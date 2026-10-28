/**
 * Authentication abuse control.
 *
 * Two implementations behind one interface:
 *
 *   createDurableRateLimiter({ db, policy })   PostgreSQL, shared and restart-proof
 *   createLoginRateLimiter({ ...policy })      process memory, the no-database fallback
 *
 * The durable one is what a real deployment uses. Counters live in
 * `auth_throttle` (migration 003), keyed by (scope, sha256(key)), incremented
 * inside a row lock with SELECT ... FOR UPDATE, so two concurrent guesses cannot
 * both read "7 of 8". Because the row is in the database, restarting the process
 * - or pointing a second process at the same database - does not reset it. That
 * is the whole point: the previous in-memory map forgot every lockout on boot.
 *
 * Policy (defaults, overridable per limiter):
 *   window 15 min, 8 failures per username+IP -> 5 min lock, doubling per repeat
 *   offence up to 60 min. A separate bare-IP budget (25 failures -> 15 min) makes
 *   spraying many usernames from one address expensive, which is what stops the
 *   "one name per attempt" bypass of the first rule.
 *
 * Denial-of-service posture: the lockout is per key, never global, and it
 * expires on its own. A successful sign-in clears that key, so a legitimate
 * owner who mistyped a few times is not punished after succeeding. There is no
 * permanent ban and no unbounded strike growth (capped at maxLockoutMs).
 *
 * Nothing here logs a username, a password or an IP: the key is hashed before it
 * is stored, and the audit row the route writes carries the hashed IP only.
 */

import { createHash } from "node:crypto";

export const THROTTLE_POLICIES = Object.freeze({
  /** username + client address: the primary credential-stuffing budget */
  signin: Object.freeze({ scope: "signin", windowMs: 15 * 60 * 1000, maxFailures: 8, baseLockoutMs: 5 * 60 * 1000, maxLockoutMs: 60 * 60 * 1000 }),
  /** bare client address: stops one source cycling usernames */
  signinIp: Object.freeze({ scope: "signin-ip", windowMs: 15 * 60 * 1000, maxFailures: 25, baseLockoutMs: 15 * 60 * 1000, maxLockoutMs: 60 * 60 * 1000 }),
  /** second-factor attempts, per owner + address */
  mfa: Object.freeze({ scope: "mfa", windowMs: 15 * 60 * 1000, maxFailures: 10, baseLockoutMs: 5 * 60 * 1000, maxLockoutMs: 60 * 60 * 1000 }),
  /** authenticated administrative mutations, per session */
  adminMutation: Object.freeze({ scope: "admin-mutation", windowMs: 60 * 1000, maxFailures: 60, baseLockoutMs: 60 * 1000, maxLockoutMs: 5 * 60 * 1000 }),
  /** password rotation and MFA changes, per session: these should be rare */
  credentialChange: Object.freeze({ scope: "credential-change", windowMs: 15 * 60 * 1000, maxFailures: 5, baseLockoutMs: 15 * 60 * 1000, maxLockoutMs: 60 * 60 * 1000 }),
});

export function hashKey(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, 32);
}

// ------------------------------------------------------------ durable backend

export function createDurableRateLimiter({ db, policy = THROTTLE_POLICIES.signin } = {}) {
  if (!db) throw new Error("createDurableRateLimiter needs a database handle");
  const config = { ...THROTTLE_POLICIES.signin, ...policy };
  const scope = config.scope;

  /** Cheap pre-check. Never mutates, so a refused attempt is not counted twice. */
  async function check({ key } = {}) {
    const result = await db.query(
      `SELECT locked_until, now() AS at FROM auth_throttle WHERE scope = $1 AND key_hash = $2`,
      [scope, hashKey(key)]
    );
    const row = result.rows[0];
    if (!row || !row.locked_until) return { allowed: true };
    const remaining = Date.parse(row.locked_until) - Date.parse(row.at);
    if (remaining > 0) return { allowed: false, retryAfterMs: remaining };
    return { allowed: true };
  }

  /**
   * Count one failure and, if the budget is spent, set the lock.
   * The read and the write happen inside one transaction holding the row lock.
   */
  async function recordFailure({ key } = {}) {
    const keyHash = hashKey(key);
    return db.withTransaction(async (client) => {
      const found = await client.query(
        `SELECT failures, strikes, window_started_at, locked_until, now() AS at
           FROM auth_throttle WHERE scope = $1 AND key_hash = $2 FOR UPDATE`,
        [scope, keyHash]
      );
      const row = found.rows[0];
      const at = row ? Date.parse(row.at) : Date.now();

      if (row && row.locked_until && Date.parse(row.locked_until) > at) {
        // already locked: report the same window, do not extend it (a caller
        // retrying in a loop must not be able to lengthen its own lockout)
        return { locked: true, retryAfterMs: Date.parse(row.locked_until) - at, remaining: 0, counted: false };
      }

      let failures = 1;
      let strikes = row ? row.strikes : 0;
      let windowStartedAt = row ? Date.parse(row.window_started_at) : at;

      if (row && at - windowStartedAt <= config.windowMs) failures = row.failures + 1;

      let lockedUntil = null;
      if (failures >= config.maxFailures) {
        strikes += 1;
        const lockMs = Math.min(config.baseLockoutMs * strikes, config.maxLockoutMs);
        lockedUntil = new Date(at + lockMs);
        // a fresh window starts with the lock, so the next offence escalates
        failures = 0;
        windowStartedAt = at;
      }

      await client.query(
        `INSERT INTO auth_throttle AS t
           (scope, key_hash, failures, strikes, window_started_at, locked_until, last_failure_at)
         VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0), $6, to_timestamp($5 / 1000.0))
         ON CONFLICT (scope, key_hash) DO UPDATE
            SET failures = EXCLUDED.failures,
                strikes = EXCLUDED.strikes,
                window_started_at = EXCLUDED.window_started_at,
                locked_until = EXCLUDED.locked_until,
                last_failure_at = EXCLUDED.last_failure_at`,
        [scope, keyHash, failures, strikes, Math.round(windowStartedAt), lockedUntil]
      );

      return lockedUntil
        ? { locked: true, retryAfterMs: lockedUntil.getTime() - at, remaining: 0, counted: true }
        : { locked: false, remaining: config.maxFailures - failures, counted: true };
    });
  }

  /** A legitimate success clears this key entirely. */
  async function recordSuccess({ key } = {}) {
    await db.query("DELETE FROM auth_throttle WHERE scope = $1 AND key_hash = $2", [scope, hashKey(key)]);
    return { ok: true };
  }

  async function status({ key } = {}) {
    const result = await db.query(
      `SELECT failures, strikes, locked_until, window_started_at, now() AS at
         FROM auth_throttle WHERE scope = $1 AND key_hash = $2`,
      [scope, hashKey(key)]
    );
    const row = result.rows[0];
    if (!row) return { failures: 0, strikes: 0, lockedUntil: null };
    return { failures: row.failures, strikes: row.strikes, lockedUntil: row.locked_until };
  }

  /** Drop counters that have been quiet for a day. Called by the maintenance timer. */
  async function prune() {
    const result = await db.query(
      `DELETE FROM auth_throttle
        WHERE window_started_at < now() - interval '1 day'
          AND (locked_until IS NULL OR locked_until < now())`
    );
    return { ok: true, purged: result.rowCount || 0 };
  }

  return { backend: "database", scope, config, check, recordFailure, recordSuccess, status, prune };
}

// ------------------------------------------------------- in-memory fallback

/**
 * The original process-local throttle, kept for memory-mode runs and for the
 * unit tests. Its documented limitation is real and is why the durable limiter
 * exists: restarting the process forgets every lockout.
 */
export function createLoginRateLimiter({ now = () => Date.now(), ...opts } = {}) {
  const config = { ...THROTTLE_POLICIES.signin, ...opts };
  const attempts = new Map(); // key -> { count, first, lockedUntil, strikes }

  function prune(at) {
    for (const [key, entry] of attempts) {
      const expiredWindow = at - entry.first > config.windowMs && !entry.lockedUntil;
      const released = entry.lockedUntil && entry.lockedUntil <= at;
      if (expiredWindow || released) attempts.delete(key);
    }
  }

  function entryFor(key, at) {
    let entry = attempts.get(key);
    if (!entry) {
      entry = { count: 0, first: at, lockedUntil: null, strikes: 0 };
      attempts.set(key, entry);
    }
    if (!entry.lockedUntil && at - entry.first > config.windowMs) {
      entry.count = 0;
      entry.first = at;
      entry.strikes = 0;
    }
    return entry;
  }

  function check({ key } = {}) {
    const at = now();
    prune(at);
    const entry = attempts.get(hashKey(key));
    if (entry && entry.lockedUntil && entry.lockedUntil > at) {
      return { allowed: false, retryAfterMs: entry.lockedUntil - at };
    }
    return { allowed: true };
  }

  function recordFailure({ key } = {}) {
    const at = now();
    const hashed = hashKey(key);
    const entry = entryFor(hashed, at);
    entry.count += 1;
    if (entry.count >= config.maxFailures) {
      entry.strikes += 1;
      const lock = Math.min(config.baseLockoutMs * entry.strikes, config.maxLockoutMs);
      entry.lockedUntil = at + lock;
      entry.count = 0;
      entry.first = at;
      return { locked: true, retryAfterMs: lock, counted: true };
    }
    return { locked: false, remaining: config.maxFailures - entry.count, counted: true };
  }

  function recordSuccess({ key } = {}) {
    attempts.delete(hashKey(key));
    return { ok: true };
  }

  function status({ key } = {}) {
    const at = now();
    const entry = attempts.get(hashKey(key));
    if (!entry) return { failures: 0, lockedUntil: null };
    return { failures: entry.count, strikes: entry.strikes, lockedUntil: entry.lockedUntil };
  }

  function pruneAll() {
    const at = now();
    prune(at);
    return { ok: true, purged: 0 };
  }

  return { backend: "memory", scope: config.scope, config, check, recordFailure, recordSuccess, status, prune: pruneAll };
}

/**
 * Build the fixed set of limiters the admin routes use. Durable when a database
 * is available, memory otherwise - the caller never has to branch.
 */
export function createThrottleSet({ db = null, log = () => {} } = {}) {
  const build = (policy) =>
    db ? createDurableRateLimiter({ db, policy }) : createLoginRateLimiter({ ...policy });
  const set = {
    backend: db ? "database" : "memory",
    signin: build(THROTTLE_POLICIES.signin),
    signinIp: build(THROTTLE_POLICIES.signinIp),
    mfa: build(THROTTLE_POLICIES.mfa),
    adminMutation: build(THROTTLE_POLICIES.adminMutation),
    credentialChange: build(THROTTLE_POLICIES.credentialChange),
    async prune() {
      if (!db) return { ok: true, purged: 0 };
      const results = [];
      for (const limiter of [set.signin, set.signinIp, set.mfa, set.adminMutation, set.credentialChange]) {
        if (limiter.scope === "signin-ip") continue; // same table, one sweep is enough
        results.push(await limiter.prune().catch((error) => {
          log("throttle prune failed", error && error.message);
          return { ok: false };
        }));
      }
      return { ok: true, results };
    },
  };
  return set;
}
