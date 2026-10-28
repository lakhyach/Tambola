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

import { IntegrityError } from "../game/engine.js";

/** Postgres error codes this module translates into game answers. */
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

function isUniqueError(error) {
  return error && (error.code === UNIQUE_VIOLATION || error.cause?.code === UNIQUE_VIOLATION);
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
  async function createRoom({ roomId, config, host } = {}) {
    if (!roomId) throw new Error("createRoom needs a room id");
    if (!host || !host.playerId) throw new Error("createRoom needs a host participant");
    await db.withTransaction(async (client) => {
      await client.query("INSERT INTO players (player_id, display_name) VALUES ($1, $2)", [host.playerId, host.name]);
      await client.query(
        "INSERT INTO rooms (room_code, status, game_number, host_player_id, config) VALUES ($1, 'WAITING', 0, $2, $3)",
        [roomId, host.playerId, json(config || {})]
      );
      await client.query(
        "INSERT INTO room_members (room_code, player_id, role, connected) VALUES ($1, $2, 'host', $3)",
        [roomId, host.playerId, Boolean(host.connected)]
      );
      await audit(client, { roomId, playerId: host.playerId, type: "room-created", detail: { config } });
    });
    return { roomId };
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
  async function markSeatLeft({ roomId, playerId, reason = "left" } = {}) {
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
      await audit(client, { roomId, playerId, type: "left", detail: { reason } });
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
  async function startGame({ roomId, gameNumber, drawSequence, tickets = [], config } = {}) {
    if (!Array.isArray(drawSequence) || drawSequence.length !== DRAW_LENGTH) {
      throw new IntegrityError("refusing to persist a draw that is not 90 numbers", { roomId });
    }
    const result = await db.withTransaction(async (client) => {
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
      await client.query(
        `INSERT INTO games (room_code, game_number, status, draw_sequence)
         VALUES ($1, $2, 'RUNNING', $3)`,
        [roomId, gameNumber, json(drawSequence)]
      );
      for (const ticket of tickets) {
        await client.query(
          "INSERT INTO tickets (room_code, game_number, player_id, grid) VALUES ($1, $2, $3, $4)",
          [roomId, gameNumber, ticket.playerId, json(ticket.grid)]
        );
      }
      await audit(client, { roomId, gameNumber, type: "start", detail: { players: tickets.length } });
      return { ok: true, gameNumber };
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
  async function recordAward({ roomId, gameNumber, playerId, pattern, points, callIndex, exclusive = true } = {}) {
    return db.withTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [roomId + ":" + gameNumber + ":" + pattern]);
      const existing = await client.query(
        "SELECT player_id, winner_ordinal FROM awards WHERE room_code = $1 AND game_number = $2 AND pattern = $3 ORDER BY winner_ordinal",
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
        `INSERT INTO awards (room_code, game_number, player_id, pattern, points, call_index, winner_ordinal)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [roomId, gameNumber, playerId, pattern, points, callIndex, ordinal]
      );
      await client.query(
        `INSERT INTO claims (room_code, game_number, player_id, pattern, status, reason, call_index)
         VALUES ($1, $2, $3, $4, 'AWARDED', 'complete', $5)`,
        [roomId, gameNumber, playerId, pattern, callIndex]
      );
      await audit(client, { roomId, gameNumber, playerId, type: "claim", detail: { pattern, points, ordinal } });
      return { ok: true, ordinal, pattern, points };
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
        `SELECT m.player_id, m.role, m.connected, m.joined_at, m.left_at, p.display_name
           FROM room_members m
           JOIN players p ON p.player_id = m.player_id
          WHERE m.room_code = $1
          ORDER BY m.joined_at`,
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
        "SELECT player_id, grid, assigned_at FROM tickets WHERE room_code = $1 AND game_number = $2",
        [roomId, gameNumber]
      );
      const calls = await client.query(
        "SELECT call_index, number, source, called_at FROM draw_calls WHERE room_code = $1 AND game_number = $2 ORDER BY call_index",
        [roomId, gameNumber]
      );
      const awards = await client.query(
        `SELECT a.player_id, a.pattern, a.points, a.call_index, a.winner_ordinal, a.awarded_at, p.display_name
           FROM awards a
           JOIN players p ON p.player_id = a.player_id
          WHERE a.room_code = $1 AND a.game_number = $2
          ORDER BY a.awarded_at, a.winner_ordinal`,
        [roomId, gameNumber]
      );
      const schedule = await client.query("SELECT * FROM room_schedule WHERE room_code = $1", [roomId]);
      return {
        room: room.rows[0] || null,
        game: game.rows[0] || null,
        gameNumber,
        members: members.rows,
        tickets: tickets.rows,
        calls: calls.rows,
        awards: awards.rows,
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

  async function upsertSchedule({ roomId, gameNumber, autoCall, intervalMs, nextDueAt, resetTick = false } = {}) {
    await db.query(
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
    addParticipant,
    markSeat,
    markSeatLeft,
    setHost,
    saveConfig,
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
    countRows,
    isUniqueError,
    FOREIGN_KEY_VIOLATION,
  };
}
