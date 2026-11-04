import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createTicketInventoryService } from "./inventory.js";
import { validTimeZone } from "../themes/service.js";

const TOKEN_RE = /^[a-f0-9]{64}$/;
const TICKET_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HOLD_MS_MAX = 15 * 60 * 1000;

const tokenHash = (token) => createHash("sha256").update(token).digest("hex");
const cleanDate = (value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};
const iso = (value) => (value instanceof Date ? value.toISOString() : value ? new Date(value).toISOString() : null);

function sessionShape(row) {
  return {
    sessionId: row.session_id,
    instanceSlug: row.slug,
    instanceName: row.display_name,
    title: row.title,
    startsAt: iso(row.starts_at),
    timeZone: row.time_zone || "UTC",
    bookingOpensAt: iso(row.booking_opens_at),
    bookingClosesAt: iso(row.booking_closes_at),
    capacity: Number(row.ticket_capacity),
    available: Number(row.available ?? 0),
    ticketLimit: Number(row.ticket_limit ?? row.ticket_capacity ?? 0),
    status: row.status,
    inventoryMode: row.inventory_mode || "legacy",
    inventoryState: row.inventory_state || "legacy",
  };
}

function reserveSummary(row) {
  return {
    reservationId: row.reservation_id,
    status: row.status,
    ticketCount: Number(row.ticket_count),
    expiresAt: iso(row.expires_at),
  };
}

export function createBookingService({ db, now = () => new Date(), inventoryService = null } = {}) {
  if (!db) throw new Error("createBookingService needs a database handle");
  const inventory = inventoryService || createTicketInventoryService({ db, now });

  async function appendAudit(client, { sessionId, reservationId = null, action, actorType, actorLabel, metadata = {} }) {
    await client.query(
      `INSERT INTO ticket_reservation_audit(session_id,reservation_id,action,actor_type,actor_label,metadata)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [sessionId, reservationId, action, actorType, actorLabel, JSON.stringify(metadata)]
    );
  }

  async function expireHolds(client, sessionId) {
    const expired = await client.query(
      `UPDATE ticket_reservations SET status='expired'
        WHERE session_id=$1 AND status='held' AND expires_at<=now()
        RETURNING reservation_id,ticket_count`,
      [sessionId]
    );
    for (const row of expired.rows) {
      await appendAudit(client, { sessionId, reservationId: row.reservation_id, action: "hold.expire", actorType: "system", actorLabel: "system", metadata: { ticketCount: Number(row.ticket_count) } });
    }
    return expired.rowCount;
  }

  async function expireSessionHolds(sessionId) {
    await db.withTransaction(async (client) => {
      const locked = await client.query("SELECT session_id FROM game_sessions WHERE session_id=$1 FOR UPDATE", [sessionId]);
      if (locked.rowCount) await expireHolds(client, sessionId);
    });
  }

  async function expireSessionsWithStaleHolds(instanceId = null, slug = null) {
    const values = [];
    const filters = ["r.status='held'", "r.expires_at<=now()"];
    if (instanceId) { values.push(instanceId); filters.push(`s.instance_id=$${values.length}`); }
    if (slug) { values.push(slug); filters.push(`i.slug=$${values.length}`); }
    const result = await db.query(`SELECT DISTINCT r.session_id FROM ticket_reservations r JOIN game_sessions s USING(session_id)
      JOIN game_instances i USING(instance_id) WHERE ${filters.join(" AND ")} ORDER BY r.session_id` , values);
    for (const row of result.rows) await expireSessionHolds(row.session_id);
  }

  async function getSessionRow(sessionId, client = db) {
    const result = await client.query(
      `SELECT s.*,i.slug,i.display_name,i.status AS instance_status,i.public_visible,ticket_limit_row.ticket_limit,
        bound_room.status AS room_status,bound_room.game_number AS room_game_number,
        EXISTS(SELECT 1 FROM games g WHERE g.room_code=bound_room.room_code) AS room_has_games,
        s.ticket_capacity - COALESCE((SELECT sum(r.ticket_count) FROM ticket_reservations r
          WHERE r.session_id=s.session_id AND r.status='confirmed'),0)::int
        - COALESCE((SELECT sum(r.ticket_count) FROM ticket_reservations r
          WHERE r.session_id=s.session_id AND r.status='held' AND r.expires_at>now()),0)::int AS available
       FROM game_sessions s JOIN game_instances i ON i.instance_id=s.instance_id
       LEFT JOIN rooms bound_room ON bound_room.room_code=s.room_code
       CROSS JOIN LATERAL (SELECT s.ticket_capacity::int AS ticket_limit) ticket_limit_row
       WHERE s.session_id=$1`, [sessionId]
    );
    return result.rows[0] || null;
  }

  function windowOpen(row, at = now()) {
    const time = at instanceof Date ? at.getTime() : new Date(at).getTime();
    return row.status === "open" && row.instance_status === "active" && row.public_visible &&
      (!row.room_code || (row.room_status === "WAITING" && Number(row.room_game_number) === 0 && !row.room_has_games)) &&
      new Date(row.booking_opens_at).getTime() <= time && new Date(row.booking_closes_at).getTime() > time &&
      new Date(row.starts_at).getTime() > time;
  }

  async function listPublicSessions(slug) {
    await expireSessionsWithStaleHolds(null, slug);
    const result = await db.query(
      `SELECT s.*,i.slug,i.display_name,i.status AS instance_status,i.public_visible,
        s.ticket_capacity::int AS ticket_limit,
        bound_room.status AS room_status,bound_room.game_number AS room_game_number,
        EXISTS(SELECT 1 FROM games g WHERE g.room_code=bound_room.room_code) AS room_has_games,
        s.ticket_capacity - COALESCE((SELECT sum(r.ticket_count) FROM ticket_reservations r
          WHERE r.session_id=s.session_id AND r.status='confirmed'),0)::int
        - COALESCE((SELECT sum(r.ticket_count) FROM ticket_reservations r
          WHERE r.session_id=s.session_id AND r.status='held' AND r.expires_at>now()),0)::int AS available
       FROM game_sessions s JOIN game_instances i ON i.instance_id=s.instance_id
       LEFT JOIN rooms bound_room ON bound_room.room_code=s.room_code
       WHERE i.slug=$1 AND i.status='active' AND i.public_visible AND s.status='open'
         AND s.booking_opens_at<=now() AND s.booking_closes_at>now() AND s.starts_at>now()
         AND (s.room_code IS NULL OR (bound_room.status='WAITING' AND bound_room.game_number=0 AND NOT EXISTS(SELECT 1 FROM games g WHERE g.room_code=s.room_code)))
       ORDER BY s.starts_at,s.session_id`, [slug]
    );
    return result.rows.map(sessionShape);
  }

  async function getPublicSession(sessionId) {
    await expireSessionHolds(sessionId);
    const row = await getSessionRow(sessionId);
    return row && windowOpen(row) ? sessionShape(row) : null;
  }

  async function listAdminSessions(instanceId) {
    await expireSessionsWithStaleHolds(instanceId);
    const instance = await db.query("SELECT instance_id FROM game_instances WHERE instance_id=$1", [instanceId]);
    if (!instance.rowCount) return null;
    const result = await db.query(
      `SELECT s.*,i.slug,i.display_name,i.status AS instance_status,i.public_visible,
        s.ticket_capacity::int AS ticket_limit,
        COALESCE(sum(r.ticket_count) FILTER(WHERE r.status='held' AND r.expires_at>now()),0)::int AS held_ticket_count,
        COALESCE(sum(r.ticket_count) FILTER(WHERE r.status='confirmed'),0)::int AS confirmed_ticket_count,
        count(r.reservation_id)::int AS reservation_count,
        s.ticket_capacity-COALESCE(sum(r.ticket_count) FILTER(WHERE r.status='held' AND r.expires_at>now()),0)::int
          -COALESCE(sum(r.ticket_count) FILTER(WHERE r.status='confirmed'),0)::int AS available
       FROM game_sessions s JOIN game_instances i ON i.instance_id=s.instance_id
       LEFT JOIN rooms bound_room ON bound_room.room_code=s.room_code
       LEFT JOIN ticket_reservations r ON r.session_id=s.session_id
       WHERE s.instance_id=$1 GROUP BY s.session_id,i.slug,i.display_name,i.status,i.public_visible,bound_room.config
       ORDER BY s.starts_at DESC,s.created_at DESC`, [instanceId]
    );
    return result.rows.map((row) => ({
      ...sessionShape(row), heldTicketCount: Number(row.held_ticket_count),
      confirmedTicketCount: Number(row.confirmed_ticket_count), reservationCount: Number(row.reservation_count),
      roomCode: row.room_code || null,
      createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    }));
  }

  async function createSession({ instanceId, actor, title, startsAt, bookingOpensAt, bookingClosesAt, capacity, holdSeconds = 600, roomCode = null, inventoryMode = "legacy", timeZone = "UTC" }) {
    const starts = cleanDate(startsAt); const opens = cleanDate(bookingOpensAt); const closes = cleanDate(bookingClosesAt);
    if (!starts || !opens || !closes || !(opens < closes && closes <= starts)) return { error: "INVALID_SCHEDULE" };
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000) return { error: "INVALID_CAPACITY" };
    if (!Number.isInteger(holdSeconds) || holdSeconds < 60 || holdSeconds > 900) return { error: "INVALID_HOLD_DURATION" };
    if (!validTimeZone(timeZone)) return { error: "INVALID_TIME_ZONE" };
    roomCode = roomCode === null || roomCode === "" || roomCode === undefined ? null : String(roomCode).trim().toUpperCase();
    if (roomCode !== null && !/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6,12}$/.test(roomCode)) return { error: "INVALID_ROOM_CODE" };
    if (typeof title !== "string" || title.trim().length < 1 || title.trim().length > 100) return { error: "INVALID_TITLE" };
    if (!["legacy", "numbered"].includes(inventoryMode)) return { error: "INVALID_INVENTORY_MODE" };
    const sessionId = randomUUID();
    const created = await db.withTransaction(async (client) => {
      const instance = await client.query("SELECT status FROM game_instances WHERE instance_id=$1 FOR UPDATE", [instanceId]);
      if (!instance.rowCount) return { error: "INSTANCE_NOT_FOUND" };
      if (instance.rows[0].status !== "active") return { error: "INSTANCE_NOT_ACTIVE" };
      if (roomCode) {
        const room = await client.query(
          `SELECT r.game_instance_id,r.status,r.game_number,EXISTS(SELECT 1 FROM games g WHERE g.room_code=r.room_code) AS has_games
             FROM rooms r WHERE r.room_code=$1`, [roomCode]
        );
        if (!room.rowCount || room.rows[0].game_instance_id !== instanceId || room.rows[0].status !== "WAITING" || Number(room.rows[0].game_number) !== 0 || room.rows[0].has_games) return { error: "SESSION_ROOM_INVALID" };
      }
      await client.query(
        `INSERT INTO game_sessions(session_id,instance_id,title,starts_at,booking_opens_at,booking_closes_at,ticket_capacity,reservation_ttl_seconds,status,created_by,updated_by,room_code,inventory_mode,inventory_state,time_zone)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9,$9,$10,$11,$12,$13)`,
        [sessionId, instanceId, title.trim(), starts, opens, closes, capacity, holdSeconds, actor, roomCode, inventoryMode, inventoryMode === "legacy" ? "legacy" : "not_generated", timeZone]
      );
      await appendAudit(client, { sessionId, action: "session.create", actorType: "super_admin", actorLabel: actor, metadata: { title: title.trim(), capacity } });
      return { row: await getSessionRow(sessionId, client) };
    });
    if (created.error) return created;
    return { session: { ...sessionShape(created.row), roomCode: created.row.room_code || null, createdAt: iso(created.row.created_at), updatedAt: iso(created.row.updated_at), heldTicketCount: 0, confirmedTicketCount: 0, reservationCount: 0 } };
  }

  async function updateSession({ instanceId, sessionId, actor, patch }) {
    return db.withTransaction(async (client) => {
      const selected = await client.query(
        `SELECT s.*,i.status AS instance_status FROM game_sessions s JOIN game_instances i ON i.instance_id=s.instance_id
         WHERE s.session_id=$1 AND s.instance_id=$2 FOR UPDATE OF s`, [sessionId, instanceId]
      );
      const row = selected.rows[0];
      if (!row) return { error: "SESSION_NOT_FOUND" };
      const status = patch.status ?? row.status;
      const title = patch.title === undefined ? row.title : patch.title;
      const starts = patch.startsAt === undefined ? new Date(row.starts_at) : cleanDate(patch.startsAt);
      const opens = patch.bookingOpensAt === undefined ? new Date(row.booking_opens_at) : cleanDate(patch.bookingOpensAt);
      const closes = patch.bookingClosesAt === undefined ? new Date(row.booking_closes_at) : cleanDate(patch.bookingClosesAt);
      const capacity = patch.capacity === undefined ? row.ticket_capacity : patch.capacity;
      const holdSeconds = patch.holdSeconds === undefined ? row.reservation_ttl_seconds : patch.holdSeconds;
      const roomCode = patch.roomCode === undefined ? row.room_code : (patch.roomCode === null || patch.roomCode === "" ? null : String(patch.roomCode).trim().toUpperCase());
      const timeZone = patch.timeZone === undefined ? (row.time_zone || "UTC") : patch.timeZone;
      if (typeof title !== "string" || title.trim().length < 1 || title.trim().length > 100) return { error: "INVALID_TITLE" };
      if (!starts || !opens || !closes || !(opens < closes && closes <= starts)) return { error: "INVALID_SCHEDULE" };
      if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000) return { error: "INVALID_CAPACITY" };
      if (!Number.isInteger(holdSeconds) || holdSeconds < 60 || holdSeconds > 900) return { error: "INVALID_HOLD_DURATION" };
      if (!validTimeZone(timeZone)) return { error: "INVALID_TIME_ZONE" };
      if (roomCode !== null && !/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6,12}$/.test(roomCode)) return { error: "INVALID_ROOM_CODE" };
      const transitions = { draft: ["draft", "open", "paused", "cancelled"], open: ["open", "paused", "cancelled", "completed"], paused: ["paused", "open", "cancelled", "completed"], cancelled: ["cancelled"], completed: ["completed"] };
      if (!transitions[row.status]?.includes(status)) return { error: "INVALID_TRANSITION" };
      if (status === "open" && (row.instance_status !== "active" || new Date(starts) <= now() || new Date(closes) <= now())) return { error: "SESSION_NOT_OPENABLE" };
      if (status === "open" && row.inventory_mode === "numbered" && row.inventory_state !== "ready") return { error: "INVENTORY_NOT_READY" };
      if (row.inventory_state === "ready" && capacity !== Number(row.ticket_capacity)) return { error: "INVENTORY_CAPACITY_LOCKED" };
      if (roomCode && roomCode !== row.room_code) {
        const room = await client.query(
          `SELECT r.game_instance_id,r.status,r.game_number,r.config,
             EXISTS(SELECT 1 FROM games g WHERE g.room_code=r.room_code) AS has_games
             FROM rooms r WHERE r.room_code=$1`, [roomCode]
        );
        if (!room.rowCount || room.rows[0].game_instance_id !== instanceId || room.rows[0].status !== "WAITING" || Number(room.rows[0].game_number) !== 0 || room.rows[0].has_games) return { error: "SESSION_ROOM_INVALID" };
        // Legacy per-player room limits are ignored; session ticket capacity
        // remains the source of truth for booked selections.
      }
      const assigned = await client.query("SELECT 1 FROM ticket_reservations WHERE session_id=$1 AND player_id IS NOT NULL LIMIT 1", [sessionId]);
      if (assigned.rowCount && roomCode !== row.room_code) return { error: "SESSION_HAS_ASSIGNED_RESERVATIONS" };
      if (assigned.rowCount && status === "cancelled") return { error: "SESSION_HAS_ASSIGNED_RESERVATIONS" };
      const booked = await client.query(
        `SELECT COALESCE(sum(ticket_count),0)::int AS n FROM ticket_reservations
         WHERE session_id=$1 AND (status='confirmed' OR (status='held' AND expires_at>now()))`, [sessionId]
      );
      if (Number(booked.rows[0].n) > capacity) return { error: "CAPACITY_BELOW_BOOKED" };
      // Resolve elapsed holds before the bulk session-cancellation transition.
      // Otherwise an unobserved expired hold would be mislabeled as cancelled,
      // making its final state depend on which API happened to read it first.
      if (status === "cancelled") await expireHolds(client, sessionId);
      await client.query(
        `UPDATE game_sessions SET title=$3,starts_at=$4,booking_opens_at=$5,booking_closes_at=$6,
          ticket_capacity=$7,reservation_ttl_seconds=$8,status=$9,updated_by=$10,room_code=$11,time_zone=$12 WHERE session_id=$1 AND instance_id=$2`,
        [sessionId, instanceId, title.trim(), starts, opens, closes, capacity, holdSeconds, status, actor, roomCode, timeZone]
      );
      if (status === "cancelled") {
        const cancelled = await client.query(
          `UPDATE ticket_reservations SET status='cancelled',cancelled_at=now()
           WHERE session_id=$1 AND player_id IS NULL AND status IN ('held','confirmed') RETURNING reservation_id,ticket_count`, [sessionId]
        );
        for (const reservation of cancelled.rows) await appendAudit(client, { sessionId, reservationId: reservation.reservation_id, action: "hold.cancel", actorType: "system", actorLabel: actor, metadata: { reason: "session-cancelled", ticketCount: Number(reservation.ticket_count) } });
      }
      const actionByStatus = { open: "session.open", paused: "session.pause", cancelled: "session.cancel", completed: "session.complete" };
      const action = status !== row.status ? (actionByStatus[status] || "session.update") : "session.update";
      await appendAudit(client, { sessionId, action, actorType: "super_admin", actorLabel: actor, metadata: { title: title.trim(), capacity, status } });
      const fresh = await getSessionRow(sessionId, client);
      return { session: { ...sessionShape(fresh), roomCode: fresh.room_code || null, createdAt: iso(fresh.created_at), updatedAt: iso(fresh.updated_at) } };
    });
  }

  async function reserve({ sessionId, displayName, ticketCount, ticketIds, bookingToken: suppliedToken }) {
    const reservationId = randomUUID();
    const bookingToken = suppliedToken === undefined ? randomBytes(32).toString("hex") : suppliedToken;
    if (typeof bookingToken !== "string" || !TOKEN_RE.test(bookingToken)) return { error: "INVALID_INPUT" };
    const hash = tokenHash(bookingToken);
    if (typeof displayName !== "string" || displayName.trim().length < 3 || displayName.trim().length > 20) return { error: "INVALID_NAME" };
    const name = displayName.trim().replace(/\s+/g, " ");
    if (!Number.isSafeInteger(ticketCount) || ticketCount < 1) return { error: "INVALID_TICKET_COUNT" };
    if (ticketIds !== undefined && (!Array.isArray(ticketIds) || ticketIds.length !== ticketCount || new Set(ticketIds).size !== ticketIds.length || ticketIds.some((id) => typeof id !== "string" || !TICKET_ID_RE.test(id)))) return { error: "INVALID_TICKET_SELECTION" };
    const selectedTicketIds = ticketIds === undefined ? null : ticketIds.map((id) => id.toLowerCase()).sort();
    let result;
    try {
      result = await db.withTransaction(async (client) => {
      const found = await client.query(`SELECT s.*,r.status AS room_status,r.game_number AS room_game_number,
        EXISTS(SELECT 1 FROM games g WHERE g.room_code=r.room_code) AS room_has_games,
        s.ticket_capacity::int AS ticket_limit
        FROM game_sessions s LEFT JOIN rooms r ON r.room_code=s.room_code WHERE s.session_id=$1 FOR UPDATE OF s`, [sessionId]);
      const row = found.rows[0];
      if (!row) return { error: "SESSION_NOT_FOUND" };
      await expireHolds(client, sessionId);
      const existing = await client.query("SELECT * FROM ticket_reservations WHERE session_id=$1 AND booking_token_hash=$2", [sessionId, hash]);
      if (existing.rowCount) {
        if (row.inventory_mode === "numbered") {
          const allocated = await inventory.listReservationTickets({ client, sessionId, reservationId: existing.rows[0].reservation_id });
          const allocatedIds = allocated.map((ticket) => ticket.ticketId.toLowerCase()).sort();
          if (!selectedTicketIds || allocatedIds.length !== selectedTicketIds.length || allocatedIds.some((id, index) => id !== selectedTicketIds[index])) return { error: "IDEMPOTENCY_KEY_REUSED" };
          return { reservation: { ...reserveSummary(existing.rows[0]), tickets: allocated }, idempotent: true };
        }
        if (selectedTicketIds) return { error: "TICKET_SELECTION_REQUIRES_INVENTORY" };
        return { reservation: reserveSummary(existing.rows[0]), idempotent: true };
      }
      if (row.inventory_mode === "numbered") {
        if (row.inventory_state !== "ready") return { error: "INVENTORY_NOT_READY" };
        if (!selectedTicketIds || selectedTicketIds.length !== ticketCount) return { error: "TICKET_SELECTION_REQUIRED" };
      } else if (selectedTicketIds) return { error: "TICKET_SELECTION_REQUIRES_INVENTORY" };
      if (ticketCount > Number(row.ticket_capacity)) return { error: "TICKET_LIMIT", maxTickets: Number(row.ticket_capacity) };
      const instance = await client.query("SELECT status,public_visible FROM game_instances WHERE instance_id=$1", [row.instance_id]);
      if (!instance.rowCount || instance.rows[0].status !== "active" || !instance.rows[0].public_visible || !windowOpen({ ...row, instance_status: instance.rows[0].status, public_visible: instance.rows[0].public_visible })) return { error: "SESSION_UNAVAILABLE" };
      const usage = await client.query(
        `SELECT COALESCE(sum(ticket_count),0)::int AS used FROM ticket_reservations
         WHERE session_id=$1 AND (status='confirmed' OR (status='held' AND expires_at>now()))`, [sessionId]
      );
      if (Number(usage.rows[0].used) + ticketCount > Number(row.ticket_capacity)) return { error: "CAPACITY_FULL" };
      const ttlSeconds = Math.min(Number(row.reservation_ttl_seconds), 900);
      const created = await client.query(
        `INSERT INTO ticket_reservations(reservation_id,session_id,display_name,ticket_count,booking_token_hash,status,expires_at)
         VALUES($1,$2,$3,$4,$5,'held',LEAST(now()+($6*interval '1 second'),$7)) RETURNING *`,
        [reservationId, sessionId, name, ticketCount, hash, ttlSeconds, row.booking_closes_at]
      );
      if (new Date(created.rows[0].expires_at) <= now()) return { error: "BOOKING_CLOSED" };
      await appendAudit(client, { sessionId, reservationId, action: "hold.create", actorType: "player", actorLabel: "reservation owner", metadata: { ticketCount } });
      let reservation = reserveSummary(created.rows[0]);
      if (row.inventory_mode === "numbered") {
        const allocation = await inventory.allocateToReservation({
          client, sessionId, reservationId, ticketIds: selectedTicketIds,
          actor: { type: "player", label: "reservation owner" },
        });
        if (allocation.error) {
          const failure = new Error(allocation.error);
          failure.inventoryCode = allocation.error;
          throw failure;
        }
        reservation = { ...reservation, tickets: await inventory.listReservationTickets({ client, sessionId, reservationId }) };
      }
      return { reservation };
      });
    } catch (error) {
      const cause = error?.cause;
      if (cause?.inventoryCode) return { error: cause.inventoryCode };
      throw error;
    }
    return result.error ? result : { ...result, reservation: { ...result.reservation, bookingToken } };
  }

  async function listAdminReservations(instanceId, { sessionId = null, status = null, search = "" } = {}) {
    await expireSessionsWithStaleHolds(instanceId);
    const values = [instanceId];
    const filters = ["s.instance_id=$1"];
    if (sessionId) { values.push(sessionId); filters.push(`s.session_id=$${values.length}`); }
    if (["held", "confirmed", "cancelled", "expired"].includes(status)) { values.push(status); filters.push(`r.status=$${values.length}`); }
    if (typeof search === "string" && search.trim()) {
      values.push(search.trim().slice(0, 80));
      filters.push(`(strpos(lower(r.display_name),lower($${values.length}))>0 OR strpos(r.reservation_id::text,$${values.length})>0)`);
    }
    const exists = await db.query("SELECT 1 FROM game_instances WHERE instance_id=$1", [instanceId]);
    if (!exists.rowCount) return null;
    const result = await db.query(`SELECT r.reservation_id,r.session_id,r.display_name,r.ticket_count,r.status,r.expires_at,r.created_at,
        r.confirmed_at,r.cancelled_at,r.player_id,r.room_code AS assigned_room_code,
        s.title AS session_title,s.room_code AS session_room_code,i.slug,i.display_name AS instance_name
      FROM ticket_reservations r JOIN game_sessions s USING(session_id) JOIN game_instances i USING(instance_id)
      WHERE ${filters.join(" AND ")} ORDER BY r.created_at DESC,r.reservation_id LIMIT 500`, values);
    return result.rows.map((row) => ({
      reservationId: row.reservation_id, sessionId: row.session_id, displayName: row.display_name,
      ticketCount: Number(row.ticket_count), status: row.status, expiresAt: iso(row.expires_at),
      createdAt: iso(row.created_at), confirmedAt: iso(row.confirmed_at), cancelledAt: iso(row.cancelled_at),
      assignedRoomCode: row.assigned_room_code || null, sessionRoomCode: row.session_room_code || null,
      sessionTitle: row.session_title, instanceSlug: row.slug, instanceName: row.instance_name,
      allocationStatus: row.player_id ? "assigned" : row.status === "confirmed" ? "awaiting-player-join" : "not-allocated",
    }));
  }

  async function getAdminReservation(instanceId, reservationId) {
    const reference = await db.query(`SELECT r.session_id FROM ticket_reservations r JOIN game_sessions s USING(session_id)
      WHERE r.reservation_id=$1 AND s.instance_id=$2`, [reservationId, instanceId]);
    if (!reference.rowCount) return null;
    await expireSessionHolds(reference.rows[0].session_id);
    const found = await db.query(`SELECT r.*,s.title AS session_title,s.room_code AS session_room_code,s.inventory_mode,i.slug,i.display_name AS instance_name
      FROM ticket_reservations r JOIN game_sessions s USING(session_id) JOIN game_instances i USING(instance_id)
      WHERE r.reservation_id=$1 AND s.instance_id=$2`, [reservationId, instanceId]);
    const row = found.rows[0];
    if (!row) return null;
    const history = await db.query(`SELECT event_id,action,actor_type,occurred_at,metadata
      FROM ticket_reservation_audit WHERE reservation_id=$1 ORDER BY event_id`, [reservationId]);
    return {
      reservationId: row.reservation_id, sessionId: row.session_id, displayName: row.display_name,
      ticketCount: Number(row.ticket_count), status: row.status, expiresAt: iso(row.expires_at),
      createdAt: iso(row.created_at), confirmedAt: iso(row.confirmed_at), cancelledAt: iso(row.cancelled_at),
      assignedRoomCode: row.room_code || null, sessionRoomCode: row.session_room_code || null,
      sessionTitle: row.session_title, instanceSlug: row.slug, instanceName: row.instance_name,
      ...(row.inventory_mode === "numbered" ? { tickets: await inventory.listReservationTickets({ sessionId: row.session_id, reservationId }) } : {}),
      allocationStatus: row.player_id ? "assigned" : row.status === "confirmed" ? "awaiting-player-join" : "not-allocated",
      history: history.rows.map((event) => ({ eventId: Number(event.event_id), action: event.action, actorType: event.actor_type, occurredAt: iso(event.occurred_at), metadata: event.metadata })),
    };
  }

  async function cancelByOperator({ instanceId, reservationId, actorType, actorLabel }) {
    return db.withTransaction(async (client) => {
      const found = await client.query(`SELECT r.*,s.instance_id,s.status AS session_status,s.room_code AS session_room
        FROM ticket_reservations r JOIN game_sessions s USING(session_id)
        WHERE r.reservation_id=$1 AND s.instance_id=$2 FOR UPDATE OF s,r`, [reservationId, instanceId]);
      const row = found.rows[0];
      if (!row) return { error: "RESERVATION_NOT_FOUND" };
      if (row.player_id) return { error: "RESERVATION_ASSIGNED" };
      if (!["held", "confirmed"].includes(row.status)) return { error: "INVALID_RESERVATION_STATE" };
      if (row.status === "held" && new Date(row.expires_at) <= now()) {
        await client.query("UPDATE ticket_reservations SET status='expired' WHERE reservation_id=$1", [reservationId]);
        await appendAudit(client, { sessionId: row.session_id, reservationId, action: "hold.expire", actorType: "system", actorLabel: "system", metadata: { ticketCount: Number(row.ticket_count) } });
        return { error: "RESERVATION_EXPIRED" };
      }
      const cancelled = await client.query("UPDATE ticket_reservations SET status='cancelled',cancelled_at=now() WHERE reservation_id=$1 RETURNING *", [reservationId]);
      await appendAudit(client, { sessionId: row.session_id, reservationId, action: "hold.cancel", actorType, actorLabel, metadata: { reason: "operator-cancelled", ticketCount: Number(row.ticket_count) } });
      return { reservation: reserveSummary(cancelled.rows[0]) };
    });
  }

  async function assignSessionRoom({ instanceId, sessionId, roomCode, actor }) {
    if (typeof roomCode !== "string" || !/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6,12}$/.test(roomCode)) return { error: "INVALID_ROOM_CODE" };
    try {
      return await db.withTransaction(async (client) => {
      const selected = await client.query(`SELECT s.*,i.status AS instance_status
        FROM game_sessions s JOIN game_instances i ON i.instance_id=s.instance_id
        WHERE s.session_id=$1 AND s.instance_id=$2 FOR UPDATE OF s,i`, [sessionId, instanceId]);
      const session = selected.rows[0];
      if (!session) return { error: "SESSION_NOT_FOUND" };
      if (session.instance_status !== "active") return { error: "INSTANCE_NOT_ACTIVE" };
      if (["cancelled", "completed"].includes(session.status)) return { error: "SESSION_CLOSED" };
      if (session.room_code) {
        if (session.room_code === roomCode) return { sessionId, roomCode, alreadyAssigned: true };
        return { error: "SESSION_ALREADY_ASSIGNED" };
      }

      const roomResult = await client.query(`SELECT r.game_instance_id,r.status,r.game_number,r.config,
          EXISTS(SELECT 1 FROM games g WHERE g.room_code=r.room_code) AS has_games
        FROM rooms r WHERE r.room_code=$1 FOR UPDATE`, [roomCode]);
      const room = roomResult.rows[0];
      if (!room || room.game_instance_id !== instanceId || room.status !== "WAITING" || Number(room.game_number) !== 0 || room.has_games) return { error: "SESSION_ROOM_INVALID" };
      const conflict = await client.query("SELECT 1 FROM game_sessions WHERE room_code=$1 AND session_id<>$2 LIMIT 1", [roomCode, sessionId]);
      if (conflict.rowCount) return { error: "SESSION_ROOM_IN_USE" };

      const limits = await client.query(`SELECT
          count(*) FILTER (WHERE player_id IS NOT NULL)::int AS assigned
        FROM ticket_reservations WHERE session_id=$1`, [sessionId]);
      if (Number(limits.rows[0].assigned) > 0) return { error: "SESSION_HAS_ASSIGNED_RESERVATIONS" };

      await client.query("UPDATE game_sessions SET room_code=$3,updated_by=$4 WHERE session_id=$1 AND instance_id=$2", [sessionId, instanceId, roomCode, actor]);
      await appendAudit(client, { sessionId, action: "session.assign_room", actorType: "moderator", actorLabel: actor, metadata: { roomCode } });
        return { sessionId, roomCode, alreadyAssigned: false };
      });
    } catch (error) {
      if (error.code === "23505" && error.constraint === "game_sessions_room_code_key") return { error: "SESSION_ROOM_IN_USE" };
      throw error;
    }
  }

  async function lookupOrTransition({ reservationId, bookingToken, action }) {
    if (typeof bookingToken !== "string" || !TOKEN_RE.test(bookingToken)) return { error: "RESERVATION_NOT_FOUND" };
    return db.withTransaction(async (client) => {
      const token = tokenHash(bookingToken);
      const reservationRef = await client.query("SELECT session_id FROM ticket_reservations WHERE reservation_id=$1", [reservationId]);
      if (!reservationRef.rowCount) return { error: "RESERVATION_NOT_FOUND" };
      await client.query("SELECT session_id FROM game_sessions WHERE session_id=$1 FOR UPDATE", [reservationRef.rows[0].session_id]);
      const found = await client.query(
        `SELECT r.*,s.status AS session_status,s.starts_at,s.booking_closes_at,s.instance_id,s.room_code AS session_room,s.inventory_mode,
           i.status AS instance_status,i.public_visible,i.slug,i.display_name AS instance_name,s.title,
           s.booking_opens_at,s.ticket_capacity
         FROM ticket_reservations r JOIN game_sessions s ON s.session_id=r.session_id
         JOIN game_instances i ON i.instance_id=s.instance_id WHERE r.reservation_id=$1 FOR UPDATE OF r`, [reservationId]
      );
      const row = found.rows[0];
      if (!row || !timingSafeHexEqual(row.booking_token_hash, token)) return { error: "RESERVATION_NOT_FOUND" };
      if (row.status === "held" && new Date(row.expires_at) <= now()) {
        await client.query("UPDATE ticket_reservations SET status='expired' WHERE reservation_id=$1", [reservationId]);
        await appendAudit(client, { sessionId: row.session_id, reservationId, action: "hold.expire", actorType: "system", actorLabel: "system", metadata: { ticketCount: Number(row.ticket_count) } });
        row.status = "expired";
      }
      if (action === "confirm") {
        if (row.status !== "held") return { error: row.status === "expired" ? "RESERVATION_EXPIRED" : "INVALID_RESERVATION_STATE" };
        if (row.session_status !== "open" || row.instance_status !== "active" || new Date(row.booking_closes_at) <= now()) return { error: "BOOKING_CLOSED" };
        const confirmed = await client.query("UPDATE ticket_reservations SET status='confirmed',confirmed_at=now() WHERE reservation_id=$1 RETURNING *", [reservationId]);
        await appendAudit(client, { sessionId: row.session_id, reservationId, action: "hold.confirm", actorType: "player", actorLabel: "reservation owner", metadata: { ticketCount: Number(row.ticket_count) } });
        return { reservation: { ...reserveSummary(confirmed.rows[0]), bookingToken,
          ...(row.inventory_mode === "numbered" ? { tickets: await inventory.listReservationTickets({ client, sessionId: row.session_id, reservationId }) } : {}),
          session: { sessionId: row.session_id, instanceSlug: row.slug, instanceName: row.instance_name,
            title: row.title, startsAt: iso(row.starts_at), bookingOpensAt: iso(row.booking_opens_at),
            bookingClosesAt: iso(row.booking_closes_at), capacity: Number(row.ticket_capacity), status: row.session_status,
            ...(row.session_room ? { roomCode: row.session_room } : {}) } } };
      }
      if (action === "cancel") {
        if (!["held", "confirmed"].includes(row.status)) return { error: "INVALID_RESERVATION_STATE" };
        if (row.player_id || new Date(row.booking_closes_at) <= now() || new Date(row.starts_at) <= now() || ["cancelled", "completed"].includes(row.session_status)) return { error: "CANCELLATION_CLOSED" };
        const cancelled = await client.query("UPDATE ticket_reservations SET status='cancelled',cancelled_at=now() WHERE reservation_id=$1 RETURNING *", [reservationId]);
        await appendAudit(client, { sessionId: row.session_id, reservationId, action: "hold.cancel", actorType: "player", actorLabel: "reservation owner", metadata: { ticketCount: Number(row.ticket_count) } });
        return { reservation: { ...reserveSummary(cancelled.rows[0]),
          ...(row.inventory_mode === "numbered" ? { tickets: await inventory.listReservationTickets({ client, sessionId: row.session_id, reservationId }) } : {}) } };
      }
      return {
        reservation: {
          ...reserveSummary(row),
          ...(row.inventory_mode === "numbered" ? { tickets: await inventory.listReservationTickets({ client, sessionId: row.session_id, reservationId }) } : {}),
          session: {
            sessionId: row.session_id, instanceSlug: row.slug, instanceName: row.instance_name,
            title: row.title, startsAt: iso(row.starts_at), bookingOpensAt: iso(row.booking_opens_at),
            bookingClosesAt: iso(row.booking_closes_at), capacity: Number(row.ticket_capacity), status: row.session_status,
            ...(row.status === "confirmed" && row.session_room ? { roomCode: row.session_room } : {}),
          },
        },
      };
    });
  }

  return {
    listPublicSessions, getPublicSession, listAdminSessions, listAdminReservations, getAdminReservation,
    cancelByOperator, assignSessionRoom, createSession, updateSession, reserve, lookupOrTransition,
    generateInventory: inventory.generateForSession,
    listPublicTicketCatalog: inventory.listPublicCatalog,
    listAdminTicketInventory: inventory.listAdminInventory,
  };
}

function timingSafeHexEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
