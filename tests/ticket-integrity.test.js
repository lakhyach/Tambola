/**
 * Phase 18: persisted tickets are re-validated before they can be played.
 *
 * The generator already self-checks every grid it mints, but a recovered room
 * replays grids that were written by an earlier process - and nothing on the
 * recovery path used to look at them. These tests pin the rule in both places
 * that rebuild state (engine hydration and persist/recovery) so a corrupt row
 * freezes the room instead of being scored.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { GameState, IntegrityError } from "../server/game/engine.js";
import { buildHydrationSource } from "../server/persist/recovery.js";
import { TICKET_A, TICKET_B, makeRoom } from "./helpers.js";

const FULL_DRAW = Array.from({ length: 90 }, (_, i) => i + 1);

/** A RUNNING hydration source with one seat holding the given tickets. */
function source(tickets, overrides = {}) {
  return {
    roomId: "INTEGRITY1",
    state: GameState.RUNNING,
    gameNumber: 1,
    hostPlayerId: "p1",
    draw: FULL_DRAW,
    calledNumbers: [],
    cursor: 0,
    players: [
      {
        id: "p1",
        name: "Hostess",
        tickets,
        ticketCount: overrides.ticketCount ?? (tickets.length || 1),
        points: 0,
        claims: [],
      },
    ],
    ...overrides.source,
  };
}

function hydrate(tickets, overrides) {
  const h = makeRoom({ roomId: "INTEGRITY1" });
  h.room.hydrateFrom(source(tickets, overrides));
  return h.room;
}

/** TICKET_A with one cell changed to a number outside the column's decade. */
function brokenDecade() {
  const grid = TICKET_A.map((row) => row.slice());
  grid[0][0] = 62; // column 1 is 1-9
  return grid;
}

function assertRefused(room, pattern) {
  assert.throws(
    () => room.assertIntegrity(),
    (error) => {
      assert.ok(error instanceof IntegrityError, "recovery must fail closed, not warn");
      assert.match(error.message, pattern);
      return true;
    }
  );
}

// ------------------------------------------------------------- legal state

test("a room hydrated with legal persisted tickets is trusted", () => {
  const room = hydrate([
    { no: 1, grid: TICKET_A },
    { no: 2, grid: TICKET_B },
  ]);
  assert.deepEqual(room.integrityErrors(), []);
  assert.doesNotThrow(() => room.assertIntegrity());
});

test("a seat that joined a running round is a spectator, not a corruption", () => {
  // mid-round joiners own no ticket by design (tickets lock at start)
  const room = hydrate([], { ticketCount: 1 });
  assert.deepEqual(room.integrityErrors(), []);
});

test("a waiting seat with a count but no minted grids is legal", () => {
  const room = hydrate([], { ticketCount: 3, source: { state: GameState.WAITING, draw: [] } });
  assert.deepEqual(room.integrityErrors(), []);
});

// -------------------------------------------------------- refused state

test("a stored grid that is not a legal Tambola ticket freezes the room", () => {
  const room = hydrate([{ no: 1, grid: brokenDecade() }]);
  assertRefused(room, /not a legal Tambola ticket/);
  assert.match(room.integrityErrors().join(" "), /column 1/);
});

test("a stored ticket with too few numbers is refused", () => {
  const grid = TICKET_A.map((row) => row.slice());
  grid[2][8] = null; // empty the ninth column: a legal ticket fills every one
  const room = hydrate([{ no: 1, grid }]);
  assertRefused(room, /not a legal Tambola ticket/);
  assert.match(room.integrityErrors().join(" "), /found 14/);
});

test("two tickets on one seat sharing a number are refused", () => {
  const room = hydrate([{ no: 1, grid: TICKET_A }, { no: 2, grid: TICKET_B }]);
  assert.deepEqual(room.integrityErrors(), []);
  room.players.get("p1").tickets[1] = { no: 2, grid: TICKET_A.map((r) => r.slice()) };
  assertRefused(room, /same 15 numbers on two tickets/);
});

test("duplicate ticket numbers on one seat are refused", () => {
  const room = hydrate([{ no: 1, grid: TICKET_A }, { no: 2, grid: TICKET_B }]);
  room.players.get("p1").tickets[1].no = 1;
  assertRefused(room, /two tickets numbered 1/);
});

test("an impossible ticket count is refused", () => {
  const room = hydrate([{ no: 1, grid: TICKET_A }]);
  room.players.get("p1").ticketCount = 0;
  assertRefused(room, /impossible ticket count/);
});

test("more grids than the seat chose is refused", () => {
  const room = hydrate([{ no: 1, grid: TICKET_A }, { no: 2, grid: TICKET_B }], { ticketCount: 1 });
  assertRefused(room, /holds 2 tickets but chose 1/);
});

// ------------------------------------------------- recovery source checks

function bundle({ tickets = [], status = GameState.RUNNING } = {}) {
  return {
    room: {
      room_code: "RECOV1",
      status,
      game_number: 1,
      host_player_id: "p1",
      config: {},
      created_at: new Date("2026-10-31T00:00:00Z"),
    },
    game: { draw_sequence: FULL_DRAW, started_at: new Date("2026-10-31T00:01:00Z") },
    members: [{ player_id: "p1", display_name: "Hostess", ticket_count: tickets.length || 1, joined_at: null }],
    tickets,
    calls: [],
    awards: [],
  };
}

test("recovery rejects a stored grid before it reaches the engine", () => {
  assert.throws(
    () => buildHydrationSource(bundle({ tickets: [{ player_id: "p1", ticket_no: 1, grid: brokenDecade() }] })),
    (error) => {
      assert.ok(error instanceof IntegrityError);
      assert.match(error.message, /not a legal Tambola ticket/);
      assert.equal(error.details.roomId, "RECOV1");
      return true;
    }
  );
});

test("recovery rejects two stored rows with the same seat and ticket number", () => {
  assert.throws(
    () =>
      buildHydrationSource(
        bundle({
          tickets: [
            { player_id: "p1", ticket_no: 1, grid: TICKET_A },
            { player_id: "p1", ticket_no: 1, grid: TICKET_B },
          ],
        })
      ),
    /two tickets both numbered 1/
  );
});

test("recovery accepts legal rows and keeps the seat's numbering", () => {
  const source = buildHydrationSource(
    bundle({
      tickets: [
        { player_id: "p1", ticket_no: 2, grid: TICKET_B },
        { player_id: "p1", ticket_no: 1, grid: TICKET_A },
      ],
    })
  );
  assert.equal(source.players[0].tickets.length, 2);
  assert.deepEqual(source.players[0].tickets.map((t) => t.no), [1, 2], "sorted by ticket number");
  assert.deepEqual(source.players[0].tickets[0].grid, TICKET_A);
});
