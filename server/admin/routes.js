/**
 * The owner control-centre HTTP API, mounted at /api/admin.
 *
 * This is the only surface that can read administrative data or perform
 * administrative mutations, and every route here is gated on a verified owner
 * session - never a game-host token, never a client role flag, never a URL.
 *
 * Layering, from the outside in:
 *   CSRF guard      every non-GET request must present the double-submit token
 *   requireOwner    a live owner session cookie, re-resolved on each request
 *   validation      payloads are checked before anything touches the engine
 *   controller      lifecycle mutations go through persist/controller.js, the
 *                   same durable, one-writer, durable-before-authoritative path
 *                   a connected host uses. Nothing here writes the database
 *                   directly to change a game.
 *   audit           each mutation and sign-in decision is written to admin_audit
 *
 * Reads prefer the durable queries (server/admin/queries.js). Without a
 * database the same routes serve live, in-process state and are explicit when a
 * durable feature (history) is unavailable, rather than inventing numbers.
 */

import express from "express";
import { createHash } from "node:crypto";
import QRCode from "qrcode";
import { readOwnerToken, setOwnerCookie, clearOwnerCookie, ensureCsrfToken, verifyCsrf } from "./cookies.js";
import { ADMIN_ACTIONS } from "./audit.js";
import { PATTERNS, enabledPatternIds } from "../game/patterns.js";
import { resolvePublicOrigin, createInvitation } from "./invites.js";
import { hashPassword, verifyPassword } from "./password.js";
import { decryptSecret, describeMfa, encryptSecret, generateSecret, provisioningUri, verifyCode } from "./mfa.js";
import { CHALLENGE_CODES } from "./mfa-challenges.js";
import { createModeratorAdminRouter } from "./moderators.js";
import { createAdminThemeRouter } from "../themes/routes.js";
import { createAdminPosterRouter } from "../posters/routes.js";
import { publicInstanceBranding, validateInstanceBranding } from "../instances/branding.js";
import { readBackupStatus } from "./backup-status.js";
import { createPlatformBrandingService } from "../branding/platform.js";
import { validateRoomDefaults } from "../instances/room-defaults.js";

const ROOM_ID_RE = /^[A-HJ-NP-Z2-9]{4,12}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;
const MIN_INTERVAL = 1000;
const MAX_INTERVAL = 120000;

function isRoomId(value) {
  return typeof value === "string" && ROOM_ID_RE.test(value);
}

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function safeName(value, fallback = null) {
  if (typeof value !== "string") return fallback;
  const clean = value.trim().replace(/\s+/g, " ");
  if (!clean.length || clean.length > 40) return fallback;
  return clean;
}

/** Clean a client pattern selection into an explicit id->boolean config map. */
function cleanPatterns(body) {
  const known = Object.keys(PATTERNS);
  if (Array.isArray(body.enabledPatterns)) {
    const set = new Set(body.enabledPatterns.filter((id) => known.includes(id)));
    return { patterns: Object.fromEntries(known.map((id) => [id, set.has(id)])), enabled: known.filter((id) => set.has(id)) };
  }
  if (body.patterns && typeof body.patterns === "object") {
    const patterns = {};
    for (const id of known) {
      const value = body.patterns[id];
      patterns[id] = value === undefined ? PATTERNS[id].enabledByDefault : Boolean(value);
    }
    return { patterns, enabled: known.filter((id) => patterns[id]) };
  }
  return { patterns: undefined, enabled: enabledPatternIds({}) };
}

/** Map an engine/controller result code to an honest HTTP status. */
function statusForCode(code) {
  switch (code) {
    case "ROOM_NOT_FOUND":
    case "UNKNOWN_PLAYER":
      return 404;
    case "NOT_HOST":
    case "RECOVERY_REQUIRED":
      return 423;
    case "PERSIST_FAILED":
    case "ADMIN_UNAVAILABLE":
      return 503;
    case "INVALID_STATE":
    case "INVALID_TRANSITION":
    case "ROOM_NOT_LIVE":
    case "DRAW_EXHAUSTED":
    case "ALREADY_AWARDED":
    case "ALREADY_CLAIMED_BY_YOU":
    case "NOT_DUE":
    case "NOT_ALLOWED":
      return 409;
    case "BAD_PAYLOAD":
      return 400;
    default:
      return 400;
  }
}

function dbUnavailable(error) {
  const code = error && error.code;
  if (typeof code === "string" && (code.startsWith("ECONN") || code.startsWith("ETIMEDOUT") || code === "57P01" || code === "57P03")) return true;
  if (error && error.code === "PERSIST_FAILED") return true;
  return false;
}

export function createAdminRouter({
  db = null,
  ownerStore,
  ownerSessions,
  audit,
  queries = null,
  registry,
  controller,
  config = {},
  publicOrigin = null,
  throttle,
  challenges,
  mfa = { configured: false, key: null, issuer: "Ninety Club" },
  production = false,
  themeService = null,
  posterService = null,
  platformBrandingService = createPlatformBrandingService(),
  healthProbe = null,
  log = () => {},
} = {}) {
  const durable = Boolean(queries);
  const router = express.Router();

  /** Keep operational details owner-only and strip everything but bounded counters. */
  function ownerHealthSummary(report, fallback = null) {
    const mode = report?.mode || (durable ? "durable" : "memory");
    const database = mode === "memory"
      ? "not-configured"
      : report
        ? report.database ? "ok" : "down"
        : fallback?.ok ? "ok" : "down";
    const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
    const scheduler = report?.scheduler && typeof report.scheduler === "object"
      ? {
          armed: count(report.scheduler.armed),
          nextDueInMs: Number.isFinite(report.scheduler.nextDueInMs) ? Math.max(0, report.scheduler.nextDueInMs) : null,
          overdue: Boolean(report.scheduler.overdue),
          ticking: Boolean(report.scheduler.ticking),
        }
      : null;
    const pool = report?.pool && typeof report.pool === "object"
      ? {
          total: count(report.pool.total),
          idle: count(report.pool.idle),
          waiting: count(report.pool.waiting),
          max: count(report.pool.max),
          errors: count(report.pool.errors),
        }
      : null;
    return {
      mode,
      readiness: report ? (report.ready ? (report.degraded ? "degraded" : "ready") : "not-ready") : "unknown",
      degraded: Boolean(report?.degraded),
      database,
      application: report?.live === false ? "down" : "ok",
      migrations: report?.migrations && typeof report.migrations === "object"
        ? {
            current: Boolean(report.migrations.current),
            latest: typeof report.migrations.latest === "string" ? report.migrations.latest : null,
            pending: Array.isArray(report.migrations.pending) ? report.migrations.pending.filter((name) => typeof name === "string").slice(0, 50) : [],
          }
        : null,
      lease: report?.lease && typeof report.lease === "object"
        ? { held: Boolean(report.lease.held), lost: Boolean(report.lease.lost) }
        : null,
      draining: Boolean(report?.draining),
      rooms: report?.rooms && typeof report.rooms === "object"
        ? { live: count(report.rooms.live), frozen: count(report.rooms.frozen) }
        : null,
      scheduler,
      pool,
      reasons: Array.isArray(report?.reasons) ? report.reasons.filter((reason) => typeof reason === "string").slice(0, 10) : [],
      uptimeSeconds: count(report?.uptimeSeconds),
      checkedAt: Number.isFinite(report?.at) ? new Date(report.at).toISOString() : null,
    };
  }

  /**
   * A client that declares a body and then stops sending would keep `express.json`
   * waiting indefinitely: Node's `server.requestTimeout` does not fire for a body
   * that already started, and body-parser has no timeout option of its own.
   * Answer 408 as the client's error, with `Connection: close` so the half-filled
   * request cannot confuse whatever the socket carried next. One knob
   * (`HTTP_REQUEST_TIMEOUT_MS`) bounds both stall shapes.
   */
  const requestTimeoutMs = Number(process.env.HTTP_REQUEST_TIMEOUT_MS) || 30000;
  router.use((req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
    };
    const timer = setTimeout(() => {
      if (settled || res.headersSent) return;
      finish();
      log("admin request body timed out", req.method, req.path, 408, "REQUEST_TIMEOUT");
      res.setHeader("Connection", "close");
      res.status(408).json({ ok: false, code: "REQUEST_TIMEOUT", error: "the request body did not arrive in time" });
    }, requestTimeoutMs);
    timer.unref?.();
    req.on("end", finish);
    req.on("aborted", finish);
    res.on("finish", finish);
    next();
  });

  router.use(express.json({ limit: "16kb" }));
  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });

  // CSRF: every state-changing request must carry the double-submit token.
  router.use((req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    if (!verifyCsrf(req)) {
      return res.status(403).json({ ok: false, code: "CSRF_FAILED", error: "missing or invalid CSRF token" });
    }
    next();
  });

  function ipFingerprint(req) {
    const raw = (req.ip || "") + "|tambola-admin-ip";
    return createHash("sha256").update(raw).digest("hex").slice(0, 24);
  }

  function requestOrigin(req) {
    try {
      return `${req.protocol}://${req.get("host")}`;
    } catch {
      return "";
    }
  }

  async function resolveOwner(req) {
    const token = readOwnerToken(req);
    if (!token) return { ok: false };
    const verified = await ownerSessions.verify({ token });
    if (!verified.ok) return { ok: false, clear: true };
    const owner = await ownerStore.getById(verified.ownerId);
    if (!owner) {
      await ownerSessions.revoke({ sessionId: verified.sessionId }).catch(() => {});
      return { ok: false, clear: true };
    }
    return { ok: true, owner: { ownerId: owner.ownerId, username: owner.username, sessionId: verified.sessionId } };
  }

  const requireOwner = wrap(async (req, res, next) => {
    const resolved = await resolveOwner(req);
    if (!resolved.ok) {
      clearOwnerCookie(res);
      return res.status(401).json({ ok: false, code: "UNAUTHENTICATED", error: "owner sign-in required" });
    }
    req.owner = resolved.owner;
    next();
  });

  // ------------------------------------------------------- abuse control
  // Every limiter is awaited, so the same call site works for the durable
  // (PostgreSQL) backend and the in-memory fallback. A limiter that cannot be
  // reached fails CLOSED: refusing to guess is safer than pretending the budget
  // was available.

  async function checkLimiter(limiter, key) {
    if (!limiter) return { allowed: true };
    try {
      return await limiter.check({ key });
    } catch (error) {
      log("throttle check failed", error && error.message);
      return { unavailable: true };
    }
  }

  async function spendLimiter(limiter, key) {
    try {
      return await limiter.recordFailure({ key });
    } catch (error) {
      log("throttle write failed", error && error.message);
      return { unavailable: true };
    }
  }

  async function clearLimiter(limiter, key) {
    try {
      await limiter.recordSuccess({ key });
    } catch {
      /* a counter that cannot be cleared only costs the owner a retry later */
    }
  }

  function tooMany(res, retryAfterMs) {
    const wait = Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : 60_000;
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil(wait / 1000))));
    return res.status(429).json({ ok: false, code: "RATE_LIMITED", error: "too many attempts; try again later", retryAfterMs: wait });
  }

  function throttleUnavailable(res) {
    return res.status(503).json({ ok: false, code: "ADMIN_UNAVAILABLE", error: "the control centre cannot check its safety limits right now" });
  }

  /**
   * Consume one token from the signed-in owner's mutation budget. 60 mutations a
   * minute per session is far above any human operator and far below anything
   * that could hammer the engine, and it is keyed on the session id, so one
   * misbehaving tab cannot exhaust another owner's allowance.
   */
  async function spendMutationBudget(req, res) {
    const key = `session:${req.owner.sessionId}`;
    const gate = await checkLimiter(throttle.adminMutation, key);
    if (gate.unavailable) {
      throttleUnavailable(res);
      return false;
    }
    if (!gate.allowed) {
      tooMany(res, gate.retryAfterMs);
      return false;
    }
    const spent = await spendLimiter(throttle.adminMutation, key);
    if (spent.unavailable) {
      throttleUnavailable(res);
      return false;
    }
    if (spent.locked) {
      tooMany(res, spent.retryAfterMs);
      return false;
    }
    return true;
  }

  /** Password rotation and second-factor changes get their own, tighter budget. */
  async function spendCredentialBudget(req, res) {
    const key = `session:${req.owner.sessionId}|credential`;
    const gate = await checkLimiter(throttle.credentialChange, key);
    if (gate.unavailable) {
      throttleUnavailable(res);
      return false;
    }
    if (!gate.allowed) {
      tooMany(res, gate.retryAfterMs);
      return false;
    }
    const spent = await spendLimiter(throttle.credentialChange, key);
    if (spent.unavailable) {
      throttleUnavailable(res);
      return false;
    }
    if (spent.locked) {
      tooMany(res, spent.retryAfterMs);
      return false;
    }
    return true;
  }

  router.get("/branding", requireOwner, wrap(async (_req, res) => {
    const result = await platformBrandingService.get();
    res.json({ ok: true, ...result });
  }));

  router.put("/branding", requireOwner, wrap(async (req, res) => {
    if (!(await spendMutationBudget(req, res))) return;
    const result = await platformBrandingService.save(req.body?.branding, req.owner.username);
    if (result.error) return res.status(400).json({ ok: false, code: result.error, error: "platform branding is invalid" });
    await audit.record({
      actor: req.owner.username,
      action: "PLATFORM_BRANDING_UPDATE",
      targetType: "platform_branding",
      targetId: "branding",
      metadata: { fields: Object.keys(result.branding).sort() },
    });
    res.json({ ok: true, ...result });
  }));

  if (db) router.use("/moderators", requireOwner, createModeratorAdminRouter({ db, audit, spendMutationBudget }));
  if (db && themeService) router.use("/themes", requireOwner, createAdminThemeRouter({ service: themeService, spendMutationBudget }));
  if (db && posterService) router.use("/posters", requireOwner, createAdminPosterRouter({ service: posterService, spendMutationBudget }));

  // ------------------------------------------------------ second factor

  function mfaState(account) {
    if (!account) return describeMfa({ keyConfigured: mfa.configured });
    return describeMfa({
      confirmedAt: account.totpConfirmedAt || null,
      pending: Boolean(account.totpSecretEnc) && !account.totpConfirmedAt,
      keyConfigured: mfa.configured,
    });
  }

  /** Decrypt the enrolled secret, or null when it cannot be used right now. */
  function openSecret(account) {
    if (!mfa.configured || !mfa.key || !account || !account.totpSecretEnc) return null;
    return decryptSecret({ envelope: account.totpSecretEnc, ownerId: account.ownerId, key: mfa.key });
  }

  /**
   * Check a TOTP code and consume its time step. The step is persisted by
   * `advanceMfaStep`, whose UPDATE is conditional on the step being newer, so
   * two requests carrying the same code cannot both succeed.
   */
  async function acceptSecondFactor(account, code) {
    const secret = openSecret(account);
    if (!secret) return { ok: false, code: "MFA_UNAVAILABLE" };
    const verified = verifyCode({ secret, code, lastStep: account.totpLastStep });
    if (!verified.ok) return { ok: false, code: verified.reason === "REPLAY" ? "MFA_REPLAY" : "MFA_INVALID_CODE" };
    const advanced = await ownerStore.advanceMfaStep({ ownerId: account.ownerId, step: verified.step });
    if (!advanced.ok) return { ok: false, code: "MFA_REPLAY" };
    return { ok: true, step: verified.step };
  }

  function secondFactorFailure(res, code) {
    if (code === "MFA_REPLAY") {
      return res.status(401).json({ ok: false, code, error: "that code was already used; wait for the next one" });
    }
    if (code === "MFA_UNAVAILABLE") {
      return res.status(503).json({
        ok: false,
        code,
        error: "this account requires a second factor, but the server has no OWNER_MFA_KEY configured. See server/RUNBOOK.md.",
      });
    }
    return res.status(401).json({ ok: false, code: "MFA_INVALID_CODE", error: "that code is not valid" });
  }

  async function record(req, action, extra = {}) {
    try {
      await audit.record({ actor: req.owner ? req.owner.username : null, action, ...extra });
    } catch (error) {
      log("admin audit write failed", action, error && error.message);
    }
  }

  function operatorAuth(room) {
    return { hostToken: room.hostCredential() };
  }

  function liveRooms() {
    return registry.all();
  }

  function liveSummary(room) {
    return {
      roomId: room.roomId,
      status: room.state,
      gameNumber: room.gameNumber || 0,
      createdAt: room.createdAt ? new Date(room.createdAt).toISOString() : null,
      updatedAt: null,
      closedAt: null,
      gameName: (room.config && room.config.name) || null,
      recoveryError: null,
      seatedPlayers: room.players.size,
      totalPlayers: room.players.size,
      callsThisRound: room.cursor || 0,
      liveInProcess: true,
      hostConnected: Boolean(room.hostSocketId),
    };
  }

  function liveDetail(room) {
    const snap = room.publicSnapshot();
    return {
      roomId: room.roomId,
      status: snap.state,
      gameNumber: room.gameNumber || 0,
      hostPlayerId: room.hostPlayerId,
      config: room.config,
      recoveryError: null,
      createdAt: room.createdAt ? new Date(room.createdAt).toISOString() : null,
      updatedAt: null,
      closedAt: null,
      calledNumbers: snap.calledNumbers.map((number, index) => ({ index: index + 1, number, source: "live", at: null })),
      members: snap.players.map((p) => ({
        playerId: p.id,
        role: p.isHost ? "host" : "player",
        displayName: p.name,
        connected: p.connected,
        joinedAt: null,
        lastSeenAt: null,
        leftAt: null,
      })),
      tickets: [],
      claims: (room.claimLog || []).map((c) => ({
        claimId: null,
        gameNumber: room.gameNumber || 0,
        playerId: c.playerId,
        displayName: c.name,
        pattern: c.pattern,
        status: c.accepted ? "AWARDED" : "REJECTED",
        reason: c.reason,
        callIndex: c.callIndex,
        decidedAt: c.at ? new Date(c.at).toISOString() : null,
      })),
      awards: (snap.awards || []).map((a) => ({
        gameNumber: room.gameNumber || 0,
        playerId: a.playerId,
        displayName: a.name,
        pattern: a.pattern,
        points: a.points,
        callIndex: a.callIndex,
        awardedAt: null,
      })),
      rounds: [],
      gameAudit: [],
      liveInProcess: true,
    };
  }

  // ------------------------------------------------------------- session state

  router.get(
    "/session",
    wrap(async (req, res) => {
      const csrfToken = ensureCsrfToken(req, res);
      let setupRequired = false;
      try {
        setupRequired = (await ownerStore.count()) === 0;
      } catch {
        return res.status(503).json({ ok: false, code: "ADMIN_UNAVAILABLE", error: "the control centre cannot reach its database right now" });
      }
      const resolved = await resolveOwner(req);
      if (!resolved.ok && resolved.clear) clearOwnerCookie(res);
      let mfaInfo = { state: mfa.configured ? "not-enrolled" : "unavailable", available: Boolean(mfa.configured) };
      if (resolved.ok) {
        const account = await ownerStore.getByUsername(resolved.owner.username).catch(() => null);
        mfaInfo = { ...mfaState(account), available: Boolean(mfa.configured) };
      }
      res.json({
        ok: true,
        authenticated: resolved.ok,
        owner: resolved.ok ? { username: resolved.owner.username } : null,
        setupRequired,
        csrfToken,
        durable,
        mfa: mfaInfo,
      });
    })
  );

  /**
   * Step one of sign-in: the password.
   *
   * With no second factor enrolled this still returns a session, exactly as in
   * Phase 5. With one enrolled it returns ONLY a short-lived challenge - no
   * cookie, no session row - so a stolen password buys nothing without the
   * authenticator. The response says which case it is, because the caller has
   * already proven the password at that point.
   */
  router.post(
    "/signin",
    wrap(async (req, res) => {
      const body = req.body || {};
      const username = typeof body.username === "string" ? body.username.trim() : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (username.length < 3 || username.length > 40 || password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
        return res.status(400).json({ ok: false, code: "INVALID_INPUT", error: "a valid username and password are required" });
      }
      let count;
      try {
        count = await ownerStore.count();
      } catch {
        return res.status(503).json({ ok: false, code: "ADMIN_UNAVAILABLE", error: "the control centre cannot reach its database right now" });
      }
      if (count === 0) {
        return res.status(503).json({
          ok: false,
          code: "OWNER_NOT_CONFIGURED",
          error: "no owner account exists yet. Create one with the documented bootstrap command on the server (see server/ADMIN.md).",
        });
      }

      const ip = ipFingerprint(req);
      const userKey = `${username.toLowerCase()}|${ip}`;
      const addressKey = `ip:${ip}`;
      const [userGate, addressGate] = await Promise.all([
        checkLimiter(throttle.signin, userKey),
        checkLimiter(throttle.signinIp, addressKey),
      ]);
      if (userGate.unavailable || addressGate.unavailable) return throttleUnavailable(res);
      const blocked = !userGate.allowed ? userGate : !addressGate.allowed ? addressGate : null;
      if (blocked) {
        await record(req, ADMIN_ACTIONS.SIGNIN_RATE_LIMITED, { metadata: { username: username.toLowerCase(), ip } });
        return tooMany(res, blocked.retryAfterMs);
      }

      let result;
      try {
        result = await ownerStore.verifyLogin({ username, password });
      } catch {
        return res.status(503).json({ ok: false, code: "ADMIN_UNAVAILABLE", error: "the control centre cannot reach its database right now" });
      }

      if (!result.ok) {
        const [userFail, addressFail] = await Promise.all([
          spendLimiter(throttle.signin, userKey),
          spendLimiter(throttle.signinIp, addressKey),
        ]);
        if (userFail.unavailable || addressFail.unavailable) return throttleUnavailable(res);
        await record(req, ADMIN_ACTIONS.SIGNIN_FAILURE, { metadata: { username: username.toLowerCase(), ip } });
        const locked = userFail.locked ? userFail : addressFail.locked ? addressFail : null;
        if (locked) return tooMany(res, locked.retryAfterMs);
        return res.status(401).json({ ok: false, code: "INVALID_CREDENTIALS", error: "invalid username or password" });
      }

      // The password was right: this key's history is no longer a risk signal.
      await clearLimiter(throttle.signin, userKey);

      if (result.mfaEnrolled) {
        const challenge = await challenges.issue({ ownerId: result.ownerId, ipHash: ip });
        await record(req, ADMIN_ACTIONS.SIGNIN_MFA_CHALLENGE, { metadata: { username: result.username, ip } });
        return res.json({
          ok: true,
          mfaRequired: true,
          challengeToken: challenge.token,
          expiresAt: challenge.expiresAt,
          csrfToken: ensureCsrfToken(req, res),
        });
      }

      await ownerStore.touchLogin({ ownerId: result.ownerId }).catch(() => {});
      // Fixation defence: a login always mints a brand-new session + token.
      const session = await ownerSessions.issue({ ownerId: result.ownerId, ipHash: ip });
      setOwnerCookie(res, session.token);
      await record(req, ADMIN_ACTIONS.SIGNIN_SUCCESS, { metadata: { username: result.username, ip, mfa: false } });
      res.json({
        ok: true,
        authenticated: true,
        owner: { username: result.username },
        csrfToken: ensureCsrfToken(req, res),
        mfa: describeMfa({ pending: Boolean(result.mfaPending), keyConfigured: mfa.configured }),
      });
    })
  );

  /**
   * Step two of sign-in: the authenticator code.
   *
   * The challenge token is the only credential accepted here, and it is spent
   * whether the code is right or wrong (wrong codes burn an attempt, a right
   * code consumes the challenge outright). A successful check is the only path
   * that creates an owner session.
   */
  router.post(
    "/signin/mfa",
    wrap(async (req, res) => {
      const body = req.body || {};
      const token = typeof body.challengeToken === "string" ? body.challengeToken : "";
      const ip = ipFingerprint(req);
      const addressKey = `ip:${ip}`;

      const gate = await checkLimiter(throttle.mfa, addressKey);
      if (gate.unavailable) return throttleUnavailable(res);
      if (!gate.allowed) {
        await record(req, ADMIN_ACTIONS.SIGNIN_RATE_LIMITED, { metadata: { stage: "mfa", ip } });
        return tooMany(res, gate.retryAfterMs);
      }

      const expired = () =>
        res.status(401).json({ ok: false, code: "MFA_CHALLENGE_INVALID", error: "this sign-in attempt has expired; start again" });

      if (!/^[0-9a-f]{16,128}$/.test(token)) return expired();
      const challenge = await challenges.lookup({ token });
      if (!challenge.ok) return expired();

      const account = await ownerStore.getForMfa({ ownerId: challenge.ownerId });
      if (!account) return expired();

      const accepted = await acceptSecondFactor(account, body.code);
      if (!accepted.ok) {
        const failed = await challenges.fail({ challengeId: challenge.challengeId });
        await spendLimiter(throttle.mfa, addressKey);
        await record(req, ADMIN_ACTIONS.SIGNIN_MFA_FAILURE, {
          metadata: { username: account.username, ip, reason: accepted.code, attemptsLeft: failed.attemptsLeft },
        });
        return secondFactorFailure(res, accepted.code);
      }

      const consumed = await challenges.complete({ challengeId: challenge.challengeId });
      if (!consumed.ok) {
        return res.status(409).json({ ok: false, code: "MFA_CHALLENGE_USED", error: "this sign-in attempt was already used; start again" });
      }

      await clearLimiter(throttle.mfa, addressKey);
      await ownerStore.touchLogin({ ownerId: account.ownerId }).catch(() => {});
      const session = await ownerSessions.issue({ ownerId: account.ownerId, ipHash: ip });
      setOwnerCookie(res, session.token);
      await record(req, ADMIN_ACTIONS.SIGNIN_MFA_SUCCESS, { metadata: { username: account.username, ip, mfa: true } });
      res.json({
        ok: true,
        authenticated: true,
        owner: { username: account.username },
        csrfToken: ensureCsrfToken(req, res),
        mfa: describeMfa({ keyConfigured: true, confirmedAt: account.totpConfirmedAt }),
      });
    })
  );

  router.post(
    "/signout",
    requireOwner,
    wrap(async (req, res) => {
      await ownerSessions.revoke({ sessionId: req.owner.sessionId }).catch(() => {});
      clearOwnerCookie(res);
      await record(req, ADMIN_ACTIONS.LOGOUT, { metadata: {} });
      res.json({ ok: true });
    })
  );

  // ----------------------------------------------------------------- overview

  // Platform domain. These endpoints use the existing owner session + CSRF
  // boundary; instance IDs are resolved from the database, never from UI state.
  router.get("/instances", requireOwner, wrap(async (_req, res) => {
    if (!db) return res.status(503).json({ ok: false, code: "DURABLE_REQUIRED", error: "game instances require PostgreSQL" });
    const result = await db.query(`SELECT i.instance_id, i.slug, i.display_name, i.description, i.status,
      i.public_visible, i.config, i.branding, i.created_at, i.updated_at,
      count(r.room_code)::int AS total_rooms,
      count(r.room_code) FILTER (WHERE r.closed_at IS NULL)::int AS open_rooms,
      count(r.room_code) FILTER (WHERE r.status = 'RUNNING' AND r.closed_at IS NULL)::int AS running_rooms
      FROM game_instances i LEFT JOIN rooms r ON r.game_instance_id=i.instance_id
      GROUP BY i.instance_id ORDER BY i.created_at, i.display_name`);
    res.json({ ok: true, instances: result.rows });
  }));

  router.get("/instances/:instanceId/overview", requireOwner, wrap(async (req, res) => {
    if (!durable) return res.status(503).json({ ok: false, code: "DURABLE_REQUIRED", error: "instance overview requires PostgreSQL" });
    const overview = await queries.instanceOverview(req.params.instanceId);
    if (!overview) return res.status(404).json({ ok: false, code: "INSTANCE_NOT_FOUND", error: "no such instance" });
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, source: "durable", ...overview });
  }));

  router.post("/instances", requireOwner, wrap(async (req, res) => {
    if (!db) return res.status(503).json({ ok: false, code: "DURABLE_REQUIRED", error: "game instances require PostgreSQL" });
    if (!(await spendMutationBudget(req, res))) return;
    const body = req.body || {};
    const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
    const name = safeName(body.displayName);
    const description = typeof body.description === "string" ? body.description.trim() : "";
    if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 48 || description.length > 500) {
      return res.status(400).json({ ok: false, code: "INVALID_INPUT", error: "displayName, a lowercase URL slug, and a description of at most 500 characters are required" });
    }
    const instanceId = `gi_${createHash("sha256").update(`${req.owner.sessionId}:${Date.now()}:${slug}`).digest("hex").slice(0, 24)}`;
    try {
      const result = await db.query(`INSERT INTO game_instances(instance_id,slug,display_name,description,created_by,updated_by)
        VALUES($1,$2,$3,$4,$5,$5) RETURNING instance_id,slug,display_name,description,status,public_visible,config,branding,created_at,updated_at`,
      [instanceId, slug, name, description, req.owner.username]);
      await record(req, "INSTANCE_CREATE", { targetType: "instance", targetId: instanceId, metadata: { slug, displayName: name } });
      return res.status(201).json({ ok: true, instance: result.rows[0] });
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ ok: false, code: "SLUG_EXISTS", error: "that instance slug is already reserved" });
      throw error;
    }
  }));

  router.patch("/instances/:instanceId", requireOwner, wrap(async (req, res) => {
    if (!db) return res.status(503).json({ ok: false, code: "DURABLE_REQUIRED", error: "game instances require PostgreSQL" });
    if (!(await spendMutationBudget(req, res))) return;
    const { instanceId } = req.params;
    const body = req.body || {};
    const allowedStatus = new Set(["active", "paused", "archived"]);
    const name = body.displayName === undefined ? undefined : safeName(body.displayName);
    const description = body.description === undefined ? undefined : (typeof body.description === "string" && body.description.trim().length <= 500 ? body.description.trim() : null);
    const status = body.status === undefined ? undefined : body.status;
    const visible = body.publicVisible === undefined ? undefined : body.publicVisible;
    const brandingResult = body.branding === undefined ? null : validateInstanceBranding(body.branding);
    const roomDefaultsResult = body.roomDefaults === undefined ? null : validateRoomDefaults(body.roomDefaults);
    if ((body.displayName !== undefined && !name) || description === null || (status !== undefined && !allowedStatus.has(status)) || (visible !== undefined && typeof visible !== "boolean") || brandingResult?.error || roomDefaultsResult?.error) {
      return res.status(400).json({ ok: false, code: brandingResult?.error || roomDefaultsResult?.error || "INVALID_INPUT", error: "invalid instance fields, room defaults, or branding values" });
    }
    const before = await db.query("SELECT status FROM game_instances WHERE instance_id=$1", [instanceId]);
    if (!before.rowCount) return res.status(404).json({ ok: false, code: "INSTANCE_NOT_FOUND", error: "no such instance" });
    if (before.rows[0].status === "archived" && status === "paused") return res.status(409).json({ ok: false, code: "INVALID_TRANSITION", error: "restore an archived instance by activating it" });
    const result = await db.query(`UPDATE game_instances SET
      display_name=COALESCE($2,display_name), description=COALESCE($3,description),
      status=COALESCE($4,status), public_visible=COALESCE($5,public_visible),
      branding=branding || $7::jsonb,
      config=CASE WHEN $8::jsonb IS NULL THEN config ELSE config || jsonb_build_object('roomDefaults',$8::jsonb) END,
      updated_by=$6
      WHERE instance_id=$1 RETURNING instance_id,slug,display_name,description,status,public_visible,config,branding,created_at,updated_at`,
    [instanceId, name ?? null, description ?? null, status ?? null, visible ?? null, req.owner.username, JSON.stringify(brandingResult?.branding || {}), roomDefaultsResult ? JSON.stringify(roomDefaultsResult.roomDefaults) : null]);
    await record(req, "INSTANCE_UPDATE", {
      targetType: "instance",
      targetId: instanceId,
      metadata: {
        changed: Object.keys(body),
        ...(roomDefaultsResult ? { roomDefaults: roomDefaultsResult.roomDefaults } : {}),
      },
    });
    res.json({ ok: true, instance: result.rows[0] });
  }));

  router.get("/reports/instances", requireOwner, wrap(async (req, res) => {
    if (!durable) return res.status(503).json({ ok: false, code: "DURABLE_REQUIRED", error: "instance reports require PostgreSQL" });
    const date = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
    const today = new Date().toISOString().slice(0, 10);
    const defaultFrom = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const from = req.query.from === undefined ? defaultFrom : req.query.from;
    const to = req.query.to === undefined ? today : req.query.to;
    const instanceId = req.query.instanceId === undefined || req.query.instanceId === "" ? null : req.query.instanceId;
    if ((instanceId !== null && (typeof instanceId !== "string" || instanceId.length > 80)) || !date(from) || !date(to) || from > to || Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 365 * 86400000) {
      return res.status(400).json({ ok: false, code: "INVALID_INPUT", error: "choose valid dates no more than 366 days apart" });
    }
    const report = await queries.instanceReport({ instanceId, from, to });
    if (instanceId && !report.instances.length) return res.status(404).json({ ok: false, code: "INSTANCE_NOT_FOUND", error: "no such instance" });
    res.json({ ok: true, source: "durable", from, to, ...report });
  }));

  router.get("/public/instances", wrap(async (_req, res) => {
    if (!db) return res.status(503).json({ ok: false, code: "DURABLE_REQUIRED", error: "instance directory unavailable" });
    const result = await db.query(`SELECT slug,display_name,description,branding FROM game_instances
      WHERE status='active' AND public_visible=true ORDER BY display_name`);
    res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
    res.json({ ok: true, instances: result.rows.map((row) => ({ ...row, branding: publicInstanceBranding(row.branding) })) });
  }));

  router.get("/public/instances/:slug", wrap(async (req, res) => {
    if (!db) return res.status(503).json({ ok: false, code: "DURABLE_REQUIRED", error: "instance directory unavailable" });
    const result = await db.query(`SELECT slug,display_name,description,branding FROM game_instances
      WHERE slug=$1 AND status='active' AND public_visible=true`, [req.params.slug]);
    if (!result.rowCount) return res.status(404).json({ ok: false, code: "INSTANCE_NOT_FOUND", error: "no active public instance" });
    res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
    res.json({ ok: true, instance: { ...result.rows[0], branding: publicInstanceBranding(result.rows[0].branding) } });
  }));

  router.get(
    "/overview",
    requireOwner,
    wrap(async (req, res) => {
      const rooms = liveRooms();
      const liveById = new Map(rooms.map((room) => [room.roomId, room]));
      const live = {
        processRooms: rooms.length,
        livePlayers: rooms.reduce((sum, room) => sum + [...room.players.values()].filter((p) => p.connected).length, 0),
      };

      if (!durable) {
        const byStatus = { WAITING: 0, RUNNING: 0, PAUSED: 0, COMPLETED: 0 };
        const recentWinners = [];
        const recentClaims = [];
        let games = 0;
        const participants = new Set();
        for (const room of rooms) {
          byStatus[room.state] = (byStatus[room.state] || 0) + 1;
          games += room.gameNumber || 0;
          for (const p of room.players.values()) participants.add(p.id);
          for (const a of room.awardList()) recentWinners.push({ roomId: room.roomId, gameNumber: room.gameNumber || 0, pattern: a.pattern, points: a.points, playerId: a.playerId, displayName: a.name, awardedAt: null });
          for (const c of room.claimLog || []) recentClaims.push({ roomId: room.roomId, gameNumber: room.gameNumber || 0, pattern: c.pattern, status: c.accepted ? "AWARDED" : "REJECTED", reason: c.reason, playerId: c.playerId, displayName: c.name, decidedAt: c.at ? new Date(c.at).toISOString() : null });
        }
        const healthReport = healthProbe ? await healthProbe.report().catch(() => null) : null;
        return res.json({
          ok: true,
          source: "live",
          generatedAt: new Date().toISOString(),
          durable: false,
          counts: {
            waiting: byStatus.WAITING,
            running: byStatus.RUNNING,
            paused: byStatus.PAUSED,
            openTotal: byStatus.WAITING + byStatus.RUNNING + byStatus.PAUSED,
            totalRooms: rooms.length,
            totalGames: games,
            completedGames: byStatus.COMPLETED,
            participants: participants.size,
            awards: recentWinners.length,
            validClaims: recentClaims.filter((c) => c.status === "AWARDED").length,
            rejectedClaims: recentClaims.filter((c) => c.status === "REJECTED").length,
          },
          rooms: rooms.map(liveSummary),
          recentCompleted: [],
          recentWinners: recentWinners.slice(0, 8),
          recentClaims: recentClaims.slice(0, 8),
          recentPlatformActivity: await audit.recent({ limit: 8 }),
          backupStatus: await readBackupStatus(),
          health: ownerHealthSummary(healthReport),
          live,
          note: "Live, in-process data only. Start the server with a database to record durable history.",
        });
      }

      const [totals, platform, byStatus, open, completed, winners, claims, healthReport, activity, backupStatus] = await Promise.all([
        queries.totals(),
        queries.platformCounts(),
        queries.roomsByStatus(),
        queries.openRooms({ limit: 30 }),
        queries.recentlyCompleted({ limit: 8 }),
        queries.recentWinners({ limit: 8 }),
        queries.recentClaims({ limit: 8 }),
        healthProbe ? healthProbe.report().catch(() => null) : queries.health().catch(() => ({ ok: false })),
        queries.recentPlatformActivity({ limit: 8 }),
        readBackupStatus(),
      ]);
      res.json({
        ok: true,
        source: "durable",
        generatedAt: new Date().toISOString(),
        durable: true,
        counts: {
          ...totals,
          waiting: byStatus.WAITING,
          running: byStatus.RUNNING,
          paused: byStatus.PAUSED,
          openTotal: byStatus.WAITING + byStatus.RUNNING + byStatus.PAUSED,
        },
        platform,
        rooms: open.map((room) => ({ ...room, liveInProcess: liveById.has(room.roomId) })),
        recentCompleted: completed,
        recentWinners: winners,
        recentClaims: claims,
        recentPlatformActivity: activity,
        backupStatus,
        health: ownerHealthSummary(healthProbe ? healthReport : null, healthProbe ? null : healthReport),
        live,
      });
    })
  );

  // ----------------------------------------------------------------- games list

  router.get(
    "/games",
    requireOwner,
    wrap(async (req, res) => {
      const state = typeof req.query.state === "string" ? req.query.state.toLowerCase() : null;
      const q = typeof req.query.q === "string" ? req.query.q : null;
      const limit = Number(req.query.limit) || 25;
      const offset = Number(req.query.offset) || 0;
      if (!durable) {
        let rooms = liveRooms().map(liveSummary);
        if (state && state !== "all") rooms = rooms.filter((r) => r.status === state.toUpperCase());
        if (q) rooms = rooms.filter((r) => r.roomId.toLowerCase().includes(q.toLowerCase()));
        const total = rooms.length;
        return res.json({ ok: true, source: "live", durable: false, rooms: rooms.slice(offset, offset + limit), total, limit, offset });
      }
      const liveById = new Map(liveRooms().map((room) => [room.roomId, room]));
      const page = await queries.listRooms({ state, q, limit, offset });
      res.json({ ok: true, source: "durable", durable: true, ...page, rooms: page.rooms.map((r) => ({ ...r, liveInProcess: liveById.has(r.roomId) })) });
    })
  );

  router.post(
    "/games",
    requireOwner,
    wrap(async (req, res) => {
      const body = req.body || {};
      const overrides = {};
      const name = safeName(body.name, "Operator Table");
      overrides.name = name;
      let callIntervalMs = null;
      if (body.callIntervalMs !== undefined) {
        if (!isNumber(body.callIntervalMs) || body.callIntervalMs < MIN_INTERVAL || body.callIntervalMs > MAX_INTERVAL) {
          return res.status(400).json({ ok: false, code: "INVALID_INPUT", error: `callIntervalMs must be between ${MIN_INTERVAL} and ${MAX_INTERVAL}` });
        }
        callIntervalMs = Math.round(body.callIntervalMs);
        overrides.callIntervalMs = callIntervalMs;
      }
      if (body.autoCall !== undefined) overrides.autoCall = Boolean(body.autoCall);
      // The open call put an official in the room, so ask whose word counts when
      // a table argues about a late "house": 0 is the traditional rule (claim
      // before the next number), N gives slow phones N further calls of grace.
      if (body.claimWindowCalls !== undefined) {
        const grace = body.claimWindowCalls;
        if (!Number.isInteger(grace) || grace < 0 || grace > 10) {
          return res.status(400).json({ ok: false, code: "INVALID_INPUT", error: "claimWindowCalls must be a whole number between 0 and 10" });
        }
        overrides.claimWindowCalls = grace;
      }
      const chosen = cleanPatterns(body);
      if (chosen.enabled.length === 0) {
        return res.status(400).json({ ok: false, code: "INVALID_INPUT", error: "enable at least one winning pattern" });
      }
      if (chosen.patterns) overrides.patterns = chosen.patterns;

      const instanceId = typeof body.instanceId === "string" ? body.instanceId : "regular";
      if (durable) {
        const instance = await db.query("SELECT status FROM game_instances WHERE instance_id=$1", [instanceId]);
        if (!instance.rowCount || instance.rows[0].status !== "active") {
          return res.status(409).json({ ok: false, code: "INSTANCE_UNAVAILABLE", error: "rooms can only be created in an active instance" });
        }
      }

      const created = await controller.createManagedRoom({ hostName: "Operator", overrides, instanceId });
      if (!created.ok) {
        return res.status(statusForCode(created.code)).json({ ok: false, code: created.code || "CREATE_FAILED", error: created.error || "the room could not be created" });
      }
      const room = registry.get(created.roomId);
      await record(req, ADMIN_ACTIONS.ROOM_CREATE, {
        targetType: "room",
        targetId: created.roomId,
        roomCode: created.roomId,
        metadata: {
          name,
          instanceId,
          callIntervalMs,
          claimWindowCalls: overrides.claimWindowCalls,
          enabledPatterns: chosen.enabled,
          state: room ? room.state : created.state,
        },
      });
      res.status(201).json({
        ok: true,
        roomId: created.roomId,
        room: room ? liveSummary(room) : { roomId: created.roomId, status: created.state, enabledPatterns: created.enabledPatterns },
      });
    })
  );

  router.get(
    "/games/:roomId",
    requireOwner,
    wrap(async (req, res) => {
      const { roomId } = req.params;
      if (!isRoomId(roomId)) return res.status(400).json({ ok: false, code: "INVALID_INPUT", error: "invalid room id" });
      if (!durable) {
        const room = registry.get(roomId);
        if (!room) return res.status(404).json({ ok: false, code: "ROOM_NOT_FOUND", error: "no such live room" });
        return res.json({ ok: true, source: "live", durable: false, room: liveDetail(room) });
      }
      const detail = await queries.roomDetail(roomId);
      if (!detail) return res.status(404).json({ ok: false, code: "ROOM_NOT_FOUND", error: "no such room" });
      const room = registry.get(roomId);
      const frozen = controller.frozenReason(roomId) || detail.recoveryError || null;
      res.json({
        ok: true,
        source: "durable",
        durable: true,
        room: {
          ...detail,
          liveInProcess: Boolean(room),
          hostConnected: room ? Boolean(room.hostSocketId) : false,
          // A room whose rows disagree with each other is frozen, not controllable.
          // The dashboard shows that state instead of pretending the room is playable.
          recoveryRequired: Boolean(frozen),
          recoveryError: frozen,
        },
      });
    })
  );

  // ------------------------------------------------------------- invitations

  router.get(
    "/games/:roomId/invitation",
    requireOwner,
    wrap(async (req, res) => {
      const { roomId } = req.params;
      if (!isRoomId(roomId)) return res.status(400).json({ ok: false, code: "INVALID_INPUT", error: "invalid room id" });
      let gameName = null;
      if (durable) {
        const detail = await queries.roomDetail(roomId);
        if (!detail) return res.status(404).json({ ok: false, code: "ROOM_NOT_FOUND", error: "no such room" });
        gameName = detail.config && detail.config.name ? detail.config.name : null;
      } else {
        const room = registry.get(roomId);
        if (!room) return res.status(404).json({ ok: false, code: "ROOM_NOT_FOUND", error: "no such live room" });
        gameName = room.config && room.config.name ? room.config.name : null;
      }
      const resolved = resolvePublicOrigin({ configured: publicOrigin, requestOrigin: requestOrigin(req), production });
      const invitation = await createInvitation({ roomId, gameName, origin: resolved.origin, configured: resolved.configured, warning: resolved.warning });
      res.json({ ok: true, invitation });
    })
  );

  // ------------------------------------------------------- lifecycle mutations

  router.post(
    "/games/:roomId/recover",
    requireOwner,
    wrap(async (req, res) => {
      const { roomId } = req.params;
      if (!isRoomId(roomId)) return res.status(400).json({ ok: false, code: "INVALID_INPUT", error: "invalid room id" });
      if (!(await spendMutationBudget(req, res))) return undefined;
      if (!durable) return res.status(503).json({ ok: false, code: "ADMIN_UNAVAILABLE", error: "room recovery requires durable storage" });
      const result = await controller.retryRecovery({ roomId });
      await record(req, ADMIN_ACTIONS.ROOM_RECOVER, {
        targetType: "room",
        targetId: roomId,
        roomCode: roomId,
        metadata: result.ok
          ? { outcome: "success", state: result.room.state, cursor: result.room.cursor, gameNumber: result.room.gameNumber, operatorRetry: true }
          : { outcome: "refused", code: result.code || "RECOVERY_REQUIRED", operatorRetry: true },
      });
      if (!result.ok) {
        const code = result.code || "RECOVERY_REQUIRED";
        return res.status(statusForCode(code)).json({ ok: false, code, error: result.error || "recovery was refused" });
      }
      res.json({ ok: true, recovered: true, state: result.room.state, room: liveSummary(result.room) });
    })
  );

  function mutationResult(res, result, onSuccess) {
    if (!result || !result.ok) {
      const code = (result && result.code) || "INVALID_STATE";
      return res.status(statusForCode(code)).json({ ok: false, code, error: (result && result.error) || "the server refused that action" });
    }
    return onSuccess(result);
  }

  /**
   * Bring the target room into this process before an operator drives it.
   *
   * The dashboard lists every open room in the database, but only a room that
   * has been recovered into this process can be driven by the engine. A cold
   * room is rebuilt through the same path a client reconnect uses: load the
   * durable bundle under the room's write lock, re-attach the sockets that are
   * still connected, and run the integrity assertion. If anything disagrees the
   * room is frozen and reported RECOVERY_REQUIRED; if it is closed in the
   * database it stays closed. Nothing is invented and no draw is regenerated.
   */
  async function loadRoomForMutation(req, res) {
    const { roomId } = req.params;
    if (!isRoomId(roomId)) {
      res.status(400).json({ ok: false, code: "INVALID_INPUT", error: "invalid room id" });
      return null;
    }
    if (!(await spendMutationBudget(req, res))) return null;
    const loaded = await controller.ensureRoom({ roomId });
    if (!loaded.ok) {
      const code = loaded.code || "ROOM_NOT_LIVE";
      res.status(statusForCode(code)).json({ ok: false, code, error: loaded.error });
      return null;
    }
    if (loaded.recovered) {
      await record(req, ADMIN_ACTIONS.ROOM_RECOVER, {
        targetType: "room",
        targetId: roomId,
        roomCode: roomId,
        metadata: { state: loaded.room.state, cursor: loaded.room.cursor, gameNumber: loaded.room.gameNumber },
      });
    }
    return loaded.room;
  }

  router.post(
    "/games/:roomId/start",
    requireOwner,
    wrap(async (req, res) => {
      const room = await loadRoomForMutation(req, res);
      if (!room) return undefined;
      const result = await controller.start({ room, auth: operatorAuth(room) });
      return mutationResult(res, result, async (ok) => {
        await record(req, ADMIN_ACTIONS.ROOM_START, { targetType: "room", targetId: room.roomId, roomCode: room.roomId, metadata: { gameNumber: ok.gameNumber } });
        res.json({ ok: true, state: ok.state, gameNumber: ok.gameNumber, ticketsIssued: ok.ticketsIssued, room: liveSummary(room) });
      });
    })
  );

  router.post(
    "/games/:roomId/call",
    requireOwner,
    wrap(async (req, res) => {
      const room = await loadRoomForMutation(req, res);
      if (!room) return undefined;
      const result = await controller.callNext({ room, source: "host", auth: operatorAuth(room) });
      return mutationResult(res, result, async (ok) => {
        await record(req, ADMIN_ACTIONS.ROOM_CALL, { targetType: "room", targetId: room.roomId, roomCode: room.roomId, metadata: { number: ok.number, index: ok.index } });
        res.json({ ok: true, number: ok.number, index: ok.index, calledCount: room.cursor, state: room.state });
      });
    })
  );

  for (const action of ["pause", "resume", "end", "reset"]) {
    router.post(
      `/games/:roomId/${action}`,
      requireOwner,
      wrap(async (req, res) => {
        const room = await loadRoomForMutation(req, res);
        if (!room) return undefined;
        const result = await controller.transition({ room, action, auth: operatorAuth(room) });
        const audited = { pause: ADMIN_ACTIONS.ROOM_PAUSE, resume: ADMIN_ACTIONS.ROOM_RESUME, end: ADMIN_ACTIONS.ROOM_END, reset: ADMIN_ACTIONS.ROOM_RESET }[action];
        return mutationResult(res, result, async () => {
          await record(req, audited, { targetType: "room", targetId: room.roomId, roomCode: room.roomId, metadata: { action } });
          res.json({ ok: true, state: room.state, room: liveSummary(room) });
        });
      })
    );
  }

  router.post(
    "/games/:roomId/autocall",
    requireOwner,
    wrap(async (req, res) => {
      const body = req.body || {};
      if (typeof body.enabled !== "boolean") return res.status(400).json({ ok: false, code: "INVALID_INPUT", error: "enabled must be a boolean" });
      let intervalMs;
      if (body.intervalMs !== undefined) {
        if (!isNumber(body.intervalMs) || body.intervalMs < MIN_INTERVAL || body.intervalMs > MAX_INTERVAL) {
          return res.status(400).json({ ok: false, code: "INVALID_INPUT", error: `intervalMs must be between ${MIN_INTERVAL} and ${MAX_INTERVAL}` });
        }
        intervalMs = Math.round(body.intervalMs);
      }
      const room = await loadRoomForMutation(req, res);
      if (!room) return undefined;
      const result = await controller.setAutoCall({ room, enabled: body.enabled, intervalMs, auth: operatorAuth(room) });
      return mutationResult(res, result, async () => {
        await record(req, ADMIN_ACTIONS.ROOM_AUTOCALL, { targetType: "room", targetId: room.roomId, roomCode: room.roomId, metadata: { enabled: body.enabled, intervalMs: intervalMs ?? null } });
        res.json({ ok: true, autoCall: Boolean(room.config.autoCall), callIntervalMs: room.config.callIntervalMs });
      });
    })
  );

  router.post(
    "/games/:roomId/close",
    requireOwner,
    wrap(async (req, res) => {
      const { roomId } = req.params;
      if (!isRoomId(roomId)) return res.status(400).json({ ok: false, code: "INVALID_INPUT", error: "invalid room id" });
      if (!(await spendMutationBudget(req, res))) return undefined;
      if (durable) {
        const detail = await queries.roomDetail(roomId);
        if (!detail) return res.status(404).json({ ok: false, code: "ROOM_NOT_FOUND", error: "no such room" });
      }
      await controller.closeRoom({ roomId, reason: "closed by owner" });
      await record(req, ADMIN_ACTIONS.ROOM_CLOSE, { targetType: "room", targetId: roomId, roomCode: roomId, metadata: {} });
      res.json({ ok: true, roomId, closed: true });
    })
  );

  router.delete(
    "/games/:roomId/members/:playerId",
    requireOwner,
    wrap(async (req, res) => {
      const playerId = req.params.playerId;
      if (typeof playerId !== "string" || playerId.length < 1 || playerId.length > 80) {
        return res.status(400).json({ ok: false, code: "INVALID_INPUT", error: "invalid player id" });
      }
      const room = await loadRoomForMutation(req, res);
      if (!room) return undefined;
      const result = await controller.removeParticipant({ room, playerId });
      return mutationResult(res, result, async () => {
        await record(req, ADMIN_ACTIONS.PLAYER_REMOVE, { targetType: "player", targetId: playerId, roomCode: room.roomId, metadata: {} });
        res.json({ ok: true, removed: playerId });
      });
    })
  );

  // ------------------------------------------------------------------- players

  router.get(
    "/players",
    requireOwner,
    wrap(async (req, res) => {
      const q = typeof req.query.q === "string" ? req.query.q : null;
      const limit = Number(req.query.limit) || 25;
      const offset = Number(req.query.offset) || 0;
      if (!durable) {
        const seen = new Map();
        for (const room of liveRooms()) {
          for (const p of room.players.values()) {
            const entry = seen.get(p.id) || { playerId: p.id, displayName: p.name, createdAt: null, roomCount: 0, awardsWon: 0, rejectedClaims: 0 };
            entry.roomCount += 1;
            entry.displayName = p.name || entry.displayName;
            seen.set(p.id, entry);
          }
        }
        let players = [...seen.values()];
        if (q) players = players.filter((p) => (p.displayName || "").toLowerCase().includes(q.toLowerCase()) || p.playerId.toLowerCase().includes(q.toLowerCase()));
        const total = players.length;
        return res.json({ ok: true, source: "live", durable: false, players: players.slice(offset, offset + limit), total, limit, offset });
      }
      const page = await queries.listPlayers({ q, limit, offset });
      res.json({ ok: true, source: "durable", durable: true, ...page });
    })
  );

  router.get(
    "/players/:playerId",
    requireOwner,
    wrap(async (req, res) => {
      const { playerId } = req.params;
      if (!durable) {
        for (const room of liveRooms()) {
          for (const p of room.players.values()) {
            if (p.id === playerId) {
              return res.json({ ok: true, source: "live", durable: false, player: { playerId: p.id, displayName: p.name, createdAt: null, memberships: [{ roomId: room.roomId, role: p.id === room.hostPlayerId ? "host" : "player", joinedAt: null, leftAt: null }], awards: [] } });
            }
          }
        }
        return res.status(404).json({ ok: false, code: "PLAYER_NOT_FOUND", error: "no such player" });
      }
      const detail = await queries.playerDetail(playerId);
      if (!detail) return res.status(404).json({ ok: false, code: "PLAYER_NOT_FOUND", error: "no such player" });
      res.json({ ok: true, source: "durable", durable: true, player: detail });
    })
  );

  // ------------------------------------------------------------------- history

  router.get(
    "/history",
    requireOwner,
    wrap(async (req, res) => {
      const state = typeof req.query.state === "string" ? req.query.state.toLowerCase() : null;
      const q = typeof req.query.q === "string" ? req.query.q : null;
      const from = typeof req.query.from === "string" ? req.query.from : null;
      const to = typeof req.query.to === "string" ? req.query.to : null;
      const limit = Number(req.query.limit) || 30;
      const offset = Number(req.query.offset) || 0;
      if (!durable) {
        return res.json({
          ok: true,
          source: "live",
          durable: false,
          durableRequired: true,
          games: [],
          total: 0,
          limit,
          offset,
          note: "Game history is stored durably. Start the server with a database to record and query past games.",
        });
      }
      if (from && Number.isNaN(Date.parse(from))) return res.status(400).json({ ok: false, code: "INVALID_INPUT", error: "invalid 'from' date" });
      if (to && Number.isNaN(Date.parse(to))) return res.status(400).json({ ok: false, code: "INVALID_INPUT", error: "invalid 'to' date" });
      const page = await queries.history({ state, q, from, to, limit, offset });
      res.json({ ok: true, source: "durable", durable: true, ...page });
    })
  );

  // --------------------------------------------------------------------- audit

  router.get(
    "/audit",
    requireOwner,
    wrap(async (req, res) => {
      const roomCode = typeof req.query.roomCode === "string" ? req.query.roomCode : null;
      const limit = Number(req.query.limit) || 50;
      const before = Number(req.query.before) || null;
      const events = roomCode ? await audit.forRoom({ roomCode, limit }) : await audit.recent({ limit, before });
      res.json({ ok: true, events, backend: audit.backend || (durable ? "database" : "memory") });
    })
  );

  // ------------------------------------------------------------------ settings

  router.get(
    "/settings",
    requireOwner,
    wrap(async (req, res) => {
      let owners = [];
      let sessions = 0;
      let health = { ok: true, mode: "memory" };
      let account = null;
      try {
        owners = await ownerStore.list();
        sessions = await ownerSessions.activeCount();
        account = await ownerStore.getByUsername(req.owner.username);
        if (durable) health = await queries.health().catch(() => ({ ok: false }));
      } catch {
        health = { ok: false };
      }
      const resolved = resolvePublicOrigin({ configured: publicOrigin, requestOrigin: requestOrigin(req), production });
      res.json({
        ok: true,
        durable,
        owner: { username: req.owner.username },
        owners: owners.map((o) => ({
          username: o.username,
          createdAt: o.createdAt,
          lastLoginAt: o.lastLoginAt,
          passwordUpdatedAt: o.passwordUpdatedAt,
          mfaEnrolled: Boolean(o.mfaEnrolled),
          mfaPending: Boolean(o.mfaPending),
        })),
        activeSessions: sessions,
        mfa: {
          ...mfaState(account),
          issuer: mfa.issuer,
          // A pending enrollment means "started, not confirmed": MFA is not
          // required until a valid code proves the device works.
          recoveryCommand: "npm run owner:mfa-reset -- <username>",
        },
        throttle: {
          backend: throttle.backend,
          signin: { windowMs: throttle.signin.config.windowMs, maxFailures: throttle.signin.config.maxFailures },
          address: { windowMs: throttle.signinIp.config.windowMs, maxFailures: throttle.signinIp.config.maxFailures },
          mfa: { windowMs: throttle.mfa.config.windowMs, maxFailures: throttle.mfa.config.maxFailures },
        },
        invitation: { origin: resolved.origin, originConfigured: resolved.configured, warning: resolved.warning },
        health: { database: durable ? (health && health.ok ? "ok" : "down") : "not-configured", app: "ok" },
        runtime: {
          node: process.version,
          persistence: durable ? "durable" : "memory",
          production: Boolean(production),
          uptimeSeconds: Math.round(process.uptime()),
        },
        defaults: { callIntervalMs: Number(config.callIntervalMs) || 8000, maxPlayers: Number(config.maxPlayers) || 100 },
      });
    })
  );

  // ------------------------------------------------------------- second factor

  /**
   * Begin TOTP enrollment. The plaintext secret and its provisioning URI are
   * returned exactly once, to the authenticated owner, and never logged or
   * stored: the database only ever receives the sealed envelope. If the owner
   * abandons this screen, the pending secret is inert forever.
   */
  router.post(
    "/settings/mfa/enroll",
    requireOwner,
    wrap(async (req, res) => {
      if (!(await spendCredentialBudget(req, res))) return;
      if (!mfa.configured || !mfa.key) {
        return res.status(503).json({
          ok: false,
          code: "MFA_UNAVAILABLE",
          error: "owner MFA is not configured on this server. Set OWNER_MFA_KEY (32 bytes, base64 or hex) and restart. See server/RUNBOOK.md.",
        });
      }
      const account = await ownerStore.getByUsername(req.owner.username);
      if (!account) return res.status(401).json({ ok: false, code: "UNAUTHENTICATED", error: "owner sign-in required" });
      if (account.totpConfirmedAt) {
        return res.status(409).json({
          ok: false,
          code: "MFA_ALREADY_ENROLLED",
          error: "this account already has a second factor. To replace the device, reset it on the server with npm run owner:mfa-reset.",
        });
      }
      const secret = generateSecret();
      const sealed = encryptSecret({ secret, ownerId: account.ownerId, key: mfa.key });
      const started = await ownerStore.beginMfaEnrollment({ ownerId: account.ownerId, secretEnc: sealed });
      if (!started.ok) {
        return res.status(409).json({ ok: false, code: started.code, error: "a second factor is already enrolled" });
      }
      const uri = provisioningUri({ secret, username: account.username, issuer: mfa.issuer });
      const qr = await QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 1, width: 320 });
      await record(req, ADMIN_ACTIONS.MFA_ENROLL_START, { metadata: { username: account.username } });
      res.json({ ok: true, secret, uri, qr, digits: 6, periodSeconds: 30, issuer: mfa.issuer, account: account.username });
    })
  );

  router.post(
    "/settings/mfa/confirm",
    requireOwner,
    wrap(async (req, res) => {
      if (!(await spendCredentialBudget(req, res))) return;
      const account = await ownerStore.getForMfa({ ownerId: req.owner.ownerId });
      if (!account || !account.totpSecretEnc) {
        return res.status(409).json({ ok: false, code: "MFA_NOT_PENDING", error: "start an enrollment first" });
      }
      if (account.totpConfirmedAt) {
        return res.status(409).json({ ok: false, code: "MFA_ALREADY_ENROLLED", error: "the second factor is already active" });
      }
      const secret = openSecret(account);
      if (!secret) {
        return res.status(503).json({
          ok: false,
          code: "MFA_UNAVAILABLE",
          error: "the pending secret cannot be opened with the configured OWNER_MFA_KEY. Start the enrollment again.",
        });
      }
      const verified = verifyCode({ secret, code: (req.body || {}).code, lastStep: null });
      if (!verified.ok) {
        await record(req, ADMIN_ACTIONS.SIGNIN_MFA_FAILURE, { metadata: { username: account.username, stage: "confirm", reason: verified.reason } });
        return secondFactorFailure(res, verified.reason === "FORMAT" ? "MFA_INVALID_CODE" : "MFA_INVALID_CODE");
      }
      const confirmed = await ownerStore.confirmMfa({ ownerId: account.ownerId, step: verified.step });
      if (!confirmed.ok) {
        return res.status(409).json({ ok: false, code: confirmed.code, error: "the second factor could not be confirmed" });
      }
      await record(req, ADMIN_ACTIONS.MFA_ENABLED, { metadata: { username: account.username } });
      res.json({ ok: true, mfa: { state: "enrolled", enrolled: true, pending: false, keyConfigured: true } });
    })
  );

  /**
   * Turn the second factor off. A live session plus a valid current code are
   * both required; the session alone is not enough, because "turn off MFA" is
   * exactly the action a stolen session would want.
   */
  router.post(
    "/settings/mfa/disable",
    requireOwner,
    wrap(async (req, res) => {
      if (!(await spendCredentialBudget(req, res))) return;
      const account = await ownerStore.getForMfa({ ownerId: req.owner.ownerId });
      if (!account || !account.totpConfirmedAt) {
        return res.status(409).json({ ok: false, code: "MFA_NOT_ENROLLED", error: "no second factor is active" });
      }
      const accepted = await acceptSecondFactor(account, (req.body || {}).code);
      if (!accepted.ok) {
        await record(req, ADMIN_ACTIONS.SIGNIN_MFA_FAILURE, { metadata: { username: account.username, stage: "disable", reason: accepted.code } });
        return secondFactorFailure(res, accepted.code);
      }
      await ownerStore.clearMfa({ ownerId: account.ownerId });
      await record(req, ADMIN_ACTIONS.MFA_DISABLED, { metadata: { username: account.username, via: "dashboard" } });
      res.json({ ok: true, mfa: { state: "not-enrolled", enrolled: false, pending: false, keyConfigured: mfa.configured } });
    })
  );

  router.post(
    "/settings/password",
    requireOwner,
    wrap(async (req, res) => {
      if (!(await spendCredentialBudget(req, res))) return;
      const body = req.body || {};
      const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
      const next = typeof body.newPassword === "string" ? body.newPassword : "";
      const code = body.code;
      if (next.length < MIN_PASSWORD || next.length > MAX_PASSWORD) {
        return res.status(400).json({ ok: false, code: "INVALID_INPUT", error: `new password must be ${MIN_PASSWORD}-${MAX_PASSWORD} characters` });
      }
      const account = await ownerStore.getByUsername(req.owner.username);
      if (!account) return res.status(401).json({ ok: false, code: "UNAUTHENTICATED", error: "owner sign-in required" });
      const good = await verifyPassword(current, account.passwordHash);
      if (!good) return res.status(403).json({ ok: false, code: "INVALID_CREDENTIALS", error: "current password is incorrect" });

      // With a second factor active, rotating the password requires it too:
      // otherwise a stolen session cookie plus a guessed current password would
      // be enough to take the account over.
      if (account.totpConfirmedAt) {
        const factor = await ownerStore.getForMfa({ ownerId: account.ownerId });
        const accepted = await acceptSecondFactor(factor, code);
        if (!accepted.ok) {
          await record(req, ADMIN_ACTIONS.SIGNIN_MFA_FAILURE, { metadata: { username: account.username, stage: "password-rotate", reason: accepted.code } });
          return secondFactorFailure(res, accepted.code);
        }
      }

      const passwordHash = await hashPassword(next);
      await ownerStore.setPassword({ ownerId: req.owner.ownerId, passwordHash });
      // rotation revokes every live session, including this one
      await ownerSessions.revokeAllForOwner({ ownerId: req.owner.ownerId, reason: "password-rotated" });
      clearOwnerCookie(res);
      await record(req, ADMIN_ACTIONS.PASSWORD_ROTATE, { metadata: { mfa: Boolean(account.totpConfirmedAt) } });
      res.json({ ok: true, signinRequired: true });
    })
  );

  router.get(
    "/health",
    requireOwner,
    wrap(async (req, res) => {
      const [database, report] = await Promise.all([
        durable && !healthProbe ? queries.health().catch(() => ({ ok: false })) : Promise.resolve(null),
        healthProbe ? healthProbe.report().catch(() => null) : Promise.resolve(null),
      ]);
      const summary = ownerHealthSummary(report, database);
      res.json({
        ok: true,
        ...summary,
        app: summary.application,
        persistence: durable ? "durable" : "memory",
        processRooms: registry.size(),
        throttle: throttle.backend,
        mfa: mfa.configured ? "configured" : "not-configured",
        uptimeSeconds: Math.round(process.uptime()),
      });
    })
  );

  router.get("/backups/status", requireOwner, wrap(async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, ...await readBackupStatus() });
  }));

  // --------------------------------------------------------- error boundary

  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (dbUnavailable(error)) {
      log("admin request could not reach the database", req.method, req.path, error && error.message);
      return res.status(503).json({ ok: false, code: "ADMIN_UNAVAILABLE", error: "the control centre could not reach the database right now" });
    }
    // A body the client could not produce is the client's problem, not ours.
    // This boundary sits in front of the app-level handler, so without this
    // branch an oversized or malformed body would be reported as a 500 and
    // look like a server fault in monitoring.
    const status = Number(error && (error.status || error.statusCode));
    if (status >= 400 && status < 500) {
      const code = error.type === "entity.too.large" ? "PAYLOAD_TOO_LARGE"
        : error.type === "entity.parse.failed" ? "MALFORMED_BODY" : "BAD_REQUEST";
      log("admin request refused", req.method, req.path, status, code);
      return res.status(status).json({
        ok: false,
        code,
        error: status === 413 ? "that request body is too large" : "that request body could not be read",
      });
    }
    log("admin request failed", req.method, req.path, error && error.message);
    res.status(500).json({ ok: false, code: "ADMIN_ERROR", error: "the control centre hit an unexpected error" });
  });

  return router;
}
