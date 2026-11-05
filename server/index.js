/**
 * Tambola server bootstrap.
 *
 * This file only wires things together: HTTP + static SPA + Socket.IO + the
 * game modules + (when configured) the database. All gameplay rules live in
 * server/game/, all transport rules in server/net/, all durable writes in
 * server/persist/. Nothing in here accepts a number, a mark, a score or a
 * winner from a browser.
 *
 * `createApp()` is exported so tests can start an isolated instance on an
 * ephemeral port, with or without durability. Running this file directly
 * (`npm start`) starts one instance from the environment.
 *
 * Deployment modes
 *   DATABASE_URL set       durable mode: migrate, take the single-instance
 *                          lease, rebuild open rooms from the database, arm the
 *                          per-room calling clock. The database is the source
 *                          of truth for recovery.
 *   DATABASE_URL unset     memory mode: Phase 2 behaviour, identical protocol,
 *                          nothing survives a restart. Refused unless
 *                          ALLOW_MEMORY_ONLY=1 is also set, so a production
 *                          container that lost its database URL fails loudly at
 *                          boot instead of quietly forgetting every game.
 *
 * Environment
 *   PORT                  HTTP port (default 4000)
 *   DATABASE_URL        postgres connection string (omit for memory mode)
 *   DB_SCHEMA           schema the server pins its connections to (default public)
 *   ALLOWED_ORIGINS     comma separated browser origins allowed to connect.
 *                       Unset = same-origin only (no cross-origin sockets).
 *   CALL_INTERVAL_MS    default ms between automatic number calls
 *   MAX_PLAYERS         participants per room
 *   CHAT_INTERVAL_MS    per-player chat cooldown
 *   SESSION_IDLE_MS     session idle window (default 7 days)
 *   SESSION_ABSOLUTE_MS session hard window (default 30 days)
 *   ALLOW_MEMORY_ONLY   must be 1 to start without a database
 *   HTTP_REQUEST_TIMEOUT_MS  ms a client may take to finish one request before
 *                       the server answers 408 and frees the socket (default 30000)
 * No secrets are read or logged here. DATABASE_URL is never printed.
 */

import express from "express";
import { Server } from "socket.io";
import http from "http";
import path from "path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createRoomRegistry } from "./net/registry.js";
import { registerGameHandlers } from "./net/socket.js";
import { createSarvamTtsService } from "./voice/sarvam-tts.js";
import { DEFAULT_CONFIG, GameState } from "./game/engine.js";
import { createGameController } from "./persist/controller.js";
import { createCallScheduler } from "./persist/scheduler.js";
import { recoverRooms } from "./persist/recovery.js";
import { createMemorySessions } from "./persist/memory-sessions.js";
import { createAdmin } from "./admin/index.js";
import { mfaKeyFromEnv } from "./admin/mfa.js";
import { createModeratorRouter } from "./moderator/routes.js";
import { createAdminBookingRouter, createPublicBookingRouter } from "./bookings/routes.js";
import { createPublicThemeRouter } from "./themes/routes.js";
import { createPublicPosterRouter } from "./posters/routes.js";
import { publicPlatformManifest } from "./branding/platform.js";
import { createLogger, requestLogger } from "./observability/log.js";
import { createHealth } from "./observability/health.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function directoryExists(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

export function originList(raw = process.env.ALLOWED_ORIGINS) {
  return String(raw || "")
    .split(",")
    .map((entry) => entry.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

/** A positive integer from an env string, else null. */
function positiveInt(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

// Hard ceiling on the app pool so a mistyped DB_POOL_MAX cannot exhaust the
// database's connection slots. The single-instance lease holds one extra
// connection outside the pool; keep the total comfortably under max_connections.
const POOL_MAX_CEILING = 50;

/** Clamp a requested pool size into a safe range, defaulting when unset. */
function poolSizeFrom(raw, fallback) {
  const n = positiveInt(raw);
  if (!n) return fallback;
  return Math.min(POOL_MAX_CEILING, Math.max(1, n));
}

/**
 * Durable plumbing, in one place: pool -> migrations -> store -> sessions ->
 * controller -> scheduler. Each step is skipped when its dependency is absent,
 * which is how the same file runs in a test without Postgres and in production
 * with it.
 */
async function buildPersistence(options, log) {
  if (options.store && options.controller) {
    return { store: options.store, sessions: options.sessions, controller: options.controller, db: options.db || null, lease: null };
  }
  // An explicit in-memory request (integration tests, a laptop with no
  // Postgres) is honoured directly. Production `npm start` does NOT set it, so
  // a container that lost its DATABASE_URL fails at boot instead of quietly
  // forgetting every game.
  if (options.memoryOnly === true) {
    return { store: null, sessions: createMemorySessions({ log }), controller: null, db: null, lease: null };
  }
  const connectionString = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!connectionString) {
    if (process.env.ALLOW_MEMORY_ONLY !== "1") {
      throw new Error(
        "DATABASE_URL is not set. A running game must survive a restart; set DATABASE_URL, or ALLOW_MEMORY_ONLY=1 for local play with no durability."
      );
    }
    return { store: null, sessions: createMemorySessions({ log }), controller: null, db: null, lease: null };
  }

  const { createPool } = await import("./db/pool.js");
  const { migrate, verifyMigrationStatus } = await import("./db/migrate.js");
  const { createStore } = await import("./persist/store.js");
  const { createSessionStore } = await import("./persist/sessions.js");

  const db = createPool({
    connectionString,
    schema: options.schema || process.env.DB_SCHEMA || "public",
    // Pool size is an operational dial so a deployment can match its database
    // plan without a code change. Default 8. Keep (pool + the single lease
    // connection + a little headroom) under the plan's usable max_connections,
    // or every checkout beyond it queues and eventually times out. Clamped hard
    // so a mis-set value cannot exhaust the server's connection slots.
    max: poolSizeFrom(options.poolMax ?? process.env.DB_POOL_MAX, 8),
    connectionTimeoutMillis: positiveInt(process.env.DB_POOL_ACQUIRE_TIMEOUT_MS) || 5000,
    log: (...args) => log("db", ...args),
  });
  if (process.env.AUTO_MIGRATE === "1" && process.env.NODE_ENV !== "production") {
    await migrate({ db, log: (...args) => log("migrate", ...args) });
  } else {
    await verifyMigrationStatus({ db });
  }
  const lease = await db.acquireInstanceLease({ holder: options.instanceId });
  const store = createStore({ db, log });
  const sessions = createSessionStore({
    db,
    log,
    idleMs: Number(options.sessionIdleMs ?? process.env.SESSION_IDLE_MS) || undefined,
    absoluteMs: Number(options.sessionAbsoluteMs ?? process.env.SESSION_ABSOLUTE_MS) || undefined,
  });
  return { store, sessions, db, lease, controller: null };
}

/**
 * Build the whole stack. `options.origins` is the browser allow-list; an empty
 * list means same-origin only. `options.port` 0 asks the OS for a free port.
 */
export async function createApp(options = {}) {
  const allowedOrigins = options.origins || originList();
  const production = options.production ?? process.env.NODE_ENV === "production";
  const memoryAllowed = process.env.ALLOW_MEMORY_ONLY === "1";
  // One structured logger for the whole process; `log(...)` stays the legacy
  // positional adapter every existing module already calls.
  const logger = options.logger || createLogger({ level: options.logLevel || process.env.LOG_LEVEL || "info", service: "tambola" });
  const log = options.log || logger.shim;
  const app = express();
  const sarvamTts = options.sarvamTts || createSarvamTtsService({
    apiKey: options.sarvamApiKey ?? process.env.SARVAM_API_KEY ?? "",
    fetchImpl: options.sarvamFetch || globalThis.fetch,
  });
  // Express adds `X-Powered-By: Express` to every response by default. It
  // advertises the stack to anyone scanning the port and buys nothing.
  app.disable("x-powered-by");
  const server = http.createServer(app);
  /**
   * Node gives a client five minutes to finish one request. A caller that
   * declares a body and then dribbles it (or never sends the rest) would hold a
   * socket that long — a textbook slowloris shape. Thirty seconds is far longer
   * than any honest browser needs on a cellular connection, and an unfinished
   * request is answered 408 rather than held hostage.
   */
  server.requestTimeout = Number(process.env.HTTP_REQUEST_TIMEOUT_MS) || 30000;
  // Behind a real proxy (nginx, a PaaS) TRUST_PROXY=1 makes req.ip / req.protocol
  // reflect the client instead of the proxy. Off by default so a direct client
  // cannot spoof its own address.
  if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);

  const persistence = await buildPersistence(options, log);
  const durable = Boolean(persistence.store);

  /**
   * Runtime state three other things read: the drain flag flips readiness to
   * 503 the moment a shutdown begins (so a load balancer stops sending traffic
   * before the listener closes), and `lease` records whether this process still
   * owns the database.
   */
  const runtime = {
    draining: false,
    lease: { holder: persistence.lease ? persistence.lease.holder : null, held: Boolean(persistence.lease), lost: false, lastHeartbeatAt: persistence.lease ? Date.now() : null },
  };
  let leaseTimer = null;
  let themeReleaseTimer = null;
  let closing = null;

  /**
   * Same-origin by default. A cross-origin browser is accepted only when its
   * Origin is exactly one of the allowed origins; "null" and absent origins
   * (curl, health probes, server-to-server clients) pass through so operational
   * checks still work.
   */
  function corsOrigin(origin, callback) {
    if (!origin || origin === "null") return callback(null, false);
    if (allowedOrigins.length === 0) return callback(null, false);
    return callback(null, allowedOrigins.includes(origin.replace(/\/+$/, "")));
  }

  /**
   * Every request gets a correlation id (or keeps a well-formed inbound one) and
   * one structured line when it finishes. Registered first so the id exists even
   * if a later middleware fails.
   */
  app.use(requestLogger(logger));

  app.use((req, res, next) => {
    corsOrigin(req.headers.origin, (err, allow) => {
      if (err) return next(err);
      if (allow) {
        // `allow` is the verdict; the header must carry the ORIGIN. Writing the
        // boolean here used to send `Access-Control-Allow-Origin: true`, which
        // no browser accepts — the allow-list silently did nothing over HTTP.
        res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Credentials", "false");
      } else if (allowedOrigins.length > 0) {
        res.setHeader("Vary", "Origin");
      }
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Referrer-Policy", "same-origin");
      res.setHeader("X-DNS-Prefetch-Control", "off");
      res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
      /**
       * The build is first-party: one script, one stylesheet, no third-party
       * host and no eval. `style-src` keeps 'unsafe-inline' because React sets
       * inline styles on a few animated elements; `img-src data:` is needed for
       * the MFA QR bitmap, which is rendered locally, not fetched.
       */
      res.setHeader(
        "Content-Security-Policy",
        [
          "default-src 'self'",
          "base-uri 'none'",
          "object-src 'none'",
          "frame-ancestors 'none'",
          "form-action 'self'",
          // Local GLB loading needs Blob URLs for embedded textures and the
          // Draco decoder worker. Keep blob execution limited to workers; page
          // scripts remain first-party and blob fetches are only used for the
          // parsed, local asset bytes.
          "img-src 'self' data: blob:",
          "style-src 'self' 'unsafe-inline'",
          "script-src 'self' 'wasm-unsafe-eval'",
          "worker-src 'self' blob:",
          "connect-src 'self' blob: ws: wss:",
          "font-src 'self' data:",
        ].join("; ")
      );
      // HSTS only when the deployment is actually behind TLS; otherwise a
      // developer's http://localhost would be pinned to https for months.
      if (production) res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
      next();
    });
  });

  const clientDist = options.clientDist || path.join(__dirname, "..", "client", "dist");
  const hasBuild = directoryExists(clientDist);

  const io = new Server(server, {
    cors: { origin: (origin, cb) => corsOrigin(origin, cb), methods: ["GET", "POST"], credentials: false },
    serveClient: false,
    maxHttpBufferSize: 1e5,
    pingInterval: 20000,
    pingTimeout: 25000,
    allowRequest: (handshake, callback) => {
      const origin = handshake.headers && handshake.headers.origin;
      if (!origin || origin === "null" || allowedOrigins.length === 0) return callback(null, true);
      if (allowedOrigins.includes(String(origin).replace(/\/+$/, ""))) return callback(null, true);
      return callback(new Error("origin not allowed"), false);
    },
  });

  // --------------------------------------------------------------- wiring

  const controller =
    persistence.controller ||
    createGameController({
      store: persistence.store,
      sessions: persistence.sessions,
      log,
    });

  const registry = createRoomRegistry({
    io,
    config: options.config,
    log,
    onAudit: durable ? controller.onAudit : undefined,
    // In durable mode the engine runs no timer of its own: the calling clock
    // belongs to persist/scheduler.js, whose due times live in the database.
    externalScheduler: durable,
    // A seat that holds a real game is never deleted because its socket
    // blinked; the room waits for its owner instead of becoming a stranger's.
    keepHostSeat: durable,
    // Only used in memory mode; with keepHostSeat the engine never reports a
    // host gone for good.
    onHostGone: durable ? () => {} : undefined,
  });
  if (!persistence.controller) controller.bindRegistry(registry);
  const scheduler = durable
    ? createCallScheduler({
        store: persistence.store,
        registry,
        log,
        // The clock only ticks while this process still owns the database and
        // is not draining. Ownership is proven by the lease heartbeat below.
        canTick: () => !runtime.draining && !runtime.lease.lost,
        onTick: (room) => controller.handleTick(room),
      })
    : null;
  if (scheduler) controller.bindScheduler(scheduler);

  /**
   * Lease heartbeat.
   *
   * The advisory lock is held by one dedicated connection, so "is the lease
   * still ours?" is answered by trying to refresh the lease row on that same
   * connection: if the query fails the connection is gone and the lock went
   * with it; if it matches zero rows the row now names a different holder.
   * Either way this process has lost the right to write on its own initiative,
   * so it fails closed - disarm the clock, answer 503 on readiness and let the
   * supervisor decide. A half-alive instance that keeps calling numbers is far
   * worse than one that stops.
   */
  const leaseHeartbeatMs = Number(options.leaseHeartbeatMs ?? process.env.LEASE_HEARTBEAT_MS) || 30000;

  function markLeaseLost(reason) {
    if (runtime.lease.lost || runtime.draining) return;
    runtime.lease = { ...runtime.lease, held: false, lost: true, lastHeartbeatAt: Date.now() };
    if (scheduler) scheduler.stopAll();
    stopLeaseMonitor();
    logger.error("instance.lease_lost", { reason: reason || "unknown" });
    if (typeof options.onLeaseLost === "function") options.onLeaseLost(reason);
  }

  async function heartbeatOnce() {
    if (!persistence.lease || runtime.draining) return;
    const result = await persistence.lease.heartbeat();
    if (!result || result.held !== true) {
      markLeaseLost((result && result.reason) || "heartbeat refused");
      return;
    }
    runtime.lease = { holder: persistence.lease.holder, held: true, lost: false, lastHeartbeatAt: result.at };
  }

  function startLeaseMonitor() {
    if (!persistence.lease || leaseTimer) return;
    leaseTimer = setInterval(() => {
      heartbeatOnce().catch(() => markLeaseLost("heartbeat threw"));
    }, leaseHeartbeatMs);
    if (typeof leaseTimer.unref === "function") leaseTimer.unref();
    heartbeatOnce().catch(() => {});
  }

  function stopLeaseMonitor() {
    if (leaseTimer) clearInterval(leaseTimer);
    leaseTimer = null;
  }


  /**
   * Rebuild open rooms before anybody can connect: the database is the source
   * of truth, so a game that was RUNNING comes back at the exact number it had
   * reached, with the same draw, the same tickets and the same winners. Rooms
   * that cannot be reconstructed are frozen, never invented.
   */
  const recovery = durable
    ? await recoverRooms({
        store: persistence.store,
        registry,
        log,
        onArmed: async (room, schedule) => {
          if (room.state === GameState.RUNNING && schedule && schedule.auto_call) {
            await scheduler.recover(room, schedule);
          }
        },
      })
    : { recovered: [], frozen: [], attempted: 0 };
  for (const frozen of recovery.frozen) controller.freeze(frozen.roomId, frozen.reason);

  /**
   * Operational probes. Three questions, three answers - and none of them may
   * claim more than it knows:
   *
   *   GET /livez   process-level only, never touches the database, so a Postgres
   *                outage cannot make a supervisor kill a healthy server.
   *   GET /readyz  can this process take traffic: database reachable, migrations
   *                current, instance lease held, not draining. 503 otherwise.
   *   GET /healthz the same facts as one object, for an operator or a script.
   *
   * Memory mode is an explicit development fallback: it answers ready with
   * `durable: false` and a note, and refuses readiness outright in production.
   * No probe returns a connection string, a query, a stack trace or a secret.
   */
  const health = createHealth({
    durable,
    db: persistence.db,
    production,
    memoryAllowed,
    lease: () => runtime.lease,
    draining: () => runtime.draining,
    rooms: () => ({ live: registry.size(), frozen: controller.summary().frozen.length }),
    /**
     * The calling clock, as a probe can see it. The scheduler holds one timer
     * per RUNNING room; `overdue` means a deadline passed by more than a minute
     * without a tick. It is reported, never used to fail readiness: a single
     * slow query can delay a tick, while a lost lease or a drain already has
     * its own reason code.
     */
    scheduler: () => {
      if (!scheduler) return null;
      const armed = scheduler.armed();
      let next = null;
      for (const entry of armed) {
        const at = entry.nextDueAt instanceof Date ? entry.nextDueAt.getTime() : Date.parse(entry.nextDueAt || "");
        if (Number.isFinite(at) && (next === null || at < next)) next = at;
      }
      const now = Date.now();
      return {
        armed: armed.length,
        nextDueInMs: next === null ? null : Math.max(0, next - now),
        overdue: next !== null && next < now - 60000,
        ticking: !runtime.draining && !runtime.lease.lost,
      };
    },
    pool: () => {
      const handle = persistence.db;
      if (!handle || !handle.pool) return null;
      return {
        total: handle.pool.totalCount || 0,
        idle: handle.pool.idleCount || 0,
        waiting: handle.pool.waitingCount || 0,
        max: (handle.pool.options && handle.pool.options.max) || null,
        errors: handle.connectionErrors(),
      };
    },
  });

  app.get("/livez", (req, res) => {
    res.json(health.liveness());
  });

  app.get("/readyz", async (req, res) => {
    const ready = await health.readiness();
    res.status(ready.ready ? 200 : 503).json(ready);
  });

  app.get("/healthz", async (req, res) => {
    const report = await health.report();
    res.status(report.ok ? 200 : 503).json(report);
  });

  /**
   * The private owner control centre. Mounted at /api/admin BEFORE the SPA
   * catch-all so an authenticated owner can read and drive the game stack; an
   * unauthenticated caller gets a 401 from the router, never the SPA and never
   * any administrative data. Reads prefer the durable queries; lifecycle
   * mutations go through `controller`, the same one-writer durable path a
   * connected host uses.
   */
  const ownerMfaConfig = options.mfaKey === undefined ? mfaKeyFromEnv() : options.mfaKey;
  const admin = createAdmin({
    db: persistence.db || null,
    durable,
    registry,
    controller,
    config: options.config,
    log,
    production,
    publicOrigin: options.publicOrigin || process.env.PUBLIC_ORIGIN || null,
    ownerStore: options.ownerStore || null,
    ownerSessions: options.ownerSessions || null,
    audit: options.audit || null,
    queries: options.adminQueries || null,
    rateLimiter: options.loginRateLimiter || null,
    throttle: options.throttle || null,
    challenges: options.mfaChallenges || null,
    mfaKey: ownerMfaConfig,
    mfaIssuer: options.mfaIssuer || process.env.MFA_ISSUER || "Tambola",
    healthProbe: options.healthProbe || health,
  });
  app.get("/api/public/branding", async (_req, res, next) => {
    try {
      const { branding } = await admin.platformBrandingService.get();
      res.setHeader("Cache-Control", "no-store");
      res.json({ ok: true, branding });
    } catch (error) { next(error); }
  });
  app.get("/api/public/manifest.webmanifest", async (_req, res, next) => {
    try {
      const { branding } = await admin.platformBrandingService.get();
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
      res.send(JSON.stringify(publicPlatformManifest(branding, {
        name: typeof _req.query.fallbackName === "string" ? _req.query.fallbackName : undefined,
        subtitle: typeof _req.query.fallbackSubtitle === "string" ? _req.query.fallbackSubtitle : undefined,
        icon: typeof _req.query.fallbackIcon === "string" ? _req.query.fallbackIcon : undefined,
        accent: typeof _req.query.fallbackAccent === "string" ? _req.query.fallbackAccent : undefined,
      })));
    } catch (error) { next(error); }
  });
  if (durable && persistence.db) {
    app.use("/api/public", createPublicBookingRouter({ db: persistence.db }));
    app.use("/api/public", createPublicThemeRouter({ service: admin.themeService }));
    app.use("/api/public", createPublicPosterRouter({ service: admin.posterService }));
    app.use("/api/admin", createAdminBookingRouter({
      db: persistence.db,
      ownerSessions: admin.ownerSessions,
      ownerStore: admin.ownerStore,
      throttle: admin.throttle,
      audit: admin.audit,
      requireMfa: production,
    }));
  } else {
    app.use("/api/public", (_req, res) => res.status(503).json({ ok: false, code: "DURABLE_REQUIRED", error: "scheduled bookings require PostgreSQL" }));
  }
  app.use("/api/admin", admin.router);

  if (hasBuild && admin.posterService) app.get("/poster/:posterId", async (req, res, next) => {
    try {
      const poster = await admin.posterService.getPublicPoster(req.params.posterId);
      if (!poster) return next();
      const host = String(req.get("host") || "");
      if (!/^[a-z0-9.-]+(?::[0-9]{1,5})?$/i.test(host)) return res.status(400).type("text/plain").send("Invalid host");
      const origin = String(options.publicOrigin || process.env.PUBLIC_ORIGIN || `${req.protocol}://${host}`).replace(/\/$/, "");
      const absoluteUrl = `${origin}/poster/${encodeURIComponent(poster.posterId)}`;
      const imagePath = poster.data.artworkAssetId
        ? `/api/public/posters/${encodeURIComponent(poster.posterId)}/artwork`
        : "/brand/tambola-house-social-card.svg";
      const absoluteImage = `${origin}${imagePath}`;
      const facts = poster.data.eventFacts;
      const patterns = Array.isArray(facts?.winningPatterns) ? facts.winningPatterns.map((item) => `${item.label}: ${item.points} game points`).join(" · ") : "";
      const bookingLink = poster.data.bookingUrl
        ? new URL(poster.data.bookingUrl, origin).href
        : facts?.publicJoinUrl ? `${origin}${facts.publicJoinUrl}` : null;
      const description = [poster.data.details, poster.data.eventDetails, poster.data.schedule, poster.data.venue, poster.data.organizerName && `Hosted by ${poster.data.organizerName}`, poster.data.contactInfo, patterns, bookingLink ? `Join: ${bookingLink}` : "Free to play"].filter(Boolean).join(" · ").slice(0, 500);
      const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll("\"", "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      let html = fs.readFileSync(path.join(clientDist, "index.html"), "utf8");
      html = html.replace(/<title>.*?<\/title>/i, `<title>${escape(poster.data.title)}</title>`)
        .replace(/(<meta\s+name="description"\s+content=")[^"]*("\s*\/>)/i, (_match, before, after) => `${before}${escape(description)}${after}`)
        .replace(/(<meta\s+property="og:title"\s+content=")[^"]*("\s*\/>)/i, (_match, before, after) => `${before}${escape(poster.data.title)}${after}`)
        .replace(/(<meta\s+property="og:description"\s+content=")[^"]*("\s*\/>)/i, (_match, before, after) => `${before}${escape(description)}${after}`)
        .replace("<meta property=\"og:type\" content=\"website\" />", `<meta property="og:type" content="website" /><meta property="og:url" content="${escape(absoluteUrl)}" /><meta property="og:image" content="${escape(absoluteImage)}" /><meta name="twitter:card" content="summary_large_image" /><meta name="twitter:title" content="${escape(poster.data.title)}" /><meta name="twitter:description" content="${escape(description)}" /><meta name="twitter:image" content="${escape(absoluteImage)}" />`);
      res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
      return res.type("html").send(html);
    } catch (error) { return next(error); }
  });

  // Only the process holding the durable game lease runs the publication
  // clock. A database row lock and a unique local date also make retries safe.
  if (persistence.lease && (admin.themeService || admin.posterService)) {
    const runDailyPublications = async () => {
      if (runtime.draining || runtime.lease.lost) return;
      if (admin.themeService) try {
        const result = await admin.themeService.runScheduledRelease();
        if (result?.error) log("theme release rejected", result.error);
        else if (result?.source === "daily") log("daily theme released", result.themeVersionId, result.publishedAt);
      } catch (error) {
        log("daily theme release failed", error && error.message);
      }
      if (admin.posterService) try {
        const result = await admin.posterService.runScheduledRelease();
        if (result?.error) log("poster template release rejected", result.error);
        else if (result?.source === "daily") log("daily poster template released", result.templateVersionId, result.publishedAt);
      } catch (error) {
        log("daily poster template release failed", error && error.message);
      }
    };
    themeReleaseTimer = setInterval(runDailyPublications, 60_000);
    if (typeof themeReleaseTimer.unref === "function") themeReleaseTimer.unref();
    runDailyPublications().catch(() => {});
  }

  let moderatorService = null;
  if (durable && persistence.db) {
    moderatorService = createModeratorRouter({
      db: persistence.db,
      controller,
      registry,
      queries: admin.queries,
      throttle: admin.throttle,
      mfaKey: ownerMfaConfig && ownerMfaConfig.configured ? ownerMfaConfig.key : null,
      log,
    });
    app.use("/api/moderator", moderatorService.router);
  } else {
    app.use("/api/moderator", (_req, res) => res.status(503).json({ ok: false, code: "DURABLE_REQUIRED", error: "moderator access requires PostgreSQL" }));
  }
  app.get("/api/voice/status", (_req, res) => {
    const status = sarvamTts.status();
    res.set("Cache-Control", "no-store").json({ ok: true, configured: status.configured, languages: status.languages });
  });
  registerGameHandlers(io, { rooms: registry, controller, log, limits: options.limits, db: persistence.db, moderatorAuth: moderatorService?.auth || null, sarvamTts });

  // ---------------------------------------------------- web client + fallbacks
  // Registered AFTER the admin API so /api/admin/* is never swallowed by the
  // single-page-app catch-all. Ordering is the whole contract here.
  if (hasBuild) {
    app.use(express.static(clientDist, { index: "index.html", fallthrough: true }));
  }

  app.get("*", (req, res) => {
    const index = path.join(clientDist, "index.html");
    if (runtime.draining) {
      return res.status(503).type("text/plain").send("Tambola is restarting");
    }
    if (!hasBuild) {
      return res
        .status(503)
        .type("text/plain")
        .send("Tambola API is running. The web client has not been built yet - run: npm run build");
    }
    res.sendFile(index, (err) => {
      if (err) res.status(500).type("text/plain").send("client build is missing or unreadable");
    });
  });

  app.use((req, res) => {
    res.status(404).json({ ok: false, error: "not found" });
  });

  /**
   * The last line. A database error string can quote a parameter value and a
   * thrown error can quote a path, so the detail is logged (redacted, with the
   * request id) and only a generic answer is ever sent to the client.
   */
  app.use((error, req, res, next) => {
    if (error && error.code === "ENOENT") return res.status(500).send("client build is missing");
    if (res.headersSent) return next(error);
    /**
     * A body the client sent badly is the client's mistake, not an outage.
     * `express.json` marks it entity.too.large (413) or entity.parse.failed
     * (400); answering 500 would page an operator for someone's bad payload
     * and would tell the caller nothing they can act on. The message stays
     * generic, and the detail is logged rather than returned.
     */
    const status = Number(error && (error.status || error.statusCode));
    if (status >= 400 && status < 500) {
      const code =
        error.type === "entity.too.large"
          ? "PAYLOAD_TOO_LARGE"
          : error.type === "entity.parse.failed"
            ? "MALFORMED_BODY"
            : "BAD_REQUEST";
      logger.warn("request.refused", {
        requestId: req.id || null,
        method: req.method,
        path: String(req.path || req.url || "").split("?")[0],
        status,
        code,
      });
      return res.status(status).json({
        ok: false,
        code,
        error: status === 413 ? "that request body is too large" : "that request body could not be read",
        requestId: req.id || null,
      });
    }
    logger.error("request.failed", {
      requestId: req.id || null,
      method: req.method,
      path: String(req.path || req.url || "").split("?")[0],
      error: error && error.message,
      code: (error && error.code) || null,
    });
    res.status(500).json({ ok: false, error: "internal error", requestId: req.id || null });
  });

  function listen(port) {
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, () => {
        startLeaseMonitor();
        startMaintenance();
        resolve(server.address().port);
      });
    });
  }

  /**
   * Housekeeping the durable backends need but no request should have to pay
   * for: expired lockout rows, consumed or stale MFA challenges and dead owner
   * sessions. Runs on its own timer so a busy sign-in path never triggers a
   * table sweep.
   */
  const maintenanceMs = Number(process.env.MAINTENANCE_INTERVAL_MS) || 300000;
  let maintenanceTimer = null;

  async function runMaintenance() {
    try {
      await admin.throttle.prune?.();
      await admin.challenges.prune?.();
      await admin.ownerSessions.purgeExpired?.();
    } catch (error) {
      logger.warn("maintenance.pass_failed", { error: error && error.message });
    }
  }

  function startMaintenance() {
    if (maintenanceTimer || !durable) return;
    maintenanceTimer = setInterval(() => {
      runMaintenance().catch(() => {});
    }, maintenanceMs);
    if (typeof maintenanceTimer.unref === "function") maintenanceTimer.unref();
    runMaintenance().catch(() => {});
  }

  function stopMaintenance() {
    if (maintenanceTimer) clearInterval(maintenanceTimer);
    maintenanceTimer = null;
  }

  /**
   * Shut the whole instance down. Deliberately NOT called `close`, which is
   * registry.close(roomId) - closing one room is a different thing entirely.
   *
   * A graceful shutdown closes the open rooms durably: players are told the
   * server is going away and their history is kept. A crash never runs this,
   * which is exactly why the next boot can tell "planned stop" (closed rows)
   * from "came back to life" (open rows to recover).
   *
   * The drain flag flips first, and it is what makes the rest of the sequence
   * honest: readiness answers 503 within its cache window, the scheduler refuses
   * to tick, and the SPA catch-all tells the visitor the server is restarting
   * instead of serving a shell that cannot open a socket.
   */
  function closeServer({ closeRoomsDurably = durable } = {}) {
    return new Promise((resolve) => {
      runtime.draining = true;
      stopLeaseMonitor();
      stopMaintenance();
      if (themeReleaseTimer) clearInterval(themeReleaseTimer);
      themeReleaseTimer = null;
      if (scheduler) scheduler.stopAll();
      io.close(() => {
        server.close(async () => {
          try {
            if (closeRoomsDurably) {
              for (const room of registry.all()) {
                await controller.closeRoom({ roomId: room.roomId, reason: "server shutting down" }).catch(() => {});
              }
            } else {
              registry.destroyAll();
            }
            if (persistence.lease) await persistence.lease.release();
            if (persistence.db) await persistence.db.end();
          } catch (error) {
            log("shutdown cleanup failed", error && error.message);
          }
          resolve();
        });
      });
    });
  }

  return {
    app,
    server,
    io,
    registry,
    sarvamTts,
    controller,
    scheduler,
    store: persistence.store,
    sessions: persistence.sessions,
    db: persistence.db,
    lease: persistence.lease,
    recovery,
    durable,
    admin,
    health,
    listen,
    closeServer,
    allowedOrigins,
    // Observable shutdown/lease state, for probes and for the tests that have to
    // prove a drain actually happens.
    get draining() {
      return runtime.draining;
    },
    get leaseState() {
      return { ...runtime.lease };
    },
  };
}

// ------------------------------------------------------------------ bootstrap

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const port = Number(process.env.PORT) || 4000;
  let instance;
  try {
    instance = await createApp({
      config: {
        callIntervalMs: Number(process.env.CALL_INTERVAL_MS) || DEFAULT_CONFIG.callIntervalMs,
        maxPlayers: Number(process.env.MAX_PLAYERS) || DEFAULT_CONFIG.maxPlayers,
        chatIntervalMs: Number(process.env.CHAT_INTERVAL_MS) || DEFAULT_CONFIG.chatIntervalMs,
      },
    });
  } catch (error) {
    console.error("[tambola] could not start:", error.message);
    if (error.code === "INSTANCE_LOCKED") console.error("[tambola] another server already owns this database schema");
    process.exit(1);
  }

  instance.listen(port).then((bound) => {
    console.log(
      `Tambola server listening on ${bound} (origins: ${instance.allowedOrigins.join(", ") || "same-origin"}, ` +
        `persistence: ${instance.durable ? "durable" : "memory only"}, ` +
        `recovered: ${instance.recovery.recovered.length} room(s), frozen: ${instance.recovery.frozen.length})`
    );
  });

  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[tambola] ${signal} received, closing rooms`);
    instance.closeServer().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("unhandledRejection", (error) => console.error("[tambola] unhandled rejection", error && error.message));
}
