/**
 * Early Seven - the first ticket on which seven of its fifteen numbers are called.
 *
 * The brief asks for six, seven and eight explicitly, and this suite gives them
 * to it: six must refuse, seven must pay, and eight must neither duplicate nor
 * un-earn the award, because the completion stays pinned to the ordinal of the
 * SEVENTH hit. Every verdict is computed by the server from its own call history.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { ErrorCodes, GameState } from "../server/game/engine.js";
import { ticketNumbers } from "../server/game/ticket.js";
import { EXAMPLE_TICKET } from "../server/game/pattern-geometry.js";
import { claim, callExact, drawLeadingWith, rebuild, startedRoom, winners } from "./pattern-harness.js";
import { TICKET_A, TICKET_B, TICKET_STAR, callThrough, makeRoom } from "./helpers.js";

const ONES = ticketNumbers(EXAMPLE_TICKET);
const SEVEN = [4, 22, 41, 15, 34, 9, 27];
const EIGHTH = 63;

function oneSeat(grids = [EXAMPLE_TICKET], options = {}) {
  return startedRoom([{ name: "Asha", grids }], "earlySeven", options);
}

test("six of the fifteen numbers is not seven", () => {
  const { room, players } = oneSeat();
  callExact(room, SEVEN.slice(0, 6));
  const result = claim(room, players[0], "earlySeven");
  assert.equal(result.ok, false);
  assert.equal(result.code, ErrorCodes.INVALID_STATE);
  assert.equal(result.reason, "fewer than seven ticket numbers called");
  assert.equal(result.needed, 1, "and the refusal says how close the seat was");
  assert.deepEqual(winners(room, "earlySeven"), []);
});

test("seven of the fifteen numbers pays 25 points", () => {
  const { room, players } = oneSeat();
  callExact(room, SEVEN);
  const prepared = room.prepareClaim({
    playerId: players[0].playerId,
    playerToken: players[0].playerToken,
    pattern: "earlySeven",
  });
  assert.equal(prepared.ok, true, prepared.error);
  assert.equal(prepared.prepared.completedOnCall, 7, "the completion is the seventh hit, not the seventh call");

  const result = claim(room, players[0], "earlySeven");
  assert.equal(result.ok, true, result.error);
  assert.equal(result.label, "Early Seven");
  assert.equal(result.points, 25);
  assert.equal(result.ticketNo, 1);
  assert.deepEqual(winners(room, "earlySeven"), [
    {
      playerId: players[0].playerId,
      name: "Asha",
      ticketNo: 1,
      ticketNos: null,
      winnerOrdinal: 1,
      points: 25,
      callIndex: 7,
    },
  ]);
});

test("which seven numbers does not matter - position is not part of the rule", () => {
  // one from each row, and a column-shaped set, both complete on their seventh hit
  const spread = [4, 15, 9, 22, 34, 27, 41];
  const column = [4, 22, 63, 85, 15, 34, 56];
  for (const needed of [spread, column]) {
    assert.equal(new Set(needed).size, 7, "seven different numbers");
    for (const n of needed) assert.equal(ONES.includes(n), true, n + " is on the ticket");
    const { room, players } = oneSeat();
    callExact(room, needed);
    const result = claim(room, players[0], "earlySeven");
    assert.equal(result.ok, true, result.error + " for " + needed.join(","));
  }
});

test("numbers that are not on the ticket count for nothing", () => {
  const { room, players } = oneSeat();
  const notOnTicket = [1, 2, 5, 6, 7, 8, 10];
  for (const n of notOnTicket) assert.equal(ONES.includes(n), false, n + " is not on the ticket");
  callExact(room, notOnTicket);
  const result = claim(room, players[0], "earlySeven");
  assert.equal(result.ok, false);
  assert.equal(result.needed, 7, "seven calls, none of them the seat's");
});

test("an eighth call can neither duplicate the award nor move its completion", () => {
  const { room, players } = oneSeat();
  callExact(room, SEVEN);
  assert.equal(claim(room, players[0], "earlySeven").ok, true);

  callExact(room, [EIGHTH]);
  const again = claim(room, players[0], "earlySeven");
  assert.equal(again.ok, false);
  assert.equal(again.code, ErrorCodes.ALREADY_CLAIMED_BY_YOU);
  assert.equal(winners(room, "earlySeven").length, 1, "the eighth number did not mint a second award");
  assert.equal(room.players.get(players[0].playerId).points, 25, "and did not pay it twice");
});

test("eight numbers before the claim is late under the strict window, on time inside a grace window", () => {
  // the traditional rule: the claim must arrive before the next number
  const strict = oneSeat();
  callExact(strict.room, [...SEVEN, EIGHTH]);
  const refused = claim(strict.room, strict.players[0], "earlySeven");
  assert.equal(refused.ok, false);
  assert.equal(refused.code, ErrorCodes.CLAIM_TOO_LATE, "the pattern completed two calls ago");
  assert.deepEqual(winners(strict.room, "earlySeven"), []);

  // the same room with a two-call grace window: the completion is still the
  // seventh hit (ordinal 7), so lateBy is 1, which is inside the window
  const gracious = oneSeat([EXAMPLE_TICKET], { config: { claimWindowCalls: 2 } });
  callExact(gracious.room, [...SEVEN, EIGHTH]);
  const paid = claim(gracious.room, gracious.players[0], "earlySeven");
  assert.equal(paid.ok, true, paid.error);
  assert.equal(paid.points, 25);
});

test("the server picks which of a seat's tickets reached seven first", () => {
  const { room, players } = oneSeat([TICKET_A, TICKET_STAR]);
  // seven of TICKET_STAR's numbers, only two of TICKET_A's
  callExact(room, [5, 13, 24, 32, 50, 8, 16]);
  const result = claim(room, players[0], "earlySeven");
  assert.equal(result.ok, true, result.error);
  assert.equal(result.ticketNo, 2, "the award goes to the ticket that actually completed");
});

test("two tickets reaching seven on the same call tie by ticket number", () => {
  const { room, players } = oneSeat([TICKET_A, TICKET_STAR]);
  // these seven numbers sit on both tickets, so both complete on the last call
  const shared = [24, 50, 28, 36, 57, 66, 74];
  for (const n of shared) {
    assert.equal(ticketNumbers(TICKET_A).includes(n), true, n + " is on ticket 1");
    assert.equal(ticketNumbers(TICKET_STAR).includes(n), true, n + " is on ticket 2");
  }
  callExact(room, shared);
  const result = claim(room, players[0], "earlySeven");
  assert.equal(result.ok, true, result.error);
  assert.equal(result.ticketNo, 1, "and the prize is still paid once");
  assert.equal(winners(room, "earlySeven").length, 1);
});

test("a seat cannot be paid twice, and only one seat wins the early seven", () => {
  const { room, players } = startedRoom(
    [
      { name: "Asha", grids: [TICKET_A] },
      { name: "Ravi", grids: [TICKET_B] },
    ],
    "earlySeven"
  );
  const sevenB = ticketNumbers(TICKET_B).slice(0, 7);
  callExact(room, [...ticketNumbers(TICKET_A).slice(0, 6), ...sevenB]);
  assert.equal(room.claimability(players[0].playerId, "earlySeven").valid, false, "six for Asha");
  const first = claim(room, players[1], "earlySeven");
  assert.equal(first.ok, true, first.error);
  assert.equal(first.ticketNo, 1);

  const sameSeat = claim(room, players[1], "earlySeven");
  assert.equal(sameSeat.code, ErrorCodes.ALREADY_CLAIMED_BY_YOU);
  const other = claim(room, players[0], "earlySeven");
  assert.equal(other.ok, false, "Asha is short anyway, and the prize is closed regardless");
});

test("a seat five numbers in is told how many more it needs", () => {
  const { room, players } = startedRoom([{ name: "Asha", grids: [TICKET_A] }], "earlySeven");
  callExact(room, ticketNumbers(TICKET_A).slice(0, 5));
  const result = claim(room, players[0], "earlySeven");
  assert.equal(result.ok, false);
  assert.equal(result.needed, 2);
});

test("a claim naming a ticket the seat does not hold is refused", () => {
  const { room, players } = oneSeat();
  callExact(room, SEVEN);
  const result = claim(room, players[0], "earlySeven", { ticketNo: 3 });
  assert.equal(result.reason, "no ticket number 3 belongs to you");
});

test("early seven sits alongside early five without disturbing it", () => {
  const { room, players } = oneSeat();
  callExact(room, SEVEN.slice(0, 5));
  const five = claim(room, players[0], "earlyFive");
  assert.equal(five.ok, true, five.error);

  callExact(room, SEVEN.slice(5));
  const seven = claim(room, players[0], "earlySeven");
  assert.equal(seven.ok, true, seven.error);
  assert.equal(room.players.get(players[0].playerId).points, 45, "20 + 25");
  assert.deepEqual(room.players.get(players[0].playerId).claims, ["earlyFive", "earlySeven"]);
});

test("a room that never opted in has no early seven to claim", () => {
  const h = makeRoom();
  const host = h.host();
  const player = h.player("Asha", "sock-a");
  h.room.start({ socketId: host.socketId });
  callExact(h.room, SEVEN);
  const result = h.room.claim({
    playerId: player.playerId,
    playerToken: player.playerToken,
    pattern: "earlySeven",
  });
  assert.equal(result.code, ErrorCodes.UNKNOWN_PATTERN);
});

test("awarding an early seven neither ends nor extends the round", () => {
  const { h, room, host, players } = oneSeat();
  room.draw = drawLeadingWith(SEVEN);
  callThrough(room, host.socketId, 7);
  assert.equal(claim(room, players[0], "earlySeven").ok, true);
  assert.equal(room.state, GameState.RUNNING);
  callThrough(room, host.socketId, 83);
  assert.equal(room.state, GameState.COMPLETED);
  const late = h.room.claim({
    playerId: players[0].playerId,
    playerToken: players[0].playerToken,
    pattern: "bottomLine",
  });
  assert.equal(late.ok, false, "a completed round takes no more claims");
});

test("a disconnected seat reconnects to the early seven it already won", () => {
  const { room, players } = oneSeat();
  callExact(room, SEVEN);
  assert.equal(claim(room, players[0], "earlySeven").ok, true);
  room.detach("sock-1");
  const resumed = room.resume({
    playerId: players[0].playerId,
    playerToken: players[0].playerToken,
    socketId: "sock-new",
  });
  assert.equal(resumed.ok, true, resumed.error);
  const snapshot = room.playerSnapshot(players[0].playerId);
  assert.equal(snapshot.awards.filter((a) => a.pattern === "earlySeven").length, 1);
  assert.equal(snapshot.points, 25);
});

test("a rebuilt room still remembers the early seven, its ticket and its ordinal", () => {
  const { room, players } = oneSeat();
  callExact(room, SEVEN);
  assert.equal(claim(room, players[0], "earlySeven").ok, true);
  const fresh = rebuild(room);
  assert.deepEqual(winners(fresh, "earlySeven"), winners(room, "earlySeven"));
  const repeat = fresh.claim({ playerId: players[0].playerId, pattern: "earlySeven" });
  assert.equal(repeat.ok, false);
});

test("the eligibility view never offers a claim the evaluator would refuse", () => {
  const { room, players } = oneSeat();
  callExact(room, SEVEN.slice(0, 6));
  assert.equal(room.claimability(players[0].playerId, "earlySeven").valid, false);
  callExact(room, [SEVEN[6]]);
  const after = room.claimability(players[0].playerId, "earlySeven");
  assert.equal(after.valid, true);
  assert.equal(after.ticketNo, 1);
  const result = claim(room, players[0], "earlySeven");
  assert.equal(result.ok, true, result.error);
  assert.equal(result.ticketNo, after.ticketNo);
});

test("the audit trail records the refusal and the payment", () => {
  const { room, players } = oneSeat();
  callExact(room, SEVEN.slice(0, 4));
  assert.equal(claim(room, players[0], "earlySeven").ok, false);
  callExact(room, SEVEN.slice(4));
  assert.equal(claim(room, players[0], "earlySeven").ok, true);
  const types = room.audit.map((entry) => entry.type);
  assert.equal(types.includes("claim-rejected"), true);
  assert.equal(types.includes("claim"), true);
});
