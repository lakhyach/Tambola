/**
 * Box - every numbered cell of the three middle columns (30-39, 40-49, 50-59).
 *
 * The block's size follows the ticket: three cells at the shallowest, nine at the
 * deepest, because a legal ticket holds one to three numbers per column. That is
 * why this suite tests the extremes as well as the example ticket, and why it
 * keeps proving Box is not the Corners prize under another name.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { ErrorCodes, GameState } from "../server/game/engine.js";
import { ticketNumbers, validateTicket } from "../server/game/ticket.js";
import { EXAMPLE_TICKET, boxCells, cellValues, cornerCells } from "../server/game/pattern-geometry.js";
import { claim, callExact, drawLeadingWith, rebuild, startedRoom, winners } from "./pattern-harness.js";
import { TICKET_PACKED, TICKET_SHALLOW, callThrough, makeRoom } from "./helpers.js";

const BOX = cellValues(EXAMPLE_TICKET, boxCells(EXAMPLE_TICKET));
const BOX_SHALLOW = cellValues(TICKET_SHALLOW, boxCells(TICKET_SHALLOW));
const BOX_PACKED = cellValues(TICKET_PACKED, boxCells(TICKET_PACKED));

function oneSeat(grid = EXAMPLE_TICKET) {
  return startedRoom([{ name: "Asha", grids: [grid] }], "box");
}

test("the box fixtures mean what the diagram says", () => {
  assert.deepEqual(boxCells(EXAMPLE_TICKET), [[1, 3], [2, 3], [0, 4], [1, 5], [2, 5]]);
  assert.deepEqual(BOX, [34, 38, 41, 56, 59]);
  for (const grid of [TICKET_SHALLOW, TICKET_PACKED]) {
    assert.equal(validateTicket(grid).valid, true, "and both extremes of the block are legal tickets");
  }
  assert.deepEqual(BOX_SHALLOW, [35, 45, 55], "the shallowest possible block is three cells");
  assert.equal(BOX_PACKED.length, 9, "the deepest is the Box of 9: " + BOX_PACKED.join(","));
});

test("a seat that fills its whole block is paid 25 points on that ticket", () => {
  const { h, room, players } = oneSeat();
  callExact(room, [34, 38, 41, 59, 56]);
  const result = claim(room, players[0], "box");
  assert.equal(result.ok, true, result.error);
  assert.equal(result.label, "Box");
  assert.equal(result.points, 25);
  assert.equal(result.ticketNo, 1);
  assert.deepEqual(winners(room, "box"), [
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
  assert.equal(h.lastEvent("claim:result").pattern, "box");
});

test("every cell of the block is required - the example ticket, one cell at a time", () => {
  for (const cell of boxCells(EXAMPLE_TICKET)) {
    const value = EXAMPLE_TICKET[cell[0]][cell[1]];
    const { room, players } = oneSeat();
    callExact(room, BOX.filter((n) => n !== value));
    const result = claim(room, players[0], "box");
    assert.equal(result.ok, false, "box cell " + cell.join(",") + " (" + value + ") is not optional");
    assert.equal(result.reason, "box incomplete");
    assert.deepEqual(result.missing, [value]);
    assert.deepEqual(winners(room, "box"), []);
  }
});

test("the shallow block of three pays, and loses on any one of its three cells", () => {
  for (const drop of BOX_SHALLOW) {
    const { room, players } = oneSeat(TICKET_SHALLOW);
    callExact(room, BOX_SHALLOW.filter((n) => n !== drop));
    const result = claim(room, players[0], "box");
    assert.equal(result.ok, false, "a block of three still needs all three: " + drop + " is missing");
    assert.deepEqual(result.missing, [drop]);
  }
  const { room, players } = oneSeat(TICKET_SHALLOW);
  callExact(room, BOX_SHALLOW);
  assert.equal(claim(room, players[0], "box").ok, true, "and three is enough when that is the whole block");
});

test("the full block of nine pays only when all nine are called", () => {
  const { room, players } = oneSeat(TICKET_PACKED);
  callExact(room, BOX_PACKED.slice(0, 8));
  const short = claim(room, players[0], "box");
  assert.equal(short.ok, false);
  assert.deepEqual(short.missing, [BOX_PACKED[8]], "the ninth cell is the one still short");

  callExact(room, [BOX_PACKED[8]]);
  const result = claim(room, players[0], "box");
  assert.equal(result.ok, true, result.error);
  assert.equal(result.points, 25, "the prize does not scale with the block, only the rule does");
});

test("numbers outside the block never fill a gap", () => {
  const { room, players } = oneSeat();
  callExact(room, ticketNumbers(EXAMPLE_TICKET).filter((n) => !BOX.includes(n)));
  const result = claim(room, players[0], "box");
  assert.equal(result.ok, false, "ten of fifteen numbers, none of them in the block");
  assert.deepEqual(result.missing, BOX);
});

test("box is not corners: the four corners do not complete it, and both prizes can be won", () => {
  const { room, players } = oneSeat();
  const corners = cellValues(EXAMPLE_TICKET, cornerCells(EXAMPLE_TICKET));
  callExact(room, corners);
  const asBox = claim(room, players[0], "box");
  assert.equal(asBox.ok, false, "corners is its own prize");
  assert.deepEqual(asBox.missing, BOX);
  assert.equal(claim(room, players[0], "corners").ok, true, "and paying corners does not pay box");

  callExact(room, BOX);
  const box = claim(room, players[0], "box");
  assert.equal(box.ok, true, box.error);
  assert.equal(room.players.get(players[0].playerId).points, 45, "20 corners + 25 box");
});

test("a box claim that arrives after the next number is called is refused as late", () => {
  const { room, players } = oneSeat();
  callExact(room, BOX);
  callExact(room, [1]);
  const result = claim(room, players[0], "box");
  assert.equal(result.code, ErrorCodes.CLAIM_TOO_LATE);
  assert.equal(result.ok, false);
});

test("one box per round, whoever lands first", () => {
  for (const first of [0, 1]) {
    const { room, players } = startedRoom(
      [
        { name: "Asha", grids: [EXAMPLE_TICKET] },
        { name: "Ravi", grids: [EXAMPLE_TICKET] },
      ],
      "box"
    );
    callExact(room, BOX);
    const winner = claim(room, players[first], "box");
    assert.equal(winner.ok, true, winner.error);
    const loser = claim(room, players[1 - first], "box");
    assert.equal(loser.ok, false, "the prize is exclusive");
    assert.equal(loser.code, ErrorCodes.ALREADY_AWARDED);
    assert.deepEqual(winners(room, "box").map((w) => w.playerId), [players[first].playerId]);
  }
});

test("a seat cannot be paid twice for the box it already won", () => {
  const { room, players } = oneSeat();
  callExact(room, BOX);
  assert.equal(claim(room, players[0], "box").ok, true);
  const again = claim(room, players[0], "box");
  assert.equal(again.code, ErrorCodes.ALREADY_CLAIMED_BY_YOU);
});

test("the server picks which of a seat's tickets won the block", () => {
  const { room, players } = startedRoom([{ name: "Asha", grids: [TICKET_SHALLOW, EXAMPLE_TICKET] }], "box");
  callExact(room, BOX_SHALLOW);
  const named = claim(room, players[0], "box", { ticketNo: 2 });
  assert.equal(named.ok, false, "ticket 2 has none of its block called");
  assert.deepEqual(named.missing, BOX);

  const open = claim(room, players[0], "box");
  assert.equal(open.ok, true, open.error);
  assert.equal(open.ticketNo, 1, "ticket 1 is the one that completed");
});

test("a claim naming a ticket the seat does not hold is refused", () => {
  const { room, players } = oneSeat();
  callExact(room, BOX);
  const result = claim(room, players[0], "box", { ticketNo: 3 });
  assert.equal(result.reason, "no ticket number 3 belongs to you");
});

test("a room that never opted in has no box to claim", () => {
  const h = makeRoom();
  const host = h.host();
  const player = h.player("Asha", "sock-a");
  h.room.start({ socketId: host.socketId });
  callExact(h.room, BOX);
  const result = h.room.claim({ playerId: player.playerId, playerToken: player.playerToken, pattern: "box" });
  assert.equal(result.code, ErrorCodes.UNKNOWN_PATTERN);
  assert.equal(h.room.stateView().enabledPatterns.includes("box"), false);
});

test("awarding a box neither ends nor extends the round", () => {
  const { h, room, host, players } = oneSeat();
  room.draw = drawLeadingWith(BOX);
  callThrough(room, host.socketId, BOX.length);
  assert.equal(claim(room, players[0], "box").ok, true);
  assert.equal(room.state, GameState.RUNNING);
  callThrough(room, host.socketId, 90 - BOX.length);
  assert.equal(room.state, GameState.COMPLETED, "the round still ends on all 90 numbers, not before");
  const late = h.room.claim({ playerId: players[0].playerId, playerToken: players[0].playerToken, pattern: "box" });
  assert.equal(late.ok, false, "and a finished round takes no more claims");
});

test("a disconnected seat reconnects to the box it already won", () => {
  const { room, players } = oneSeat();
  callExact(room, BOX);
  assert.equal(claim(room, players[0], "box").ok, true);
  room.detach("sock-1");
  const resumed = room.resume({
    playerId: players[0].playerId,
    playerToken: players[0].playerToken,
    socketId: "sock-again",
  });
  assert.equal(resumed.ok, true, resumed.error);
  const snapshot = room.playerSnapshot(players[0].playerId);
  assert.equal(snapshot.awards.filter((a) => a.pattern === "box").length, 1);
  assert.equal(snapshot.points, 25);
});

test("a rebuilt room still remembers the box, its ticket and its ordinal", () => {
  const { room, players } = oneSeat(TICKET_PACKED);
  callExact(room, BOX_PACKED);
  assert.equal(claim(room, players[0], "box").ok, true);
  const fresh = rebuild(room);
  assert.deepEqual(winners(fresh, "box"), winners(room, "box"));
  const repeat = fresh.claim({ playerId: players[0].playerId, pattern: "box" });
  assert.equal(repeat.ok, false);
  assert.equal(repeat.code, ErrorCodes.ALREADY_CLAIMED_BY_YOU);
});

test("the eligibility view never offers a claim the evaluator would refuse", () => {
  const { room, players } = oneSeat();
  callExact(room, BOX.slice(0, 4));
  assert.equal(room.claimability(players[0].playerId, "box").valid, false);
  callExact(room, [BOX[4]]);
  const after = room.claimability(players[0].playerId, "box");
  assert.equal(after.valid, true);
  assert.equal(after.ticketNo, 1);
  const result = claim(room, players[0], "box");
  assert.equal(result.ok, true, result.error);
  assert.equal(result.ticketNo, after.ticketNo);
});

test("the audit trail records the refusal and the payment", () => {
  const { room, players } = oneSeat();
  callExact(room, [34, 38]);
  assert.equal(claim(room, players[0], "box").ok, false);
  callExact(room, [41, 56, 59]);
  assert.equal(claim(room, players[0], "box").ok, true);
  const types = room.audit.map((entry) => entry.type);
  assert.equal(types.includes("claim-rejected"), true);
  assert.equal(types.includes("claim"), true);
});
