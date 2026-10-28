/**
 * Pre-authentication challenges for the second sign-in step.
 *
 * When MFA is enrolled, a correct password does NOT receive a session. It
 * receives a challenge token: a random 32-byte value whose SHA-256 is the only
 * thing stored here. The challenge is bound to one owner, expires in five
 * minutes, allows a small number of wrong codes, and is consumed exactly once -
 * either by a successful TOTP check or by exhausting its attempts.
 *
 * This is the same shape as owner_sessions on purpose (random token in the
 * browser, hash in the database), with a much shorter life and no authority of
 * its own: nothing but /signin/mfa accepts it, so it cannot be replayed against
 * any other route.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";

export const CHALLENGE_CODES = Object.freeze({
  INVALID: "MFA_CHALLENGE_INVALID",
  EXPIRED: "MFA_CHALLENGE_EXPIRED",
  CONSUMED: "MFA_CHALLENGE_CONSUMED",
  LOCKED: "MFA_CHALLENGE_LOCKED",
});

const TOKEN_BYTES = 32;
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 5;

export function hashChallengeToken(token) {
  if (typeof token !== "string" || !/^[0-9a-f]{16,128}$/.test(token)) return null;
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createMfaChallengeStore({
  db,
  ttlMs = DEFAULT_TTL_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  now = () => Date.now(),
} = {}) {
  if (!db) throw new Error("createMfaChallengeStore needs a database handle");

  async function issue({ ownerId, ipHash = null } = {}) {
    if (!ownerId) throw new Error("issue() needs an owner");
    const token = randomBytes(TOKEN_BYTES).toString("hex");
    const challengeId = randomUUID();
    const result = await db.query(
      `INSERT INTO owner_mfa_challenges (challenge_id, token_hash, owner_id, expires_at, ip_hash)
       VALUES ($1, $2, $3, now() + ($4 * interval '1 millisecond'), $5)
       RETURNING expires_at`,
      [challengeId, hashChallengeToken(token), ownerId, Math.round(ttlMs), ipHash]
    );
    return { ok: true, token, challengeId, ownerId, expiresAt: result.rows[0].expires_at };
  }

  async function lookup({ token } = {}) {
    const hash = hashChallengeToken(token);
    if (!hash) return { ok: false, code: CHALLENGE_CODES.INVALID };
    const found = await db.query(
      `SELECT challenge_id, owner_id, expires_at, consumed_at, attempts
         FROM owner_mfa_challenges WHERE token_hash = $1`,
      [hash]
    );
    const row = found.rows[0];
    if (!row) return { ok: false, code: CHALLENGE_CODES.INVALID };
    if (row.consumed_at) return { ok: false, code: CHALLENGE_CODES.CONSUMED };
    if (Date.parse(row.expires_at) <= now()) return { ok: false, code: CHALLENGE_CODES.EXPIRED };
    if (row.attempts >= maxAttempts) return { ok: false, code: CHALLENGE_CODES.LOCKED };
    return { ok: true, challengeId: row.challenge_id, ownerId: row.owner_id, attempts: row.attempts, expiresAt: row.expires_at };
  }

  /**
   * Count a wrong code inside the same statement that reads it, so two
   * concurrent guesses cannot both see "attempts = 4".
   */
  async function fail({ challengeId } = {}) {
    if (!challengeId) throw new Error("fail() needs a challenge id");
    const result = await db.query(
      `UPDATE owner_mfa_challenges
          SET attempts = attempts + 1
        WHERE challenge_id = $1 AND consumed_at IS NULL
        RETURNING attempts`,
      [challengeId]
    );
    const attempts = result.rows[0] ? result.rows[0].attempts : maxAttempts;
    return { ok: true, attempts, attemptsLeft: Math.max(0, maxAttempts - attempts), locked: attempts >= maxAttempts };
  }

  async function complete({ challengeId } = {}) {
    if (!challengeId) throw new Error("complete() needs a challenge id");
    const result = await db.query(
      `UPDATE owner_mfa_challenges SET consumed_at = now()
        WHERE challenge_id = $1 AND consumed_at IS NULL
        RETURNING challenge_id`,
      [challengeId]
    );
    // zero rows means another request consumed it first: the caller must not
    // treat that as success
    return { ok: result.rows.length === 1 };
  }

  /**
   * Destroy every outstanding challenge for one owner. Used by the recovery CLI:
   * when a second factor is reset or removed, a challenge issued before that
   * moment must stop being tradeable, or a password-only step could still walk up
   * to the door of a factor that no longer exists. Hard delete, not consume -
   * there is nothing left worth auditing about the token.
   */
  async function revokeAllForOwner({ ownerId } = {}) {
    if (!ownerId) throw new Error("revokeAllForOwner() needs an owner");
    const result = await db.query(
      "DELETE FROM owner_mfa_challenges WHERE owner_id = $1 AND consumed_at IS NULL",
      [ownerId]
    );
    return { ok: true, revoked: result.rowCount || 0 };
  }

  async function prune() {
    const result = await db.query(
      `DELETE FROM owner_mfa_challenges
        WHERE expires_at < now() - interval '1 day' OR consumed_at < now() - interval '1 day'`
    );
    return { ok: true, purged: result.rowCount || 0 };
  }

  return { backend: "database", issue, lookup, fail, complete, revokeAllForOwner, prune, maxAttempts, ttlMs };
}

export function createMemoryMfaChallengeStore({ ttlMs = DEFAULT_TTL_MS, maxAttempts = DEFAULT_MAX_ATTEMPTS, now = () => Date.now() } = {}) {
  const byHash = new Map();

  async function issue({ ownerId, ipHash = null } = {}) {
    if (!ownerId) throw new Error("issue() needs an owner");
    const token = randomBytes(TOKEN_BYTES).toString("hex");
    const hash = hashChallengeToken(token);
    const entry = {
      challengeId: randomUUID(),
      ownerId,
      expiresAt: now() + ttlMs,
      consumedAt: null,
      attempts: 0,
      ipHash,
    };
    byHash.set(hash, entry);
    return { ok: true, token, challengeId: entry.challengeId, ownerId, expiresAt: new Date(entry.expiresAt) };
  }

  async function lookup({ token } = {}) {
    const hash = hashChallengeToken(token);
    if (!hash) return { ok: false, code: CHALLENGE_CODES.INVALID };
    const row = byHash.get(hash);
    if (!row) return { ok: false, code: CHALLENGE_CODES.INVALID };
    if (row.consumedAt) return { ok: false, code: CHALLENGE_CODES.CONSUMED };
    if (row.expiresAt <= now()) return { ok: false, code: CHALLENGE_CODES.EXPIRED };
    if (row.attempts >= maxAttempts) return { ok: false, code: CHALLENGE_CODES.LOCKED };
    return { ok: true, challengeId: row.challengeId, ownerId: row.ownerId, attempts: row.attempts, expiresAt: new Date(row.expiresAt) };
  }

  async function fail({ challengeId } = {}) {
    for (const row of byHash.values()) {
      if (row.challengeId !== challengeId || row.consumedAt) continue;
      row.attempts += 1;
      return { ok: true, attempts: row.attempts, attemptsLeft: Math.max(0, maxAttempts - row.attempts), locked: row.attempts >= maxAttempts };
    }
    return { ok: true, attempts: maxAttempts, attemptsLeft: 0, locked: true };
  }

  async function complete({ challengeId } = {}) {
    for (const row of byHash.values()) {
      if (row.challengeId === challengeId && !row.consumedAt) {
        row.consumedAt = now();
        return { ok: true };
      }
    }
    return { ok: false };
  }

  async function revokeAllForOwner({ ownerId } = {}) {
    if (!ownerId) throw new Error("revokeAllForOwner() needs an owner");
    let revoked = 0;
    for (const [hash, row] of [...byHash.entries()]) {
      if (row.ownerId === ownerId && !row.consumedAt) {
        byHash.delete(hash);
        revoked += 1;
      }
    }
    return { ok: true, revoked };
  }

  async function prune() {
    let purged = 0;
    for (const [hash, row] of [...byHash.entries()]) {
      if (row.expiresAt <= now() || row.consumedAt) {
        byHash.delete(hash);
        purged += 1;
      }
    }
    return { ok: true, purged };
  }

  return { backend: "memory", issue, lookup, fail, complete, revokeAllForOwner, prune, maxAttempts, ttlMs };
}
