/**
 * Owner control-centre tests.
 *
 * Three layers, matching how the feature is built:
 *   A. pure units      password hashing, the login throttle, invitations, cookies
 *   B. HTTP authz      the real createApp on an ephemeral port with in-memory
 *                      owner backends - sign-in, CSRF, session fixation,
 *                      rate limiting, host/player denial, owner-created rooms,
 *                      lifecycle, invitations, audit
 *   C. durable layer   owner tables, sessions, audit and the admin read queries
 *                      against an isolated throwaway schema (skipped without a
 *                      database). This is where history durability is proven.
 *
 * The HTTP tests inject memory backends so they need no Postgres and cannot
 * touch the running server's instance lease. The durable tests use a random
 * schema and drop it afterwards, per the test-isolation rule.
 */

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { io as connectClient } from "socket.io-client";

import { createApp } from "../server/index.js";
import { hashPassword, verifyPassword, needsRehash } from "../server/admin/password.js";
import { createLoginRateLimiter } from "../server/admin/rate-limit.js";
import { createMemoryOwnerStore } from "../server/admin/owner-store.js";
import { createMemoryOwnerSessions } from "../server/admin/owner-sessions.js";
import { createMemoryAdminAudit } from "../server/admin/audit.js";
import { resolvePublicOrigin, buildInviteUrl, buildWhatsAppUrl, createInvitation } from "../server/admin/invites.js";
import { parseCookies, serializeCookie, verifyCsrf } from "../server/admin/cookies.js";

const OWNER = { username: "operator", password: "correct-horse-battery" };

// ------------------------------------------------------------------ helpers

class AdminClient {
  constructor(baseUrl) {
    this.base = baseUrl;
    this.cookies = new Map();
    this.csrf = null;
    this.lastSetCookie = [];
  }

  storeCookies(res) {
    const list = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    this.lastSetCookie = list;
    for (const raw of list) {
      const pair = raw.split(";")[0];
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!value) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  async req(method, path, body) {
    const headers = {};
    if (this.cookies.size) headers.cookie = this.cookieHeader();
    if (body !== undefined) headers["content-type"] = "application/json";
    if (method !== "GET" && this.csrf) headers["x-csrf-token"] = this.csrf;
    const res = await fetch(this.base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    this.storeCookies(res);
    let parsed = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    if (parsed && typeof parsed.csrfToken === "string") this.csrf = parsed.csrfToken;
    return { status: res.status, body: parsed, headers: res.headers };
  }

  get(path) {
    return this.req("GET", path);
  }
  post(path, body = {}) {
    return this.req("POST", path, body);
  }
  del(path) {
    return this.req("DELETE", path);
  }
  async signIn(username = OWNER.username, password = OWNER.password) {
    await this.get("/api/admin/session");
    return this.post("/api/admin/signin", { username, password });
  }
}

function seededMemoryStore() {
  const store = createMemoryOwnerStore();
  const sessions = createMemoryOwnerSessions();
  const audit = createMemoryAdminAudit();
  return { store, sessions, audit };
}

// ============================================================ A. pure units

describe("owner password hashing", () => {
  test("hashes are self-describing, salted, and verify only the right password", async () => {
    const digest = await hashPassword("a-long-enough-secret");
    assert.match(digest, /^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]+\$[0-9a-f]+$/);
    assert.equal(await verifyPassword("a-long-enough-secret", digest), true);
    assert.equal(await verifyPassword("wrong-secret-123", digest), false);
    const second = await hashPassword("a-long-enough-secret");
    assert.notEqual(digest, second, "each hash uses a fresh salt");
    assert.equal(await verifyPassword("a-long-enough-secret", second), true);
  });

  test("rejects too-short passwords and never throws on a malformed digest", async () => {
    await assert.rejects(() => hashPassword("short"), /too short/);
    assert.equal(await verifyPassword("anything", "not-a-digest"), false);
    assert.equal(await verifyPassword("anything", null), false);
    assert.equal(needsRehash("garbage"), true);
  });
});

describe("login rate limiter", () => {
  test("locks out after repeated failures and reports a retry window", () => {
    const limiter = createLoginRateLimiter({ maxFailures: 3, windowMs: 60_000, baseLockoutMs: 10_000 });
    const key = "operator|ip";
    assert.equal(limiter.check({ key }).allowed, true);
    limiter.recordFailure({ key });
    limiter.recordFailure({ key });
    const third = limiter.recordFailure({ key });
    assert.equal(third.locked, true);
    const blocked = limiter.check({ key });
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterMs > 0);
    limiter.recordSuccess({ key });
    assert.equal(limiter.check({ key }).allowed, true);
  });
});

describe("invitations", () => {
  test("production without a public origin is flagged, never fabricated", () => {
    const resolved = resolvePublicOrigin({ configured: null, requestOrigin: "http://localhost:4000", production: true });
    assert.equal(resolved.configured, false);
    assert.match(resolved.warning, /PUBLIC_ORIGIN/);
    assert.equal(resolved.origin, "");
  });

  test("a local address in production is treated as a setup warning", () => {
    const resolved = resolvePublicOrigin({ configured: "http://127.0.0.1:4000", production: true });
    assert.equal(resolved.configured, false);
    assert.match(resolved.warning, /local address/i);
  });

  test("a configured public origin is used verbatim", () => {
    const resolved = resolvePublicOrigin({ configured: "https://hall.example/", production: true });
    assert.equal(resolved.configured, true);
    assert.equal(resolved.origin, "https://hall.example");
  });

  test("invitation URL and QR encode the real join URL and WhatsApp is encoded", async () => {
    const invitation = await createInvitation({ roomId: "ABCD2345", gameName: "Friday", origin: "https://hall.example", configured: true });
    assert.equal(invitation.url, "https://hall.example/player?id=ABCD2345");
    assert.match(invitation.qrDataUrl, /^data:image\/png;base64,/);
    assert.equal(invitation.originConfigured, true);
    const whatsapp = decodeURIComponent(invitation.whatsappUrl.split("text=")[1]);
    assert.ok(whatsapp.includes(invitation.url), "WhatsApp text carries the real URL");
    assert.ok(invitation.whatsappUrl.startsWith("https://wa.me/?text="));
    const manual = buildWhatsAppUrl("Join me", "https://hall.example/player?id=ABCD2345");
    assert.equal(manual, "https://wa.me/?text=" + encodeURIComponent("Join me https://hall.example/player?id=ABCD2345"));
    assert.equal(buildInviteUrl("ABCD2345", "https://hall.example"), invitation.url);
  });

  test("missing origin yields no URL and an explicit warning", async () => {
    const invitation = await createInvitation({ roomId: "ABCD2345", origin: "", warning: "no origin" });
    assert.equal(invitation.url, null);
    assert.equal(invitation.qrDataUrl, null);
    assert.equal(invitation.originConfigured, false);
  });
});

describe("cookies and CSRF", () => {
  test("cookie parsing and serialisation round-trip with security flags", () => {
    const jar = parseCookies("a=1; tambola_csrf=" + "f".repeat(48) + "; b=2");
    assert.equal(jar.a, "1");
    assert.equal(jar.tambola_csrf, "f".repeat(48));
    const cookie = serializeCookie("tambola_owner", "deadbeef", { httpOnly: true, path: "/api/admin" });
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Path=\/api\/admin/);
  });

  test("double-submit CSRF requires a matching cookie and header", () => {
    const token = "a".repeat(48);
    const req = (cookie, header) => ({ headers: { cookie, "x-csrf-token": header } });
    assert.equal(verifyCsrf(req(`tambola_csrf=${token}`, token)), true);
    assert.equal(verifyCsrf(req(`tambola_csrf=${token}`, "b".repeat(48))), false);
    assert.equal(verifyCsrf(req("", token)), false);
    assert.equal(verifyCsrf(req(`tambola_csrf=${token}`, undefined)), false);
  });
});

// ===================================================== B. HTTP authorization

describe("owner control centre over HTTP (in-memory backends)", () => {
  let instance;
  let url;
  let backends;

  before(async () => {
    backends = seededMemoryStore();
    await backends.store.create({ username: OWNER.username, passwordHash: await hashPassword(OWNER.password) });
    instance = await createApp({
      memoryOnly: true,
      origins: [],
      config: { autoCall: false, chatIntervalMs: 0, callIntervalMs: 60000 },
      limits: { burst: 2000, perSecond: 4000 },
      ownerStore: backends.store,
      ownerSessions: backends.sessions,
      audit: backends.audit,
      loginRateLimiter: createLoginRateLimiter({ maxFailures: 3, windowMs: 60_000, baseLockoutMs: 30_000 }),
      publicOrigin: "https://hall.example",
      log: () => {},
    });
    const port = await instance.listen(0);
    url = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (instance) await instance.closeServer();
  });

  test("an unauthenticated caller is refused on every protected endpoint", async () => {
    const anon = new AdminClient(url);
    for (const path of ["/api/admin/overview", "/api/admin/games", "/api/admin/players", "/api/admin/history", "/api/admin/settings", "/api/admin/audit"]) {
      const res = await anon.get(path);
      assert.equal(res.status, 401, path + " must require the owner");
      assert.equal(res.body.code, "UNAUTHENTICATED");
    }
    // A POST without CSRF is refused by the CSRF guard (403). With a valid
    // CSRF token but no owner session it is refused by the owner gate (401).
    const noCsrf = await anon.post("/api/admin/games", { name: "Nope" });
    assert.equal(noCsrf.status, 403);
    await anon.get("/api/admin/session");
    const mutation = await anon.post("/api/admin/games", { name: "Nope" });
    assert.equal(mutation.status, 401, "valid CSRF but no session must still be refused");
  });

  test("session endpoint advertises setup state and issues a CSRF token", async () => {
    const anon = new AdminClient(url);
    const res = await anon.get("/api/admin/session");
    assert.equal(res.status, 200);
    assert.equal(res.body.authenticated, false);
    assert.equal(res.body.setupRequired, false, "an owner already exists");
    assert.equal(typeof res.body.csrfToken, "string");
    assert.ok(anon.cookies.has("tambola_csrf"));
  });

  test("a state-changing request without the CSRF header is refused", async () => {
    const client = new AdminClient(url);
    await client.get("/api/admin/session");
    client.csrf = null; // deliberately drop the header, keep the cookie
    const res = await client.req("POST", "/api/admin/signin", { username: OWNER.username, password: OWNER.password });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "CSRF_FAILED");
  });

  test("a mangled request body is the client's error, not a reported server fault", async () => {
    // A body past the router's 16 kb limit, and a truncated JSON body. Both are
    // rejected by the body parser before any handler runs, and both used to
    // surface as 500 because this router's error boundary runs in front of the
    // app-level one - a client typo would have paged an operator at 3am.
    const oversized = await fetch(`${url}/api/admin/signin`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: OWNER.username, password: "x".repeat(32 * 1024) }),
    });
    assert.equal(oversized.status, 413);
    const tooBig = await oversized.json();
    assert.equal(tooBig.ok, false);
    assert.equal(tooBig.code, "PAYLOAD_TOO_LARGE");
    assert.ok(!JSON.stringify(tooBig).includes("xxxx"), "the offending body is never echoed back");

    const malformed = await fetch(`${url}/api/admin/signin`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"username":"operator","password":',
    });
    assert.equal(malformed.status, 400);
    const unreadable = await malformed.json();
    assert.equal(unreadable.ok, false);
    assert.equal(unreadable.code, "MALFORMED_BODY");

    // Refusing a bad body must not damage the process or the session endpoint.
    const alive = await new AdminClient(url).get("/api/admin/session");
    assert.equal(alive.status, 200);
  });

  test("wrong credentials are rejected without revealing whether the user exists", async () => {
    const client = new AdminClient(url);
    const res = await client.signIn(OWNER.username, "definitely-wrong");
    assert.equal(res.status, 401);
    assert.equal(res.body.code, "INVALID_CREDENTIALS");
    const unknown = new AdminClient(url);
    const res2 = await unknown.signIn("nobody-here", "definitely-wrong");
    assert.equal(res2.status, 401);
    assert.equal(res2.body.code, "INVALID_CREDENTIALS");
  });

  test("sign-in sets an HttpOnly session cookie and a brand-new token each time", async () => {
    const first = new AdminClient(url);
    const res1 = await first.signIn();
    assert.equal(res1.status, 200);
    assert.equal(res1.body.authenticated, true);
    const ownerCookie = first.lastSetCookie.find((c) => c.startsWith("tambola_owner="));
    assert.ok(ownerCookie, "session cookie is set");
    assert.match(ownerCookie, /HttpOnly/);
    const token1 = first.cookies.get("tambola_owner");

    // A second sign-in from a different client mints a different token.
    const second = new AdminClient(url);
    await second.signIn();
    const token2 = second.cookies.get("tambola_owner");
    assert.notEqual(token1, token2, "each login is a fresh session (fixation defence)");
  });

  test("successful owner gets real live overview data", async () => {
    const client = new AdminClient(url);
    await client.signIn();
    const res = await client.get("/api/admin/overview");
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.source, "live");
    assert.equal(typeof res.body.counts.waiting, "number");
  });

  test("a game-host session token is not an owner credential", async () => {
    // Mint a real game host session over Socket.IO.
    const socket = connectClient(url, { transports: ["websocket"], forceNew: true, reconnection: false });
    const created = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no host ack")), 5000);
      socket.on("connect", () => {
        socket.emit("room:create", { name: "Hosty" }, (ack) => {
          clearTimeout(timer);
          resolve(ack);
        });
      });
    });
    assert.equal(created.ok, true);
    assert.match(created.sessionToken, /^[0-9a-f]{48}$/);
    // Present it as the owner cookie: the owner session store has never heard of it.
    const impostor = new AdminClient(url);
    impostor.cookies.set("tambola_owner", created.sessionToken);
    const res = await impostor.get("/api/admin/overview");
    assert.equal(res.status, 401);
    socket.disconnect();
  });

  test("the owner can create a free-to-play room, start it, call, pause, resume and end", async () => {
    const owner = new AdminClient(url);
    await owner.signIn();
    const created = await owner.post("/api/admin/games", { name: "Control Room", callIntervalMs: 20000, enabledPatterns: ["earlyFive", "topLine", "fullHouse"] });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const roomId = created.body.roomId;
    assert.match(roomId, /^[A-HJ-NP-Z2-9]{8}$/);

    const detail = await owner.get(`/api/admin/games/${roomId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.room.config.name, "Control Room");
    assert.deepEqual(detail.body.room.config.patterns.topLine, true);
    assert.deepEqual(detail.body.room.config.patterns.corners, false, "unselected patterns are disabled");

    const started = await owner.post(`/api/admin/games/${roomId}/start`);
    assert.equal(started.status, 200, JSON.stringify(started.body));
    assert.equal(started.body.state, "RUNNING");

    const called = await owner.post(`/api/admin/games/${roomId}/call`);
    assert.equal(called.status, 200);
    assert.equal(called.body.calledCount, 1);

    assert.equal((await owner.post(`/api/admin/games/${roomId}/pause`)).body.state, "PAUSED");
    assert.equal((await owner.post(`/api/admin/games/${roomId}/resume`)).body.state, "RUNNING");
    assert.equal((await owner.post(`/api/admin/games/${roomId}/end`)).body.state, "COMPLETED");

    // owner-created and owner-driven actions are audited
    const audit = await owner.get("/api/admin/audit");
    assert.equal(audit.status, 200);
    const actions = audit.body.events.map((e) => e.action);
    assert.ok(actions.includes("owner.signin.success"));
    assert.ok(actions.includes("admin.room.create"));
    assert.ok(actions.includes("admin.room.start"));
    assert.ok(actions.includes("admin.room.call"));
    assert.ok(actions.includes("admin.room.end"));
  });

  test("the claim window is an operator decision, validated and stored", async () => {
    const owner = new AdminClient(url);
    await owner.signIn();

    const friendly = await owner.post("/api/admin/games", { name: "Grace Table", claimWindowCalls: 1 });
    assert.equal(friendly.status, 201, JSON.stringify(friendly.body));
    const detail = await owner.get(`/api/admin/games/${friendly.body.roomId}`);
    assert.equal(detail.body.room.config.claimWindowCalls, 1, "one call of grace is remembered");

    // the traditional room (the default) stores 0, not "undefined"
    const strict = await owner.post("/api/admin/games", { name: "Strict Table" });
    const strictDetail = await owner.get(`/api/admin/games/${strict.body.roomId}`);
    assert.equal(strictDetail.body.room.config.claimWindowCalls, 0);

    for (const bad of [11, -1, 1.5, "1", null]) {
      const refused = await owner.post("/api/admin/games", { name: "Bad Window", claimWindowCalls: bad });
      assert.equal(refused.status, 400, "refused " + JSON.stringify(bad));
      assert.equal(refused.body.code, "INVALID_INPUT");
    }
  });

  test("invitations are built from the configured public origin and carry no credentials", async () => {
    const owner = new AdminClient(url);
    await owner.signIn();
    const created = await owner.post("/api/admin/games", { name: "Invite Table" });
    const roomId = created.body.roomId;
    const res = await owner.get(`/api/admin/games/${roomId}/invitation`);
    assert.equal(res.status, 200);
    const inv = res.body.invitation;
    assert.equal(inv.url, `https://hall.example/player?id=${roomId}`);
    assert.equal(inv.originConfigured, true);
    assert.match(inv.qrDataUrl, /^data:image\/png;base64,/);
    assert.ok(!inv.url.includes("tambola_owner"));
    assert.ok(!JSON.stringify(inv).includes(owner.cookies.get("tambola_owner")), "no owner token leaks");
  });

  test("the owner can remove a disruptive player without closing the room", async () => {
    const owner = new AdminClient(url);
    await owner.signIn();
    const created = await owner.post("/api/admin/games", { name: "Removal Table" });
    const roomId = created.body.roomId;

    const socket = connectClient(url, { transports: ["websocket"], forceNew: true, reconnection: false });
    const joined = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no join ack")), 5000);
      socket.on("connect", () => {
        socket.emit("room:join", { roomId, name: "Disruptor" }, (ack) => {
          clearTimeout(timer);
          resolve(ack);
        });
      });
    });
    assert.equal(joined.ok, true);

    const before = await owner.get(`/api/admin/games/${roomId}`);
    assert.equal(before.body.room.members.length, 2, "operator seat + disruptive player");

    const removed = await owner.del(`/api/admin/games/${roomId}/members/${joined.playerId}`);
    assert.equal(removed.status, 200, JSON.stringify(removed.body));

    const afterRemoval = await owner.get(`/api/admin/games/${roomId}`);
    assert.equal(afterRemoval.body.room.members.length, 1);
    socket.disconnect();

    const audit = await owner.get("/api/admin/audit");
    assert.ok(audit.body.events.some((e) => e.action === "admin.player.remove" && e.targetId === joined.playerId));
  });

  test("an invalid room id and unknown room give honest errors", async () => {
    const owner = new AdminClient(url);
    await owner.signIn();
    assert.equal((await owner.get("/api/admin/games/notaroom")).status, 400);
    const missing = await owner.get("/api/admin/games/ZZZZZZZZ");
    assert.equal(missing.status, 404);
  });

  test("rate limiting refuses a credential-stuffing burst", async () => {
    // Use a distinct username so locking this key does not lock the real owner
    // account used by later tests.
    const client = new AdminClient(url);
    await client.get("/api/admin/session");
    let last;
    for (let i = 0; i < 4; i++) last = await client.post("/api/admin/signin", { username: "burst-victim", password: "wrong-pass-" + i });
    assert.equal(last.status, 429);
    assert.equal(last.body.code, "RATE_LIMITED");
    assert.equal(last.headers.get("retry-after") !== null, true);
  });

  test("logout revokes the session so the cookie stops working", async () => {
    const owner = new AdminClient(url);
    await owner.signIn();
    assert.equal((await owner.get("/api/admin/overview")).status, 200);
    const out = await owner.post("/api/admin/signout");
    assert.equal(out.status, 200);
    // keep the stale cookie deliberately
    const stale = owner.cookies.get("tambola_owner");
    const reuse = new AdminClient(url);
    reuse.cookies.set("tambola_owner", stale);
    assert.equal((await reuse.get("/api/admin/overview")).status, 401);
  });
});

describe("admin API surfaces database failure honestly", () => {
  let instance;
  let url;

  before(async () => {
    const backends = seededMemoryStore();
    await backends.store.create({ username: OWNER.username, passwordHash: await hashPassword(OWNER.password) });
    // Every method of the read layer rejects as if the database connection died.
    const failingQueries = new Proxy(
      {},
      {
        get: () => async () => {
          const error = new Error("connect ECONNREFUSED 127.0.0.1:55432");
          error.code = "ECONNREFUSED";
          throw error;
        },
      }
    );
    instance = await createApp({
      memoryOnly: true,
      origins: [],
      config: { autoCall: false },
      limits: { burst: 2000, perSecond: 4000 },
      ownerStore: backends.store,
      ownerSessions: backends.sessions,
      audit: backends.audit,
      adminQueries: failingQueries,
      publicOrigin: "https://hall.example",
      log: () => {},
    });
    const port = await instance.listen(0);
    url = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (instance) await instance.closeServer();
  });

  test("a query that cannot reach the database returns 503, not a fake dashboard", async () => {
    const owner = new AdminClient(url);
    await owner.signIn();
    const res = await owner.get("/api/admin/overview");
    assert.equal(res.status, 503);
    assert.equal(res.body.code, "ADMIN_UNAVAILABLE");
  });
});

// =========================================================== C. durable layer

const hasDatabase = Boolean(process.env.DATABASE_URL);
const skip = !hasDatabase;

describe("durable owner layer and admin queries", { skip }, () => {
  let db;
  let schema;
  let ownerStore;
  let ownerSessions;
  let audit;
  let queries;
  let poolFactory;

  before(async () => {
    const { createPool } = await import("../server/db/pool.js");
    const { migrate } = await import("../server/db/migrate.js");
    const { createOwnerStore } = await import("../server/admin/owner-store.js");
    const { createOwnerSessionStore } = await import("../server/admin/owner-sessions.js");
    const { createAdminAudit } = await import("../server/admin/audit.js");
    const { createAdminQueries } = await import("../server/admin/queries.js");

    schema = "tambola_admin_" + randomBytes(4).toString("hex");
    const connectionString = process.env.DATABASE_URL;
    poolFactory = (name) => createPool({ connectionString, schema: name });
    db = poolFactory(schema);
    await db.query("CREATE SCHEMA IF NOT EXISTS " + schema);
    await migrate({ db });

    ownerStore = createOwnerStore({ db });
    ownerSessions = createOwnerSessionStore({ db });
    audit = createAdminAudit({ db });
    queries = createAdminQueries({ db });

    // Seed two rooms: one completed with a winner and calls, one open/waiting.
    await db.query(`INSERT INTO players (player_id, display_name) VALUES ('p_alice', 'Alice'), ('p_bob', 'Bob')`);
    await db.query(
      `INSERT INTO rooms (room_code, status, game_number, host_player_id, config, closed_at)
       VALUES ('ROOMAAA1', 'COMPLETED', 1, 'p_alice', '{"name":"Friday Night"}', now())`
    );
    await db.query(
      `INSERT INTO rooms (room_code, status, game_number, host_player_id, config)
       VALUES ('ROOMBBB2', 'WAITING', 0, 'p_alice', '{"name":"Open Table"}')`
    );
    await db.query(
      `INSERT INTO room_members (room_code, player_id, role, connected) VALUES
         ('ROOMAAA1', 'p_alice', 'host', true), ('ROOMAAA1', 'p_bob', 'player', true),
         ('ROOMBBB2', 'p_alice', 'host', true)`
    );
    await db.query(
      `INSERT INTO games (room_code, game_number, status, draw_sequence, started_at, completed_at, end_reason)
       VALUES ('ROOMAAA1', 1, 'COMPLETED', '[5,12,40]', now() - interval '1 hour', now(), 'full-house')`
    );
    await db.query(
      `INSERT INTO tickets (room_code, game_number, player_id, grid)
       VALUES ('ROOMAAA1', 1, 'p_bob', '[[1,2,3,4,5,6,7,8,9],[10,11,12,13,14,15,16,17,18],[19,20,21,22,23,24,25,26,27]]')`
    );
    await db.query(
      `INSERT INTO draw_calls (room_code, game_number, call_index, number, source) VALUES
         ('ROOMAAA1', 1, 1, 5, 'host'), ('ROOMAAA1', 1, 2, 12, 'scheduler')`
    );
    await db.query(
      `INSERT INTO claims (room_code, game_number, player_id, pattern, status, reason, call_index) VALUES
         ('ROOMAAA1', 1, 'p_bob', 'topLine', 'AWARDED', 'complete', 2),
         ('ROOMAAA1', 1, 'p_bob', 'corners', 'REJECTED', 'corners incomplete', 2)`
    );
    await db.query(
      `INSERT INTO awards (room_code, game_number, player_id, pattern, points, call_index)
       VALUES ('ROOMAAA1', 1, 'p_bob', 'topLine', 10, 2)`
    );
  });

  after(async () => {
    if (db) {
      await db.query("DROP SCHEMA IF EXISTS " + schema + " CASCADE").catch(() => {});
      await db.end();
    }
  });

  test("migration 002 created the owner tables", async () => {
    const { listMigrations } = await import("../server/db/migrate.js");
    const versions = listMigrations().map((m) => m.version);
    assert.ok(versions.includes("002"));
    const tables = await db.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('owner_accounts','owner_sessions','admin_audit')",
      [schema]
    );
    assert.equal(tables.rows.length, 3);
  });

  test("owner accounts, hashed sessions and audit round-trip in Postgres", async () => {
    const created = await ownerStore.create({ username: "DbOwner", passwordHash: await hashPassword("db-owner-secret") });
    assert.equal(await ownerStore.count(), 1);
    assert.equal((await ownerStore.verifyLogin({ username: "dbowner", password: "db-owner-secret" })).ok, true);
    assert.equal((await ownerStore.verifyLogin({ username: "dbowner", password: "nope-nope" })).ok, false);

    const issued = await ownerSessions.issue({ ownerId: created.ownerId, ipHash: "abc" });
    assert.match(issued.token, /^[0-9a-f]{64}$/);
    const stored = await db.query("SELECT token_hash FROM owner_sessions WHERE session_id = $1", [issued.sessionId]);
    assert.equal(stored.rows[0].token_hash.length, 64);
    assert.notEqual(stored.rows[0].token_hash, issued.token, "only the hash is stored");

    assert.equal((await ownerSessions.verify({ token: issued.token })).ok, true);
    await ownerSessions.revoke({ sessionId: issued.sessionId });
    const afterRevoke = await ownerSessions.verify({ token: issued.token });
    assert.equal(afterRevoke.ok, false);
    assert.equal(afterRevoke.code, "OWNER_SESSION_REVOKED");

    const other = await ownerSessions.issue({ ownerId: created.ownerId });
    const revoked = await ownerSessions.revokeAllForOwner({ ownerId: created.ownerId, reason: "test" });
    assert.ok(revoked.revoked >= 1);
    assert.equal((await ownerSessions.verify({ token: other.token })).ok, false);

    await audit.record({ actor: "dbowner", action: "admin.test", targetType: "room", targetId: "ROOMAAA1", roomCode: "ROOMAAA1", metadata: { note: "safe" } });
    const recent = await audit.recent({ limit: 5 });
    assert.ok(recent.some((e) => e.action === "admin.test"));
    assert.ok(!JSON.stringify(recent).includes("db-owner-secret"), "audit never holds a password");
  });

  test("dashboard totals, status grouping and open rooms are real query results", async () => {
    const totals = await queries.totals();
    assert.equal(totals.total_rooms, 2);
    assert.equal(totals.completed_games, 1);
    assert.equal(totals.participants, 2);
    assert.equal(totals.awards, 1);
    assert.equal(totals.valid_claims, 1);
    assert.equal(totals.rejected_claims, 1);

    const grouped = await queries.roomsByStatus();
    assert.equal(grouped.WAITING, 1);
    assert.equal(grouped.RUNNING, 0);

    const open = await queries.openRooms({ limit: 10 });
    assert.equal(open.length, 1);
    assert.equal(open[0].roomId, "ROOMBBB2");

    const winners = await queries.recentWinners({ limit: 5 });
    assert.equal(winners.length, 1);
    assert.equal(winners[0].displayName, "Bob");
    assert.equal(winners[0].pattern, "topLine");
  });

  test("room detail exposes called numbers but never the private draw plan", async () => {
    const detail = await queries.roomDetail("ROOMAAA1");
    assert.ok(detail);
    assert.equal(detail.calledNumbers.length, 2);
    assert.equal(detail.awards.length, 1);
    assert.equal(detail.claims.length, 2);
    assert.equal(detail.members.length, 2);
    assert.equal(Object.prototype.hasOwnProperty.call(detail, "drawSequence"), false);
    assert.equal(JSON.stringify(detail).includes("draw_sequence"), false);
    assert.deepEqual(detail.calledNumbers.map((c) => c.number), [5, 12]);
  });

  test("the health probe is shaped the way every caller reads it", async () => {
    const probe = await queries.health();
    assert.equal(probe.ok, true, "a reachable database reports ok: true, not a bare boolean");
    assert.match(probe.checkedAt, /^\d{4}-/);
  });

  test("player directory paginates and rolls up memberships", async () => {
    const page = await queries.listPlayers({ limit: 1, offset: 0 });
    assert.equal(page.total, 2);
    assert.equal(page.players.length, 1);
    const alice = await queries.playerDetail("p_alice");
    assert.equal(alice.memberships.length, 2);
  });

  test("history stays queryable after a room is closed", async () => {
    const closed = await queries.history({ state: "closed", limit: 10, offset: 0 });
    assert.equal(closed.total, 1);
    assert.equal(closed.games[0].roomId, "ROOMAAA1");
    assert.equal(closed.games[0].roundsPlayed, 1);
    assert.equal(closed.games[0].participants, 2);
    const all = await queries.history({ limit: 10, offset: 0 });
    assert.equal(all.total, 2, "closing a room does not remove it from history");
  });
});
