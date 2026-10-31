/**
 * Shared harness for the engine/pattern tests.
 *
 * The engine is transport-free and takes its rng, clock, timers and emitters by
 * injection, so every test below runs deterministically: no sockets, no real
 * time, no real crypto. Recorded emissions let us assert exactly what a client
 * would have been sent.
 */

import { createRoom } from "../server/game/engine.js";
import { ticketNumbers } from "../server/game/ticket.js";

/** Deterministic integer source in [0, max) so a failure is reproducible. */
export function makeRng(seed = 1) {
  let state = (seed >>> 0) || 1;
  return function next(max) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state % max;
  };
}

/**
 * A legal ticket built by hand, so tests can reason about concrete numbers.
 *
 *   top row    3 11 24 31 -- 50 -- -- --   -> 3, 11, 24, 31, 50
 *   middle row 7 15 28 -- 42 -- 61 -- --   -> 7, 15, 28, 42, 61
 *   bottom --  -- -- 36 -- 57 66 74 85     -> 36, 57, 66, 74, 85
 */
export const TICKET_A = [
  [3, 11, 24, 31, null, 50, null, null, null],
  [7, 15, 28, null, 42, null, 61, null, null],
  [null, null, null, 36, null, 57, 66, 74, 85],
];

/** Second legal ticket, disjoint from TICKET_A so two players never tie. */
export const TICKET_B = [
  [4, 12, 25, 32, null, 51, null, null, null],
  [8, 16, 29, null, 43, null, 62, null, null],
  [null, null, null, 37, null, 58, 67, 75, 86],
];

export const TOP_LINE = [3, 11, 24, 31, 50];
export const MIDDLE_LINE = [7, 15, 28, 42, 61];
export const BOTTOM_LINE = [36, 57, 66, 74, 85];
export const CORNERS = [3, 50, 36, 85];
export const ALL_FIFTEEN = ticketNumbers(TICKET_A);

export function makeRoom(options = {}) {
  const events = [];
  const direct = [];
  const timers = new Map();
  let timerSeq = 0;
  let clock = options.startClock ?? 1_700_000_000_000;

  const room = createRoom({
    roomId: options.roomId || "TESTROOM",
    config: {
      autoCall: false,
      chatIntervalMs: 0,
      disconnectGraceMs: 60_000,
      ...(options.config || {}),
    },
    rng: options.rng || makeRng(options.seed ?? 12345),
    now: () => clock,
    setTimer: (fn, ms) => {
      const id = ++timerSeq;
      timers.set(id, { fn, due: clock + ms });
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id);
    },
    emit: (event, payload) => events.push({ event, payload }),
    emitTo: (socketId, event, payload) => direct.push({ socketId, event, payload }),
    onHostGone: options.onHostGone || (() => {}),
  });

  const harness = {
    room,
    events,
    direct,
    timers,
    eventsNamed(name) {
      return events.filter((entry) => entry.event === name);
    },
    lastEvent(name) {
      const found = harness.eventsNamed(name);
      return found.length ? found[found.length - 1].payload : null;
    },
    /** Join as host and mark the room's owner. */
    host(name = "Hostess", socketId = "sock-host") {
      const joined = room.join({ name, socketId });
      if (!joined.ok) throw new Error("host join failed: " + joined.error);
      room.setHost({ socketId, playerId: joined.playerId });
      return { ...joined, socketId };
    },
    /** Join as a plain player. */
    player(name = "Player", socketId = "sock-player") {
      const joined = room.join({ name, socketId });
      if (!joined.ok) throw new Error("player join failed: " + joined.error);
      return { ...joined, socketId };
    },
    /** Move the fake clock forward, firing any timer that comes due. */
    advance(ms) {
      const target = clock + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.due <= target)
          .sort((a, b) => a[1].due - b[1].due);
        if (!due.length) break;
        const [id, timer] = due[0];
        timers.delete(id);
        clock = timer.due;
        timer.fn();
      }
      clock = target;
    },
    now: () => clock,
  };

  return harness;
}

/**
 * Force a ticket onto a player. Tests use this to reason about exact numbers;
 * the engine still owns the call history and does all verification.
 */
export function giveTicket(room, playerId, ticket) {
  const player = room.players.get(playerId);
  if (!player) throw new Error("unknown player " + playerId);
  player.tickets = [{ no: 1, grid: ticket }];
  player.ticketCount = 1;
  return player;
}

/** Call numbers in the given order through the host intent path. */
export function callThrough(room, hostSocketId, count) {
  const calls = [];
  for (let i = 0; i < count; i++) {
    const result = room.callNext({ socketId: hostSocketId });
    if (!result.ok) throw new Error("call failed: " + result.error);
    calls.push(result.number);
  }
  return calls;
}

/**
 * Drive the draw manually so a set of numbers becomes officially called,
 * regardless of shuffle order. Used for pattern verification tests.
 */
export function callSpecific(room, numbers) {
  for (const number of numbers) {
    room.calledNumbers.push(number);
    room.calledSet.add(number);
    room.cursor += 1;
  }
}

/** Collect every numeric value and every object key inside a structure. */
export function walk(value, keys, numbers) {
  if (value === null || value === undefined) return;
  if (typeof value === "number") {
    numbers.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walk(item, keys, numbers);
    return;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      keys.add(key);
      walk(item, keys, numbers);
    }
  }
}
