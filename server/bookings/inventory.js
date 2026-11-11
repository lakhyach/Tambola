import { randomUUID } from "node:crypto";
import { generateTickets, validateTicket } from "../game/ticket.js";

const MAX_INVENTORY = 10_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;
const ACTOR_TYPES = new Set(["owner", "admin", "super_admin", "host", "player", "moderator", "system"]);
const STATUS_VALUES = new Set(["available", "reserved", "booked", "assigned"]);

const ticketFingerprint = (grid) => grid.flat().filter(Number.isInteger).sort((a, b) => a - b).join(",");
const iso = (value) => (value instanceof Date ? value.toISOString() : value ? new Date(value).toISOString() : null);

function actorShape(actor = {}) {
  const actorType = ACTOR_TYPES.has(actor.type) ? actor.type : "system";
  const label = typeof actor.label === "string" ? actor.label.trim().slice(0, 80) : actorType;
  return { type: actorType, label: label || actorType };
}

function publicTicket(row, { publicOnly = false } = {}) {
  return {
    ticketId: row.ticket_id,
    serial: row.serial,
    serialOrdinal: Number(row.serial_ordinal),
    grid: row.grid,
    sheetId: row.sheet_id || null,
    sheetOrdinal: row.sheet_ordinal == null ? null : Number(row.sheet_ordinal),
    sheetPosition: row.sheet_position == null ? null : Number(row.sheet_position),
    status: row.inventory_status,
    ...(!publicOnly ? { playerName: row.player_name || null } : {}),
    ...(!publicOnly ? { reservationId: row.reservation_id || null } : {}),
    expiresAt: iso(row.reservation_expires_at),
  };
}

export function createTicketInventoryService({ db, now = () => new Date(), generate = generateTickets, validate = validateTicket } = {}) {
  if (!db) throw new Error("createTicketInventoryService needs a database handle");
  const inTransaction = (client, operation) => client ? operation(client) : db.withTransaction(operation);

  async function appendEvent(client, { sessionId, ticketId = null, generationBatchId = null, reservationId = null, action, actor, metadata = {} }) {
    const who = actorShape(actor);
    await client.query(
      `INSERT INTO session_ticket_events(session_id,ticket_id,generation_batch_id,reservation_id,action,actor_type,actor_label,metadata)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [sessionId, ticketId, generationBatchId, reservationId, action, who.type, who.label, JSON.stringify(metadata)]
    );
  }

  async function inventorySummary(client, sessionId) {
    const result = await client.query(
      `SELECT s.session_id,s.instance_id,s.inventory_mode,s.inventory_state,s.inventory_request_key,
          b.generation_batch_id,b.requested_count,b.generated_count,b.idempotency_key,b.status AS batch_status,b.completed_at
         FROM game_sessions s LEFT JOIN ticket_inventory_batches b USING(session_id)
        WHERE s.session_id=$1`, [sessionId]
    );
    return result.rows[0] || null;
  }

  async function expireStaleHolds(sessionId) {
    await db.withTransaction(async (client) => {
      const session = await client.query("SELECT session_id FROM game_sessions WHERE session_id=$1 FOR UPDATE", [sessionId]);
      if (!session.rowCount) return;
      const stale = await client.query(
        "SELECT reservation_id,ticket_count FROM ticket_reservations WHERE session_id=$1 AND status='held' AND expires_at<=now() ORDER BY reservation_id FOR UPDATE",
        [sessionId]
      );
      for (const row of stale.rows) {
        const expired = await client.query(
          "UPDATE ticket_reservations SET status='expired' WHERE session_id=$1 AND reservation_id=$2 AND status='held' RETURNING reservation_id",
          [sessionId, row.reservation_id]
        );
        if (!expired.rowCount) continue;
        await client.query(
          `INSERT INTO ticket_reservation_audit(session_id,reservation_id,action,actor_type,actor_label,metadata)
           VALUES($1,$2,'hold.expire','system','system',$3)`,
          [sessionId, row.reservation_id, JSON.stringify({ ticketCount: Number(row.ticket_count), source: "inventory-catalog" })]
        );
      }
    });
  }

  async function listReservationTickets({ sessionId, reservationId, client = null } = {}) {
    if (!UUID_RE.test(String(sessionId || "")) || !UUID_RE.test(String(reservationId || ""))) return [];
    const query = client ? client.query.bind(client) : db.query;
    const result = await query(
      `SELECT t.ticket_id,t.serial,t.serial_ordinal,t.grid,t.sheet_id,sh.sheet_ordinal,t.sheet_position,a.released_at,a.release_reason
         FROM ticket_reservation_items a JOIN session_tickets t ON t.session_id=a.session_id AND t.ticket_id=a.ticket_id
         LEFT JOIN session_ticket_sheets sh ON sh.session_id=t.session_id AND sh.sheet_id=t.sheet_id
        WHERE a.session_id=$1 AND a.reservation_id=$2 ORDER BY t.serial_ordinal`, [sessionId, reservationId]
    );
    return result.rows.map((row) => ({
      ticketId: row.ticket_id, serial: row.serial, serialOrdinal: Number(row.serial_ordinal), grid: row.grid,
      sheetId: row.sheet_id || null, sheetOrdinal: row.sheet_ordinal == null ? null : Number(row.sheet_ordinal),
      sheetPosition: row.sheet_position == null ? null : Number(row.sheet_position),
      releasedAt: iso(row.released_at), releaseReason: row.release_reason || null,
    }));
  }

  async function generateForSession({ instanceId = null, sessionId, requestedCount, actor = { type: "admin", label: "admin" }, idempotencyKey } = {}) {
    if (!UUID_RE.test(String(sessionId || ""))) return { error: "SESSION_NOT_FOUND" };
    if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > MAX_INVENTORY) return { error: "INVALID_INVENTORY_COUNT", max: MAX_INVENTORY };
    if (typeof idempotencyKey !== "string" || !KEY_RE.test(idempotencyKey)) return { error: "INVALID_IDEMPOTENCY_KEY" };
    const who = actorShape(actor);

    return db.withTransaction(async (client) => {
      const found = await client.query("SELECT * FROM game_sessions WHERE session_id=$1 FOR UPDATE", [sessionId]);
      const session = found.rows[0];
      if (!session) return { error: "SESSION_NOT_FOUND" };
      if (instanceId && session.instance_id !== instanceId) return { error: "SESSION_NOT_FOUND" };
      if (session.inventory_mode !== "numbered") return { error: "LEGACY_SESSION" };
      if (Number(session.ticket_capacity) !== requestedCount) return { error: "INVENTORY_COUNT_MISMATCH", expected: Number(session.ticket_capacity) };

      const priorKey = await client.query(
        "SELECT generation_batch_id,session_id,requested_count FROM ticket_inventory_batches WHERE instance_id=$1 AND idempotency_key=$2 FOR UPDATE",
        [session.instance_id, idempotencyKey]
      );
      if (priorKey.rowCount && priorKey.rows[0].session_id !== sessionId) return { error: "IDEMPOTENCY_KEY_REUSED" };

      const existing = await inventorySummary(client, sessionId);
      if (existing?.inventory_state === "ready") {
        if (existing.idempotency_key !== idempotencyKey || Number(existing.requested_count) !== requestedCount) return { error: "INVENTORY_ALREADY_GENERATED" };
        return {
          sessionId,
          generationBatchId: existing.generation_batch_id,
          requestedCount: Number(existing.requested_count),
          generatedCount: Number(existing.generated_count),
          status: "ready",
          completedAt: iso(existing.completed_at),
          idempotent: true,
        };
      }
      if (existing?.generation_batch_id) return { error: "INVENTORY_STATE_INVALID" };
      if (session.status !== "draft") return { error: "SESSION_NOT_GENERATABLE" };

      const grids = generate(requestedCount);
      if (!Array.isArray(grids) || grids.length !== requestedCount) throw new Error("ticket generator did not return the complete requested inventory");
      const fingerprints = new Set();
      for (const [index, grid] of grids.entries()) {
        const checked = validate(grid);
        if (!checked?.valid) throw new Error(`ticket ${index + 1} is invalid: ${(checked?.errors || ["unknown validation error"]).join("; ")}`);
        const fingerprint = ticketFingerprint(grid);
        if (fingerprints.has(fingerprint)) throw new Error(`ticket generator returned a duplicate grid at serial ${index + 1}`);
        fingerprints.add(fingerprint);
      }

      const generationBatchId = randomUUID();
      const sheetCount = generate === generateTickets ? Math.floor(requestedCount / 6) : 0;
      const sheetIds = Array.from({ length: sheetCount }, () => randomUUID());
      const batch = await client.query(
        `INSERT INTO ticket_inventory_batches(generation_batch_id,session_id,instance_id,idempotency_key,requested_count,generated_count,status,generated_by)
         VALUES($1,$2,$3,$4,$5,0,'generating',$6) RETURNING created_at`,
        [generationBatchId, sessionId, session.instance_id, idempotencyKey, requestedCount, who.label]
      );
      for (let offset = 0; offset < sheetCount; offset += 250) {
        const chunk = sheetIds.slice(offset, offset + 250);
        const values = [];
        const tuples = chunk.map((sheetId, localIndex) => {
          const ordinal = offset + localIndex + 1;
          const first = values.length + 1;
          values.push(sheetId, sessionId, generationBatchId, ordinal);
          return `($${first},$${first + 1},$${first + 2},$${first + 3})`;
        });
        await client.query(
          `INSERT INTO session_ticket_sheets(sheet_id,session_id,generation_batch_id,sheet_ordinal) VALUES ${tuples.join(",")}`,
          values
        );
      }
      const insertChunkSize = 250;
      for (let offset = 0; offset < grids.length; offset += insertChunkSize) {
        const values = [];
        const tuples = grids.slice(offset, offset + insertChunkSize).map((grid, localIndex) => {
          const serialOrdinal = offset + localIndex + 1;
          const serial = `TKT-${String(serialOrdinal).padStart(4, "0")}`;
          const sheetIndex = Math.floor((serialOrdinal - 1) / 6);
          const sheetId = sheetIndex < sheetCount ? sheetIds[sheetIndex] : null;
          const sheetPosition = sheetId ? ((serialOrdinal - 1) % 6) + 1 : null;
          const ticketValues = [randomUUID(), sessionId, generationBatchId, serialOrdinal, serial, ticketFingerprint(grid), JSON.stringify(grid), sheetId, sheetPosition];
          const firstPlaceholder = values.length + 1;
          values.push(...ticketValues);
          return `($${firstPlaceholder},$${firstPlaceholder + 1},$${firstPlaceholder + 2},$${firstPlaceholder + 3},$${firstPlaceholder + 4},$${firstPlaceholder + 5},$${firstPlaceholder + 6},$${firstPlaceholder + 7},$${firstPlaceholder + 8})`;
        });
        await client.query(
          `INSERT INTO session_tickets(ticket_id,session_id,generation_batch_id,serial_ordinal,serial,fingerprint,grid,sheet_id,sheet_position) VALUES ${tuples.join(",")}`,
          values
        );
      }
      await client.query(
        `UPDATE ticket_inventory_batches SET generated_count=$2,status='ready',completed_at=now()
          WHERE generation_batch_id=$1`, [generationBatchId, requestedCount]
      );
      await client.query(
        `UPDATE game_sessions SET inventory_state='ready',inventory_request_key=$2,updated_by=$3
          WHERE session_id=$1`, [sessionId, idempotencyKey, who.label]
      );
      await appendEvent(client, {
        sessionId,
        generationBatchId,
        action: "generated",
        actor: who,
        metadata: { requestedCount, generatedCount: requestedCount },
      });
      return {
        sessionId,
        generationBatchId,
        requestedCount,
        generatedCount: requestedCount,
        status: "ready",
        createdAt: iso(batch.rows[0].created_at),
        completedAt: new Date(now()).toISOString(),
        idempotent: false,
      };
    });
  }

  async function listInventory({ sessionId, page = 1, pageSize = 24, search = "", status = null, publicOnly = false } = {}) {
    if (!UUID_RE.test(String(sessionId || ""))) return null;
    const safePage = Number.isInteger(page) && page > 0 ? Math.min(page, 1_000_000) : 1;
    const safePageSize = Number.isInteger(pageSize) && pageSize > 0 ? Math.min(pageSize, 100) : 24;
    const query = typeof search === "string" ? search.trim().slice(0, 64) : "";
    const wantedStatus = STATUS_VALUES.has(status) ? status : null;
    const params = [sessionId];
    const filters = ["s.session_id=$1", "s.inventory_mode='numbered'", "s.inventory_state='ready'"];
    if (publicOnly) {
      filters.push("i.status='active'", "i.public_visible", "s.status='open'", "s.booking_opens_at<=now()", "s.booking_closes_at>now()", "s.starts_at>now()");
      filters.push("(s.room_code IS NULL OR EXISTS(SELECT 1 FROM rooms br WHERE br.room_code=s.room_code AND br.status='WAITING' AND br.game_number=0 AND NOT EXISTS(SELECT 1 FROM games bg WHERE bg.room_code=br.room_code)))");
    }
    const projectedStatus = `CASE WHEN r.status='held' AND r.expires_at>now() THEN 'reserved'
      WHEN r.status='confirmed' AND r.player_id IS NOT NULL THEN 'assigned'
      WHEN r.status='confirmed' THEN 'booked' ELSE 'available' END`;
    if (publicOnly) {
      // The public catalog is a booking surface, not an inventory or player
      // directory. Never disclose ticket grids/names for held or owned seats,
      // even when a caller supplies a crafted status filter.
      filters.push(`${projectedStatus}='available'`);
    } else if (wantedStatus) {
      params.push(wantedStatus);
      filters.push(`${projectedStatus}=$${params.length}`);
    }
    if (query) {
      params.push(query);
      filters.push(`(strpos(lower(t.serial),lower($${params.length}))>0 OR strpos(t.grid::text,$${params.length})>0)`);
    }
    const where = filters.join(" AND ");
    const count = await db.query(
      `SELECT count(*)::int AS total FROM session_tickets t JOIN game_sessions s USING(session_id)
       JOIN game_instances i USING(instance_id)
       LEFT JOIN ticket_reservation_items a ON a.ticket_id=t.ticket_id AND a.released_at IS NULL
       LEFT JOIN ticket_reservations r ON r.reservation_id=a.reservation_id
       WHERE ${where}`,
      params
    );
    const total = Number(count.rows[0]?.total || 0);
    const inventoryCount = publicOnly
      ? { rows: [{ total }] }
      : await db.query("SELECT count(*)::int AS total FROM session_tickets WHERE session_id=$1", [sessionId]);
    params.push(safePageSize, (safePage - 1) * safePageSize);
    const rows = await db.query(
      `SELECT t.ticket_id,t.serial,t.serial_ordinal,t.grid,t.sheet_id,sh.sheet_ordinal,t.sheet_position,${projectedStatus} AS inventory_status,
          CASE WHEN r.status='confirmed' THEN r.display_name ELSE NULL END AS player_name,
          CASE WHEN r.status IN ('held','confirmed') THEN r.reservation_id ELSE NULL END AS reservation_id,
          CASE WHEN r.status='held' AND r.expires_at>now() THEN r.expires_at ELSE NULL END AS reservation_expires_at
         FROM session_tickets t JOIN game_sessions s USING(session_id)
         JOIN game_instances i USING(instance_id)
       LEFT JOIN session_ticket_sheets sh ON sh.session_id=t.session_id AND sh.sheet_id=t.sheet_id
         LEFT JOIN ticket_reservation_items a ON a.ticket_id=t.ticket_id AND a.released_at IS NULL
         LEFT JOIN ticket_reservations r ON r.reservation_id=a.reservation_id
        WHERE ${where} ORDER BY t.serial_ordinal LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return {
      sessionId,
      page: safePage,
      pageSize: safePageSize,
      total,
      inventoryTotal: Number(inventoryCount.rows[0]?.total || 0),
      pageCount: Math.ceil(total / safePageSize),
      tickets: rows.rows.map((row) => publicTicket(row, { publicOnly })),
    };
  }

  async function listPublicCatalog({ sessionId, page, pageSize, search, status } = {}) {
    if (UUID_RE.test(String(sessionId || ""))) await expireStaleHolds(sessionId);
    return listInventory({ sessionId, page, pageSize, search, status, publicOnly: true });
  }

  async function listAdminInventory({ instanceId, sessionId, page, pageSize, search, status } = {}) {
    if (typeof instanceId !== "string" || !instanceId || !UUID_RE.test(String(sessionId || ""))) return null;
    const ownership = await db.query("SELECT 1 FROM game_sessions WHERE session_id=$1 AND instance_id=$2", [sessionId, instanceId]);
    if (!ownership.rowCount) return null;
    await expireStaleHolds(sessionId);
    return listInventory({ sessionId, page, pageSize, search, status });
  }

  async function allocateToReservation({ sessionId, reservationId, ticketIds, bookingMode = "random", actor = { type: "player", label: "player" }, client: transactionClient = null } = {}) {
    if (!UUID_RE.test(String(sessionId || "")) || !UUID_RE.test(String(reservationId || ""))) return { error: "RESERVATION_NOT_FOUND" };
    if (!Array.isArray(ticketIds) || ticketIds.length < 1 || ticketIds.length > 12 || ticketIds.some((id) => !UUID_RE.test(String(id))) || new Set(ticketIds).size !== ticketIds.length) return { error: "INVALID_TICKET_SELECTION" };
    if (!["random", "half", "full"].includes(bookingMode)) return { error: "INVALID_BOOKING_MODE" };
    return inTransaction(transactionClient, async (client) => {
      const lockedSession = await client.query("SELECT inventory_mode,inventory_state FROM game_sessions WHERE session_id=$1 FOR UPDATE", [sessionId]);
      if (!lockedSession.rowCount) return { error: "SESSION_NOT_FOUND" };
      if (lockedSession.rows[0].inventory_mode !== "numbered" || lockedSession.rows[0].inventory_state !== "ready") return { error: "INVENTORY_NOT_READY" };
      const booking = await client.query("SELECT * FROM ticket_reservations WHERE session_id=$1 AND reservation_id=$2 FOR UPDATE", [sessionId, reservationId]);
      const reservation = booking.rows[0];
      if (!reservation) return { error: "RESERVATION_NOT_FOUND" };
      if (reservation.status !== "held" || new Date(reservation.expires_at) <= new Date(now())) return { error: "RESERVATION_NOT_ACTIVE" };
      if (Number(reservation.ticket_count) !== ticketIds.length) return { error: "TICKET_COUNT_MISMATCH" };

      if (bookingMode !== "random") {
        const sheetTickets = await client.query(
          "SELECT ticket_id,sheet_id,sheet_position FROM session_tickets WHERE session_id=$1 AND ticket_id=ANY($2::uuid[])",
          [sessionId, ticketIds]
        );
        if (sheetTickets.rowCount !== ticketIds.length) return { error: "INVALID_TICKET_SELECTION" };
        const groups = new Map();
        for (const ticket of sheetTickets.rows) {
          if (!ticket.sheet_id || !Number.isInteger(Number(ticket.sheet_position))) return { error: "SHEET_SELECTION_INVALID" };
          const positions = groups.get(ticket.sheet_id) || [];
          positions.push(Number(ticket.sheet_position));
          groups.set(ticket.sheet_id, positions);
        }
        for (const positions of groups.values()) {
          positions.sort((left, right) => left - right);
          const isFull = positions.length === 6 && positions.every((position, index) => position === index + 1);
          const isHalf = positions.length === 3 && (
            positions.every((position, index) => position === index + 1)
            || positions.every((position, index) => position === index + 4)
          );
          if (bookingMode === "full" ? !isFull : bookingMode === "half" ? !isHalf : false) return { error: "SHEET_SELECTION_INVALID" };
        }
        if (bookingMode === "full" && ticketIds.length % 6 !== 0) return { error: "SHEET_SELECTION_INVALID" };
        if (bookingMode === "half" && ticketIds.length % 3 !== 0) return { error: "SHEET_SELECTION_INVALID" };
      }

      const stale = await client.query(
        `SELECT r.reservation_id,r.status FROM ticket_reservation_items a
          JOIN ticket_reservations r ON r.reservation_id=a.reservation_id
         WHERE a.session_id=$1 AND a.ticket_id=ANY($2::uuid[]) AND a.released_at IS NULL
           AND (r.status IN ('cancelled','expired') OR (r.status='held' AND r.expires_at<=$3))
         ORDER BY r.reservation_id FOR UPDATE OF r`, [sessionId, ticketIds, new Date(now())]
      );
      for (const staleReservation of stale.rows) {
        let releaseReason = staleReservation.status;
        if (staleReservation.status === "held") {
          const expired = await client.query(
            "UPDATE ticket_reservations SET status='expired' WHERE session_id=$1 AND reservation_id=$2 AND status='held' RETURNING ticket_count",
            [sessionId, staleReservation.reservation_id]
          );
          if (!expired.rowCount) continue;
          releaseReason = "expired";
          await client.query(
            `INSERT INTO ticket_reservation_audit(session_id,reservation_id,action,actor_type,actor_label,metadata)
             VALUES($1,$2,'hold.expire','system','system',$3)`,
            [sessionId, staleReservation.reservation_id, JSON.stringify({ ticketCount: Number(expired.rows[0].ticket_count), source: "inventory-allocation" })]
          );
        }
        const released = await client.query(
          `UPDATE ticket_reservation_items SET released_at=now(),release_reason=$3
            WHERE session_id=$1 AND reservation_id=$2 AND released_at IS NULL RETURNING ticket_id`, [sessionId, staleReservation.reservation_id, releaseReason]
        );
        for (const item of released.rows) await appendEvent(client, { sessionId, ticketId: item.ticket_id, reservationId: staleReservation.reservation_id, action: "released", actor: { type: "system", label: "system" }, metadata: { reason: releaseReason } });
      }

      const current = await client.query("SELECT ticket_id FROM ticket_reservation_items WHERE reservation_id=$1 AND released_at IS NULL ORDER BY ticket_id", [reservationId]);
      if (current.rowCount) {
        const requested = ticketIds.slice().sort();
        const allocated = current.rows.map((row) => row.ticket_id).sort();
        if (requested.length === allocated.length && requested.every((id, index) => id === allocated[index])) {
          return { sessionId, reservationId, ticketIds: allocated, idempotent: true };
        }
        return { error: "RESERVATION_ALREADY_ALLOCATED" };
      }

      const selected = await client.query(
        `SELECT t.ticket_id,t.serial FROM session_tickets t
          WHERE t.session_id=$1 AND t.ticket_id=ANY($2::uuid[])
          ORDER BY t.serial_ordinal FOR UPDATE`, [sessionId, ticketIds]
      );
      if (selected.rowCount !== ticketIds.length) return { error: "TICKET_NOT_FOUND" };
      const unavailable = await client.query(
        `SELECT t.ticket_id FROM session_tickets t JOIN ticket_reservation_items a ON a.ticket_id=t.ticket_id AND a.released_at IS NULL
          JOIN ticket_reservations r ON r.reservation_id=a.reservation_id
         WHERE t.session_id=$1 AND t.ticket_id=ANY($2::uuid[])
           AND (r.status='confirmed' OR (r.status='held' AND r.expires_at>now()))
         FOR UPDATE OF a`, [sessionId, ticketIds]
      );
      if (unavailable.rowCount) return { error: "TICKET_UNAVAILABLE", ticketIds: unavailable.rows.map((row) => row.ticket_id) };

      const who = actorShape(actor);
      for (const row of selected.rows) {
        await client.query(
          `INSERT INTO ticket_reservation_items(allocation_id,session_id,reservation_id,ticket_id)
           VALUES($1,$2,$3,$4)`, [randomUUID(), sessionId, reservationId, row.ticket_id]
        );
        await appendEvent(client, { sessionId, ticketId: row.ticket_id, reservationId, action: "reserved", actor: who, metadata: { serial: row.serial } });
      }
      return { sessionId, reservationId, ticketIds: selected.rows.map((row) => row.ticket_id), idempotent: false };
    });
  }

  async function markReservationEvent({ sessionId, reservationId, action, actor = { type: "system", label: "system" }, client: transactionClient = null } = {}) {
    if (!new Set(["confirmed", "assigned", "issued"]).has(action)) return { error: "INVALID_INVENTORY_ACTION" };
    return inTransaction(transactionClient, async (client) => {
      await client.query("SELECT session_id FROM game_sessions WHERE session_id=$1 FOR UPDATE", [sessionId]);
      const found = await client.query(
        `SELECT r.*,s.inventory_mode,s.inventory_state FROM ticket_reservations r JOIN game_sessions s USING(session_id)
          WHERE r.session_id=$1 AND r.reservation_id=$2 FOR UPDATE OF r`, [sessionId, reservationId]
      );
      const reservation = found.rows[0];
      if (!reservation) return { error: "RESERVATION_NOT_FOUND" };
      if (reservation.inventory_mode !== "numbered" || reservation.inventory_state !== "ready") return { error: "INVENTORY_NOT_READY" };
      if (action === "confirmed" && reservation.status !== "confirmed") return { error: "RESERVATION_NOT_CONFIRMED" };
      if ((action === "assigned" || action === "issued") && (reservation.status !== "confirmed" || !reservation.player_id)) return { error: "RESERVATION_NOT_ASSIGNED" };
      const items = await client.query("SELECT ticket_id FROM ticket_reservation_items WHERE session_id=$1 AND reservation_id=$2 AND released_at IS NULL ORDER BY ticket_id FOR UPDATE", [sessionId, reservationId]);
      if (!items.rowCount) return { error: "NO_ALLOCATED_TICKETS" };
      const who = actorShape(actor);
      let appended = false;
      for (const item of items.rows) {
        const duplicate = await client.query("SELECT 1 FROM session_ticket_events WHERE session_id=$1 AND ticket_id=$2 AND reservation_id=$3 AND action=$4 LIMIT 1", [sessionId, item.ticket_id, reservationId, action]);
        if (!duplicate.rowCount) { await appendEvent(client, { sessionId, ticketId: item.ticket_id, reservationId, action, actor: who }); appended = true; }
      }
      return { sessionId, reservationId, ticketIds: items.rows.map((item) => item.ticket_id), action, idempotent: !appended };
    });
  }

  async function releaseReservation({ sessionId, reservationId, reason, actor = { type: "system", label: "system" }, client: transactionClient = null } = {}) {
    if (!new Set(["cancelled", "expired"]).has(reason)) return { error: "INVALID_RELEASE_REASON" };
    return inTransaction(transactionClient, async (client) => {
      await client.query("SELECT session_id FROM game_sessions WHERE session_id=$1 FOR UPDATE", [sessionId]);
      const found = await client.query("SELECT status FROM ticket_reservations WHERE session_id=$1 AND reservation_id=$2 FOR UPDATE", [sessionId, reservationId]);
      if (!found.rowCount) return { error: "RESERVATION_NOT_FOUND" };
      if (found.rows[0].status !== reason) return { error: "RESERVATION_STATE_MISMATCH" };
      const released = await client.query(
        `UPDATE ticket_reservation_items SET released_at=now(),release_reason=$3
          WHERE session_id=$1 AND reservation_id=$2 AND released_at IS NULL RETURNING ticket_id`, [sessionId, reservationId, reason]
      );
      const who = actorShape(actor);
      for (const item of released.rows) await appendEvent(client, { sessionId, ticketId: item.ticket_id, reservationId, action: "released", actor: who, metadata: { reason } });
      const historical = released.rowCount ? released.rows : (await client.query(
        "SELECT ticket_id FROM ticket_reservation_items WHERE session_id=$1 AND reservation_id=$2 AND release_reason=$3 ORDER BY ticket_id", [sessionId, reservationId, reason]
      )).rows;
      return { sessionId, reservationId, releasedTicketIds: historical.map((item) => item.ticket_id), idempotent: released.rowCount === 0 };
    });
  }

  return { generateForSession, listPublicCatalog, listAdminInventory, listReservationTickets, allocateToReservation, markReservationEvent, releaseReservation };
}

export { MAX_INVENTORY, ticketFingerprint };
