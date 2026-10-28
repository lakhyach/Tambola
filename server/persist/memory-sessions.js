/**
 * Sessions without a database.
 *
 * The transport always resolves a browser's identity through a session token,
 * whether or not durability is switched on (see net/socket.js). That is
 * deliberate: one contract, one code path, so the in-memory mode described in
 * server/net/CONTRACT.md is the same protocol a real deployment speaks - it
 * simply cannot survive a restart.
 *
 * Same shape, same rules as persist/sessions.js: a random token the browser
 * keeps, opaque to everything else, scoped to one seat in one room, with an
 * idle and a hard deadline. The differences are honest and total:
 *
 *   - state lives in this process only. A restart loses every session, which is
 *     exactly why production uses the database store rather than this one.
 *   - nothing is hashed, because there is nothing durable to dump. The map is
 *     keyed by the token itself; no plaintext secret is ever written to disk or
 *     into a log.
 *
 * It is small on purpose. It is a compatibility shim for tests and for running
 * without Postgres, not a second session system to keep in step forever.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { SESSION_CODES } from "./sessions.js";

const TOKEN_BYTES = 24;
const DEFAULT_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;

function newToken() {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

export function createMemorySessions({
  log = () => {},
  now = () => Date.now(),
  idleMs = DEFAULT_IDLE_MS,
  absoluteMs = DEFAULT_ABSOLUTE_MS,
} = {}) {
  /** token -> session row */
  const byToken = new Map();
  const failing = (code, message) => ({ ok: false, code, error: message });

  function findRow({ roomId, playerId }) {
    for (const row of byToken.values()) {
      if (row.revokedAt || row.rotatedAt) continue;
      if (roomId && row.roomId !== roomId) continue;
      if (playerId && row.playerId !== playerId) continue;
      return row;
    }
    return null;
  }

  async function issue({ roomId, playerId, role = "player", revokePrior = true } = {}) {
    if (!roomId || !playerId) throw new Error("issue() needs a room and a player");
    if (role !== "host" && role !== "player") throw new Error("issue() got an unknown role");
    if (revokePrior) {
      const prior = findRow({ roomId, playerId });
      if (prior) revokeRow(prior, "re-issued");
    }
    const at = now();
    const sessionToken = newToken();
    const row = {
      sessionId: randomUUID(),
      roomId,
      playerId,
      role,
      issuedAt: at,
      lastUsedAt: null,
      expiresAt: at + idleMs,
      absoluteExpiresAt: at + absoluteMs,
      revokedAt: null,
      revokeReason: null,
      rotatedAt: null,
    };
    byToken.set(sessionToken, row);
    return { ok: true, sessionToken, sessionId: row.sessionId, role, roomId, playerId, issuedAt: at };
  }

  async function verify({ sessionToken, roomId } = {}) {
    const row = typeof sessionToken === "string" ? byToken.get(sessionToken) : null;
    if (!row) return failing(SESSION_CODES.UNKNOWN, "this session is not known");
    if (row.revokedAt) return failing(SESSION_CODES.REVOKED, "this session was revoked");
    if (row.rotatedAt) return failing(SESSION_CODES.ROTATED, "this session was rotated");
    const at = now();
    if (row.absoluteExpiresAt <= at) {
      revokeRow(row, "expired");
      return failing(SESSION_CODES.EXPIRED, "this session has expired");
    }
    if (row.expiresAt <= at) {
      revokeRow(row, "idle-expired");
      return failing(SESSION_CODES.EXPIRED, "this session has expired");
    }
    if (roomId && row.roomId !== roomId) {
      return failing(SESSION_CODES.INVALID, "this session belongs to a different room");
    }
    row.lastUsedAt = at;
    row.expiresAt = at + idleMs;
    return {
      ok: true,
      sessionId: row.sessionId,
      roomId: row.roomId,
      playerId: row.playerId,
      role: row.role,
      expiresAt: new Date(row.expiresAt).toISOString(),
    };
  }

  function revokeRow(row, reason) {
    row.revokedAt = now();
    row.revokeReason = reason;
  }

  async function revoke({ sessionId = null, roomId = null, playerId = null, reason = "revoked" } = {}) {
    if (!sessionId && !roomId) throw new Error("revoke() needs a session or a room");
    let count = 0;
    for (const [token, row] of [...byToken.entries()]) {
      if (row.revokedAt || row.rotatedAt) continue;
      if (sessionId && row.sessionId !== sessionId) continue;
      if (roomId && row.roomId !== roomId) continue;
      if (playerId && row.playerId !== playerId) continue;
      revokeRow(row, reason);
      byToken.delete(token);
      count += 1;
    }
    if (count) log("sessions revoked", count, reason);
    return { ok: true, revoked: count };
  }

  async function rotate({ sessionToken, reason = "rotated" } = {}) {
    const verified = await verify({ sessionToken });
    if (!verified.ok) return verified;
    const row = byToken.get(sessionToken);
    const fresh = await issue({
      roomId: row.roomId,
      playerId: row.playerId,
      role: row.role,
      revokePrior: false,
    });
    row.rotatedAt = now();
    row.rotatedTo = fresh.sessionId;
    revokeRow(row, reason);
    byToken.delete(sessionToken);
    return fresh;
  }

  async function purgeExpired() {
    let purged = 0;
    for (const [token, row] of [...byToken.entries()]) {
      if (row.revokedAt || row.rotatedAt) {
        byToken.delete(token);
        continue;
      }
      if (row.expiresAt <= now() || row.absoluteExpiresAt <= now()) {
        revokeRow(row, "expired");
        byToken.delete(token);
        purged += 1;
      }
    }
    return { ok: true, purged };
  }

  async function activeCount({ roomId } = {}) {
    let active = 0;
    for (const row of byToken.values()) {
      if (row.revokedAt || row.rotatedAt) continue;
      if (roomId && row.roomId !== roomId) continue;
      active += 1;
    }
    return active;
  }

  return { issue, verify, revoke, rotate, purgeExpired, activeCount, memoryOnly: true };
}
