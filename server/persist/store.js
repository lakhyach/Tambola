/**
 * Durable game state. The only module that writes game rows, and the only
 * module that reads them for recovery.
 *
 * It knows SQL and nothing about sockets; the engine knows rules and nothing
 * about SQL. persist/controller.js is what puts the two together.
 *
 * Concurrency contract
 *  - every write is one transaction; a failure leaves no partial row
 *  - calls lock their games row, so two schedulers cannot both append to the
 *    same position, and the (room_code, game_number, call_index) primary key
 *    makes a duplicate call impossible even if a lock were missed
 *  - awards take a transaction-scoped advisory lock on the pattern, count the
 *    existing winners inside that lock and insert the next ordinal, with the
 *    partial unique index on winner_ordinal = 1 as the hard backstop
 *  - reads used for recovery are single consistent snapshots
 *
 * Idempotency: recordCall and recordAward both return a clean conflict shape
 * instead of throwing on a replay, so a retried request can never double-write.
 */

import { createHash } from "node:crypto";
import { IntegrityError } from "../game/engine.js";

/** Postgres error codes this module translates into game answers. */
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

function isUniqueError(error) {
  return error && (error.code === UNIQUE_VIOLATION || error.cause?.code === UNIQUE_VIOLATION);
}

function safeBookingHash(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

function safeHashEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

/** 90 numbers, positions 1..90 - the shape the engine's draw must have. */
const DRAW_LENGTH = 90;

export function createStore({ db, log = () => {} } = {}) {
  if (!db) throw new Error("createStore() needs a database handle");

  const json = (value) => JSON.stringify(value === undefined ? null : value);
  const atOf = (millis) => (Number.isFinite(millis) ? new Date(millis) : new Date());

  async function audit(client, { roomId, gameNumber = null, playerId = null, type, detail = {}, at } = {}) {
    const runner = client || db;
    await runner.query(
      `INSERT INTO audit_events (room_code, game_number, player_id, type, detail, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [roomId, gameNumber, playerId, type, json(detail), atOf(at)]
    );
  }

  // ------------------------------------------------------------- rooms & seats

  /** Rooms are created durable-first: no ack until the row exists. */
  async function createRoom({ roomId, config, host, instanceId = "regular", transactionClient = null } = {}) {
    if (!roomId) throw new Error("createRoom needs a room id");
    if (!host || !host.playerId) throw new Error("createRoom needs a host participant");
    const persist = async (client) => {
      await client.query("INSERT INTO players (player_id, display_name) VALUES ($1, $2)", [host.playerId, host.name]);
      await client.query(
        "INSERT INTO rooms (room_code, status, game_number, host_player_id, config, game_instance_id) VALUES ($1, 'WAITING', 0, $2, $3, $4)",
        [roomId, host.playerId, json(config || {}), instanceId]
      );
      await client.query(
        "INSERT INTO room_members (room_code, player_id, role, connected) VALUES ($1, $2, 'host', $3)",
        [roomId, host.playerId, Boolean(host.connected)]
      );
      await audit(client, { roomId, playerId: host.playerId, type: "room-created", detail: { config } });
    };
    if (transactionClient) await persist(transactionClient);
    else await db.withTransaction(persist);
    return { roomId };
  }

  async function instanceStatusForRoom({ roomId } = {}) {
    const result = await db.query(`SELECT i.status FROM rooms r JOIN game_instances i ON i.instance_id=r.game_instance_id WHERE r.room_code=$1`, [roomId]);
    return result.rows[0]?.status || null;
  }

  async function instanceSlugForRoom({ roomId } = {}) {
    const result = await db.query(`SELECT i.slug FROM rooms r JOIN game_instances i ON i.instance_id=r.game_instance_id WHERE r.room_code=$1`, [roomId]);
    return result.rows[0]?.slug || null;
  }

  async function instanceStatus({ instanceId } = {}) {
    const result = await db.query("SELECT status FROM game_instances WHERE instance_id=$1", [instanceId]);
    return result.rows[0]?.status || null;
  }

  async function instanceRoomDefaults({ instanceId } = {}) {
    const result = await db.query("SELECT config->'roomDefaults' AS room_defaults FROM game_instances WHERE instance_id=$1", [instanceId]);
    return result.rows[0]?.room_defaults || {};
  }

  async function publicInstanceIdBySlug({ slug } = {}) {
    const result = await db.query(
      "SELECT instance_id FROM game_instances WHERE slug=$1 AND status='active' AND public_visible=true",
      [slug]
    );
    return result.rows[0]?.instance_id || null;
  }

  async function themeVersionForInstance({ instanceId } = {}) {
    const result = await db.query(`SELECT CASE
      WHEN i.theme_mode='fixed' THEN i.theme_version_id
      WHEN i.theme_mode='latest' THEN (SELECT p.theme_version_id FROM theme_publications p
        JOIN theme_versions v USING(theme_version_id) JOIN theme_catalog c USING(theme_id)
        WHERE c.status='approved' ORDER BY p.published_at DESC,p.publication_id DESC LIMIT 1)
      ELSE s.active_version_id END AS theme_version_id
      FROM game_instances i CROSS JOIN platform_theme_state s
      WHERE i.instance_id=$1 AND s.singleton=true`, [instanceId]);
    return result.rows[0]?.theme_version_id || null;
  }

  async function addParticipant({ roomId, playerId, name, connected = true } = {}) {
    const created = await db.withTransaction(async (client) => {
      await client.query(
        "INSERT INTO players (player_id, display_name) VALUES ($1, $2) ON CONFLICT (player_id) DO NOTHING",
        [playerId, name]
      );
      const result = await client.query(
        `INSERT INTO room_members (room_code, player_id, role, connected, last_seen_at)
         VALUES ($1, $2, 'player', $3, now())
         ON CONFLICT (room_code, player_id) DO UPDATE
           SET connected = EXCLUDED.connected, last_seen_at = now(), left_at = NULL
         RETURNING room_code`,
        [roomId, playerId, connected]
      );
      await audit(client, { roomId, playerId, type: "join", detail: { name } });
      return result.rows.length > 0;
    });
    return { ok: true, registered: created };
  }

  async function bookingSessionForRoom({ roomId } = {}) {
    const result = await db.query(
      `SELECT s.session_id,s.instance_id,s.status,s.starts_at,s.booking_closes_at,r.game_instance_id,r.status AS room_status,r.game_number,i.status AS instance_status,
              EXISTS(SELECT 1 FROM games g WHERE g.room_code=r.room_code AND g.game_number=r.game_number AND g.status='RUNNING') AS has_running_game
         FROM game_sessions s JOIN rooms r ON r.room_code=s.room_code
         JOIN game_instances i ON i.instance_id=s.instance_id
        WHERE s.room_code=$1`, [roomId]
    );
    return result.rows[0] || null;
  }

  async function reservationForRoomJoin({ roomId, reservationId, bookingToken } = {}) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(reservationId || "")) || !/^[a-f0-9]{64}$/.test(String(bookingToken || ""))) return null;
    const result = await db.query(
      `SELECT r.reservation_id,r.session_id,r.display_name,r.ticket_count,r.booking_token_hash,
              s.instance_id,s.status AS session_status,s.starts_at,s.inventory_mode,s.inventory_state,i.status AS instance_status,
              room.status AS room_status,room.game_number
         FROM ticket_reservations r
         JOIN game_sessions s ON s.session_id=r.session_id
         JOIN game_instances i ON i.instance_id=s.instance_id
         JOIN rooms room ON room.room_code=s.room_code
        WHERE r.reservation_id=$1 AND s.room_code=$2 AND r.status='confirmed'
          AND r.player_id IS NULL AND s.status='open' AND i.status='active'
          AND ((room.status='WAITING' AND room.game_number=0 AND s.starts_at>now())
            OR (room.status IN ('RUNNING','PAUSED') AND room.game_number>0
              AND EXISTS(SELECT 1 FROM games g WHERE g.room_code=room.room_code AND g.game_number=room.game_number AND g.status='RUNNING')))
          AND r.booking_token_hash=$3`,
      [reservationId, roomId, safeBookingHash(bookingToken)]
    );
    const row = result.rows[0];
    if (!row || !safeHashEqual(row.booking_token_hash, safeBookingHash(bookingToken))) return null;
    let tickets = [];
    if (row.inventory_mode === "numbered") {
      if (row.inventory_state !== "ready") return null;
      const inventory = await db.query(
        `SELECT st.ticket_id,st.serial,st.serial_ordinal,st.grid,a.released_at
           FROM ticket_reservation_items a JOIN session_tickets st
             ON st.session_id=a.session_id AND st.ticket_id=a.ticket_id
          WHERE a.session_id=$1 AND a.reservation_id=$2 ORDER BY st.serial_ordinal`,
        [row.session_id, row.reservation_id]
      );
      if (inventory.rows.length !== Number(row.ticket_count) || inventory.rows.some((ticket) => ticket.released_at)) return null;
      tickets = inventory.rows.map((ticket) => ({
        inventoryTicketId: ticket.ticket_id,
        serial: ticket.serial,
        serialOrdinal: Number(ticket.serial_ordinal),
        grid: ticket.grid,
      }));
    }
    return {
      reservationId: row.reservation_id,
      displayName: row.display_name,
      ticketCount: Number(row.ticket_count),
      sessionId: row.session_id,
      inventoryMode: row.inventory_mode || "legacy",
      tickets,
    };
  }

  async function addParticipantFromBooking({ roomId, playerId, name, connected = true, reservationId, bookingToken, expectedTicketIds = [], tickets = [] } = {}) {
    const hash = safeBookingHash(bookingToken);
    try {
      return await db.withTransaction(async (client) => {
        const reservation = await client.query(
          `SELECT r.*,s.status AS session_status,s.starts_at,i.status AS instance_status,
                  room.status AS room_status,room.game_number,s.room_code AS session_room,
                  s.inventory_mode,s.inventory_state,
                  EXISTS(SELECT 1 FROM games g WHERE g.room_code=room.room_code AND g.game_number=room.game_number AND g.status='RUNNING') AS has_running_game
             FROM ticket_reservations r JOIN game_sessions s ON s.session_id=r.session_id
             JOIN game_instances i ON i.instance_id=s.instance_id JOIN rooms room ON room.room_code=s.room_code
            WHERE r.reservation_id=$1 AND s.room_code=$2 FOR UPDATE OF r,s,room`, [reservationId, roomId]
        );
        const row = reservation.rows[0];
        const waitingRoom = row?.room_status === "WAITING" && Number(row.game_number) === 0 && new Date(row.starts_at) > new Date();
        const runningRoom = ["RUNNING", "PAUSED"].includes(row?.room_status) && Number(row.game_number) > 0 && row.has_running_game;
        if (!row || !safeHashEqual(row.booking_token_hash, hash) || row.status !== "confirmed" || row.player_id ||
            row.session_status !== "open" || row.instance_status !== "active" || (!waitingRoom && !runningRoom)) {
          return { ok: false, code: "RESERVATION_NOT_FOUND", error: "that confirmed booking is not available for this room" };
        }
        if (runningRoom) {
          const currentGame = await client.query(
            "SELECT 1 FROM games WHERE room_code=$1 AND game_number=$2 AND status='RUNNING' FOR UPDATE",
            [roomId, Number(row.game_number)]
          );
          if (!currentGame.rowCount) return { ok: false, code: "SESSION_UNAVAILABLE", error: "this game is no longer accepting booked players" };
        }
        if (name !== row.display_name) return { ok: false, code: "RESERVATION_NOT_FOUND", error: "that confirmed booking is not available for this room" };
        let inventoryTickets = [];
        if (row.inventory_mode === "numbered") {
          if (row.inventory_state !== "ready") return { ok: false, code: "TICKET_INVENTORY_INCOMPLETE", error: "the booked ticket inventory is not ready" };
          const allocated = await client.query(
            `SELECT st.ticket_id,st.serial,st.serial_ordinal,st.grid,a.released_at
               FROM ticket_reservation_items a JOIN session_tickets st
                 ON st.session_id=a.session_id AND st.ticket_id=a.ticket_id
              WHERE a.session_id=$1 AND a.reservation_id=$2
              ORDER BY st.serial_ordinal FOR UPDATE OF a,st`,
            [row.session_id, reservationId]
          );
          const expected = Array.isArray(expectedTicketIds) ? expectedTicketIds.map(String).map((id) => id.toLowerCase()).sort() : [];
          const actual = allocated.rows.map((ticket) => String(ticket.ticket_id).toLowerCase()).sort();
          if (allocated.rows.length !== Number(row.ticket_count) || allocated.rows.some((ticket) => ticket.released_at) ||
              expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) {
            return { ok: false, code: "TICKET_INVENTORY_INCOMPLETE", error: "the booked ticket inventory no longer matches this reservation" };
          }
          inventoryTickets = allocated.rows.map((ticket) => ({
            inventoryTicketId: ticket.ticket_id,
            serial: ticket.serial,
            serialOrdinal: Number(ticket.serial_ordinal),
            grid: ticket.grid,
          }));
        } else if (expectedTicketIds?.length) {
          return { ok: false, code: "TICKET_INVENTORY_INCOMPLETE", error: "a legacy booking cannot carry numbered inventory tickets" };
        }
        await client.query("INSERT INTO players(player_id,display_name) VALUES($1,$2)", [playerId, name]);
        await client.query(
          `UPDATE ticket_reservations SET player_id=$2,room_code=$3 WHERE reservation_id=$1 AND status='confirmed' AND player_id IS NULL`,
          [reservationId, playerId, roomId]
        );
        await client.query(
          `INSERT INTO room_members(room_code,player_id,role,connected,last_seen_at,ticket_count,booking_reservation_id)
           VALUES($1,$2,'player',$3,now(),$4,$5)`, [roomId, playerId, connected, Number(row.ticket_count), reservationId]
        );
        if (runningRoom) {
          if (!Array.isArray(tickets) || tickets.length !== Number(row.ticket_count)) {
            throw new IntegrityError("late booked seat has an incomplete live ticket set", { roomId, playerId });
          }
          const assignedById = new Map(inventoryTickets.map((ticket) => [ticket.inventoryTicketId, ticket]));
          for (const [index, ticket] of tickets.entries()) {
            const assigned = ticket.inventoryTicketId ? assignedById.get(ticket.inventoryTicketId) : null;
            if (row.inventory_mode === "numbered" && (!assigned || JSON.stringify(assigned.grid) !== JSON.stringify(ticket.grid))) {
              throw new IntegrityError("late booked seat tickets disagree with its confirmed inventory", { roomId, playerId });
            }
            if (row.inventory_mode !== "numbered" && (ticket.inventoryTicketId || ticket.inventorySessionId || ticket.inventoryReservationId)) {
              throw new IntegrityError("legacy late booked seat contains numbered inventory identity", { roomId, playerId });
            }
            await client.query(
              `INSERT INTO tickets(room_code,game_number,player_id,ticket_no,grid,inventory_session_id,inventory_reservation_id,inventory_ticket_id)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
              [roomId, Number(row.game_number), playerId, ticket.ticketNo || index + 1, json(ticket.grid),
                ticket.inventorySessionId || null, ticket.inventoryReservationId || null, ticket.inventoryTicketId || null]
            );
            if (ticket.inventoryTicketId) await client.query(
              `INSERT INTO session_ticket_events(session_id,ticket_id,reservation_id,action,actor_type,actor_label,metadata)
               VALUES($1,$2,$3,'issued','system','game-engine',$4)`,
              [row.session_id, ticket.inventoryTicketId, reservationId, json({ roomCode: roomId, gameNumber: Number(row.game_number), ticketNo: ticket.ticketNo || index + 1 })]
            );
          }
        }
        await audit(client, { roomId, playerId, type: "join", detail: { name, reservationId, ticketCount: Number(row.ticket_count) } });
        await client.query(
          `INSERT INTO ticket_reservation_audit(session_id,reservation_id,action,actor_type,actor_label,metadata)
           VALUES($1,$2,'hold.assign','player',$3,$4)`,
          [row.session_id, reservationId, name, JSON.stringify({ ticketCount: Number(row.ticket_count), roomCode: roomId })]
        );
        const gameNumber = runningRoom ? Number(row.game_number) : null;
        await audit(client, { roomId, gameNumber, playerId, type: "tickets-booked", detail: { count: Number(row.ticket_count), booking: true } });
        await audit(client, {
          roomId, gameNumber, playerId,
          type: row.inventory_mode === "numbered" ? "inventory-tickets-assigned" : "tickets-selected",
          detail: { count: Number(row.ticket_count), booking: true },
        });
        return { ok: true, registered: true, ticketCount: Number(row.ticket_count), inventoryTickets };
      });
    } catch (error) {
      if (isUniqueError(error)) return { ok: false, code: "RESERVATION_NOT_FOUND", error: "that confirmed booking is not available for this room" };
      throw error;
    }
  }

  async function bookedTicketCount({ roomId, playerId } = {}) {
    const result = await db.query(
      `SELECT m.ticket_count FROM room_members m WHERE m.room_code=$1 AND m.player_id=$2 AND m.booking_reservation_id IS NOT NULL`,
      [roomId, playerId]
    );
    return result.rowCount ? Number(result.rows[0].ticket_count) : null;
  }

  /**
   * Projection of live socket state. Not a game rule: it is false for every
   * seat after a boot, and the session layer flips it as sockets arrive.
   */
  async function markSeat({ roomId, playerId, connected, seen = true } = {}) {
    await db.query(
      `UPDATE room_members
          SET connected = $3, last_seen_at = CASE WHEN $4 THEN now() ELSE last_seen_at END
        WHERE room_code = $1 AND player_id = $2 AND left_at IS NULL`,
      [roomId, playerId, Boolean(connected), seen]
    );
    return { ok: true };
  }

  /**
   * A seat vacates. The row survives (left_at) so the tickets and awards that
   * player earned stay attached to the room's history.
   */
  async function markSeatLeft({ roomId, playerId, reason = "left", actorPlayerId = null, actorRole = null } = {}) {
    await db.withTransaction(async (client) => {
      await client.query(
        "UPDATE room_members SET left_at = now(), connected = false WHERE room_code = $1 AND player_id = $2",
        [roomId, playerId]
      );
      await client.query(
        `UPDATE sessions SET revoked_at = now(), revoke_reason = $3
          WHERE room_code = $1 AND player_id = $2 AND revoked_at IS NULL`,
        [roomId, playerId, reason]
      );
      await audit(client, { roomId, playerId, type: "left", detail: { reason, ...(actorPlayerId ? { actorPlayerId, actorRole } : {}) } });
    });
    return { ok: true };
  }

  async function setHost({ roomId, playerId } = {}) {
    await db.withTransaction(async (client) => {
      await client.query("UPDATE rooms SET host_player_id = $2 WHERE room_code = $1", [roomId, playerId]);
      await client.query(
        "UPDATE room_members SET role = 'host' WHERE room_code = $1 AND player_id = $2",
        [roomId, playerId]
      );
      await audit(client, { roomId, playerId, type: "host-set", detail: {} });
    });
    return { ok: true };
  }

  async function saveConfig({ roomId, config } = {}) {
    await db.query("UPDATE rooms SET config = $2 WHERE room_code = $1", [roomId, json(config)]);
    return { ok: true };
  }

  /**
   * Remember a seat's chosen ticket count before the round starts. Only the
   * count is durable while WAITING (there is no games row to hang grids on);
   * start() re-mints the actual tickets to this number.
   */
  async function setTicketCount({ roomId, playerId, count } = {}) {
    const safe = Number(count);
    if (!Number.isInteger(safe) || safe < 1 || safe > 10000) {
      return { ok: false, code: "BAD_PAYLOAD", error: "ticket count is outside the supported range" };
    }
    const result = await db.query(
      `UPDATE room_members SET ticket_count=$3 WHERE room_code=$1 AND player_id=$2
        AND (booking_reservation_id IS NULL OR ticket_count=$3) RETURNING player_id`,
      [roomId, playerId, safe]
    );
    return result.rowCount ? { ok: true } : { ok: false, code: "BOOKING_TICKET_COUNT_LOCKED", error: "ticket count is fixed by the confirmed reservation" };
  }

  /**
   * Compare-and-set on the lifecycle state. Returns false when the room is not
   * in the state the caller believed it was, which is how two hosts pressing
   * the same button at the same moment resolve to one winner.
   */
  async function setStatus({ roomId, from, to } = {}) {
    const result = await db.query(
      `UPDATE rooms SET status = $3
        WHERE room_code = $1 AND closed_at IS NULL AND ($2::text IS NULL OR status = $2)
        RETURNING room_code`,
      [roomId, from || null, to]
    );
    return { ok: result.rows.length > 0, moved: result.rows.length > 0 };
  }

  /** Closing is a soft delete: history stays queryable forever. */
  async function closeRoom({ roomId, reason = "room closed" } = {}) {
    await db.withTransaction(async (client) => {
      await client.query("UPDATE rooms SET closed_at = now() WHERE room_code = $1 AND closed_at IS NULL", [roomId]);
      await client.query(
        `UPDATE sessions SET revoked_at = now(), revoke_reason = 'room-closed'
          WHERE room_code = $1 AND revoked_at IS NULL`,
        [roomId]
      );
      await client.query("UPDATE room_members SET connected = false WHERE room_code = $1", [roomId]);
      await audit(client, { roomId, type: "room-closed", detail: { reason } });
    });
    return { ok: true };
  }

  /** A frozen room refuses every intent until an operator clears the note. */
  async function setRecoveryError({ roomId, error } = {}) {
    await db.query("UPDATE rooms SET recovery_error = $2 WHERE room_code = $1", [roomId, error || null]);
    await audit(null, {
      roomId,
      type: error ? "recovery-failed" : "recovery-cleared",
      detail: { error: error || null },
    });
    return { ok: true };
  }

  // --------------------------------------------------------------------- games

  /**
   * A game starts as one transaction: the room moves to RUNNING, the private
   * draw plan is written, and every seat's ticket is written with it. Either
   * all of that is durable or none of it is, so a crash can never leave a room
   * "running" with half its tickets.
   */
  async function startGame({ roomId, gameNumber, drawSequence, tickets = [], ticketCounts = [], config, startSource = "host", scheduledStart = null } = {}) {
    if (!Array.isArray(drawSequence) || drawSequence.length !== DRAW_LENGTH) {
      throw new IntegrityError("refusing to persist a draw that is not 90 numbers", { roomId });
    }
    if (!["host", "scheduled"].includes(startSource) || (startSource === "scheduled" && (!scheduledStart?.sessionId || !scheduledStart?.claimToken))) {
      const error = new Error("invalid game start source"); error.code = "SCHEDULED_START_INVALID"; throw error;
    }
    const result = await db.withTransaction(async (client) => {
      let scheduledAt = null;
      if (startSource === "scheduled") {
        const session = await client.query(
          `SELECT s.starts_at,s.room_code
             FROM game_sessions s JOIN game_instances i ON i.instance_id=s.instance_id
            WHERE s.session_id=$1 AND s.room_code=$2 AND s.auto_start_enabled
              AND s.status='open' AND s.auto_start_state='starting'
              AND s.auto_start_claim_token=$3 AND s.auto_start_claimed_until>clock_timestamp()
              AND s.starts_at<=clock_timestamp() AND i.status='active'
            FOR UPDATE OF s`,
          [scheduledStart.sessionId, roomId, scheduledStart.claimToken]
        );
        if (!session.rowCount) {
          const error = new Error("scheduled start is not due or no longer owns its database claim");
          error.code = "SCHEDULED_START_CLAIM_LOST"; throw error;
        }
        scheduledAt = session.rows[0].starts_at;
      } else {
        const reserved = await client.query(
          "SELECT 1 FROM game_sessions WHERE room_code=$1 AND auto_start_enabled AND status NOT IN ('cancelled','completed') FOR UPDATE",
          [roomId]
        );
        if (reserved.rowCount) {
          const error = new Error("this room is reserved for its scheduled automatic start");
          error.code = "AUTO_START_RESERVED"; throw error;
        }
      }
      const moved = await client.query(
        `UPDATE rooms SET status = 'RUNNING', game_number = $2, config = COALESCE($3, config)
          WHERE room_code = $1 AND closed_at IS NULL AND status = 'WAITING'
          RETURNING room_code`,
        [roomId, gameNumber, config ? json(config) : null]
      );
      if (!moved.rows.length) {
        const error = new Error("room is not in WAITING");
        error.code = "INVALID_TRANSITION";
        throw error;
      }
      const insertedGame = await client.query(
        `INSERT INTO games (room_code, game_number, status, draw_sequence, start_source, scheduled_for)
         VALUES ($1, $2, 'RUNNING', $3, $4, $5) RETURNING started_at`,
        [roomId, gameNumber, json(drawSequence), startSource, scheduledAt]
      );
      for (const entry of ticketCounts) {
        const count = Number(entry.count);
        if (!Number.isInteger(count) || count < 1 || count > 10000) {
          throw new IntegrityError("refusing to persist an unsupported ticket count", { roomId, playerId: entry.playerId });
        }
        await client.query(
          "UPDATE room_members SET ticket_count = $3 WHERE room_code = $1 AND player_id = $2",
          [roomId, entry.playerId, count]
        );
      }
      const bookingSeats = await client.query(
        `SELECT m.player_id,m.ticket_count,r.reservation_id,r.session_id,s.inventory_mode
           FROM room_members m
           LEFT JOIN ticket_reservations r ON r.reservation_id=m.booking_reservation_id
           LEFT JOIN game_sessions s ON s.session_id=r.session_id
          WHERE m.room_code=$1`,
        [roomId]
      );
      const seatsByPlayer = new Map(bookingSeats.rows.map((seat) => [seat.player_id, seat]));
      const inventoryTicketsByPlayer = new Map();
      for (const ticket of tickets) {
        const seat = seatsByPlayer.get(ticket.playerId);
        if (!seat) throw new IntegrityError("game ticket has no durable room seat", { roomId, playerId: ticket.playerId });
        if (seat.inventory_mode === "numbered") {
          if (!ticket.inventoryTicketId || ticket.inventorySessionId !== seat.session_id || ticket.inventoryReservationId !== seat.reservation_id) {
            throw new IntegrityError("numbered booking ticket is missing its exact inventory identity", { roomId, playerId: ticket.playerId });
          }
          const ids = inventoryTicketsByPlayer.get(ticket.playerId) || [];
          ids.push(ticket.inventoryTicketId);
          inventoryTicketsByPlayer.set(ticket.playerId, ids);
        } else if (ticket.inventoryTicketId || ticket.inventorySessionId || ticket.inventoryReservationId) {
          throw new IntegrityError("legacy room ticket unexpectedly carries numbered inventory identity", { roomId, playerId: ticket.playerId });
        }
      }
      for (const seat of bookingSeats.rows) {
        if (seat.inventory_mode !== "numbered") continue;
        const assigned = await client.query(
          `SELECT st.ticket_id,st.serial_ordinal,st.grid,a.released_at
             FROM ticket_reservation_items a JOIN session_tickets st
               ON st.session_id=a.session_id AND st.ticket_id=a.ticket_id
            WHERE a.session_id=$1 AND a.reservation_id=$2 ORDER BY st.serial_ordinal FOR UPDATE OF a,st`,
          [seat.session_id, seat.reservation_id]
        );
        const issuedIds = inventoryTicketsByPlayer.get(seat.player_id) || [];
        const expectedIds = assigned.rows.map((row) => row.ticket_id);
        if (assigned.rows.length !== Number(seat.ticket_count) || assigned.rows.some((row) => row.released_at) ||
            issuedIds.length !== expectedIds.length || expectedIds.some((id) => !issuedIds.includes(id)) ||
            new Set(issuedIds).size !== issuedIds.length) {
          throw new IntegrityError("game start ticket set does not match the confirmed durable inventory", { roomId, playerId: seat.player_id });
        }
      }
      for (const ticket of tickets) {
        await client.query(
          `INSERT INTO tickets
             (room_code,game_number,player_id,ticket_no,grid,inventory_session_id,inventory_reservation_id,inventory_ticket_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [roomId, gameNumber, ticket.playerId, ticket.ticketNo || 1, json(ticket.grid),
            ticket.inventorySessionId, ticket.inventoryReservationId, ticket.inventoryTicketId]
        );
        if (ticket.inventoryTicketId) {
          await client.query(
            `INSERT INTO session_ticket_events(session_id,ticket_id,reservation_id,action,actor_type,actor_label,metadata)
             VALUES($1,$2,$3,'issued','system','game-engine',$4)`,
            [ticket.inventorySessionId,ticket.inventoryTicketId,ticket.inventoryReservationId,json({roomCode:roomId,gameNumber,ticketNo:ticket.ticketNo||1})]
          );
        }
      }
      const actualStartedAt = insertedGame.rows[0].started_at;
      if (startSource === "scheduled") {
        const marked = await client.query(
          `UPDATE game_sessions SET auto_start_state='started',auto_started_at=$3,
                auto_start_claim_token=NULL,auto_start_claimed_until=NULL,auto_start_retry_at=NULL,auto_start_error=NULL
            WHERE session_id=$1 AND auto_start_claim_token=$2 AND auto_start_state='starting'
            RETURNING session_id`,
          [scheduledStart.sessionId, scheduledStart.claimToken, actualStartedAt]
        );
        if (!marked.rowCount) {
          const error = new Error("scheduled start claim changed during game transition");
          error.code = "SCHEDULED_START_CLAIM_LOST"; throw error;
        }
      } else {
        await client.query(
          `UPDATE game_sessions SET auto_start_state='started',auto_started_at=$2,
                auto_start_claim_token=NULL,auto_start_claimed_until=NULL,auto_start_retry_at=NULL,auto_start_error=NULL
            WHERE room_code=$1 AND auto_start_enabled AND status='open' AND auto_start_state<>'started'`,
          [roomId, actualStartedAt]
        );
      }
      await audit(client, { roomId, gameNumber, type: "start", detail: {
        players: ticketCounts.length, tickets: tickets.length, source: startSource,
        ...(scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString(), actualStartedAt: new Date(actualStartedAt).toISOString() } : {}),
      } });
      return { ok: true, gameNumber, startedAt: actualStartedAt, scheduledAt };
    });
    return result;
  }

  async function completeGame({ roomId, gameNumber, reason = "ended" } = {}) {
    await db.withTransaction(async (client) => {
      await client.query(
        `UPDATE games SET status = 'COMPLETED', completed_at = now(), end_reason = $3
          WHERE room_code = $1 AND game_number = $2 AND status = 'RUNNING'`,
        [roomId, gameNumber, reason]
      );
      await client.query(
        `UPDATE game_sessions SET status='completed',auto_start_state='completed',
              auto_start_claim_token=NULL,auto_start_claimed_until=NULL
          WHERE room_code=$1 AND auto_start_enabled AND status IN ('open','paused')`,
        [roomId]
      );
      await audit(client, { roomId, gameNumber, type: "completed", detail: { reason } });
    });
    return { ok: true };
  }

  // ---------------------------------------------------------------- draw calls

  /**
   * Write the next official call. The number comes from the stored draw plan,
   * read under a row lock, so this is the only place a number is chosen once
   * durability is on.
   *
   * Returns:
   *   { ok: true,  number, index, calledAt, completed }   the call is durable
   *   { ok: true,  duplicate: true, ... }                 somebody else already
   *                                                      committed this tick
   *   { ok: false, code }                                 refused
   */
  async function recordCall({ roomId, gameNumber, expectedIndex, source = "host" } = {}) {
    return db.withTransaction(async (client) => {
      const plan = await client.query(
        `SELECT g.draw_sequence, g.status
           FROM games g
           JOIN rooms r ON r.room_code = g.room_code
          WHERE g.room_code = $1 AND g.game_number = $2 AND r.closed_at IS NULL
            FOR UPDATE OF g`,
        [roomId, gameNumber]
      );
      if (!plan.rows.length) return { ok: false, code: "ROOM_NOT_FOUND" };
      if (plan.rows[0].status !== "RUNNING") return { ok: false, code: "INVALID_STATE" };
      if (!Number.isInteger(expectedIndex) || expectedIndex < 1 || expectedIndex > DRAW_LENGTH) {
        return { ok: false, code: "DRAW_EXHAUSTED" };
      }

      const draw = plan.rows[0].draw_sequence;
      const number = draw[expectedIndex - 1];
      if (!Number.isInteger(number)) return { ok: false, code: "DRAW_EXHAUSTED" };

      const inserted = await client.query(
        `INSERT INTO draw_calls (room_code, game_number, call_index, number, source)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (room_code, game_number, call_index) DO NOTHING
         RETURNING called_at`,
        [roomId, gameNumber, expectedIndex, number, source]
      );
      if (!inserted.rows.length) {
        const existing = await client.query(
          "SELECT number, called_at FROM draw_calls WHERE room_code = $1 AND game_number = $2 AND call_index = $3",
          [roomId, gameNumber, expectedIndex]
        );
        const row = existing.rows[0] || {};
        return { ok: true, duplicate: true, number: row.number, index: expectedIndex, calledAt: row.called_at };
      }

      const exhausted = expectedIndex >= draw.length;
      if (exhausted) {
        await client.query(
          `UPDATE games SET status = 'COMPLETED', completed_at = now(), end_reason = 'all 90 numbers called'
            WHERE room_code = $1 AND game_number = $2`,
          [roomId, gameNumber]
        );
        await client.query("UPDATE rooms SET status = 'COMPLETED' WHERE room_code = $1", [roomId]);
        await client.query(
          `UPDATE game_sessions SET status='completed',auto_start_state='completed',
                auto_start_claim_token=NULL,auto_start_claimed_until=NULL
            WHERE room_code=$1 AND auto_start_enabled AND status IN ('open','paused')`,
          [roomId]
        );
      }
      await audit(client, { roomId, gameNumber, type: "call", detail: { number, index: expectedIndex, source } });

      return {
        ok: true,
        number,
        index: expectedIndex,
        calledAt: inserted.rows[0].called_at,
        completed: exhausted,
        remaining: draw.length - expectedIndex,
      };
    });
  }

  /**
   * Replay-safe: the same position asked for twice returns the same row rather
   * than a second number.
   */
  async function readCall({ roomId, gameNumber, index } = {}) {
    const result = await db.query(
      "SELECT number, call_index, source, called_at FROM draw_calls WHERE room_code = $1 AND game_number = $2 AND call_index = $3",
      [roomId, gameNumber, index]
    );
    return result.rows[0] || null;
  }

  // ------------------------------------------------------- claims and awards

  /**
   * Award an exclusive pattern. Exclusivity is decided here, under a lock, not
   * in the caller's memory, so it also survives a restart.
   */
  async function recordAward({
    roomId,
    gameNumber,
    playerId,
    pattern,
    points,
    callIndex,
    ticketNo = null,
    ticketNos = null,
    ticketSerial = null,
    ticketSerials = null,
    exclusive = true,
  } = {}) {
    return db.withTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [roomId + ":" + gameNumber + ":" + pattern]);
      const existing = await client.query(
        "SELECT player_id, winner_ordinal, ticket_no FROM awards WHERE room_code = $1 AND game_number = $2 AND pattern = $3 ORDER BY winner_ordinal",
        [roomId, gameNumber, pattern]
      );
      const rows = existing.rows;
      if (rows.some((row) => row.player_id === playerId)) {
        return { ok: false, code: "ALREADY_CLAIMED_BY_YOU", pattern };
      }
      if (rows.length && exclusive) {
        return { ok: false, code: "ALREADY_AWARDED", pattern, awardedTo: rows[0].player_id };
      }
      const ordinal = rows.length + 1;
      await client.query(
        `INSERT INTO awards (room_code, game_number, player_id, pattern, points, call_index, winner_ordinal, ticket_no, ticket_nos)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [roomId, gameNumber, playerId, pattern, points, callIndex, ordinal, ticketNo, ticketNos ?? null]
      );
      await client.query(
        `INSERT INTO claims (room_code, game_number, player_id, pattern, status, reason, call_index)
         VALUES ($1, $2, $3, $4, 'AWARDED', 'complete', $5)`,
        [roomId, gameNumber, playerId, pattern, callIndex]
      );
      await audit(client, { roomId, gameNumber, playerId, type: "claim", detail: { pattern, points, ordinal, ticketNo, ticketNos, ticketSerial, ticketSerials } });
      return { ok: true, ordinal, pattern, points, ticketNo, ticketSerial, ticketSerials };
    });
  }

  /** A refused claim is still a decision worth keeping. */
  async function recordClaimDecision({ roomId, gameNumber, playerId, pattern, status, reason, callIndex } = {}) {
    return db.withTransaction(async (client) => {
      await client.query(
        `INSERT INTO claims (room_code, game_number, player_id, pattern, status, reason, call_index)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [roomId, gameNumber, playerId, pattern, status, reason, callIndex]
      );
      await audit(client, {
        roomId,
        gameNumber,
        playerId,
        type: status === "AWARDED" ? "claim" : "claim-rejected",
        detail: { pattern, reason },
      });
      return { ok: true };
    });
  }

  // -------------------------------------------------------------------- audit

  /** Best-effort event log. Authoritative state never depends on this. */
  async function appendAudit({ roomId, gameNumber = null, playerId = null, type, detail = {}, at } = {}) {
    await db.query(
      `INSERT INTO audit_events (room_code, game_number, player_id, type, detail, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [roomId, gameNumber, playerId, type, json(detail), atOf(at)]
    );
    return { ok: true };
  }

  async function recentAudit({ roomId, limit = 50 } = {}) {
    const result = await db.query(
      "SELECT type, player_id, detail, occurred_at FROM audit_events WHERE room_code = $1 ORDER BY event_id DESC LIMIT $2",
      [roomId, Math.min(Number(limit) || 50, 200)]
    );
    return result.rows.reverse();
  }

  // ---------------------------------------------------------------- recovery IO

  /** Rooms a restart has to bring back: never closed, never completed-and-idle. */
  async function loadRecoverableRooms() {
    const result = await db.query(
      `SELECT room_code, status, game_number, host_player_id, config, recovery_error, created_at
         FROM rooms
        WHERE closed_at IS NULL
        ORDER BY created_at`
    );
    return result.rows;
  }

  /** One consistent read of everything a room needs to become live again. */
  async function loadRoomBundle({ roomId } = {}) {
    return db.withTransaction(async (client) => {
      const room = await client.query("SELECT * FROM rooms WHERE room_code = $1", [roomId]);
      const members = await client.query(
        `SELECT m.player_id, m.role, m.connected, m.joined_at, m.left_at, m.ticket_count, m.booking_reservation_id, p.display_name
           FROM room_members m
           JOIN players p ON p.player_id = m.player_id
          WHERE m.room_code = $1
          ORDER BY m.joined_at`,
        [roomId]
      );
      // Booking assignments are part of the seat's durable identity. A room
      // recovery must reject split-brain links (reservation points to a player
      // but no member references it, or the member's locked quantity changed).
      const bookingAssignments = await client.query(
        `SELECT r.reservation_id,r.session_id,r.player_id,r.room_code,r.ticket_count,r.status,s.inventory_mode,s.inventory_state,
                m.player_id AS member_player_id,m.room_code AS member_room_code,
                m.ticket_count AS member_ticket_count,
                (SELECT count(*) FROM ticket_reservation_items a WHERE a.session_id=r.session_id AND a.reservation_id=r.reservation_id AND a.released_at IS NULL) AS active_inventory_count
           FROM ticket_reservations r JOIN game_sessions s ON s.session_id=r.session_id
           LEFT JOIN room_members m ON m.booking_reservation_id=r.reservation_id
          WHERE r.room_code=$1 OR (m.room_code=$1 AND m.booking_reservation_id IS NOT NULL)
          ORDER BY r.reservation_id`,
        [roomId]
      );
      const game = await client.query(
        `SELECT g.game_number, g.status, g.draw_sequence, g.started_at, g.completed_at, g.end_reason
           FROM games g
          WHERE g.room_code = $1 AND g.game_number = $2`,
        [roomId, room.rows[0] ? room.rows[0].game_number : 0]
      );
      const gameNumber = game.rows.length ? game.rows[0].game_number : null;
      const tickets = await client.query(
        `SELECT t.player_id,t.ticket_no,t.grid,t.assigned_at,t.inventory_session_id,t.inventory_reservation_id,t.inventory_ticket_id,st.serial AS inventory_serial
           FROM tickets t LEFT JOIN session_tickets st
             ON st.session_id=t.inventory_session_id AND st.ticket_id=t.inventory_ticket_id
          WHERE room_code=$1 AND game_number=$2 ORDER BY player_id,ticket_no`,
        [roomId, gameNumber]
      );
      const waitingInventoryTickets = await client.query(
        `SELECT m.player_id,r.reservation_id,r.session_id,st.ticket_id,st.serial,st.serial_ordinal,st.grid
           FROM room_members m
           JOIN ticket_reservations r ON r.reservation_id=m.booking_reservation_id AND r.player_id=m.player_id AND r.room_code=m.room_code AND r.status='confirmed'
           JOIN game_sessions s ON s.session_id=r.session_id AND s.inventory_mode='numbered' AND s.inventory_state='ready'
           JOIN ticket_reservation_items a ON a.session_id=r.session_id AND a.reservation_id=r.reservation_id AND a.released_at IS NULL
           JOIN session_tickets st ON st.session_id=a.session_id AND st.ticket_id=a.ticket_id
          WHERE m.room_code=$1 ORDER BY m.player_id,st.serial_ordinal`, [roomId]
      );
      const calls = await client.query(
        "SELECT call_index, number, source, called_at FROM draw_calls WHERE room_code = $1 AND game_number = $2 ORDER BY call_index",
        [roomId, gameNumber]
      );
      const awards = await client.query(
        `SELECT a.player_id, a.pattern, a.points, a.call_index, a.winner_ordinal, a.ticket_no, a.ticket_nos, a.awarded_at, p.display_name
           FROM awards a
           JOIN players p ON p.player_id = a.player_id
          WHERE a.room_code = $1 AND a.game_number = $2
          ORDER BY a.awarded_at, a.winner_ordinal`,
        [roomId, gameNumber]
      );
      const claims = await client.query(
        `SELECT player_id, pattern, status, reason, call_index, decided_at
           FROM claims
          WHERE room_code = $1 AND game_number = $2
          ORDER BY claim_id`,
        [roomId, gameNumber]
      );
      const schedule = await client.query("SELECT * FROM room_schedule WHERE room_code = $1", [roomId]);
      return {
        room: room.rows[0] || null,
        game: game.rows[0] || null,
        gameNumber,
        members: members.rows,
        bookingAssignments: bookingAssignments.rows,
        tickets: tickets.rows,
        waitingInventoryTickets: waitingInventoryTickets.rows,
        calls: calls.rows,
        awards: awards.rows,
        claims: claims.rows,
        schedule: schedule.rows[0] || null,
      };
    });
  }

  /** Cross-check the pieces the controller just rebuilt, straight from SQL. */
  async function verifyRoomHistory({ roomId } = {}) {
    const problems = [];
    const result = await db.query(
      `SELECT
         (SELECT count(*) FROM draw_calls WHERE room_code = $1 AND game_number = (SELECT game_number FROM rooms WHERE room_code = $1)) AS calls,
         (SELECT max(call_index) FROM draw_calls WHERE room_code = $1 AND game_number = (SELECT game_number FROM rooms WHERE room_code = $1)) AS last_index,
         (SELECT count(DISTINCT number) FROM draw_calls WHERE room_code = $1 AND game_number = (SELECT game_number FROM rooms WHERE room_code = $1)) AS distinct_numbers,
         (SELECT count(*) FROM tickets WHERE room_code = $1 AND game_number = (SELECT game_number FROM rooms WHERE room_code = $1)) AS tickets,
         (SELECT count(*) FROM awards WHERE room_code = $1 AND game_number = (SELECT game_number FROM rooms WHERE room_code = $1)) AS awards,
         (SELECT count(*) FROM awards WHERE room_code = $1 AND game_number = (SELECT game_number FROM rooms WHERE room_code = $1) AND winner_ordinal > 1) AS extra_winners`,
      [roomId]
    );
    const row = result.rows[0];
    if (Number(row.calls) !== Number(row.last_index || 0)) {
      problems.push("call history has a gap: " + row.calls + " rows but last index " + row.last_index);
    }
    if (Number(row.calls) !== Number(row.distinct_numbers)) problems.push("a number was called twice");
    return { ok: problems.length === 0, problems, counts: row };
  }

  // ------------------------------------------------------------------ schedule

  async function upsertSchedule({ roomId, gameNumber, autoCall, intervalMs, nextDueAt, resetTick = false, transactionClient = null } = {}) {
    const runner = transactionClient || db;
    await runner.query(
      `INSERT INTO room_schedule (room_code, game_number, auto_call, interval_ms, tick, next_due_at)
       VALUES ($1, $2, $3, $4, 0, $5)
       ON CONFLICT (room_code) DO UPDATE
         SET game_number = EXCLUDED.game_number,
             auto_call = EXCLUDED.auto_call,
             interval_ms = EXCLUDED.interval_ms,
             next_due_at = COALESCE(EXCLUDED.next_due_at, room_schedule.next_due_at),
             tick = CASE WHEN $6 THEN 0 ELSE room_schedule.tick END`,
      [roomId, gameNumber, Boolean(autoCall), intervalMs, nextDueAt ? new Date(nextDueAt) : null, resetTick]
    );
    return { ok: true };
  }

  async function setScheduleFlags({ roomId, autoCall, intervalMs, nextDueAt } = {}) {
    await db.query(
      `UPDATE room_schedule
          SET auto_call = COALESCE($2, auto_call),
              interval_ms = COALESCE($3, interval_ms),
              next_due_at = COALESCE($4, next_due_at)
        WHERE room_code = $1`,
      [roomId, autoCall === undefined ? null : autoCall, intervalMs ?? null, nextDueAt ? new Date(nextDueAt) : null]
    );
    return { ok: true };
  }

  async function disarmSchedule({ roomId, gameNumber = null } = {}) {
    await db.query(
      "UPDATE room_schedule SET auto_call = false, next_due_at = NULL WHERE room_code = $1 AND ($2::int IS NULL OR game_number = $2)",
      [roomId, gameNumber]
    );
    return { ok: true };
  }

  /**
   * Consume this room's scheduled tick. The conditional UPDATE is the lock: a
   * second server, or a second timer in this one, reads next_due_at already
   * moved on and gets zero rows back, so only one of them calls a number.
   */
  async function claimTick({ roomId, gameNumber, dueAt = Date.now() } = {}) {
    const result = await db.withTransaction(async (client) => {
      const claimed = await client.query(
        `UPDATE room_schedule
            SET tick = tick + 1,
                next_due_at = $3::timestamptz + (interval_ms * interval '1 millisecond')
          WHERE room_code = $1
            AND game_number = $2
            AND auto_call
            AND next_due_at <= $3::timestamptz
            AND EXISTS (SELECT 1 FROM rooms r WHERE r.room_code = $1 AND r.status = 'RUNNING' AND r.closed_at IS NULL
                        AND r.recovery_error IS NULL)
          RETURNING tick, next_due_at`,
        [roomId, gameNumber, new Date(dueAt)]
      );
      if (!claimed.rows.length) return { claimed: false };
      // the games row must still be open, otherwise the tick belongs to a round
      // that has already finished and nothing may be called for it
      const open = await client.query(
        "SELECT 1 FROM games WHERE room_code = $1 AND game_number = $2 AND status = 'RUNNING'",
        [roomId, gameNumber]
      );
      if (!open.rows.length) {
        const error = new Error("scheduled tick for a game that is not running");
        error.code = "INVALID_STATE";
        throw error;
      }
      return { claimed: true, tick: claimed.rows[0].tick, nextDueAt: claimed.rows[0].next_due_at };
    });
    return result;
  }

  async function loadSchedule({ roomId } = {}) {
    const result = await db.query("SELECT * FROM room_schedule WHERE room_code = $1", [roomId]);
    return result.rows[0] || null;
  }

  async function autoStartSessionForRoom({ roomId } = {}) {
    const result = await db.query(
      `SELECT session_id,auto_start_enabled,auto_start_state,starts_at
         FROM game_sessions WHERE room_code=$1 AND auto_start_enabled AND status NOT IN ('cancelled','completed')
         ORDER BY created_at DESC LIMIT 1`, [roomId]
    );
    const row = result.rows[0];
    return row ? { enabled: true, sessionId: row.session_id, state: row.auto_start_state, scheduledAt: row.starts_at } : null;
  }

  /** Atomically claim one due session. Expired claims are safe to retry. */
  async function claimDueScheduledStart({ claimToken, leaseMs = 30000, retryMs = 5000 } = {}) {
    if (typeof claimToken !== "string" || !/^[0-9a-f-]{36}$/i.test(claimToken)) throw new Error("scheduled start claim needs a UUID token");
    return db.withTransaction(async (client) => {
      const claimed = await client.query(
        `WITH due AS (
           SELECT session_id FROM game_sessions
            WHERE auto_start_enabled AND status='open'
              AND starts_at<=clock_timestamp()
              AND auto_start_state IN ('scheduled','starting','waiting')
              AND (auto_start_claimed_until IS NULL OR auto_start_claimed_until<=clock_timestamp())
              AND (auto_start_retry_at IS NULL OR auto_start_retry_at<=clock_timestamp())
            ORDER BY starts_at,session_id
            FOR UPDATE SKIP LOCKED LIMIT 1
         )
         UPDATE game_sessions s SET auto_start_state='starting',auto_start_claim_token=$1,
               auto_start_claimed_until=clock_timestamp()+($2::int*interval '1 millisecond'),
               auto_start_attempts=auto_start_attempts+1,auto_start_error=NULL
           FROM due WHERE s.session_id=due.session_id
         RETURNING s.session_id,s.instance_id,s.room_code,s.starts_at,s.time_zone,s.auto_start_attempts`,
        [claimToken, leaseMs]
      );
      if (!claimed.rowCount) return { claimed: false };
      const session = claimed.rows[0];
      const details = await client.query(
        `SELECT s.status AS session_status,i.status AS instance_status,r.game_instance_id,r.status AS room_status,
                r.game_number,r.closed_at,
                EXISTS(SELECT 1 FROM games g WHERE g.room_code=r.room_code) AS has_game,
                (SELECT count(*)::int FROM room_members m WHERE m.room_code=r.room_code AND m.left_at IS NULL) AS member_count,
                (SELECT g.started_at FROM games g WHERE g.room_code=r.room_code ORDER BY g.game_number DESC LIMIT 1) AS game_started_at,
                (SELECT g.status FROM games g WHERE g.room_code=r.room_code ORDER BY g.game_number DESC LIMIT 1) AS game_status
           FROM game_sessions s JOIN game_instances i ON i.instance_id=s.instance_id
           LEFT JOIN rooms r ON r.room_code=s.room_code WHERE s.session_id=$1`, [session.session_id]
      );
      const state = details.rows[0];
      if (state?.game_status === "COMPLETED") {
        await client.query(
          `UPDATE game_sessions SET status='completed',auto_start_state='completed',
                auto_start_claim_token=NULL,auto_start_claimed_until=NULL
            WHERE session_id=$1 AND auto_start_claim_token=$2`, [session.session_id, claimToken]
        );
        return { claimed: false, reconciled: true, sessionId: session.session_id };
      }
      if (state?.room_status === "RUNNING" && state.has_game) {
        await client.query(
          `UPDATE game_sessions SET auto_start_state='started',auto_started_at=COALESCE(auto_started_at,$3),
                auto_start_claim_token=NULL,auto_start_claimed_until=NULL,auto_start_retry_at=NULL
            WHERE session_id=$1 AND auto_start_claim_token=$2`,
          [session.session_id, claimToken, state.game_started_at]
        );
        return { claimed: false, reconciled: true, sessionId: session.session_id };
      }
      let errorCode = null;
      if (!session.room_code || !state?.room_status) errorCode = "SESSION_ROOM_REQUIRED";
      else if (state.instance_status !== "active" || state.game_instance_id !== session.instance_id) errorCode = "SESSION_ROOM_INVALID";
      else if (state.room_status !== "WAITING" || Number(state.game_number) !== 0 || state.closed_at || state.has_game) errorCode = "SESSION_ROOM_NOT_WAITING";
      if (errorCode) {
        await client.query(
          `UPDATE game_sessions SET auto_start_state='failed',auto_start_error=$3,
                auto_start_claim_token=NULL,auto_start_claimed_until=NULL
            WHERE session_id=$1 AND auto_start_claim_token=$2`, [session.session_id, claimToken, errorCode]
        );
        return { claimed: false, failed: true, errorCode, sessionId: session.session_id };
      }
      if (Number(state.member_count) < 1) {
        await client.query(
          `UPDATE game_sessions SET auto_start_state='waiting',auto_start_retry_at=clock_timestamp()+($3::int*interval '1 millisecond'),
                auto_start_error='NO_PLAYERS',auto_start_claim_token=NULL,auto_start_claimed_until=NULL
            WHERE session_id=$1 AND auto_start_claim_token=$2`, [session.session_id, claimToken, retryMs]
        );
        return { claimed: false, waiting: true, sessionId: session.session_id };
      }
      return {
        claimed: true, sessionId: session.session_id, instanceId: session.instance_id,
        roomCode: session.room_code, scheduledAt: session.starts_at, timeZone: session.time_zone,
        attempts: Number(session.auto_start_attempts),
        claimToken,
      };
    });
  }

  /** Revalidate a scheduler lease immediately before changing the room engine. */
  async function verifyScheduledStartClaim({ sessionId, claimToken } = {}) {
    const result = await db.query(
      `SELECT s.session_id,s.instance_id,s.room_code,s.starts_at,s.time_zone,
              i.status AS instance_status,r.game_instance_id,r.status AS room_status,r.game_number,r.closed_at,
              EXISTS(SELECT 1 FROM games g WHERE g.room_code=r.room_code) AS has_game,
              (SELECT count(*)::int FROM room_members m WHERE m.room_code=r.room_code AND m.left_at IS NULL) AS member_count
         FROM game_sessions s JOIN game_instances i ON i.instance_id=s.instance_id
         LEFT JOIN rooms r ON r.room_code=s.room_code
        WHERE s.session_id=$1 AND s.auto_start_enabled AND s.status='open'
          AND s.auto_start_state='starting' AND s.auto_start_claim_token=$2
          AND s.auto_start_claimed_until>clock_timestamp() AND s.starts_at<=clock_timestamp()`,
      [sessionId, claimToken]
    );
    const row = result.rows[0];
    if (!row) return { ok: false, code: "SCHEDULED_START_CLAIM_LOST", error: "scheduled start is not yet due or the claim expired" };
    if (!row.room_code || row.instance_status !== "active" || row.game_instance_id !== row.instance_id ||
        row.room_status !== "WAITING" || Number(row.game_number) !== 0 || row.closed_at || row.has_game) {
      return { ok: false, code: "SESSION_ROOM_INVALID", error: "scheduled room is no longer a valid waiting room" };
    }
    if (Number(row.member_count) < 1) return { ok: false, code: "NO_PLAYERS", error: "the scheduled room has no joined players yet" };
    return { ok: true, sessionId: row.session_id, claimToken, roomCode: row.room_code, scheduledAt: row.starts_at, timeZone: row.time_zone };
  }

  async function releaseScheduledStartClaim({ sessionId, claimToken, retry = false, retryMs = 5000, errorCode = null } = {}) {
    const state = retry ? "waiting" : "failed";
    const result = await db.query(
      `UPDATE game_sessions SET auto_start_state=$3,auto_start_error=$4,
            auto_start_retry_at=CASE WHEN $3='waiting' THEN clock_timestamp()+($5::int*interval '1 millisecond') ELSE NULL END,
            auto_start_claim_token=NULL,auto_start_claimed_until=NULL
        WHERE session_id=$1 AND auto_start_claim_token=$2 AND auto_start_state='starting'
        RETURNING session_id`, [sessionId, claimToken, state, errorCode, retryMs]
    );
    return { released: result.rowCount === 1, state };
  }

  /** Server-side sessions are also part of the durable footprint. */
  async function countRows() {
    const result = await db.query(
      `SELECT
        (SELECT count(*) FROM rooms) AS rooms,
        (SELECT count(*) FROM players) AS players,
        (SELECT count(*) FROM tickets) AS tickets,
        (SELECT count(*) FROM draw_calls) AS calls,
        (SELECT count(*) FROM awards) AS awards,
        (SELECT count(*) FROM sessions WHERE revoked_at IS NULL AND rotated_at IS NULL) AS sessions`
    );
    return result.rows[0];
  }

  return {
    createRoom,
    instanceStatusForRoom,
    instanceSlugForRoom,
    instanceStatus,
    instanceRoomDefaults,
    publicInstanceIdBySlug,
    themeVersionForInstance,
    addParticipant,
    bookingSessionForRoom,
    reservationForRoomJoin,
    addParticipantFromBooking,
    bookedTicketCount,
    markSeat,
    markSeatLeft,
    setHost,
    saveConfig,
    setTicketCount,
    setStatus,
    closeRoom,
    setRecoveryError,
    startGame,
    completeGame,
    recordCall,
    readCall,
    recordAward,
    recordClaimDecision,
    appendAudit,
    recentAudit,
    loadRecoverableRooms,
    loadRoomBundle,
    verifyRoomHistory,
    upsertSchedule,
    setScheduleFlags,
    disarmSchedule,
    claimTick,
    loadSchedule,
    autoStartSessionForRoom,
    claimDueScheduledStart,
    verifyScheduledStartClaim,
    releaseScheduledStartClaim,
    countRows,
    isUniqueError,
    FOREIGN_KEY_VIOLATION,
  };
}
