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

import { GameState, IntegrityError, TambolaRoom } from "../game/engine.js";
import { validateTicket } from "../game/ticket.js";
import { PATTERNS, evaluateClaimAcrossTickets } from "../game/patterns.js";

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

  for (const assignment of bundle.bookingAssignments || []) {
    const matches = assignment.room_code === room.room_code &&
      assignment.player_id && assignment.status === "confirmed" &&
      assignment.member_player_id === assignment.player_id &&
      assignment.member_room_code === room.room_code &&
      Number(assignment.member_ticket_count) === Number(assignment.ticket_count);
    if (!matches) {
      throw new IntegrityError("a booked seat no longer matches its reservation, room, player, or locked ticket count", {
        roomId: room.room_code,
        reservationId: assignment.reservation_id,
        playerId: assignment.player_id || null,
      });
    }
    if (assignment.inventory_mode === "numbered" &&
        (assignment.inventory_state !== "ready" || Number(assignment.active_inventory_count) !== Number(assignment.ticket_count))) {
      throw new IntegrityError("a numbered booking does not have its complete active durable ticket allocation", {
        roomId: room.room_code, reservationId: assignment.reservation_id,
      });
    }
  }

  const game = bundle.game;
  if (room.game_number > 0 && (!game || game.game_number !== room.game_number)) {
    throw new IntegrityError("the room's current game row is missing or has a different round number", { roomId: room.room_code });
  }
  if (room.status === GameState.WAITING) {
    if (game && game.status !== "COMPLETED") {
      throw new IntegrityError("a WAITING room still has an unfinished game row", { roomId: room.room_code });
    }
  } else {
    const expectedGameStatus = room.status === GameState.COMPLETED ? "COMPLETED" : "RUNNING";
    if (!game || game.status !== expectedGameStatus) {
      throw new IntegrityError("room and current game lifecycle states do not agree", {
        roomId: room.room_code,
        roomStatus: room.status,
        gameStatus: game?.status || null,
      });
    }
  }
  if (game) {
    const startedAt = asMillis(game.started_at);
    const completedAt = asMillis(game.completed_at);
    if (startedAt === undefined) {
      throw new IntegrityError("the current game has no valid start timestamp", { roomId: room.room_code });
    }
    if (game.status === "COMPLETED" && completedAt === undefined) {
      throw new IntegrityError("a completed game has no valid completion timestamp", { roomId: room.room_code });
    }
    if (game.status === "RUNNING" && completedAt !== undefined) {
      throw new IntegrityError("a running game already has a completion timestamp", { roomId: room.room_code });
    }
    if (completedAt !== undefined && completedAt < startedAt) {
      throw new IntegrityError("the game completed before it started", { roomId: room.room_code });
    }
  }

  // Reset moves the durable room back to WAITING but deliberately retains the
  // completed game row as history until the next round starts. Validate that
  // history above, then rebuild only the empty waiting-room projection.
  const resetToWaiting = room.status === GameState.WAITING && game?.status === "COMPLETED";
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
  // list, ordered by ticket_no so a recovered seat sees the same numbering.
  // Every stored grid is checked with the same independent validator the
  // generator uses: a row that is not a legal Tambola ticket cannot be played,
  // so the room is frozen here instead of at the next claim.
  const ticketsByPlayer = new Map();
  const ticketRows = bundle.tickets || [];
  const storedIds = new Set();
  for (const ticket of ticketRows) {
    const key = String(ticket.player_id) + "#" + String(ticket.ticket_no);
    if (storedIds.has(key)) {
      throw new IntegrityError(
        "seat " + ticket.player_id + " has two tickets both numbered " + ticket.ticket_no,
        { roomId: room.room_code }
      );
    }
    storedIds.add(key);

    const check = validateTicket(ticket.grid);
    if (!check.valid) {
      throw new IntegrityError(
        "stored ticket " + ticket.ticket_no + " for seat " + ticket.player_id + " is not a legal Tambola ticket: " + check.errors[0],
        { roomId: room.room_code, playerId: ticket.player_id, ticketNo: ticket.ticket_no, problems: check.errors }
      );
    }

    const list = ticketsByPlayer.get(ticket.player_id) || [];
    list.push({
      no: ticket.ticket_no || list.length + 1,
      grid: ticket.grid,
      ...(ticket.inventory_ticket_id ? { inventoryTicketId: ticket.inventory_ticket_id, serial: ticket.inventory_serial } : {}),
      ...(ticket.inventory_session_id ? { inventorySessionId: ticket.inventory_session_id } : {}),
      ...(ticket.inventory_reservation_id ? { inventoryReservationId: ticket.inventory_reservation_id } : {}),
    });
    ticketsByPlayer.set(ticket.player_id, list);
  }
  for (const list of ticketsByPlayer.values()) list.sort((a, b) => a.no - b.no);
  const waitingInventoryByPlayer = new Map();
  for (const ticket of bundle.waitingInventoryTickets || []) {
    const list = waitingInventoryByPlayer.get(ticket.player_id) || [];
    list.push({
      no: list.length + 1, grid: ticket.grid, inventoryTicketId: ticket.ticket_id, serial: ticket.serial,
      inventorySessionId: ticket.session_id, inventoryReservationId: ticket.reservation_id,
    });
    waitingInventoryByPlayer.set(ticket.player_id, list);
  }
  for (const list of waitingInventoryByPlayer.values()) list.sort((a, b) => a.no - b.no);
  for (const assignment of bundle.bookingAssignments || []) {
    if (assignment.inventory_mode !== "numbered") continue;
    const expected = (bundle.waitingInventoryTickets || []).filter((ticket) => ticket.reservation_id === assignment.reservation_id);
    const issued = (bundle.tickets || []).filter((ticket) => ticket.inventory_reservation_id === assignment.reservation_id);
    const source = (resetToWaiting || room.status === GameState.WAITING) ? expected : issued;
    if (source.length !== Number(assignment.ticket_count) || source.some((ticket) => !ticket.inventory_ticket_id && !ticket.ticket_id)) {
      throw new IntegrityError("a numbered booking's game tickets do not match its reservation", {
        roomId: room.room_code, reservationId: assignment.reservation_id,
      });
    }
    const ids = source.map((ticket) => String(ticket.inventory_ticket_id || ticket.ticket_id));
    const expectedIds = expected.map((ticket) => String(ticket.ticket_id)).sort();
    if (new Set(ids).size !== ids.length || ids.slice().sort().some((id, index) => id !== expectedIds[index])) {
      throw new IntegrityError("a numbered booking's issued ticket identities do not match its active allocation", {
        roomId: room.room_code, reservationId: assignment.reservation_id,
      });
    }
  }
  const storedAwards = bundle.awards || [];
  const membersById = new Map(members.map((member) => [member.player_id, member]));
  const storedClaims = Array.isArray(bundle.claims) ? bundle.claims : null;
  const awardedClaimCounts = new Map();
  if (storedClaims) {
    for (const claim of storedClaims) {
      if (!membersById.has(claim.player_id)) {
        throw new IntegrityError("a claim decision names a participant who is gone", {
          roomId: room.room_code,
          playerId: claim.player_id,
        });
      }
      if (!Number.isInteger(claim.call_index) || claim.call_index < 0 || claim.call_index > calls.length) {
        throw new IntegrityError("a claim decision refers to a call outside the stored history", {
          roomId: room.room_code,
          playerId: claim.player_id,
          callIndex: claim.call_index,
        });
      }
      if (claim.status !== "AWARDED" && claim.status !== "REJECTED") {
        throw new IntegrityError("a claim decision has an unknown status", { roomId: room.room_code, status: claim.status });
      }
      if (claim.status === "AWARDED") {
        const matchingAwards = storedAwards.filter((award) =>
          award.player_id === claim.player_id && award.pattern === claim.pattern && award.call_index === claim.call_index
        );
        if (matchingAwards.length !== 1) {
          throw new IntegrityError("an awarded claim does not match exactly one persisted award", {
            roomId: room.room_code,
            playerId: claim.player_id,
            pattern: claim.pattern,
            callIndex: claim.call_index,
          });
        }
        const key = JSON.stringify([claim.player_id, claim.pattern, claim.call_index]);
        awardedClaimCounts.set(key, (awardedClaimCounts.get(key) || 0) + 1);
      }
    }
    for (const award of storedAwards) {
      const key = JSON.stringify([award.player_id, award.pattern, award.call_index]);
      if (awardedClaimCounts.get(key) !== 1) {
        throw new IntegrityError("a persisted award does not have exactly one matching awarded claim", {
          roomId: room.room_code,
          playerId: award.player_id,
          pattern: award.pattern,
          callIndex: award.call_index,
        });
      }
    }
  }
  const awardOrdinals = new Map();
  const awardWinners = new Set();
  const validatedAwards = [];
  // Migrations before winner attribution may leave these optional columns null.
  // When present, however, the durable relationship must be internally sound.
  for (const award of storedAwards) {
    const definition = PATTERNS[award.pattern];
    if (!definition) {
      throw new IntegrityError("an award exists for unknown pattern " + award.pattern, { roomId: room.room_code });
    }
    if (!membersById.has(award.player_id)) {
      throw new IntegrityError("an award names a participant who is gone", { roomId: room.room_code, playerId: award.player_id });
    }
    if (award.points !== definition.points) {
      throw new IntegrityError("award points do not match pattern " + award.pattern, { roomId: room.room_code });
    }
    if (!Number.isInteger(award.call_index) || award.call_index < 1 || award.call_index > calls.length) {
      throw new IntegrityError("an award refers to a call that is not in the stored history", { roomId: room.room_code });
    }
    if (award.ticket_no != null && (!Number.isInteger(award.ticket_no) || award.ticket_no < 1)) {
      throw new IntegrityError("an award has an invalid ticket number", { roomId: room.room_code });
    }
    const ticketNos = Array.isArray(award.ticket_nos) ? award.ticket_nos :
      (Number.isInteger(award.ticket_no) ? [award.ticket_no] : null);
    if (ticketNos) {
      const owned = new Set((ticketsByPlayer.get(award.player_id) || []).map((ticket) => ticket.no));
      if (!ticketNos.length || ticketNos.some((ticketNo) => !owned.has(ticketNo))) {
        throw new IntegrityError("an award refers to a ticket not held by its winner", { roomId: room.room_code, playerId: award.player_id });
      }
      if (award.ticket_no != null && ticketNos.length === 1 && ticketNos[0] !== award.ticket_no) {
        throw new IntegrityError("award ticket number disagrees with its ticket attribution", { roomId: room.room_code });
      }
    }
    const playerTickets = ticketsByPlayer.get(award.player_id) || [];
    const calledAtAward = calls.slice(0, award.call_index).map((call) => call.number);
    const verdict = evaluateClaimAcrossTickets(award.pattern, playerTickets, calledAtAward, room.config || {}, {
      awards: validatedAwards,
      claimantId: award.player_id,
    });
    if (!verdict.valid) {
      throw new IntegrityError("award pattern was not claimable by its winner at the recorded call: " + verdict.reason, {
        roomId: room.room_code,
        playerId: award.player_id,
        pattern: award.pattern,
        callIndex: award.call_index,
      });
    }
    const winningTickets = new Set(verdict.winningTickets || []);
    if (ticketNos && ticketNos.some((ticketNo) => !winningTickets.has(ticketNo))) {
      throw new IntegrityError("award ticket attribution does not contain a winning ticket", {
        roomId: room.room_code,
        playerId: award.player_id,
        pattern: award.pattern,
      });
    }
    if (ticketNos && PATTERNS[award.pattern].scope === "seat") {
      const attributed = [...ticketNos].sort((a, b) => a - b);
      const actual = [...winningTickets].sort((a, b) => a - b);
      if (attributed.length !== actual.length || attributed.some((ticketNo, index) => ticketNo !== actual[index])) {
        throw new IntegrityError("seat award ticket attribution does not match its winning ticket set", {
          roomId: room.room_code,
          playerId: award.player_id,
          pattern: award.pattern,
        });
      }
    }
    const ordinalKey = award.pattern;
    const winnerKey = award.pattern + "#" + award.player_id;
    if (awardWinners.has(winnerKey)) {
      throw new IntegrityError("the same participant has duplicate awards for pattern " + award.pattern, { roomId: room.room_code });
    }
    const expectedOrdinal = (awardOrdinals.get(ordinalKey) || 0) + 1;
    if (award.winner_ordinal != null && award.winner_ordinal !== expectedOrdinal) {
      throw new IntegrityError("award winner ordinals are not contiguous for pattern " + award.pattern, { roomId: room.room_code });
    }
    awardOrdinals.set(ordinalKey, expectedOrdinal);
    awardWinners.add(winnerKey);
    validatedAwards.push({
      pattern: award.pattern,
      playerId: award.player_id,
      ticketNo: Number.isInteger(award.ticket_no) ? award.ticket_no : null,
      ticketNos: Array.isArray(award.ticket_nos) ? award.ticket_nos.slice() : null,
    });
  }
  const pointsByPlayer = new Map();
  const claimsByPlayer = new Map();
  for (const award of storedAwards) {
    pointsByPlayer.set(award.player_id, (pointsByPlayer.get(award.player_id) || 0) + award.points);
    const list = claimsByPlayer.get(award.player_id) || [];
    list.push(award.pattern);
    claimsByPlayer.set(award.player_id, list);
  }

  const playerSources = members.map((member) => ({
    id: member.player_id,
    name: member.display_name,
    ticketCount: Number.isInteger(member.ticket_count) && member.ticket_count > 0
      ? member.ticket_count
      : (ticketsByPlayer.get(member.player_id) || []).length || 1,
    ticketSelectionLocked: Boolean(member.booking_reservation_id),
    inventoryLocked: (bundle.bookingAssignments || []).some((assignment) =>
      assignment.reservation_id === member.booking_reservation_id && assignment.inventory_mode === "numbered"
    ),
    tickets: (ticketsByPlayer.get(member.player_id) || []).length
      ? ticketsByPlayer.get(member.player_id)
      : (waitingInventoryByPlayer.get(member.player_id) || []),
    points: pointsByPlayer.get(member.player_id) || 0,
    claims: claimsByPlayer.get(member.player_id) || [],
    joinedAt: asMillis(member.joined_at),
  }));

  if (resetToWaiting) {
    const historicalPlayers = playerSources.map((player) => ({
      ...player,
      // A later waiting-room selection may change room_members.ticket_count.
      // The prior round's durable ticket rows are its only surviving count.
      ticketCount: Math.max(player.tickets.length, 1),
    }));
    const historicalRoom = new TambolaRoom({
      roomId: room.room_code,
      config: room.config || {},
      externalScheduler: true,
      hydrate: {
        roomId: room.room_code,
        state: GameState.COMPLETED,
        gameNumber: room.game_number,
        createdAt: asMillis(room.created_at),
        startedAt: asMillis(game.started_at),
        endedAt: asMillis(game.completed_at),
        hostPlayerId: room.host_player_id,
        config: room.config || {},
        players: historicalPlayers,
        draw,
        cursor: calls.length,
        calledNumbers: calls.map((call) => call.number),
        calledAt: calls.map((call) => asMillis(call.called_at)),
        awards: storedAwards.map((award) => ({
          pattern: award.pattern,
          playerId: award.player_id,
          name: award.display_name,
          points: award.points,
          callIndex: award.call_index,
          ticketNo: Number.isInteger(award.ticket_no) ? award.ticket_no : null,
          ticketNos: Array.isArray(award.ticket_nos) ? award.ticket_nos.slice() : null,
          ordinal: Number.isInteger(award.winner_ordinal) ? award.winner_ordinal : null,
          at: asMillis(award.awarded_at),
        })),
      },
    });
    try {
      historicalRoom.assertIntegrity();
    } finally {
      historicalRoom.destroy();
    }
  }

  const activeIds = new Set(active.map((member) => member.player_id));
  const players = resetToWaiting
    ? playerSources.filter((player) => activeIds.has(player.id)).map((player) => ({
      ...player,
      tickets: player.inventoryLocked ? (waitingInventoryByPlayer.get(player.id) || []) : [],
      points: 0,
      claims: [],
    }))
    : playerSources.filter((player) => activeIds.has(player.id));

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
    // The caller console's round clock continues from this timestamp, so a
    // restarted process does not report the round as having just begun.
    startedAt: !resetToWaiting && game ? asMillis(game.started_at) : undefined,
    endedAt: !resetToWaiting && game ? asMillis(game.completed_at) : undefined,
    hostPlayerId: room.host_player_id,
    config: room.config || {},
    players,
    draw: resetToWaiting ? [] : draw,
    cursor: resetToWaiting ? 0 : calls.length,
    calledNumbers: resetToWaiting ? [] : calls.map((call) => call.number),
    calledAt: resetToWaiting ? [] : calls.map((call) => asMillis(call.called_at)),
    awards: (resetToWaiting ? [] : storedAwards).map((award) => ({
      pattern: award.pattern,
      playerId: award.player_id,
      name: award.display_name,
      points: award.points,
      callIndex: award.call_index,
      // Ticket attribution and the award's place in the pattern's own history.
      // Rows written before migration 005 have neither, which the engine reads
      // as "unknown" rather than inventing ticket 1 or ordinal 1.
      ticketNo: Number.isInteger(award.ticket_no) ? award.ticket_no : null,
      ticketNos: Array.isArray(award.ticket_nos) ? award.ticket_nos.slice() : null,
      ordinal: Number.isInteger(award.winner_ordinal) ? award.winner_ordinal : null,
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
