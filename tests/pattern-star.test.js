/**
 * Star - the four corners plus the middle row's third number.
 *
 * Every claim here goes through the engine's player-intent path, so what is
 * under test is the server's own verification: the browser never sends a mark,
 * a point value or a winner flag, only "I claim Star". The five cells come from
 * the same `starCells()` the published diagram is drawn from, which is the
 * guarantee this suite exists to defend.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { ErrorCodes, GameState } from "../server/game/engine.js";
import { ticketNumbers } from "../server/game/ticket.js";
import { EXAMPLE_TICKET, cellValues, starCells } from "../server/game/pattern-geometry.js";
import {
  claim,
  drawLeadingWith,
  callExact,
  rebuild,
  startedRoom,
  winners,
} from "./pattern-harness.js";
import { TICKET_A, TICKET_STAR, callThrough, makeRoom } from "./helpers.js";

/** The Star of the example ticket: 4, 85, 9, 90 and the middle row's 56. */
const STAR_CELLS = starCells(EXAMPLE_TICKET);
const STAR = cellValues(EXAMPLE_TICKET, STAR_CELLS);

/** Star of a seat holding TICKET_A: corners 3, 50, 36, 85 plus 28. */
const STAR_A = cellValues(TICKET_A, starCells(TICKET_A));
const STAR_OTHER = cellValues(TICKET_STAR, starCells(TICKET_STAR));

function oneSeat() {
  return startedRoom([{ name: "Asha", grids: [EXAMPLE_TICKET] }], "star");
}

test("the star fixture means what the diagram says", () => {
  assert.deepEqual(STAR_CELLS, [[0, 0], [0, 8], [2, 0], [2, 8], [1, 5]]);
  assert.deepEqual(STAR, [4, 85, 9, 90, 56]);
  assert.deepEqual(STAR_A, [3, 50, 36, 85, 28]);
  assert.deepEqual(STAR_OTHER, [5, 50, 36, 85, 28]);
});

test("a seat that fills all five star cells is paid, on the ticket that holds them", () => {
  const { h, room, players } = oneSeat();
  callExact(room, [4, 85, 9, 56, 90]);
  const result = claim(room, players[0], "star");
  assert.equal(result.ok, true, result.error);
  assert.equal(result.pattern, "star");
  assert.equal(result.won, true);
  assert.equal(result.points, 25);
  assert.equal(result.label, "Star");
  assert.equal(result.playerId, players[0].playerId);
  assert.equal(result.ticketNo, 1, "the award names the winning ticket");
  assert.equal(room.players.get(players[0].playerId).points, 25);
  assert.deepEqual(winners(room, "star"), [
    {
      playerId: players[0].playerId,
      name: "Asha",
      ticketNo: 1,
      ticketNos: null,
      winnerOrdinal: 1,
      points: 25,
      callIndex: 5,
    },
  ]);
  // the claim event carries the same verdict every client renders
  assert.equal(h.lastEvent("claim:result").pattern, "star");
});

test("every one of the five star cells is required, and a refusal names the missing one", () => {
  for (const cell of STAR_CELLS) {
    const value = EXAMPLE_TICKET[cell[0]][cell[1]];
    const { room, players } = oneSeat();
    callExact(room, STAR.filter((n) => n !== value));
    const result = claim(room, players[0], "star");
    assert.equal(result.ok, false, "star cell " + cell.join(",") + " (" + value + ") is not optional");
    assert.equal(result.code, ErrorCodes.INVALID_STATE);
    assert.equal(result.reason, "star incomplete");
    assert.deepEqual(result.missing, [value], "the refusal names the cell that is still short");
    assert.deepEqual(winners(room, "star"), [], "a refused claim pays nothing");
    assert.equal(room.players.get(players[0].playerId).points, 0);
  }
});

test("four corners are Corners, not Star, and the two prizes can both be won", () => {
  const { room, players } = oneSeat();
  callExact(room, [4, 85, 9, 90]);
  const tooEarly = claim(room, players[0], "star");
  assert.equal(tooEarly.ok, false, "corners alone are the Corners prize");
  assert.deepEqual(tooEarly.missing, [56], "and the refusal says what is still missing");

  const corners = claim(room, players[0], "corners");
  assert.equal(corners.ok, true, corners.error);

  // the centre number lands on the next call: the seat may now take Star as well,
  // alongside a Corners it already banked
  callExact(room, [56]);
  const star = claim(room, players[0], "star");
  assert.equal(star.ok, true, star.error);
  assert.equal(star.points, 25);
  assert.equal(room.players.get(players[0].playerId).points, 45, "20 + 25");
  assert.deepEqual(room.players.get(players[0].playerId).claims, ["corners", "star"]);
});

test("the middle row's third number alone is not a star", () => {
  const { room, players } = oneSeat();
  callExact(room, [56]);
  const result = claim(room, players[0], "star");
  assert.equal(result.ok, false);
  assert.equal(winners(room, "star").length, 0);
});

test("numbers outside the star never fill a gap", () => {
  const { room, players } = oneSeat();
  // fourteen of the ticket's fifteen numbers, everything except the 90 corner
  callExact(room, ticketNumbers(EXAMPLE_TICKET).filter((n) => n !== 90));
  const result = claim(room, players[0], "star");
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, [90], "still short of the 90 corner only");
});

test("a star claim that arrives after the next number is called is refused as late", () => {
  const { room, players } = oneSeat();
  callExact(room, STAR);
  callExact(room, [1]);
  const result = claim(room, players[0], "star");
  assert.equal(result.ok, false);
  assert.equal(result.code, ErrorCodes.CLAIM_TOO_LATE);
  assert.equal(winners(room, "star").length, 0);
});

test("one star per round: a second seat that also completed it is refused", () => {
  const { room, players } = startedRoom(
    [
      { name: "Asha", grids: [EXAMPLE_TICKET] },
      { name: "Ravi", grids: [EXAMPLE_TICKET] },
    ],
    "star"
  );
  callExact(room, STAR);
  const first = claim(room, players[0], "star");
  assert.equal(first.ok, true, first.error);
  const second = claim(room, players[1], "star");
  assert.equal(second.ok, false, "the prize is exclusive");
  assert.equal(second.code, ErrorCodes.ALREADY_AWARDED);
  assert.equal(winners(room, "star").length, 1, "and only one seat is on the board");
});

test("whichever seat lands first takes the star when both completed on the same call", () => {
  for (const order of [
    [0, 1],
    [1, 0],
  ]) {
    const { room, players } = startedRoom(
      [
        { name: "Asha", grids: [EXAMPLE_TICKET] },
        { name: "Ravi", grids: [EXAMPLE_TICKET] },
      ],
      "star"
    );
    callExact(room, STAR);
    const winner = claim(room, players[order[0]], "star");
    const loser = claim(room, players[order[1]], "star");
    assert.equal(winner.ok, true, winner.error);
    assert.equal(loser.code, ErrorCodes.ALREADY_AWARDED);
    assert.deepEqual(winners(room, "star").map((w) => w.playerId), [players[order[0]].playerId]);
  }
});

test("a seat cannot be paid twice for the star it already won", () => {
  const { room, players } = oneSeat();
  callExact(room, STAR);
  assert.equal(claim(room, players[0], "star").ok, true);
  const again = claim(room, players[0], "star");
  assert.equal(again.ok, false);
  assert.equal(again.code, ErrorCodes.ALREADY_CLAIMED_BY_YOU);
  assert.equal(winners(room, "star").length, 1);
});

test("the server picks which of a seat's tickets won, not the claim", () => {
  const { room, players } = startedRoom([{ name: "Asha", grids: [TICKET_A, TICKET_STAR] }], "star");
  // only the second ticket's star is complete - 3 is still uncalled
  callExact(room, [5, 50, 36, 85, 28]);

  const named = claim(room, players[0], "star", { ticketNo: 1 });
  assert.equal(named.ok, false, "ticket 1 is short a corner and says so");
  assert.deepEqual(named.missing, [3]);

  const open = claim(room, players[0], "star");
  assert.equal(open.ok, true, open.error);
  assert.equal(open.ticketNo, 2, "the award is attributed to the ticket that actually completed");
});

test("two tickets completing on the same call tie by ticket number, lowest first", () => {
  const { room, players } = startedRoom([{ name: "Asha", grids: [TICKET_A, TICKET_STAR] }], "star");
  // 3 and 5 both go before the shared four, so both tickets finish on the last call
  callExact(room, [3, 5, 50, 36, 85, 28]);
  const result = claim(room, players[0], "star");
  assert.equal(result.ok, true, result.error);
  assert.equal(result.ticketNo, 1, "the earlier ticket wins the tie, and the prize is still paid once");
  assert.equal(winners(room, "star").length, 1);
});

test("a claim naming a ticket the seat does not hold is refused", () => {
  const { room, players } = oneSeat();
  callExact(room, STAR);
  const result = claim(room, players[0], "star", { ticketNo: 4 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no ticket number 4 belongs to you");
});

test("a room that never opted in has no star to claim", () => {
  const h = makeRoom();
  const host = h.host();
  const player = h.player("Asha", "sock-a");
  h.room.start({ socketId: host.socketId });
  callExact(h.room, STAR);
  const result = h.room.claim({
    playerId: player.playerId,
    playerToken: player.playerToken,
    pattern: "star",
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, ErrorCodes.UNKNOWN_PATTERN);
  assert.equal(h.room.stateView().enabledPatterns.includes("star"), false);
});

test("ending the round closes the star, and a star neither ends nor extends it", () => {
  const { h, room, host, players } = oneSeat();
  room.draw = drawLeadingWith(STAR);
  callThrough(room, host.socketId, 5);
  const result = claim(room, players[0], "star");
  assert.equal(result.ok, true, result.error);
  assert.equal(room.state, GameState.RUNNING, "a star is not the end of the round");
  assert.equal(room.cursor, 5);

  callThrough(room, host.socketId, 85);
  assert.equal(room.state, GameState.COMPLETED, "and the round still ends on all 90 numbers");
  const late = h.room.claim({ playerId: players[0].playerId, playerToken: players[0].playerToken, pattern: "topLine" });
  assert.equal(late.ok, false);
  assert.equal(late.code, ErrorCodes.INVALID_STATE, "no claim survives the final whistle");
});

test("a star claim after the round ended is refused", () => {
  const { h, room, host, players } = oneSeat();
  room.draw = drawLeadingWith(STAR);
  callThrough(room, host.socketId, 90);
  assert.equal(room.state, GameState.COMPLETED);
  const result = h.room.claim({
    playerId: players[0].playerId,
    playerToken: players[0].playerToken,
    pattern: "star",
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, ErrorCodes.INVALID_STATE);
  assert.equal(winners(room, "star").length, 0, "and it was not paid by the side");
});

test("a disconnected seat reconnects to the star it already won", () => {
  const { h, room, players } = oneSeat();
  callExact(room, STAR);
  assert.equal(claim(room, players[0], "star").ok, true);

  room.detach("sock-1");
  const resumed = room.resume({
    playerId: players[0].playerId,
    playerToken: players[0].playerToken,
    socketId: "sock-1-again",
  });
  assert.equal(resumed.ok, true, resumed.error);
  const snapshot = room.playerSnapshot(players[0].playerId);
  assert.equal(snapshot.awards.filter((a) => a.pattern === "star").length, 1);
  assert.equal(snapshot.awards.find((a) => a.pattern === "star").ticketNo, 1);
  assert.equal(snapshot.points, 25);
  assert.deepEqual(snapshot.claims, ["star"]);
  assert.equal(h.room.state, GameState.RUNNING);
});

test("a rebuilt room still remembers the star, its ticket and its ordinal", () => {
  const { room, players } = startedRoom(
    [
      { name: "Asha", grids: [EXAMPLE_TICKET] },
      { name: "Ravi", grids: [EXAMPLE_TICKET] },
    ],
    "star"
  );
  callExact(room, STAR);
  assert.equal(claim(room, players[0], "star").ok, true);

  const fresh = rebuild(room);
  assert.deepEqual(winners(fresh, "star"), winners(room, "star"));
  assert.equal(fresh.players.get(players[0].playerId).points, 25);
  const repeat = fresh.claim({ playerId: players[0].playerId, pattern: "star" });
  assert.equal(repeat.ok, false, "the rebuilt board refuses the winner's repeat");
  assert.equal(repeat.code, ErrorCodes.ALREADY_CLAIMED_BY_YOU);
  const other = fresh.claim({ playerId: players[1].playerId, pattern: "star" });
  assert.equal(other.ok, false, "and refuses a second seat too");
  assert.equal(other.code, ErrorCodes.ALREADY_AWARDED);
  assert.equal(winners(fresh, "star").length, 1, "nothing was paid by the side");
});

test("the eligibility view never offers a claim the evaluator would refuse", () => {
  const { room, players } = oneSeat();
  callExact(room, [4, 85, 9, 56]);
  const before = room.claimability(players[0].playerId, "star");
  assert.equal(before.valid, false, "four of five cells is not yet claimable");

  callExact(room, [90]);
  const after = room.claimability(players[0].playerId, "star");
  assert.equal(after.valid, true);
  assert.equal(after.ticketNo, 1);
  const result = claim(room, players[0], "star");
  assert.equal(result.ok, true, "and the claim the panel offered really does pay");
  assert.equal(result.ticketNo, after.ticketNo, "on the ticket the panel named");
});

test("the audit trail records the refusal and the payment", () => {
  const { room, players } = oneSeat();
  callExact(room, [4, 85, 9]);
  assert.equal(claim(room, players[0], "star").ok, false);
  callExact(room, [56, 90]);
  assert.equal(claim(room, players[0], "star").ok, true);
  const types = room.audit.map((entry) => entry.type);
  assert.equal(types.includes("claim-rejected"), true, "an invalid attempt is logged");
  assert.equal(types.includes("claim"), true, "and so is the accepted one");
  const rejected = room.audit.find((entry) => entry.type === "claim-rejected");
  assert.equal(rejected.pattern, "star");
});
