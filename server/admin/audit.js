/**
 * Admin audit trail: the durable record of who did what in the control centre.
 *
 * Every administrative mutation and every sign-in decision lands here with an
 * actor, an action, a target, a timestamp and safe metadata. This table is
 * separate from the game `audit_events` table (migration 001) because admin
 * actions include global ones - a login, a password rotation - that belong to no
 * room and must survive even after a room is purged. `room_code` here is a plain
 * informational column with no foreign key for exactly that reason.
 *
 * The contract with callers: metadata must never contain a password, a token,
 * a session id or a raw IP. The route layer passes already-safe values
 * (a username, an action, a hashed IP, counts) - this module stores what it is
 * given and adds nothing sensitive of its own.
 *
 * Two backends, one interface (durable + memory).
 */

export const ADMIN_ACTIONS = Object.freeze({
  SIGNIN_SUCCESS: "owner.signin.success",
  SIGNIN_FAILURE: "owner.signin.failure",
  SIGNIN_RATE_LIMITED: "owner.signin.rate-limited",
  SIGNIN_MFA_CHALLENGE: "owner.signin.mfa-challenge",
  SIGNIN_MFA_SUCCESS: "owner.signin.mfa-success",
  SIGNIN_MFA_FAILURE: "owner.signin.mfa-failure",
  LOGOUT: "owner.logout",
  MFA_ENROLL_START: "owner.mfa.enroll-start",
  MFA_ENABLED: "owner.mfa.enabled",
  MFA_DISABLED: "owner.mfa.disabled",
  MFA_RECOVERY_RESET: "owner.mfa.recovery-reset",
  ROOM_CREATE: "admin.room.create",
  ROOM_START: "admin.room.start",
  ROOM_CALL: "admin.room.call",
  ROOM_PAUSE: "admin.room.pause",
  ROOM_RESUME: "admin.room.resume",
  ROOM_END: "admin.room.end",
  ROOM_RESET: "admin.room.reset",
  ROOM_AUTOCALL: "admin.room.autocall",
  ROOM_CLOSE: "admin.room.close",
  ROOM_RECOVER: "admin.room.recover",
  PLAYER_REMOVE: "admin.player.remove",
  PASSWORD_ROTATE: "admin.password.rotate",
});

function trim(value, max) {
  if (value == null) return null;
  const text = String(value);
  return text.length > max ? text.slice(0, max) : text;
}

export function createAdminAudit({ db, log = () => {} } = {}) {
  if (!db) throw new Error("createAdminAudit needs a database handle");

  async function record({ actor = null, action, targetType = null, targetId = null, roomCode = null, metadata = {} } = {}) {
    if (!action) throw new Error("record() needs an action");
    const result = await db.query(
      `INSERT INTO admin_audit (actor, action, target_type, target_id, room_code, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING event_id, occurred_at`,
      [trim(actor, 80), trim(action, 60), trim(targetType, 40), trim(targetId, 80), trim(roomCode, 40), JSON.stringify(metadata || {})]
    );
    return { ok: true, eventId: result.rows[0].event_id, occurredAt: result.rows[0].occurred_at };
  }

  async function recent({ limit = 50, before = null } = {}) {
    const size = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const params = [size];
    let where = "";
    if (before) {
      where = "WHERE event_id < $2";
      params.push(before);
    }
    const result = await db.query(
      `SELECT event_id, actor, action, target_type, target_id, room_code, metadata, occurred_at
         FROM admin_audit ${where} ORDER BY event_id DESC LIMIT $1`,
      params
    );
    return result.rows.map(mapRow);
  }

  async function forRoom({ roomCode, limit = 100 } = {}) {
    const result = await db.query(
      `SELECT event_id, actor, action, target_type, target_id, room_code, metadata, occurred_at
         FROM admin_audit WHERE room_code = $1 ORDER BY event_id DESC LIMIT $2`,
      [roomCode, Math.min(Math.max(Number(limit) || 100, 1), 500)]
    );
    return result.rows.map(mapRow);
  }

  return { backend: "database", record, recent, forRoom };
}

export function createMemoryAdminAudit({ log = () => {} } = {}) {
  const events = [];
  let seq = 1;

  async function record({ actor = null, action, targetType = null, targetId = null, roomCode = null, metadata = {} } = {}) {
    if (!action) throw new Error("record() needs an action");
    const event = {
      eventId: seq++,
      actor: trim(actor, 80),
      action: trim(action, 60),
      targetType: trim(targetType, 40),
      targetId: trim(targetId, 80),
      roomCode: trim(roomCode, 40),
      metadata: metadata || {},
      occurredAt: new Date().toISOString(),
    };
    events.push(event);
    return { ok: true, eventId: event.eventId, occurredAt: event.occurredAt };
  }

  async function recent({ limit = 50, before = null } = {}) {
    const size = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const pool = before ? events.filter((e) => e.eventId < before) : events;
    return [...pool].reverse().slice(0, size);
  }

  async function forRoom({ roomCode, limit = 100 } = {}) {
    const size = Math.min(Math.max(Number(limit) || 100, 1), 500);
    return [...events].reverse().filter((e) => e.roomCode === roomCode).slice(0, size);
  }

  return { backend: "memory", record, recent, forRoom };
}

function mapRow(row) {
  return {
    eventId: row.event_id,
    actor: row.actor,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    roomCode: row.room_code,
    metadata: row.metadata,
    occurredAt: row.occurred_at,
  };
}
