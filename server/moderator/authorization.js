import { isSafePathIdentifier } from "../identifiers.js";

export const MODERATOR_PERMISSIONS = Object.freeze([
  "instance.read", "instance.settings.update", "room.create", "room.read", "room.start", "room.pause",
  "room.end", "room.reset", "players.read", "players.manage", "tickets.manage", "bookings.read", "bookings.manage", "bookings.assign", "history.read", "reports.read",
]);

export async function authorizeInstance({ db, moderatorId, instanceId, permission }) {
  if (!db || !moderatorId || !isSafePathIdentifier(instanceId) || !MODERATOR_PERMISSIONS.includes(permission)) return { ok: false, code: "FORBIDDEN" };
  const result = await db.query(`SELECT i.instance_id,i.status,g.permissions
    FROM game_instances i JOIN moderator_instance_grants g ON g.instance_id=i.instance_id
    JOIN moderator_accounts a ON a.moderator_id=g.moderator_id
    WHERE i.instance_id=$1 AND g.moderator_id=$2 AND g.revoked_at IS NULL AND a.status='active'`, [instanceId, moderatorId]);
  const row = result.rows[0];
  if (!row || !row.permissions.includes(permission)) return { ok: false, code: "FORBIDDEN" };
  if (permission === "instance.settings.update" && row.status === "archived") return { ok: false, code: "LIFECYCLE" };
  return { ok: true, instanceId: row.instance_id, instanceStatus: row.status, permissions: row.permissions };
}

export async function authorizeRoom({ db, moderatorId, roomId, instanceId, permission }) {
  if (!isSafePathIdentifier(roomId) || (instanceId != null && !isSafePathIdentifier(instanceId)) || !MODERATOR_PERMISSIONS.includes(permission)) {
    return { ok: false, code: "NOT_FOUND" };
  }
  const found = await db.query(`SELECT r.game_instance_id,i.status AS instance_status,r.status AS room_status,r.closed_at
    FROM rooms r JOIN game_instances i ON i.instance_id=r.game_instance_id WHERE r.room_code=$1`, [roomId]);
  const row = found.rows[0];
  if (!row || (instanceId && row.game_instance_id !== instanceId)) return { ok: false, code: "NOT_FOUND" };
  const grant = await authorizeInstance({ db, moderatorId, instanceId: row.game_instance_id, permission });
  if (!grant.ok) return { ok: false, code: "FORBIDDEN" };
  if (["room.create", "room.start"].includes(permission) && row.instance_status !== "active") return { ok: false, code: "LIFECYCLE" };
  if (row.closed_at && ["room.start", "room.pause", "room.end", "room.reset"].includes(permission)) return { ok: false, code: "LIFECYCLE" };
  return { ok: true, roomId, instanceId: row.game_instance_id, instanceStatus: row.instance_status, roomStatus: row.room_status };
}
