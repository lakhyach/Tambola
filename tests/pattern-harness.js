/**
 * Shared scaffolding for the five optional winning patterns.
 *
 * Nothing here decides a rule. It only assembles the situations the pattern
 * tests keep asking for: a room whose host has opted into a prize, a seat
 * holding exact tickets, a call history that reaches a chosen state, and a
 * durable room in a throwaway PostgreSQL schema that can be rebuilt from the
 * rows to prove an award outlives the process that paid it.
 */

import { randomBytes } from "node:crypto";
import { makeRoom, makeRng, callSpecific } from "./helpers.js";
import { generateTicket, ticketNumbers } from "../server/game/ticket.js";
import { TambolaRoom } from "../server/game/engine.js";

export const HAS_DB = Boolean(process.env.DATABASE_URL);
export const NEEDS_DB = "no DATABASE_URL - the durable half of this suite needs PostgreSQL";

/** Every number a ticket actually holds. */
export function numbersOf(grid) {
  return ticketNumbers(grid);
}

/** A room whose host opted into the given optional prizes before the round. */
export function optedInRoom(patternIds, options = {}) {
  const h = makeRoom(options);
  const host = h.host();
  const patterns = {};
  for (const id of [].concat(patternIds)) patterns[id] = true;
  const opted = h.room.setPatterns({ patterns, socketId: host.socketId });
  if (!opted.ok) throw new Error("the opt-in fixture failed: " + JSON.stringify(opted));
  return { h, room: h.room, host };
}

/**
 * Force exact tickets onto a seat. Tests reason about concrete numbers; the
 * engine still owns the history and does every verification. Must be called
 * after join and before start, because start() honours what the seat already
 * holds rather than re-minting over it.
 */
export function giveTickets(room, playerId, grids) {
  const player = room.players.get(playerId);
  if (!player) throw new Error("unknown player " + playerId);
  player.tickets = grids.map((grid, index) => ({ no: index + 1, grid }));
  player.ticketCount = grids.length;
  return player;
}

/** Deterministic legal tickets, distinct from each other. */
export function legalTickets(count, seed = 7) {
  const rng = makeRng(seed);
  const grids = [];
  const seen = new Set();
  for (let guard = 0; grids.length < count && guard < count * 60; guard++) {
    const grid = generateTicket(rng);
    const key = numbersOf(grid).join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    grids.push(grid);
  }
  if (grids.length !== count) throw new Error("could not mint " + count + " distinct legal tickets");
  return grids;
}

/**
 * A started room: the host, plus one seat per entry, each holding the exact
 * grids the test reasons about. Tickets are forced before start() for the same
 * reason giveTickets() needs it - after the whistle the engine owns the deal.
 * @param {Array<{name?: string, socketId?: string, grids: Array}>} seats
 */
export function startedRoom(seats, patternIds, options = {}) {
  const { h, room, host } = optedInRoom(patternIds, options);
  const players = seats.map((seat, index) => {
    const joined = h.player(seat.name || "Seat " + (index + 1), seat.socketId || "sock-" + (index + 1));
    giveTickets(room, joined.playerId, seat.grids);
    return { ...joined, grids: seat.grids };
  });
  const started = room.start({ socketId: host.socketId });
  if (!started.ok) throw new Error("start fixture failed: " + JSON.stringify(started));
  return { h, room, host, players };
}

/** Claim through the engine's own player-intent path, credential included. */
export function claim(room, player, pattern, extra = {}) {
  return room.claim({
    playerId: player.playerId,
    playerToken: player.playerToken,
    pattern,
    ...extra,
  });
}

/** The winners a pattern currently has, in the order they were paid. */
export function winners(room, pattern) {
  return (room.awardList().filter((award) => award.pattern === pattern)).map((award) => ({
    playerId: award.playerId,
    name: award.name,
    ticketNo: award.ticketNo,
    ticketNos: award.ticketNos,
    winnerOrdinal: award.winnerOrdinal,
    points: award.points,
    callIndex: award.callIndex,
  }));
}

/**
 * Rebuild a room from the state a persistence layer would have stored, the way
 * recovery.js does at boot: a new TambolaRoom instance, hydrateFrom(), nothing
 * carried over by reference. Proves an award is not merely a variable in this
 * process's memory.
 */
export function rebuild(room) {
  const source = room.publicSnapshot();
  const fresh = new TambolaRoom({
    roomId: room.roomId,
    config: JSON.parse(JSON.stringify({ ...room.config, patterns: room.config.patterns || {} })),
    rng: makeRng(4242),
    now: () => room.now(),
    setTimer: () => 0,
    clearTimer: () => {},
    emit: () => {},
    emitTo: () => {},
    onHostGone: () => {},
  });
  fresh.hydrateFrom({
    state: room.state,
    hostPlayerId: room.hostPlayerId,
    gameNumber: room.gameNumber,
    createdAt: room.createdAt,
    startedAt: room.startedAt,
    endedAt: room.endedAt,
    draw: room.draw,
    calledNumbers: room.calledNumbers,
    cursor: room.cursor,
    // what a durable bundle looks like: grids per seat, plus each award's ticket
    // and ordinal, because those are the fields Second Full House and Half Sheet
    // are judged against
    players: source.players.map((entry) => {
      const live = room.players.get(entry.id);
      return {
        ...entry,
        claims: live ? live.claims.slice() : [],
        ticketCount: entry.tickets,
        tickets: live ? live.tickets.map((t) => ({ no: t.no, grid: t.grid })) : [],
      };
    }),
    awards: source.awards.map((award) => ({ ...award, ordinal: award.winnerOrdinal })),
  });
  return fresh;
}

/** A 1-90 permutation that plays `leading` first, in order, then the rest. */
export function drawLeadingWith(leading) {
  const chosen = [];
  const seen = new Set();
  for (const n of leading) {
    if (!Number.isInteger(n) || n < 1 || n > 90) throw new Error("bad number in leading sequence: " + n);
    if (seen.has(n)) continue;
    seen.add(n);
    chosen.push(n);
  }
  const rest = [];
  for (let n = 1; n <= 90; n++) if (!seen.has(n)) rest.push(n);
  return chosen.concat(rest);
}

/** Call exactly these numbers, in this order, through the test-only history path. */
export function callExact(room, numbers) {
  callSpecific(room, numbers);
}

/** The nth entry of the history (1-based), which is what a completion ordinal names. */
export function ordinalOf(calledNumbers, value) {
  return calledNumbers.indexOf(value) + 1;
}

// ---------------------------------------------------------------- durable rooms

/**
 * Open a throwaway schema with the shipped migrations applied.
 *
 * `newProcess()` hands back a registry and controller that share the STORE but
 * hold nothing in memory, which is how a test says "the server restarted": the
 * room has to be rebuilt from rows, exactly as recovery.js does at boot.
 */
export async function openDurableSchema({ prefix = "pat" } = {}) {
  if (!HAS_DB) throw new Error(NEEDS_DB);
  const schema = "tambola_" + prefix + "_" + randomBytes(4).toString("hex");
  const { createPool } = await import("../server/db/pool.js");
  const { migrate } = await import("../server/db/migrate.js");
  const db = createPool({ connectionString: process.env.DATABASE_URL, schema, log: () => {} });
  await db.query("CREATE SCHEMA IF NOT EXISTS " + schema);
  await migrate({ db, log: () => {} });

  const { createStore } = await import("../server/persist/store.js");
  const { createSessionStore } = await import("../server/persist/sessions.js");
  const { createGameController } = await import("../server/persist/controller.js");
  const { createRoomRegistry } = await import("../server/net/registry.js");

  const store = createStore({ db, log: () => {} });
  const sessions = createSessionStore({ db, log: () => {} });

  function newProcess(config = {}) {
    const registry = createRoomRegistry({
      io: null,
      config: {
        autoCall: false,
        callIntervalMs: 8000,
        disconnectGraceMs: 60000,
        chatIntervalMs: 0,
        patterns: {},
        ...config,
      },
      externalScheduler: true,
      keepHostSeat: true,
      log: () => {},
    });
    const controller = createGameController({ store, sessions, registry, log: () => {}, allowPublicHostSessions: true });
    controller.bindRegistry(registry);
    return { registry, controller };
  }

  async function close() {
    await db.query("DROP SCHEMA IF EXISTS " + schema + " CASCADE").catch(() => {});
    await db.end().catch(() => {});
  }

  async function awardRows({ roomId }) {
    const rows = await db.query(
      `SELECT player_id, pattern, points, call_index, winner_ordinal, ticket_no, ticket_nos
         FROM awards WHERE room_code = $1 ORDER BY award_id`,
      [roomId]
    );
    return rows.rows;
  }

  async function claimRows({ roomId, status = null }) {
    const rows = await db.query(
      status
        ? "SELECT pattern, status, reason, call_index FROM claims WHERE room_code = $1 AND status = $2 ORDER BY claim_id"
        : "SELECT pattern, status, reason, call_index FROM claims WHERE room_code = $1 ORDER BY claim_id",
      status ? [roomId, status] : [roomId]
    );
    return rows.rows;
  }

  async function auditRows({ roomId, type }) {
    const rows = await db.query(
      "SELECT detail FROM audit_events WHERE room_code = $1 AND type = $2 ORDER BY event_id",
      [roomId, type]
    );
    return rows.rows.map((row) => row.detail);
  }

  /**
   * Replace a started room's draw with a permutation the test needs, in BOTH the
   * live room and the stored plan. engine.assertIntegrity() compares the called
   * history against the plan, so writing only one of the two would freeze the
   * room; this writes both and keeps the fixture honest.
   */
  async function setDraw({ room, sequence }) {
    const check = drawLeadingWith(sequence);
    if (check.length !== 90) throw new Error("a replacement draw must be a permutation of 1-90");
    room.draw = check;
    await db.query(
      "UPDATE games SET draw_sequence = $2 WHERE room_code = $1 AND game_number = $3",
      [room.roomId, JSON.stringify(check), room.gameNumber]
    );
    return check;
  }

  return { db, schema, store, sessions, newProcess, close, awardRows, claimRows, auditRows, setDraw };
}
