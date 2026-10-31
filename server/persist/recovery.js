/**
 * Recovery: turn durable rows back into live rooms.
 *
 * Called once at boot, and again after a database outage clears. The rule is
 * simple - rebuild what the database says existed, and never invent anything:
 * no new tickets, no new draw, no new calls, no new winners.
 *
 * Fail closed
 *   A room whose rows do not add up is not loaded as "the best guess". It is
 *   frozen: its reason is written to rooms.recovery_error, every intent for it
 *   is refused with RECOVERY_REQUIRED, and its scheduler stays disarmed. An
 *   operator (or a later migration) fixes the data; players are told what
 *   happened instead of being quietly given a different game.
 *
 * Resume policy (documented, deliberate)
 *   A RUNNING room comes back RUNNING and keeps its place in the draw. It does
 *   not call anything until its schedule is due again. Missed ticks are dropped
 *   rather than replayed - a game that resumed by firing six numbers because
 *   the process was down for 48 seconds would be a different game.
 */

import { GameState, IntegrityError } from "../game/engine.js";

const KNOWN_STATES = new Set(Object.values(GameState));

function asMillis(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Convert one room's rows into the shape TambolaRoom.hydrateFrom() expects.
 * Throws IntegrityError on anything that would require inventing state.
 */
export function buildHydrationSource(bundle, { log = () => {} } = {}) {
  const room = bundle.room;
  if (!room) throw new IntegrityError("no room row to recover from");
  if (!KNOWN_STATES.has(room.status)) {
    throw new IntegrityError("room state is not a known game state: " + room.status, { roomId: room.room_code });
  }

  const members = bundle.members || [];
  const active = members.filter((member) => !member.left_at);
  if (!active.length) throw new IntegrityError("the room has no participants left to recover", { roomId: room.room_code });

  const game = bundle.game;
  const draw = game && Array.isArray(game.draw_sequence) ? game.draw_sequence : [];
  const calls = bundle.calls || [];

  if (room.status !== GameState.WAITING && !draw.length) {
    throw new IntegrityError("a " + room.status + " room has no stored draw to recover", { roomId: room.room_code });
  }
  if (draw.length && draw.length !== 90) {
    throw new IntegrityError("the stored draw holds " + draw.length + " numbers, expected 90", { roomId: room.room_code });
  }

  // the history must be a contiguous prefix of the stored plan, in order
  for (const call of calls) {
    if (call.number !== draw[call.call_index - 1]) {
      throw new IntegrityError(
        "call " + call.call_index + " is number " + call.number + " but the stored draw says " + draw[call.call_index - 1],
        { roomId: room.room_code }
      );
    }
  }
  for (let i = 0; i < calls.length; i++) {
    if (calls[i].call_index !== i + 1) {
      throw new IntegrityError("the called history is not contiguous at position " + (i + 1), {
        roomId: room.room_code,
      });
    }
  }

  // group every stored ticket by seat into the engine's canonical [{ no, grid }]
  // list, ordered by ticket_no so a recovered seat sees the same numbering
  const ticketsByPlayer = new Map();
  for (const ticket of bundle.tickets || []) {
    const list = ticketsByPlayer.get(ticket.player_id) || [];
    list.push({ no: ticket.ticket_no || list.length + 1, grid: ticket.grid });
    ticketsByPlayer.set(ticket.player_id, list);
  }
  for (const list of ticketsByPlayer.values()) list.sort((a, b) => a.no - b.no);
  const pointsByPlayer = new Map();
  const claimsByPlayer = new Map();
  for (const award of bundle.awards || []) {
    pointsByPlayer.set(award.player_id, (pointsByPlayer.get(award.player_id) || 0) + award.points);
    const list = claimsByPlayer.get(award.player_id) || [];
    list.push(award.pattern);
    claimsByPlayer.set(award.player_id, list);
  }

  const players = active.map((member) => ({
    id: member.player_id,
    name: member.display_name,
    tickets: ticketsByPlayer.get(member.player_id) || [],
    ticketCount: Number.isInteger(member.ticket_count) && member.ticket_count > 0
      ? member.ticket_count
      : (ticketsByPlayer.get(member.player_id) || []).length || 1,
    points: pointsByPlayer.get(member.player_id) || 0,
    claims: claimsByPlayer.get(member.player_id) || [],
    joinedAt: asMillis(member.joined_at),
  }));

  const seen = new Set(players.map((player) => player.id));
  if (room.host_player_id && !seen.has(room.host_player_id)) {
    throw new IntegrityError("the recorded host is no longer a participant of this room", {
      roomId: room.room_code,
    });
  }

  if (room.status !== GameState.WAITING) {
    const withTickets = players.filter((player) => player.tickets.length).length;
    if (withTickets !== players.length) {
      log("recovering a live game with", withTickets, "of", players.length, "seats ticketed", room.room_code);
    }
    if (!withTickets) {
      throw new IntegrityError("a game is running but no seat has a stored ticket", { roomId: room.room_code });
    }
  }

  return {
    roomId: room.room_code,
    state: room.status,
    gameNumber: room.game_number,
    createdAt: asMillis(room.created_at),
    hostPlayerId: room.host_player_id,
    config: room.config || {},
    players,
    draw,
    cursor: calls.length,
    calledNumbers: calls.map((call) => call.number),
    awards: (bundle.awards || []).map((award) => ({
      pattern: award.pattern,
      playerId: award.player_id,
      name: award.display_name,
      points: award.points,
      callIndex: award.call_index,
      at: asMillis(award.awarded_at),
    })),
    claimLog: [],
    recoveryError: room.recovery_error || null,
    schedule: bundle.schedule || null,
  };
}

/**
 * Rebuild every recoverable room.
 *
 * @param {object} deps
 * @param {object} deps.store       persist/store.js
 * @param {object} deps.registry    net/registry.js
 * @param {Function} [deps.onArmed] called with (room, schedule) for the scheduler
 * @returns {Promise<{recovered: object[], frozen: object[], skipped: object[]}>}
 */
export async function recoverRooms({ store, registry, log = () => {}, onArmed } = {}) {
  const recovered = [];
  const frozen = [];
  const skipped = [];

  const rows = await store.loadRecoverableRooms();
  for (const row of rows) {
    const roomId = row.room_code;
    if (row.recovery_error) {
      // already frozen by an earlier boot: stay frozen until the note is cleared
      frozen.push({ roomId, reason: row.recovery_error, preexisting: true });
      log("room stays frozen", roomId, row.recovery_error);
      continue;
    }

    try {
      const bundle = await store.loadRoomBundle({ roomId });
      const source = buildHydrationSource(bundle, { log });
      const room = registry.restore({ roomId, hydrate: source, overrides: source.config });
      room.assertIntegrity();
      const extra = await store.verifyRoomHistory({ roomId });
      if (!extra.ok) throw new IntegrityError(extra.problems.join("; "), { roomId });
      recovered.push(room);
      if (typeof onArmed === "function") await onArmed(room, source.schedule, source);
    } catch (error) {
      const reason = (error && error.message) || "unknown recovery failure";
      log("recovery refused", roomId, reason);
      frozen.push({ roomId, reason, code: error && error.code });
      try {
        // leave whatever was half-built out of the live set and record why
        registry.close(roomId, "recovery failed");
        await store.setRecoveryError({ roomId, error: reason });
      } catch (writeError) {
        log("could not record the recovery failure", roomId, writeError && writeError.message);
      }
    }
  }

  if (!rows.length) log("nothing to recover", "(first boot)");
  return { recovered, frozen, attempted: rows.length };
}
