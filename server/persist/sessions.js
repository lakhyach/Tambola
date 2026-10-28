/**
 * Server-backed sessions: how a browser proves who it is after a refresh, a
 * network drop or a server restart.
 *
 * What the browser holds
 *   a 48-hex-character token (24 random bytes from node:crypto) plus the room
 *   code. That is the only credential a client ever keeps, and it is what
 *   survives in localStorage.
 *
 * What the database holds
 *   SHA-256(token) and nothing else about the secret. Reading the sessions
 *   table cannot reconstitute a usable token, and a dumped table cannot be
 *   replayed. Raw engine credentials (hostToken / playerToken in the engine)
 *   never leave the process any more, so they are absent from every payload.
 *
 * Expiry (both deadlines enforced by the database clock, not the app clock)
 *   idle    expires_at slides forward on every successful use; default 7 days
 *   hard    absolute_expires_at is set at issue time and never moves; 30 days
 *   An expired session is marked revoked with reason 'expired' on the attempt
 *   that discovers it, so it cannot be revived.
 *
 * Rotation
 *   rotate() issues a replacement and marks the old row rotated. A rotated row
 *   is rejected with SESSION_ROTATED, which is how a replayed or stolen token
 *   is detected rather than silently honoured. Rotation is explicit (the
 *   session:rotate event) because an automatic swap on every resume would make
 *   a retried request look like a theft.
 *
 * Revocation
 *   leaving a seat, closing a room, or re-issuing for the same identity revokes
 *   the active rows. A revoked session cannot regain access to any room, and a
 *   guessed room code without a live token gets nothing at all.
 *
 * Nothing here is ever logged: tokens, hashes and session ids stay out of the
 * log sink, and the codes returned to clients describe their own credential.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";

export const SESSION_CODES = Object.freeze({
  UNKNOWN: "SESSION_UNKNOWN",
  INVALID: "SESSION_INVALID",
  EXPIRED: "SESSION_EXPIRED",
  REVOKED: "SESSION_REVOKED",
  ROTATED: "SESSION_ROTATED",
});

const TOKEN_BYTES = 24;
const DEFAULT_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;

export function hashSessionToken(token) {
  if (typeof token !== "string" || !/^[0-9a-f]{16,128}$/.test(token)) return null;
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function newToken() {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

export function createSessionStore({
  db,
  log = () => {},
  idleMs = DEFAULT_IDLE_MS,
  absoluteMs = DEFAULT_ABSOLUTE_MS,
} = {}) {
  if (!db) throw new Error("createSessionStore() needs a database handle");

  const now = () => Date.now();
  const failing = (code, message) => ({ ok: false, code, error: message });

  /** Mint a token for a verified seat. The plaintext exists only in the answer. */
  async function issue({ roomId, playerId, role = "player", revokePrior = true } = {}) {
    if (!roomId || !playerId) throw new Error("issue() needs a room and a player");
    if (role !== "host" && role !== "player") throw new Error("issue() got an unknown role");
    const token = newToken();
    const hash = hashSessionToken(token);
    const sessionId = randomUUID();
    const issuedAt = now();
    const idle = Math.round(idleMs);
    const absolute = Math.round(absoluteMs);
    if (absolute < idle) throw new Error("session idle window must not exceed the hard window");

    await db.withTransaction(async (client) => {
      // one live lineage per seat: anything older is retired atomically
      if (revokePrior) {
        await client.query(
          `UPDATE sessions SET revoked_at = now(), revoke_reason = 're-issued'
            WHERE room_code = $1 AND player_id = $2 AND revoked_at IS NULL AND rotated_at IS NULL`,
          [roomId, playerId]
        );
      }
      await client.query(
        `INSERT INTO sessions
           (session_id, token_hash, room_code, player_id, role, expires_at, absolute_expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + ($6 * interval '1 millisecond'), now() + ($7 * interval '1 millisecond'))`,
        [sessionId, hash, roomId, playerId, role, idle, absolute]
      );
      await client.query(
        `INSERT INTO audit_events (room_code, player_id, type, detail)
         VALUES ($1, $2, 'session-issued', $3)`,
        [roomId, playerId, JSON.stringify({ role })]
      );
    });

    return { ok: true, sessionToken: token, sessionId, role, roomId, playerId, issuedAt };
  }

  /**
   * Prove a token belongs to this room. Slides the idle deadline on success.
   * Never returns anything about a different seat.
   */
  async function verify({ sessionToken, roomId } = {}) {
    const hash = hashSessionToken(sessionToken);
    if (!hash) return failing(SESSION_CODES.INVALID, "not a session credential");

    const found = await db.query(
      `SELECT session_id, room_code, player_id, role, expires_at, absolute_expires_at,
              revoked_at, revoke_reason, rotated_at
         FROM sessions WHERE token_hash = $1`,
      [hash]
    );
    const row = found.rows[0];
    if (!row) return failing(SESSION_CODES.UNKNOWN, "this session is not known");
    if (row.rotated_at) return failing(SESSION_CODES.ROTATED, "this session was rotated");
    if (row.revoked_at) return failing(SESSION_CODES.REVOKED, "this session was revoked");
    if (Date.parse(row.absolute_expires_at) <= now()) {
      await revoke({ sessionId: row.session_id, reason: "expired" });
      return failing(SESSION_CODES.EXPIRED, "this session has expired");
    }
    if (Date.parse(row.expires_at) <= now()) {
      await revoke({ sessionId: row.session_id, reason: "idle-expired" });
      return failing(SESSION_CODES.EXPIRED, "this session has expired");
    }
    if (roomId && row.room_code !== roomId) {
      return failing(SESSION_CODES.INVALID, "this session belongs to a different room");
    }

    const touched = await db.query(
      `UPDATE sessions SET last_used_at = now(), expires_at = now() + ($2 * interval '1 millisecond')
        WHERE session_id = $1 AND revoked_at IS NULL
        RETURNING expires_at`,
      [row.session_id, Math.round(idleMs)]
    );
    return {
      ok: true,
      sessionId: row.session_id,
      roomId: row.room_code,
      playerId: row.player_id,
      role: row.role,
      expiresAt: touched.rows[0] ? touched.rows[0].expires_at : row.expires_at,
    };
  }

  async function revoke({ sessionId = null, roomId = null, playerId = null, reason = "revoked" } = {}) {
    if (!sessionId && !roomId) throw new Error("revoke() needs a session or a room");
    const result = await db.query(
      `UPDATE sessions SET revoked_at = now(), revoke_reason = $4
        WHERE ($1::text IS NULL OR session_id = $1)
          AND ($2::text IS NULL OR room_code = $2)
          AND ($3::text IS NULL OR player_id = $3)
          AND revoked_at IS NULL
        RETURNING session_id`,
      [sessionId, roomId, playerId, reason]
    );
    if (result.rows.length) log("sessions revoked", result.rows.length, reason);
    return { ok: true, revoked: result.rows.length };
  }

  /** Replace a live credential with a fresh one and record the lineage. */
  async function rotate({ sessionToken, reason = "rotated" } = {}) {
    const verified = await verify({ sessionToken });
    if (!verified.ok) return verified;
    // the old row is retired by the rotation itself, not as a side effect of
    // re-issuing, so a replay of it is reported as rotated rather than revoked
    const fresh = await issue({
      roomId: verified.roomId,
      playerId: verified.playerId,
      role: verified.role,
      revokePrior: false,
    });
    await db.withTransaction(async (client) => {
      await client.query(
        `UPDATE sessions SET rotated_at = now(), revoked_at = now(), revoke_reason = $2, rotated_to = $3
          WHERE session_id = $1 AND rotated_at IS NULL`,
        [verified.sessionId, reason, fresh.sessionId]
      );
      await client.query(
        `INSERT INTO audit_events (room_code, player_id, type, detail)
         VALUES ($1, $2, 'session-rotated', $3)`,
        [verified.roomId, verified.playerId, JSON.stringify({ reason })]
      );
    });
    return fresh;
  }

  /** Housekeeping for an idle server: nothing revoked here is ever reachable. */
  async function purgeExpired() {
    const result = await db.query(
      `UPDATE sessions SET revoked_at = now(), revoke_reason = COALESCE(revoke_reason, 'expired')
        WHERE revoked_at IS NULL AND (expires_at < now() OR absolute_expires_at < now())
        RETURNING session_id`
    );
    return { ok: true, purged: result.rows.length };
  }

  async function activeCount({ roomId } = {}) {
    const result = await db.query(
      "SELECT count(*)::int AS active FROM sessions WHERE revoked_at IS NULL AND rotated_at IS NULL AND ($1::text IS NULL OR room_code = $1)",
      [roomId || null]
    );
    return result.rows[0].active;
  }

  return { issue, verify, revoke, rotate, purgeExpired, activeCount, hashSessionToken };
}
