/**
 * Phase 6 - production hardening verification.
 *
 * Four groups, in ascending order of what they need:
 *
 *   A. pure units        the second-factor crypto, the throttle policy and the
 *                        health answers, with no sockets and no database
 *   B. over HTTP         the two-step owner sign-in and the second-factor
 *                        management surface, on the in-memory backends
 *   C. scheduler gate    what happens to the calling clock when this process
 *                        stops being the instance that owns the database
 *   D. durable (Postgres) migration 003, the shared attempt counter, the
 *                        instance lease and a real durable server, each in a
 *                        throwaway schema that is dropped afterwards
 *
 * Group D is skipped when no database is reachable. The application server must
 * be stopped while this file runs: the instance advisory lock is per Postgres
 * *cluster*, not per schema, so a live server holding it makes the lease tests
 * fail - which is that test doing its job, not a false positive.
 *
 * Nothing here asserts on a secret: the tests check that secrets are absent from
 * responses and that only ciphertext reaches the database.
 */

import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { compareSnapshots, driverAvailable, parseConnection } from "../scripts/pg-cli.js";

import { createApp } from "../server/index.js";
import {
  currentCode,
  decryptSecret,
  describeMfa,
  encryptSecret,
  generateSecret,
  normalizeCode,
  parseMfaKey,
  provisioningUri,
  verifyCode,
} from "../server/admin/mfa.js";
import { createDurableRateLimiter, createThrottleSet, hashKey, THROTTLE_POLICIES } from "../server/admin/rate-limit.js";
import { createMemoryMfaChallengeStore } from "../server/admin/mfa-challenges.js";
import { createHealth } from "../server/observability/health.js";
import { createCallScheduler } from "../server/persist/scheduler.js";
import { createLogger } from "../server/observability/log.js";
import { hashPassword } from "../server/admin/password.js";
import { createMemoryOwnerStore } from "../server/admin/owner-store.js";
import { createMemoryOwnerSessions } from "../server/admin/owner-sessions.js";
import { createMemoryAdminAudit } from "../server/admin/audit.js";

const OWNER = { username: "operator", password: "correct-horse-battery" };
const MFA_KEY = randomBytes(32);

/** A code valid `steps` from now (negative = a step already spent). */
function codeAt(secret, steps = 0) {
  return currentCode({ secret, now: Date.now() + steps * 30_000 });
}

// ============================================================ A. pure units

describe("second-factor key handling", () => {
  test("a missing key means unavailable, a malformed key means a hard error", () => {
    assert.deepEqual(parseMfaKey(undefined), { configured: false, key: null });
    assert.deepEqual(parseMfaKey(""), { configured: false, key: null });
    assert.deepEqual(parseMfaKey("   "), { configured: false, key: null });

    assert.equal(parseMfaKey(MFA_KEY.toString("hex")).configured, true);
    assert.equal(parseMfaKey(MFA_KEY.toString("base64url")).configured, true);
    assert.equal(parseMfaKey(MFA_KEY.toString("base64")).configured, true);

    for (const bad of ["short", randomBytes(31).toString("hex"), randomBytes(64).toString("hex"), "zz" + "0".repeat(62)]) {
      assert.throws(() => parseMfaKey(bad), (error) => error.code === "MFA_KEY_INVALID", JSON.stringify(bad).slice(0, 12) + " must be refused");
    }
  });

  test("a sealed secret round-trips and never survives in the envelope", () => {
    const secret = generateSecret();
    const envelope = encryptSecret({ secret, ownerId: "owner-1", key: MFA_KEY });
    assert.match(envelope, /^v1\./);
    assert.equal(envelope.includes(secret), false, "the base32 secret must not appear in the ciphertext");
    assert.equal(envelope.split(".").length, 4);
    assert.equal(decryptSecret({ envelope, ownerId: "owner-1", key: MFA_KEY }), secret);
  });

  test("a sealed secret is bound to its owner, its key and its own bytes", () => {
    const secret = generateSecret();
    const envelope = encryptSecret({ secret, ownerId: "owner-1", key: MFA_KEY });
    assert.equal(decryptSecret({ envelope, ownerId: "owner-2", key: MFA_KEY }), null, "another owner must not open it");
    assert.equal(decryptSecret({ envelope, ownerId: "owner-1", key: randomBytes(32) }), null, "another key must not open it");
    assert.equal(decryptSecret({ envelope: envelope.replace(/v1\./, "v2."), ownerId: "owner-1", key: MFA_KEY }), null);
    assert.equal(decryptSecret({ envelope: "garbage", ownerId: "owner-1", key: MFA_KEY }), null);
    assert.equal(decryptSecret({ envelope, ownerId: "owner-1", key: null }), null);
    const tampered = envelope.split(".");
    tampered[3] = tampered[3].slice(0, -4) + "AAAA";
    assert.equal(decryptSecret({ envelope: tampered.join("."), ownerId: "owner-1", key: MFA_KEY }), null, "a flipped byte must fail authentication");
  });

  test("encrypting with no key returns nothing rather than plaintext", () => {
    assert.equal(encryptSecret({ secret: generateSecret(), ownerId: "o", key: null }), null);
    assert.throws(() => encryptSecret({ secret: generateSecret(), ownerId: null, key: MFA_KEY }));
    assert.throws(() => encryptSecret({ secret: "", ownerId: "o", key: MFA_KEY }));
  });

  test("a code verifies once and cannot be replayed inside its window", () => {
    const secret = generateSecret();
    assert.equal(verifyCode({ secret, code: codeAt(secret, 0) }).ok, true);
    const first = verifyCode({ secret, code: codeAt(secret, 0) });
    assert.equal(first.ok, true);
    assert.equal(verifyCode({ secret, code: codeAt(secret, 0), lastStep: first.step }).ok, false, "the same step twice is a replay");
    assert.equal(verifyCode({ secret, code: codeAt(secret, 0), lastStep: first.step }).reason, "REPLAY");
    assert.equal(verifyCode({ secret, code: codeAt(secret, 1), lastStep: first.step }).ok, true, "a newer step is fine");
    assert.equal(verifyCode({ secret, code: codeAt(secret, 5) }).ok, false, "far outside the window is refused");
    assert.equal(verifyCode({ secret, code: "0000000" }).reason, "FORMAT");
    assert.equal(verifyCode({ secret, code: "abc123" }).reason, "FORMAT");
    assert.equal(verifyCode({ secret: "NOTASECRET", code: codeAt(secret, 0) }).ok, false);
  });

  test("code normalisation accepts spacing and nothing else", () => {
    assert.equal(normalizeCode(" 123 456 "), "123456");
    assert.equal(normalizeCode("12345"), null);
    assert.equal(normalizeCode("12345a"), null);
    assert.equal(normalizeCode(null), null);
    assert.equal(normalizeCode(123456), null, "a number is not a string");
  });

  test("the provisioning uri names the issuer and the account", () => {
    const uri = provisioningUri({ secret: generateSecret(), username: "operator", issuer: "Tambola" });
    assert.match(uri, /^otpauth:\/\/totp\/Tambola:/);
    assert.match(uri, /[?&]secret=[A-Z2-7]+/);
    assert.match(uri, /[?&]period=30/);
    assert.match(uri, /[?&]digits=6/);
    assert.throws(() => provisioningUri({ secret: generateSecret() }));
  });

  test("the mfa description never carries a secret", () => {
    const cases = [
      [{ keyConfigured: false }, "unavailable"],
      [{ keyConfigured: true, confirmedAt: new Date() }, "enrolled"],
      [{ keyConfigured: true, pending: true }, "pending"],
      [{ keyConfigured: true }, "not-enrolled"],
    ];
    for (const [input, state] of cases) {
      const described = describeMfa(input);
      assert.equal(described.state, state);
      assert.equal(JSON.stringify(described).includes("secret"), false);
    }
  });
});

describe("health answers distinguish liveness, readiness and mode", () => {
  const okDb = { healthCheck: async () => true, query: async () => ({ rows: [] }), withTransaction: async (fn) => fn({ query: async () => ({ rows: [] }) }) };

  test("liveness never touches the database", async () => {
    let touched = 0;
    const health = createHealth({
      durable: true,
      db: { ...okDb, healthCheck: async () => { touched += 1; return true; } },
      lease: () => ({ held: true, lost: false }),
    });
    const live = health.liveness();
    assert.equal(live.ok, true);
    assert.equal(live.live, true);
    assert.equal(touched, 0, "a database outage must not make a supervisor kill a healthy process");
  });

  test("a lost lease or a drain takes the process out of rotation", async () => {
    const lostLease = createHealth({ durable: true, db: okDb, lease: () => ({ held: false, lost: true }) });
    const lost = await lostLease.readiness();
    assert.equal(lost.ready, false);
    assert.ok(lost.reasons.includes("instance_lease_lost"));

    const draining = createHealth({ durable: true, db: okDb, lease: () => ({ held: true }), draining: () => true });
    const drained = await draining.readiness();
    assert.equal(drained.ready, false);
    assert.ok(drained.reasons.includes("draining"));

    const down = createHealth({ durable: true, db: { healthCheck: async () => false }, lease: () => ({ held: true }) });
    const unreachable = await down.readiness();
    assert.equal(unreachable.ready, false);
    assert.ok(unreachable.reasons.includes("database_unreachable"));
  });

  test("memory mode is honest, and refuses to pretend in production", async () => {
    const dev = createHealth({ durable: false, db: null, production: false, memoryAllowed: true });
    const devAnswer = await dev.readiness();
    assert.equal(devAnswer.durable, false);
    assert.equal(devAnswer.degraded, true);
    assert.match(devAnswer.note, /nothing survives a restart/);

    const prod = createHealth({ durable: false, db: null, production: true, memoryAllowed: false });
    const prodAnswer = await prod.readiness();
    assert.equal(prodAnswer.ready, false, "production without durable storage is not ready");
    assert.ok(prodAnswer.reasons.includes("no_database_in_production"));

    const optedIn = createHealth({ durable: false, db: null, production: true, memoryAllowed: true });
    assert.equal((await optedIn.readiness()).reasons.length, 0, "an explicit opt-in is respected");
  });

  test("a probe response carries no connection string, query or stack", async () => {
    const secretish = {
      healthCheck: async () => true,
      query: async () => {
        throw new Error("connect postgres://user:hunter2@db.internal:5432/tambola failed");
      },
    };
    const health = createHealth({ durable: true, db: secretish, lease: () => ({ held: true }) });
    const report = await health.report();
    const text = JSON.stringify(report);
    assert.equal(text.includes("hunter2"), false);
    assert.equal(text.includes("postgres://"), false);
    assert.equal(text.includes("db.internal"), false);
    assert.equal(text.includes("at "), false, "no stack trace");
    assert.equal(report.ready, false);
    assert.ok(report.reasons.includes("migrations_pending") || report.reasons.includes("database_unreachable"));
  });

  test("readiness is cached so a probing load balancer cannot stampede the database", async () => {
    let calls = 0;
    const health = createHealth({
      durable: true,
      db: { ...okDb, healthCheck: async () => { calls += 1; return true; } },
      lease: () => ({ held: true }),
      cacheMs: 5000,
    });
    await health.readiness();
    await health.readiness();
    await health.readiness();
    assert.equal(calls, 1);
  });
});

describe("structured logging keeps credentials out of the log", () => {
  function capture(options = {}) {
    const lines = [];
    const logger = createLogger({ level: "debug", sink: (line) => lines.push(JSON.parse(line)), ...options });
    return { logger, lines, last: () => lines[lines.length - 1] };
  }

  test("one json object per line, with a timestamp, a severity and the event name", () => {
    const { logger, last } = capture();
    logger.info("room.created", { roomId: "ABC12345" });
    const entry = last();
    assert.equal(entry.level, "info");
    assert.equal(entry.event, "room.created");
    assert.equal(entry.service, "tambola");
    assert.equal(entry.roomId, "ABC12345");
    assert.ok(Date.parse(entry.ts), "every line is timestamped in ISO-8601");
  });

  test("the legacy log(...) shim still writes, and a failure word raises the level", () => {
    const { logger, last } = capture();
    logger.shim("room created", "ABC12345");
    assert.equal(last().level, "info");
    logger.shim("connection failed", "retrying");
    assert.equal(last().level, "warn", "a failure message is a warning, not info");
    assert.match(last().msg, /connection failed/);
  });

  test("anything below the configured level is dropped entirely", () => {
    const lines = [];
    const logger = createLogger({ level: "warn", sink: (line) => lines.push(JSON.parse(line)) });
    logger.info("nope");
    logger.debug("nope");
    assert.equal(lines.length, 0, "info and debug are silent at warn level");
    logger.warn("yes");
    assert.equal(lines.length, 1);
  });

  test("a credential-named field is redacted, a username is not", () => {
    const { logger, lines } = capture();
    logger.info("auth.attempt", { username: "operator", password: "hunter2", csrfToken: "zzz", nested: { totp: "123456" } });
    const text = JSON.stringify(lines);
    assert.equal(text.includes("hunter2"), false);
    assert.equal(text.includes("123456"), false);
    assert.equal(text.includes("zzz"), false, "the csrf value is redacted");
    assert.equal(text.includes("operator"), true, "a username is not a secret and is kept");
  });

  test("database credentials quoted inside a message are scrubbed", () => {
    const { logger, last } = capture();
    logger.error("db.failure", { detail: "connect postgres://user:hunter2@db.internal:5432/tambola refused" });
    const text = JSON.stringify(last());
    assert.equal(text.includes("hunter2"), false);
    assert.equal(text.includes("user:"), false, "only the scheme survives, the credentials do not");
    assert.ok(text.includes("[redacted]"));
  });
});

// ================================================== A2. durable throttle policy

/**
 * A tiny stand-in for the auth_throttle table that speaks just enough of the
 * pool interface for createDurableRateLimiter: `query` for the single
 * statements, `withTransaction` for the read-modify-write, with a real per-row
 * mutex so that "concurrent guesses cannot both read 7 of 8" is a claim about
 * the code and not about the fake.
 */
function makeThrottleDb() {
  // "scope|hash" -> { failures, strikes, windowStartedAt(ms), lockedUntilMs(ms|null) }
  const rows = new Map();
  // Every transaction is chained onto one tail promise: this models the
  // SELECT ... FOR UPDATE row lock, so a read-modify-write is atomic and the
  // "concurrent guesses cannot both spend a slot" claim is about the code, not
  // about the fake letting two guesses interleave.
  let tail = Promise.resolve();

  const idOf = (scope, hash) => `${scope}|${hash}`;
  const readRow = (params) => rows.get(idOf(params[0], params[1]));

  async function query(text, params = []) {
    const sql = String(text).replace(/\s+/g, " ").trim();
    if (sql.startsWith("SELECT locked_until")) {
      const r = readRow(params);
      return { rows: r ? [{ locked_until: r.lockedUntilMs ? new Date(r.lockedUntilMs) : null, at: new Date() }] : [] };
    }
    if (sql.startsWith("SELECT failures, strikes, locked_until")) {
      const r = readRow(params);
      return { rows: r ? [{ failures: r.failures, strikes: r.strikes, locked_until: r.lockedUntilMs ? new Date(r.lockedUntilMs) : null }] : [] };
    }
    if (sql.startsWith("DELETE FROM auth_throttle WHERE scope")) {
      const existed = rows.delete(idOf(params[0], params[1]));
      return { rowCount: existed ? 1 : 0 };
    }
    if (sql.startsWith("DELETE FROM auth_throttle")) {
      let purged = 0;
      for (const [id, r] of [...rows.entries()]) {
        if (Date.now() - r.windowStartedAt > 86_400_000 && (!r.lockedUntilMs || r.lockedUntilMs < Date.now())) {
          rows.delete(id);
          purged += 1;
        }
      }
      return { rowCount: purged };
    }
    throw new Error("unexpected statement: " + sql.slice(0, 60));
  }

  function withTransaction(fn) {
    const run = tail.then(() =>
      fn({
        query: async (text, params = []) => {
          const sql = String(text).replace(/\s+/g, " ").trim();
          if (sql.startsWith("SELECT failures, strikes, window_started_at")) {
            const r = readRow(params);
            if (!r) return { rows: [] };
            return {
              rows: [{
                failures: r.failures,
                strikes: r.strikes,
                window_started_at: new Date(r.windowStartedAt),
                locked_until: r.lockedUntilMs ? new Date(r.lockedUntilMs) : null,
                at: new Date(),
              }],
            };
          }
          if (sql.startsWith("INSERT INTO auth_throttle")) {
            rows.set(idOf(params[0], params[1]), {
              failures: params[2],
              strikes: params[3],
              windowStartedAt: params[4],
              lockedUntilMs: params[5] ? Number(params[5]) : null,
            });
            return { rows: [], rowCount: 1 };
          }
          throw new Error("unexpected transactional statement: " + sql.slice(0, 60));
        },
      })
    );
    tail = run.then(
      () => {},
      () => {}
    );
    return run;
  }

  return { query, withTransaction, rows };
}

describe("the shared attempt counter enforces a policy that outlives the process", () => {
  const policy = { ...THROTTLE_POLICIES.signin, maxFailures: 4, baseLockoutMs: 5000, maxLockoutMs: 20000 };

  test("failures spend the budget, then the key is locked with a retry window", async () => {
    const db = makeThrottleDb();
    const limiter = createDurableRateLimiter({ db, policy });
    assert.equal(limiter.backend, "database");
    for (let i = 0; i < 3; i++) {
      const spent = await limiter.recordFailure({ key: "operator|ip" });
      assert.equal(spent.locked, false);
      assert.equal(spent.remaining, 3 - i);
    }
    assert.equal((await limiter.check({ key: "operator|ip" })).allowed, true);
    const fourth = await limiter.recordFailure({ key: "operator|ip" });
    assert.equal(fourth.locked, true);
    assert.ok(fourth.retryAfterMs > 0);
    const gate = await limiter.check({ key: "operator|ip" });
    assert.equal(gate.allowed, false);
    assert.equal(gate.retryAfterMs > 0, true);
  });

  test("retrying inside a lockout does not extend it", async () => {
    const db = makeThrottleDb();
    const limiter = createDurableRateLimiter({ db, policy });
    let last;
    for (let i = 0; i < 6; i++) last = await limiter.recordFailure({ key: "sprayer" });
    assert.equal(last.locked, true);
    const first = await limiter.status({ key: "sprayer" });
    for (let i = 0; i < 6; i++) await limiter.recordFailure({ key: "sprayer" });
    const after = await limiter.status({ key: "sprayer" });
    assert.equal(after.strikes, first.strikes, "a caller in a loop must not be able to lengthen its own lockout");
    assert.equal(Date.parse(after.lockedUntil) - Date.parse(first.lockedUntil) < 5, true);
  });

  test("the counter is shared: a second limiter sees the first one's lockout", async () => {
    const db = makeThrottleDb();
    const before = createDurableRateLimiter({ db, policy });
    for (let i = 0; i < 4; i++) await before.recordFailure({ key: "operator|ip" });
    // "restart": a brand-new limiter over the same storage must not forget.
    const afterRestart = createDurableRateLimiter({ db, policy });
    assert.equal((await afterRestart.check({ key: "operator|ip" })).allowed, false);
    assert.equal((await afterRestart.check({ key: "someone-else" })).allowed, true, "the lock is per key, never global");
  });

  test("a success clears that key's history", async () => {
    const db = makeThrottleDb();
    const limiter = createDurableRateLimiter({ db, policy });
    await limiter.recordFailure({ key: "typo" });
    await limiter.recordFailure({ key: "typo" });
    assert.equal((await limiter.status({ key: "typo" })).failures, 2);
    await limiter.recordSuccess({ key: "typo" });
    assert.equal((await limiter.status({ key: "typo" })).failures, 0);
    assert.equal((await limiter.check({ key: "typo" })).allowed, true);
  });

  test("concurrent guesses cannot both spend the same slot", async () => {
    const db = makeThrottleDb();
    const limiter = createDurableRateLimiter({ db, policy });
    const results = await Promise.all([1, 2, 3, 4, 5, 6].map(() => limiter.recordFailure({ key: "race" })));
    const counted = results.filter((entry) => entry.counted);
    assert.equal(counted.length, 4, "only the four budget slots may be spent, got " + counted.length);
    assert.equal(results.filter((entry) => entry.locked).length >= 1, true);
    const row = db.rows.get(`signin|${hashKey("race")}`);
    assert.equal(row.failures, 0, "the window resets when the lock is taken");
    assert.equal(row.strikes, 1);
  });

  test("a limiter that cannot be reached is not treated as an open gate", async () => {
    const limiter = createDurableRateLimiter({
      db: { query: async () => { throw new Error("connection reset"); }, withTransaction: async () => { throw new Error("connection reset"); } },
      policy,
    });
    await assert.rejects(() => limiter.check({ key: "x" }));
    // the route layer turns a throw into `unavailable`, which answers 503
    const wrapped = { async check() { try { return await limiter.check({ key: "x" }); } catch { return { unavailable: true }; } } };
    assert.equal((await wrapped.check()).unavailable, true);
  });

  test("prune clears quiet rows and the set sweeps the table only once", async () => {
    const db = makeThrottleDb();
    const set = createThrottleSet({ db });
    assert.equal(set.backend, "database");
    await set.signin.recordFailure({ key: "old" });
    const row = db.rows.get(`signin|${hashKey("old")}`);
    row.windowStartedAt = Date.now() - 2 * 86_400_000;
    row.lockedUntilMs = null;
    const pruned = await set.prune();
    assert.equal(pruned.ok, true);
    assert.equal(db.rows.has(`signin|${hashKey("old")}`), false, "a quiet, unlocked row is swept");
  });

  test("memory mode still gets a limiter set with the same interface", () => {
    const set = createThrottleSet({ db: null });
    assert.equal(set.backend, "memory");
    for (const name of ["signin", "signinIp", "mfa", "adminMutation", "credentialChange"]) {
      assert.equal(typeof set[name].check, "function", name);
      assert.equal(typeof set[name].recordFailure, "function", name);
      assert.equal(typeof set[name].recordSuccess, "function", name);
    }
  });
});

describe("pre-authentication challenges are single-use", () => {
  test("a challenge expires, burns attempts and is consumed once", async () => {
    let clock = Date.now();
    const store = createMemoryMfaChallengeStore({ ttlMs: 1000, maxAttempts: 2, now: () => clock });
    const issued = await store.issue({ ownerId: "o1" });
    assert.match(issued.token, /^[0-9a-f]{64}$/);
    assert.equal((await store.lookup({ token: issued.token })).ok, true);
    assert.equal((await store.lookup({ token: "00".repeat(32) })).code, "MFA_CHALLENGE_INVALID");

    await store.fail({ challengeId: issued.challengeId });
    const second = await store.fail({ challengeId: issued.challengeId });
    assert.equal(second.locked, true);
    assert.equal((await store.lookup({ token: issued.token })).code, "MFA_CHALLENGE_LOCKED");

    clock += 5000;
    assert.equal((await store.lookup({ token: issued.token })).code, "MFA_CHALLENGE_EXPIRED");

    const fresh = await store.issue({ ownerId: "o1" });
    assert.equal((await store.complete({ challengeId: fresh.challengeId })).ok, true);
    assert.equal((await store.complete({ challengeId: fresh.challengeId })).ok, false, "a spent challenge cannot be spent twice");
  });

  test("resetting a second factor cancels the challenges already in flight", async () => {
    const store = createMemoryMfaChallengeStore();
    const mine = await store.issue({ ownerId: "o1" });
    const theirs = await store.issue({ ownerId: "o2" });
    const swept = await store.revokeAllForOwner({ ownerId: "o1" });
    assert.equal(swept.revoked, 1);
    assert.equal((await store.lookup({ token: mine.token })).ok, false);
    assert.equal((await store.lookup({ token: theirs.token })).ok, true, "another owner is untouched");
  });
});

// ============================================================ B. over HTTP

/** A minimal cookie jar that follows the admin contract: CSRF echo + HttpOnly session. */
class AdminClient {
  constructor(baseUrl) {
    this.base = baseUrl;
    this.cookies = new Map();
    this.csrf = null;
  }
  storeCookies(res) {
    for (const raw of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
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
    const res = await fetch(this.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
    this.storeCookies(res);
    let parsed = null;
    try { parsed = await res.json(); } catch { parsed = null; }
    if (parsed && typeof parsed.csrfToken === "string") this.csrf = parsed.csrfToken;
    return { status: res.status, body: parsed };
  }
  get(path) { return this.req("GET", path); }
  post(path, body = {}) { return this.req("POST", path, body); }
}

describe("owner second-factor sign-in over HTTP (in-memory backends)", () => {
  let instance;
  let url;

  before(async () => {
    const store = createMemoryOwnerStore();
    const sessions = createMemoryOwnerSessions();
    const audit = createMemoryAdminAudit();
    await store.create({ username: OWNER.username, passwordHash: await hashPassword(OWNER.password) });
    instance = await createApp({
      memoryOnly: true,
      origins: [],
      config: { autoCall: false, chatIntervalMs: 0, callIntervalMs: 60000 },
      limits: { burst: 2000, perSecond: 4000 },
      ownerStore: store,
      ownerSessions: sessions,
      audit,
      mfaKey: { configured: true, key: MFA_KEY },
      mfaIssuer: "TambolaTest",
      log: () => {},
    });
    const port = await instance.listen(0);
    url = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (instance) await instance.closeServer();
  });

  test("the second factor turns a password into only half a login", async () => {
    const client = new AdminClient(url);
    await client.get("/api/admin/session");
    const first = await client.post("/api/admin/signin", { username: OWNER.username, password: OWNER.password });
    assert.equal(first.status, 200);
    assert.equal(first.body.authenticated, true, "no factor yet, so the password is sufficient");

    const enroll = await client.post("/api/admin/settings/mfa/enroll", {});
    assert.equal(enroll.status, 200);
    const secret = enroll.body.secret;
    assert.ok(secret, "the plaintext secret is returned exactly once");
    assert.match(enroll.body.uri, /^otpauth:\/\/totp\//);
    assert.match(enroll.body.qr, /^data:image\/png;base64,/);

    const bad = await client.post("/api/admin/settings/mfa/confirm", { code: "000000" });
    assert.equal(bad.status, 401, "a wrong code does not activate the factor");
    const confirm = await client.post("/api/admin/settings/mfa/confirm", { code: codeAt(secret, 0) });
    assert.equal(confirm.status, 200);
    assert.equal(confirm.body.mfa.state, "enrolled");

    await client.post("/api/admin/signout", {});
    assert.equal(client.cookies.has("tambola_owner"), false, "signout clears the session cookie");

    // A fresh browser: the password now buys only a challenge, never a session.
    const second = new AdminClient(url);
    await second.get("/api/admin/session");
    const step1 = await second.post("/api/admin/signin", { username: OWNER.username, password: OWNER.password });
    assert.equal(step1.status, 200);
    assert.equal(step1.body.mfaRequired, true);
    assert.equal(step1.body.authenticated, undefined, "the password alone does not authenticate");
    assert.match(step1.body.challengeToken, /^[0-9a-f]{64}$/);
    assert.equal(second.cookies.has("tambola_owner"), false, "no session cookie on the password step");

    const wrong = await second.post("/api/admin/signin/mfa", { challengeToken: step1.body.challengeToken, code: "111111" });
    assert.equal(wrong.status, 401, "a wrong code is refused");
    assert.equal(second.cookies.has("tambola_owner"), false, "and still issues no session");

    const good = await second.post("/api/admin/signin/mfa", { challengeToken: step1.body.challengeToken, code: codeAt(secret, 1) });
    assert.equal(good.status, 200);
    assert.equal(good.body.authenticated, true);
    assert.equal(second.cookies.has("tambola_owner"), true, "only the code mints a session");

    const replay = await second.post("/api/admin/signin/mfa", { challengeToken: step1.body.challengeToken, code: codeAt(secret, 2) });
    assert.equal(replay.status, 401, "a spent challenge cannot be traded a second time");

    const settings = await second.get("/api/admin/settings");
    assert.equal(settings.status, 200);
    assert.equal(settings.body.mfa.state, "enrolled");
  });
});

// ==================================================== C. scheduler authority

function makeClock() {
  let t = 0;
  const due = [];
  return {
    now: () => t,
    advance(ms) { t += ms; },
    setTimer: (fn) => { due.push(fn); return { fn }; },
    clearTimer: (handle) => { const i = due.indexOf(handle && handle.fn); if (i >= 0) due.splice(i, 1); },
    pending: () => due.length,
    async fireAll() { const fns = due.splice(0); for (const f of fns) await f(); },
  };
}

const fakeRoom = (roomId = "r1") => ({ roomId, state: "RUNNING", config: { callIntervalMs: 500 } });
const nullStore = { loadSchedule: async () => null, setScheduleFlags: async () => {} };

describe("the calling clock stops the instant this process loses authority", () => {
  test("a tick whose authority vanished before it fires is dropped, never called", async () => {
    const clock = makeClock();
    const ticks = [];
    let authorised = true;
    const scheduler = createCallScheduler({
      store: nullStore,
      registry: { get: (roomId) => fakeRoom(roomId) },
      onTick: (room) => { ticks.push(room.roomId); },
      canTick: () => authorised,
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      log: () => {},
    });

    scheduler.arm(fakeRoom("r1"), { nextDueAt: new Date(500), intervalMs: 500 });
    assert.equal(clock.pending(), 1, "a clock is armed while this process still owns the game");

    authorised = false; // the lease/advisory lock is lost between arming and firing
    clock.advance(500);
    await clock.fireAll();
    assert.equal(ticks.length, 0, "no number is called without authority");
    assert.equal(scheduler.isArmed("r1"), false, "the dropped tick does not re-arm a clock this process no longer owns");

    authorised = true;
    scheduler.arm(fakeRoom("r1"), { nextDueAt: new Date(clock.now() + 500), intervalMs: 500 });
    await clock.fireAll();
    assert.equal(ticks.length, 1, "with authority the same clock calls normally");
  });

  test("installing a denying gate immediately stands every clock down", () => {
    const clock = makeClock();
    const scheduler = createCallScheduler({
      store: nullStore,
      registry: { get: (roomId) => fakeRoom(roomId) },
      onTick: () => {},
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      log: () => {},
    });
    scheduler.arm(fakeRoom("r1"), { nextDueAt: new Date(500), intervalMs: 500 });
    assert.equal(scheduler.count(), 1);
    scheduler.setCanTick(() => false);
    assert.equal(scheduler.count(), 0, "setCanTick(false) cancels every armed clock at once");
    assert.equal(clock.pending(), 0, "and no timer is left to fire");
  });

  test("a clock cannot even be armed without authority", () => {
    const clock = makeClock();
    const scheduler = createCallScheduler({
      store: nullStore,
      registry: { get: (roomId) => fakeRoom(roomId) },
      onTick: () => {},
      canTick: () => false,
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      log: () => {},
    });
    assert.equal(scheduler.arm(fakeRoom("r1"), { nextDueAt: new Date(500), intervalMs: 500 }), null);
    assert.equal(clock.pending(), 0, "an unauthorised process never schedules a call");
  });
});

// ======================================================= D. durable (Postgres)

const hasDatabase = Boolean(process.env.DATABASE_URL);
const durableSkip = hasDatabase ? false : "no DATABASE_URL - durable suite needs PostgreSQL";

describe("hardening that outlives the process (PostgreSQL)", () => {
  const SCHEMA = "tambola_harden_" + randomBytes(4).toString("hex");
  let db;

  before(async () => {
    if (!hasDatabase) return;
    const { createPool } = await import("../server/db/pool.js");
    const { migrate } = await import("../server/db/migrate.js");
    db = createPool({ connectionString: process.env.DATABASE_URL, schema: SCHEMA, log: () => {} });
    await db.query("CREATE SCHEMA IF NOT EXISTS " + SCHEMA);
    await migrate({ db, log: () => {} });
  });

  after(async () => {
    if (!db) return;
    await db.query("DROP SCHEMA IF EXISTS " + SCHEMA + " CASCADE").catch(() => {});
    await db.end();
  });

  test("migration 003 creates the throttle and challenge tables and the totp columns", { skip: durableSkip }, async () => {
    const tables = await db.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('auth_throttle','owner_mfa_challenges')",
      [SCHEMA]
    );
    assert.equal(tables.rows.length, 2, "both hardening tables exist");
    const cols = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'owner_accounts'",
      [SCHEMA]
    );
    const names = new Set(cols.rows.map((c) => c.column_name));
    for (const col of ["totp_secret_enc", "totp_confirmed_at", "totp_last_step"]) {
      assert.ok(names.has(col), col + " is present");
    }
  });

  test("a lockout written by one limiter is honoured by a fresh limiter over the same database", { skip: durableSkip }, async () => {
    const policy = { ...THROTTLE_POLICIES.signin, maxFailures: 3, baseLockoutMs: 30000, maxLockoutMs: 60000 };
    const before1 = createDurableRateLimiter({ db, policy });
    for (let i = 0; i < 3; i++) await before1.recordFailure({ key: "operator|1.2.3.4" });
    // "restart": a brand-new limiter over the same rows must not forget the lockout.
    const afterRestart = createDurableRateLimiter({ db, policy });
    const gate = await afterRestart.check({ key: "operator|1.2.3.4" });
    assert.equal(gate.allowed, false, "the counter lives in Postgres, not in the process");
    assert.ok(gate.retryAfterMs > 0);
    await afterRestart.recordSuccess({ key: "operator|1.2.3.4" });
    assert.equal((await afterRestart.check({ key: "operator|1.2.3.4" })).allowed, true, "a success clears the key");
  });

  test("a sealed totp secret round-trips through Postgres and only ciphertext is stored", { skip: durableSkip }, async () => {
    const { createOwnerStore } = await import("../server/admin/owner-store.js");
    const store = createOwnerStore({ db, log: () => {} });
    const created = await store.create({ username: "dboperator", passwordHash: await hashPassword("db-owner-secret-long") });
    const secret = generateSecret();
    const sealed = encryptSecret({ secret, ownerId: created.ownerId, key: MFA_KEY });
    assert.match(sealed, /^v1\./);
    await store.beginMfaEnrollment({ ownerId: created.ownerId, secretEnc: sealed });

    const raw = await db.query("SELECT totp_secret_enc FROM owner_accounts WHERE owner_id = $1", [created.ownerId]);
    assert.equal(raw.rows[0].totp_secret_enc.includes(secret), false, "the base32 secret never lands in the database");
    assert.equal(raw.rows[0].totp_secret_enc, sealed);

    assert.equal((await store.confirmMfa({ ownerId: created.ownerId, step: 1 })).ok, true);
    const account = await store.getForMfa({ ownerId: created.ownerId });
    assert.equal(decryptSecret({ envelope: account.totpSecretEnc, ownerId: created.ownerId, key: MFA_KEY }), secret, "it opens back to the same secret");
    assert.equal(account.totpConfirmedAt instanceof Date, true);

    // the SQL step guard refuses a replay of an equal or older step
    assert.equal((await store.advanceMfaStep({ ownerId: created.ownerId, step: 0 })).code, "MFA_REPLAY");
    assert.equal((await store.advanceMfaStep({ ownerId: created.ownerId, step: 2 })).ok, true);
    assert.equal((await store.advanceMfaStep({ ownerId: created.ownerId, step: 2 })).code, "MFA_REPLAY");
  });

  test("resetting a second factor revokes that owner's durable challenges", { skip: durableSkip }, async () => {
    const { createOwnerStore } = await import("../server/admin/owner-store.js");
    const { createMfaChallengeStore } = await import("../server/admin/mfa-challenges.js");
    const store = createOwnerStore({ db, log: () => {} });
    const mine = await store.create({ username: "chal_a", passwordHash: await hashPassword("a-password-long-enough") });
    const theirs = await store.create({ username: "chal_b", passwordHash: await hashPassword("b-password-long-enough") });
    const challenges = createMfaChallengeStore({ db });
    const issued = await challenges.issue({ ownerId: mine.ownerId });
    const other = await challenges.issue({ ownerId: theirs.ownerId });
    const swept = await challenges.revokeAllForOwner({ ownerId: mine.ownerId });
    assert.equal(swept.ok, true);
    assert.equal(swept.revoked, 1);
    assert.equal((await challenges.lookup({ token: issued.token })).ok, false, "the reset owner's challenge is gone");
    assert.equal((await challenges.lookup({ token: other.token })).ok, true, "another owner is untouched");
  });

  test("an operator can drive a durable room this process never loaded", { skip: durableSkip }, async () => {
    const { createStore } = await import("../server/persist/store.js");
    const { createSessionStore } = await import("../server/persist/sessions.js");
    const { createGameController } = await import("../server/persist/controller.js");
    const { createRoomRegistry } = await import("../server/net/registry.js");

    const dstore = createStore({ db, log: () => {} });
    const dsessions = createSessionStore({ db, log: () => {} });
    const newProcess = () => {
      const registry = createRoomRegistry({
        io: null,
        config: { autoCall: false, callIntervalMs: 8000, disconnectGraceMs: 60000, chatIntervalMs: 0 },
        externalScheduler: true,
        keepHostSeat: true,
        log: () => {},
      });
      const controller = createGameController({ store: dstore, sessions: dsessions, registry, log: () => {} });
      controller.bindRegistry(registry);
      return { registry, controller };
    };

    const first = newProcess();
    const created = await first.controller.createRoom({ name: "Operator", socketId: "s-host" });
    assert.equal(created.ok, true, JSON.stringify(created));
    const roomId = created.roomId;
    const room = first.registry.get(roomId);
    await first.controller.joinRoom({ roomId, name: "Guest", socketId: "s-guest" });
    await first.controller.start({ room, socketId: "s-host" });
    await first.controller.callNext({ room, socketId: "s-host", source: "host" });
    const cursor = room.cursor;

    // a brand-new process: same database, nothing loaded into its registry
    const second = newProcess();
    assert.equal(second.registry.get(roomId), null, "the cold room is not in this process's memory");

    const loaded = await second.controller.ensureRoom({ roomId });
    assert.equal(loaded.ok, true, JSON.stringify(loaded));
    assert.equal(loaded.recovered, true, "the durable bundle was rebuilt, not invented");
    const rebuilt = second.registry.get(roomId);
    assert.equal(rebuilt.cursor, cursor, "the called-number position is honoured exactly");
    assert.equal(rebuilt.state, "RUNNING", "and so is the running state");
  });
});

// ============================== E. probes + graceful shutdown (in-memory)

describe("liveness, readiness and graceful shutdown over HTTP", () => {
  async function memoryInstance() {
    const store = createMemoryOwnerStore();
    const sessions = createMemoryOwnerSessions();
    const audit = createMemoryAdminAudit();
    await store.create({ username: OWNER.username, passwordHash: await hashPassword(OWNER.password) });
    const instance = await createApp({
      memoryOnly: true,
      origins: [],
      config: { autoCall: false, chatIntervalMs: 0, callIntervalMs: 60000 },
      limits: { burst: 2000, perSecond: 4000 },
      ownerStore: store,
      ownerSessions: sessions,
      audit,
      log: () => {},
    });
    const port = await instance.listen(0);
    return { instance, base: `http://127.0.0.1:${port}` };
  }

  test("/livez never touches the database and no probe leaks a secret", async () => {
    const { instance, base } = await memoryInstance();
    try {
      const live = await (await fetch(base + "/livez")).json();
      assert.equal(live.ok, true);
      assert.equal(live.live, true);
      assert.equal(live.draining, false);
      assert.equal(JSON.stringify(live).includes("DATABASE_URL"), false);

      const readyRes = await fetch(base + "/readyz");
      assert.equal(readyRes.status, 200, "a memory-mode dev process is ready for traffic");
      const ready = await readyRes.json();
      assert.equal(ready.durable, false);
      assert.equal(ready.ready, true);
      assert.match(ready.note, /nothing survives a restart/, "and it says so honestly");
      assert.equal(JSON.stringify(ready).includes("postgres"), false);
    } finally {
      await instance.closeServer();
    }
  });

  test("graceful shutdown flips the drain flag and takes readiness out of rotation", async () => {
    const { instance } = await memoryInstance();
    assert.equal(instance.draining, false, "a live process is not draining");
    await instance.closeServer();
    assert.equal(instance.draining, true, "closeServer sets the drain flag before it closes");
    // Readiness is asked only after the drain, so the probe cache never hides it.
    const ready = await instance.health.readiness();
    assert.equal(ready.ready, false, "a draining process is not ready for new traffic");
    assert.ok(ready.reasons.includes("draining"), "and it names the reason");
  });
});

// ================= F. backup + isolated restore integrity (Phase 6 §8/§10)

const SCRIPTS = fileURLToPath(new URL("../scripts", import.meta.url));
const toolsAvailable = hasDatabase && driverAvailable();
const restoreSkip = hasDatabase
  ? toolsAvailable
    ? false
    : "no pg_dump/pg_restore driver (set PG_BIN or PG_CONTAINER) - real restore cannot run"
  : "no DATABASE_URL - restore suite needs PostgreSQL";

describe("backup snapshot comparison (pure)", () => {
  test("parseConnection splits a URL and keeps the password off the surface it returns for display", () => {
    const c = parseConnection("postgres://admin:s3cr3t@db.example:6432/tambola");
    assert.equal(c.user, "admin");
    assert.equal(c.host, "db.example");
    assert.equal(c.port, 6432);
    assert.equal(c.database, "tambola");
    // the parsed object legitimately carries the password (it must, to auth),
    // but redact() is what callers print, and it never leaks it.
    assert.match(c.password, /s3cr3t/);
  });

  test("compareSnapshots reports a faithful restore as clean", () => {
    const snap = { schema: "public", ledger: [{ version: "001", name: "a", checksum: "x" }], tables: ["games", "rooms"], rows: { games: 3, rooms: 2 } };
    assert.deepEqual(compareSnapshots(snap, JSON.parse(JSON.stringify(snap))), []);
  });

  test("compareSnapshots catches every way a restore can lie", () => {
    const expected = { schema: "public", ledger: [{ version: "001", name: "a", checksum: "x" }], tables: ["games", "rooms", "tickets"], rows: { games: 3, rooms: 2, tickets: 9 } };
    const actual = { schema: "public", ledger: [{ version: "001", name: "a", checksum: "CHANGED" }], tables: ["games", "rooms"], rows: { games: 3, rooms: 5 } };
    const issues = compareSnapshots(expected, actual);
    assert.ok(issues.some((i) => /ledger differs/i.test(i)), "checksum drift is caught");
    assert.ok(issues.some((i) => /table missing after restore: tickets/i.test(i)), "a dropped table is caught (once, not double-counted)");
    assert.ok(issues.some((i) => /row count mismatch for "rooms"/i.test(i)), "a changed row count is caught");
    assert.equal(issues.some((i) => /row count mismatch for "tickets"/i.test(i)), false, "a missing table is not also reported as a count mismatch");
  });
});

describe("real isolated database restore (pg_dump + pg_restore)", () => {
  test("a backup restores faithfully into a throwaway database and passes integrity checks", { skip: restoreSkip, timeout: 180_000 }, () => {
    // A dedicated scratch backup dir so this run never reads a stale archive.
    const backupDir = path.join(SCRIPTS, "..", "backups", "selfcheck_" + randomBytes(4).toString("hex"));
    fs.mkdirSync(backupDir, { recursive: true });
    const env = { ...process.env, BACKUP_DIR: backupDir };
    const run = (script) =>
      spawnSync(process.execPath, ["--env-file-if-exists=.env", path.join(SCRIPTS, script)], { cwd: path.join(SCRIPTS, ".."), env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    try {
      const dump = run("backup.js");
      assert.equal(dump.status, 0, "backup.js exited 0\n" + dump.stdout + "\n" + dump.stderr);
      assert.match(dump.stdout, /\[backup\] wrote .*\.dump/, "it reports the archive it wrote");
      const dumps = fs.readdirSync(backupDir).filter((n) => n.endsWith(".dump"));
      assert.equal(dumps.length, 1, "exactly one archive landed in BACKUP_DIR");
      // The archive must be a real Postgres dump, not a text file: PGDMP magic.
      assert.equal(fs.readFileSync(path.join(backupDir, dumps[0])).subarray(0, 5).toString("latin1"), "PGDMP", "the archive is a genuine custom-format dump");
      // And it must carry a manifest that promises the durable contents.
      const manifest = JSON.parse(fs.readFileSync(path.join(backupDir, dumps[0].replace(/\.dump$/, ".manifest.json")), "utf8"));
      assert.ok(Array.isArray(manifest.migrationLedger) && manifest.migrationLedger.length >= 1, "the manifest records the migration ledger");
      assert.ok(manifest.tables.includes("games") && manifest.tables.includes("rooms"), "the manifest counts the game tables");

      const verify = run("restore-check.js");
      assert.equal(verify.status, 0, "restore-check.js exited 0\n" + verify.stdout + "\n" + verify.stderr);
      assert.match(verify.stdout, /RESTORE CHECK PASSED/, "the isolated restore verified");
      assert.match(verify.stdout, /created throwaway database/, "into a throwaway database");
      assert.match(verify.stdout, /dropped throwaway database/, "which was cleaned up afterwards");
      // No credential ever appears in either command's own output.
      const pw = (() => { try { return parseConnection(process.env.DATABASE_URL).password; } catch { return null; } })();
      if (pw) {
        assert.equal((dump.stdout + dump.stderr + verify.stdout + verify.stderr).includes(pw), false, "no password leaks into the command logs");
      }
    } finally {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }
  });
});
