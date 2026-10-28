/**
 * Owner sessions: the credential behind an authenticated admin browser.
 *
 * The same security posture as the game session store, applied to a different
 * table and a different identity. A login always mints a brand-new session id
 * and a brand-new token (never promoted from a pre-login value), which is the
 * session-fixation defence; logging out revokes the row so the token stops
 * working; a database dump holds only SHA-256(token), which cannot be replayed.
 *
 * Two backends, one interface:
 *   createOwnerSessionStore({ db })  - durable owner_sessions rows
 *   createMemoryOwnerSessions()      - process-local, tests and no-DB runs
 *
 * Idle and hard deadlines mirror the game sessions: sliding expires_at on each
 * successful use, an absolute_expires_at set at issue time that never moves.
 * Nothing here is ever logged - tokens, hashes and session ids stay private.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";

const TOKEN_BYTES = 32;
const DEFAULT_IDLE_MS = 12 * 60 * 60 * 1000; // 12 hours of inactivity
const DEFAULT_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000; // one week hard ceiling

export const OWNER_SESSION_CODES = Object.freeze({
  UNKNOWN: "OWNER_SESSION_UNKNOWN",
  INVALID: "OWNER_SESSION_INVALID",
  EXPIRED: "OWNER_SESSION_EXPIRED",
  REVOKED: "OWNER_SESSION_REVOKED",
});

export function hashOwnerToken(token) {
  if (typeof token !== "string" || !/^[0-9a-f]{16,128}$/.test(token)) return null;
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function newToken() {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

export function createOwnerSessionStore({ db, log = () => {}, idleMs = DEFAULT_IDLE_MS, absoluteMs = DEFAULT_ABSOLUTE_MS } = {}) {
  if (!db) throw new Error("createOwnerSessionStore needs a database handle");
  const now = () => Date.now();
  const failing = (code, message) => ({ ok: false, code, error: message });

  async function issue({ ownerId, ipHash = null } = {}) {
    if (!ownerId) throw new Error("issue() needs an owner");
    if (absoluteMs < idleMs) throw new Error("session idle window must not exceed the hard window");
    const token = newToken();
    const hash = hashOwnerToken(token);
    const sessionId = randomUUID();
    await db.query(
      `INSERT INTO owner_sessions
         (session_id, token_hash, owner_id, expires_at, absolute_expires_at, ip_hash)
       VALUES ($1, $2, $3, now() + ($4 * interval '1 millisecond'), now() + ($5 * interval '1 millisecond'), $6)`,
      [sessionId, hash, ownerId, Math.round(idleMs), Math.round(absoluteMs), ipHash]
    );
    return { ok: true, token, sessionId, ownerId, issuedAt: now() };
  }

  async function verify({ token } = {}) {
    const hash = hashOwnerToken(token);
    if (!hash) return failing(OWNER_SESSION_CODES.INVALID, "not an owner session credential");
    const found = await db.query(
      `SELECT session_id, owner_id, expires_at, absolute_expires_at, revoked_at
         FROM owner_sessions WHERE token_hash = $1`,
      [hash]
    );
    const row = found.rows[0];
    if (!row) return failing(OWNER_SESSION_CODES.UNKNOWN, "this session is not known");
    if (row.revoked_at) return failing(OWNER_SESSION_CODES.REVOKED, "this session was revoked");
    if (Date.parse(row.absolute_expires_at) <= now()) {
      await revoke({ sessionId: row.session_id, reason: "expired" });
      return failing(OWNER_SESSION_CODES.EXPIRED, "this session has expired");
    }
    if (Date.parse(row.expires_at) <= now()) {
      await revoke({ sessionId: row.session_id, reason: "idle-expired" });
      return failing(OWNER_SESSION_CODES.EXPIRED, "this session has expired");
    }
    await db.query(
      `UPDATE owner_sessions SET last_used_at = now(), expires_at = now() + ($2 * interval '1 millisecond')
        WHERE session_id = $1 AND revoked_at IS NULL`,
      [row.session_id, Math.round(idleMs)]
    );
    return { ok: true, sessionId: row.session_id, ownerId: row.owner_id };
  }

  async function revoke({ sessionId } = {}) {
    if (!sessionId) throw new Error("revoke() needs a session id");
    await db.query("UPDATE owner_sessions SET revoked_at = now(), revoke_reason = $2 WHERE session_id = $1 AND revoked_at IS NULL", [
      sessionId,
      "logout",
    ]);
    return { ok: true };
  }

  /** Credential rotation and admin-disable both need to kill every live session. */
  async function revokeAllForOwner({ ownerId, reason = "revoked" } = {}) {
    const result = await db.query(
      `UPDATE owner_sessions SET revoked_at = now(), revoke_reason = $2
        WHERE owner_id = $1 AND revoked_at IS NULL
        RETURNING session_id`,
      [ownerId, reason]
    );
    if (result.rows.length) log("owner sessions revoked", result.rows.length, reason);
    return { ok: true, revoked: result.rows.length };
  }

  async function purgeExpired() {
    const result = await db.query(
      `UPDATE owner_sessions SET revoked_at = now(), revoke_reason = COALESCE(revoke_reason, 'expired')
        WHERE revoked_at IS NULL AND (expires_at < now() OR absolute_expires_at < now())
        RETURNING session_id`
    );
    return { ok: true, purged: result.rows.length };
  }

  async function activeCount({ ownerId } = {}) {
    const result = await db.query(
      `SELECT count(*)::int AS n FROM owner_sessions
        WHERE revoked_at IS NULL AND ($1::text IS NULL OR owner_id = $1) AND expires_at > now() AND absolute_expires_at > now()`,
      [ownerId || null]
    );
    return result.rows[0].n;
  }

  return { backend: "database", issue, verify, revoke, revokeAllForOwner, purgeExpired, activeCount, hashOwnerToken };
}

export function createMemoryOwnerSessions({ log = () => {}, now = () => Date.now(), idleMs = DEFAULT_IDLE_MS, absoluteMs = DEFAULT_ABSOLUTE_MS } = {}) {
  const byTokenHash = new Map();
  const failing = (code, message) => ({ ok: false, code, error: message });

  async function issue({ ownerId, ipHash = null } = {}) {
    if (!ownerId) throw new Error("issue() needs an owner");
    const token = newToken();
    const hash = hashOwnerToken(token);
    const sessionId = randomUUID();
    const at = now();
    byTokenHash.set(hash, {
      sessionId,
      ownerId,
      issuedAt: at,
      lastUsedAt: null,
      expiresAt: at + idleMs,
      absoluteExpiresAt: at + absoluteMs,
      revokedAt: null,
      revokeReason: null,
      ipHash,
    });
    return { ok: true, token, sessionId, ownerId, issuedAt: at };
  }

  async function verify({ token } = {}) {
    const hash = hashOwnerToken(token);
    if (!hash) return failing(OWNER_SESSION_CODES.INVALID, "not an owner session credential");
    const row = byTokenHash.get(hash);
    if (!row) return failing(OWNER_SESSION_CODES.UNKNOWN, "this session is not known");
    if (row.revokedAt) return failing(OWNER_SESSION_CODES.REVOKED, "this session was revoked");
    const at = now();
    if (row.absoluteExpiresAt <= at) {
      row.revokedAt = at;
      row.revokeReason = "expired";
      return failing(OWNER_SESSION_CODES.EXPIRED, "this session has expired");
    }
    if (row.expiresAt <= at) {
      row.revokedAt = at;
      row.revokeReason = "idle-expired";
      return failing(OWNER_SESSION_CODES.EXPIRED, "this session has expired");
    }
    row.lastUsedAt = at;
    row.expiresAt = at + idleMs;
    return { ok: true, sessionId: row.sessionId, ownerId: row.ownerId };
  }

  async function revoke({ sessionId } = {}) {
    if (!sessionId) throw new Error("revoke() needs a session id");
    for (const row of byTokenHash.values()) {
      if (row.sessionId === sessionId && !row.revokedAt) {
        row.revokedAt = now();
        row.revokeReason = "logout";
      }
    }
    return { ok: true };
  }

  async function revokeAllForOwner({ ownerId, reason = "revoked" } = {}) {
    let revoked = 0;
    const at = now();
    for (const row of byTokenHash.values()) {
      if (row.ownerId === ownerId && !row.revokedAt) {
        row.revokedAt = at;
        row.revokeReason = reason;
        revoked += 1;
      }
    }
    if (revoked) log("owner sessions revoked", revoked, reason);
    return { ok: true, revoked };
  }

  async function purgeExpired() {
    const at = now();
    let purged = 0;
    for (const [hash, row] of [...byTokenHash.entries()]) {
      if (row.revokedAt || row.expiresAt <= at || row.absoluteExpiresAt <= at) {
        byTokenHash.delete(hash);
        purged += 1;
      }
    }
    return { ok: true, purged };
  }

  async function activeCount({ ownerId } = {}) {
    const at = now();
    let n = 0;
    for (const row of byTokenHash.values()) {
      if (row.revokedAt || row.expiresAt <= at || row.absoluteExpiresAt <= at) continue;
      if (ownerId && row.ownerId !== ownerId) continue;
      n += 1;
    }
    return n;
  }

  return { backend: "memory", issue, verify, revoke, revokeAllForOwner, purgeExpired, activeCount, hashOwnerToken };
}
