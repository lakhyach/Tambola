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
import { PATTERNS, evaluateClaimAcrossTickets } from "../server/game/patterns.js";
import { generateTicket } from "../server/game/ticket.js";
import { TICKET_A, TICKET_B, makeRoom, makeRng } from "./helpers.js";

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

test("a hydrated room rejects stored draws that are not permutations of 1–90", () => {
  const repeated = FULL_DRAW.slice();
  repeated[89] = repeated[88];
  const repeatedRoom = hydrate([{ no: 1, grid: TICKET_A }], { source: { draw: repeated } });
  assertRefused(repeatedRoom, /draw contains a repeated number|not a permutation of 1-90/);

  const outOfRange = FULL_DRAW.slice();
  outOfRange[89] = 91;
  const outOfRangeRoom = hydrate([{ no: 1, grid: TICKET_A }], { source: { draw: outOfRange } });
  assertRefused(outOfRangeRoom, /not a permutation of 1-90/);
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
    game: { game_number: 1, status: "RUNNING", draw_sequence: FULL_DRAW, started_at: new Date("2026-10-31T00:01:00Z") },
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

test("recovery rejects room/game lifecycle split-brain", () => {
  assert.throws(
    () => buildHydrationSource(bundle({ status: GameState.COMPLETED })),
    /lifecycle states do not agree/
  );
  assert.throws(
    () => buildHydrationSource(bundle({ status: GameState.WAITING })),
    /unfinished game row/
  );
});

test("reset waiting recovery validates but does not hydrate the prior completed game's projection", () => {
  const previousRound = bundle({
    status: GameState.WAITING,
    tickets: [{ player_id: "p1", ticket_no: 1, grid: TICKET_A }],
  });
  previousRound.game.status = "COMPLETED";
  previousRound.game.completed_at = new Date("2026-10-31T00:03:00Z");
  previousRound.calls = [{ call_index: 1, number: FULL_DRAW[0], source: "host", called_at: new Date() }];

  const source = buildHydrationSource(previousRound);
  assert.equal(source.state, GameState.WAITING);
  assert.deepEqual(source.draw, []);
  assert.deepEqual(source.calledNumbers, []);
  assert.equal(source.cursor, 0);
  assert.deepEqual(source.players[0].tickets, []);

  previousRound.calls[0].number = FULL_DRAW[1];
  assert.throws(
    () => buildHydrationSource(previousRound),
    /stored draw says/,
    "completed history still has to pass integrity checks before the room reopens"
  );
});

test("reset waiting recovery still validates prior award history before omitting it from the new round", () => {
  const previousRound = bundle({
    status: GameState.WAITING,
    tickets: [{ player_id: "p1", ticket_no: 1, grid: TICKET_A }],
  });
  previousRound.game.status = "COMPLETED";
  previousRound.game.completed_at = new Date("2026-10-31T00:03:00Z");
  previousRound.awards = [{
    player_id: "p1",
    display_name: "Hostess",
    pattern: "not-a-supported-pattern",
    points: 5,
    call_index: 1,
    winner_ordinal: 1,
    ticket_no: 1,
  }];

  assert.throws(() => buildHydrationSource(previousRound), /unknown pattern/);
});

test("recovery rejects awards whose points, call, winner, or ticket attribution is corrupt", () => {
  const base = bundle({ tickets: [{ player_id: "p1", ticket_no: 1, grid: TICKET_A }] });
  base.calls = FULL_DRAW.slice(0, 24).map((number, index) => ({ call_index: index + 1, number, source: "host", called_at: new Date() }));
  const award = {
    player_id: "p1", display_name: "Hostess", pattern: "earlyFive", points: 20,
    call_index: 24, winner_ordinal: 1, ticket_no: 1,
  };
  base.awards = [award];
  assert.doesNotThrow(() => buildHydrationSource(base));

  for (const [change, expected] of [
    [{ points: 21 }, /points do not match pattern/],
    [{ call_index: 25 }, /refers to a call that is not in the stored history/],
    [{ call_index: 5 }, /not claimable by its winner at the recorded call/],
    [{ player_id: "missing" }, /participant who is gone/],
    [{ ticket_no: 2 }, /ticket not held by its winner/],
  ]) {
    const corrupted = { ...base, awards: [{ ...award, ...change }] };
    assert.throws(() => buildHydrationSource(corrupted), expected);
  }
});

test("recovery cross-checks awarded claim history while retaining rejected decisions", () => {
  const fixture = bundle({ tickets: [{ player_id: "p1", ticket_no: 1, grid: TICKET_A }] });
  fixture.calls = FULL_DRAW.slice(0, 24).map((number, index) => ({ call_index: index + 1, number, source: "host", called_at: new Date() }));
  const award = {
    player_id: "p1", display_name: "Hostess", pattern: "earlyFive", points: 20,
    call_index: 24, winner_ordinal: 1, ticket_no: 1,
  };
  const winningClaim = { player_id: "p1", pattern: "earlyFive", status: "AWARDED", call_index: 24 };
  fixture.awards = [award];
  fixture.claims = [winningClaim, { player_id: "p1", pattern: "legacyOrUnknown", status: "REJECTED", call_index: 24 }];
  assert.doesNotThrow(() => buildHydrationSource(fixture), "a real award and even an unknown-pattern rejection remain recoverable");

  for (const claims of [
    [],
    [{ ...winningClaim, call_index: 23 }],
    [winningClaim, winningClaim],
    [winningClaim, { player_id: "missing", pattern: "earlyFive", status: "REJECTED", call_index: 24 }],
    [winningClaim, { player_id: "p1", pattern: "earlyFive", status: "REJECTED", call_index: 25 }],
  ]) {
    assert.throws(() => buildHydrationSource({ ...fixture, claims }), /claim|Claim|participant|history/i);
  }
});

test("recovery rejects duplicate or non-contiguous award ordinals", () => {
  const fixture = bundle({ tickets: [{ player_id: "p1", ticket_no: 1, grid: TICKET_A }] });
  fixture.calls = FULL_DRAW.slice(0, 24).map((number, index) => ({ call_index: index + 1, number, source: "host", called_at: new Date() }));
  fixture.awards = [
    { player_id: "p1", display_name: "Hostess", pattern: "earlyFive", points: 20, call_index: 24, winner_ordinal: 2, ticket_no: 1 },
  ];
  assert.throws(() => buildHydrationSource(fixture), /ordinals are not contiguous/);
  fixture.awards[0].winner_ordinal = 1;
  fixture.awards.push({ ...fixture.awards[0] });
  assert.throws(() => buildHydrationSource(fixture), /duplicate awards/);
});

test("recovery requires seat-scoped awards to retain the complete winning ticket set", () => {
  const grids = [TICKET_A, TICKET_B];
  for (let seed = 1; grids.length < 3; seed++) {
    const grid = generateTicket(makeRng(seed));
    if (!grids.some((existing) => JSON.stringify(existing) === JSON.stringify(grid))) grids.push(grid);
  }
  const tickets = grids.map((grid, index) => ({ no: index + 1, grid }));
  const config = { patterns: { halfSheet: true } };
  let callIndex = 0;
  let verdict;
  for (let count = 1; count <= FULL_DRAW.length; count++) {
    verdict = evaluateClaimAcrossTickets("halfSheet", tickets, FULL_DRAW.slice(0, count), config, { claimantId: "p1" });
    if (verdict.valid) { callIndex = count; break; }
  }
  assert.ok(verdict?.valid, "the deterministic full draw eventually completes the seat pattern");
  const fixture = bundle({ tickets: tickets.map((ticket) => ({ player_id: "p1", ticket_no: ticket.no, grid: ticket.grid })) });
  fixture.room.config = config;
  fixture.calls = FULL_DRAW.slice(0, callIndex).map((number, index) => ({ call_index: index + 1, number, source: "host", called_at: new Date() }));
  const award = {
    player_id: "p1", display_name: "Hostess", pattern: "halfSheet", points: PATTERNS.halfSheet.points,
    call_index: callIndex, winner_ordinal: 1, ticket_no: verdict.ticketNo, ticket_nos: verdict.winningTickets,
  };
  fixture.awards = [award];
  assert.doesNotThrow(() => buildHydrationSource(fixture));

  fixture.awards = [{ ...award, ticket_nos: [verdict.winningTickets[0]] }];
  assert.throws(() => buildHydrationSource(fixture), /does not match its winning ticket set/);
});
