/**
 * Half Sheet - two of a ticket's own numbers called on each of three tickets.
 *
 * This is the one pattern of the five that is not judged on a single ticket, so
 * it is the one that runs through the seat-scope branch of the evaluator: the
 * server looks at the tickets one seat holds, picks the three that reached two
 * marks earliest, and names them in the award. A client never sends a count of
 * marked cells; it sends "I claim Half Sheet" and takes the verdict.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { ErrorCodes, GameState } from "../server/game/engine.js";
import { EXAMPLE_TICKET } from "../server/game/pattern-geometry.js";
import { evaluateClaim } from "../server/game/patterns.js";
import { claim, callExact, rebuild, startedRoom, winners } from "./pattern-harness.js";
import { TICKET_A, TICKET_B, TICKET_STAR, makeRoom } from "./helpers.js";

const FOUR = [TICKET_A, TICKET_B, TICKET_STAR, EXAMPLE_TICKET];
const ON = "halfSheet";

/** one seat, three tickets, two marks on each: the pattern is complete */
function readySeat(options = {}) {
  const fixture = startedRoom([{ name: "Asha", grids: FOUR.slice(0, 3) }], ON, options);
  callExact(fixture.room, [3, 11, 4, 12, 13, 5]);
  return fixture;
}

test("two marks on each of three tickets wins the half sheet", () => {
  const { h, room, players } = readySeat();
  const result = claim(room, players[0], ON);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.label, "Half Sheet");
  assert.equal(result.points, 20);
  assert.deepEqual(result.ticketNos, [1, 2, 3], "the award names all three tickets it was judged on");
  assert.equal(result.ticketNo, 1, "and its lead ticket, so a one-column view still says something true");
  assert.equal(room.players.get(players[0].playerId).points, 20);
  assert.deepEqual(winners(room, ON), [
    {
      playerId: players[0].playerId,
      name: "Asha",
      ticketNo: 1,
      ticketNos: [1, 2, 3],
      winnerOrdinal: 1,
      points: 20,
      callIndex: 6,
    },
  ]);
  assert.equal(h.lastEvent("claim:result").pattern, ON);
});

test("one mark short of the third ticket refuses and says how many are needed", () => {
  const { room, players } = startedRoom([{ name: "Asha", grids: FOUR.slice(0, 3) }], ON);
  callExact(room, [3, 11, 4, 12, 13]);
  const result = claim(room, players[0], ON);
  assert.equal(result.ok, false);
  assert.equal(result.code, ErrorCodes.INVALID_STATE);
  assert.equal(result.reason, "only 2 of your tickets have two numbers called");
  assert.equal(result.needed, 1);
  assert.deepEqual(winners(room, ON), []);
});

test("a seat with fewer than three tickets cannot win a half sheet at all", () => {
  for (const grids of [[TICKET_A], [TICKET_A, TICKET_B]]) {
    const { room, players } = startedRoom([{ name: "Asha", grids }], ON);
    callExact(room, [3, 11, 4, 12]);
    const result = claim(room, players[0], ON);
    assert.equal(result.ok, false, "two tickets is not a half sheet");
    assert.equal(result.reason, "half sheet needs three tickets, this seat holds " + grids.length);
  }
});

test("marks piled on one ticket do not make up a half sheet", () => {
  const { room, players } = startedRoom([{ name: "Asha", grids: FOUR.slice(0, 3) }], ON);
  // five of ticket 1's own numbers: nothing on the other two
  callExact(room, [3, 11, 31, 7, 15]);
  const result = claim(room, players[0], ON);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "only 1 of your tickets have two numbers called");
  assert.equal(result.needed, 2);
});

test("numbers that belong to none of the seat's tickets count for nothing", () => {
  const { room, players } = startedRoom([{ name: "Asha", grids: FOUR.slice(0, 3) }], ON);
  callExact(room, [90, 89, 87, 84, 83, 82]);
  for (const grid of FOUR.slice(0, 3)) {
    for (const n of [90, 89, 87, 84, 83, 82]) assert.equal(grid.flat().includes(n), false, n + " is on nobody");
  }
  const result = claim(room, players[0], ON);
  assert.equal(result.ok, false);
  assert.equal(result.needed, 3);
});

test("the three tickets that reach two marks earliest are the ones named", () => {
  // The window here is only a fixture: this test is about WHICH tickets the
  // server names, and the claim has to be allowed to arrive at all. Being late
  // is its own test further down.
  const wide = { config: { claimWindowCalls: 4 } };
  const completionOf = (fixture) => fixture.room.claimability(fixture.players[0].playerId, ON).completedOnCall;
  // ticket 4 gets its marks last, so the prize is paid on tickets 1-3 and its
  // completion stays pinned to ticket 3's second mark (call 6)
  const a = startedRoom([{ name: "Asha", grids: FOUR }], ON, wide);
  callExact(a.room, [3, 11, 4, 12, 13, 5, 22, 63]);
  assert.equal(completionOf(a), 6, "the pattern closed on ticket 3's second mark");
  const first = claim(a.room, a.players[0], ON);
  assert.equal(first.ok, true, first.error);
  assert.deepEqual(first.ticketNos, [1, 2, 3], "the late fourth ticket is not part of the award");

  // and when it is ticket 1 that arrives last, the server names 2, 3 and 4 instead
  const b = startedRoom([{ name: "Babita", grids: FOUR }], ON, wide);
  callExact(b.room, [4, 12, 13, 5, 22, 63, 3, 11]);
  assert.equal(completionOf(b), 5, "ticket 4's second mark closed it, not ticket 1's");
  const second = claim(b.room, b.players[0], ON);
  assert.equal(second.ok, true, second.error);
  assert.deepEqual(second.ticketNos, [2, 3, 4], "the earliest three win, whichever numbers they are");
  assert.equal(second.ticketNo, 2);
});

test("a half sheet claim that waits two calls past the completion is refused", () => {
  const { room, players } = startedRoom([{ name: "Asha", grids: FOUR }], ON, { config: { claimWindowCalls: 2 } });
  callExact(room, [4, 12, 13, 5, 22, 63]);
  assert.equal(claim(room, players[0], ON).ok, true, "inside the window it pays");

  const other = startedRoom([{ name: "Asha", grids: FOUR }], ON);
  callExact(other.room, [4, 12, 13, 5, 22, 63]);
  callExact(other.room, [3, 11]);
  const late = claim(other.room, other.players[0], ON);
  assert.equal(late.ok, false);
  assert.equal(late.code, ErrorCodes.CLAIM_TOO_LATE, "under the traditional rule the next number closes it");
});

test("one half sheet per round, whoever lands first", () => {
  const { room, players } = startedRoom(
    [
      { name: "Asha", grids: FOUR.slice(0, 3) },
      { name: "Ravi", grids: FOUR.slice(0, 3) },
    ],
    ON
  );
  callExact(room, [3, 11, 4, 12, 13, 5]);
  const first = claim(room, players[0], ON);
  assert.equal(first.ok, true, first.error);
  const second = claim(room, players[1], ON);
  assert.equal(second.ok, false, "both seats qualified, but the prize is exclusive");
  assert.equal(second.code, ErrorCodes.ALREADY_AWARDED);
  assert.equal(winners(room, ON).length, 1);

  const repeat = claim(room, players[0], ON);
  assert.equal(repeat.code, ErrorCodes.ALREADY_CLAIMED_BY_YOU, "and the winner cannot be paid twice");
});

test("a seat-scoped pattern refuses a claim pointed at one ticket", () => {
  const { room, players } = readySeat();
  const result = claim(room, players[0], ON, { ticketNo: 1 });
  assert.equal(result.ok, false, "half sheet is a seat rule, so naming a single ticket cannot satisfy it");
  assert.equal(result.reason, "half sheet needs three tickets, this seat holds 1");
});

test("a claim naming a ticket the seat does not hold is refused", () => {
  const { room, players } = readySeat();
  const result = claim(room, players[0], ON, { ticketNo: 9 });
  assert.equal(result.reason, "no ticket number 9 belongs to you");
});

test("the single-ticket evaluator refuses rather than inventing an answer", () => {
  const verdict = evaluateClaim(ON, TICKET_A, [3, 11, 4, 12, 13, 5], { patterns: { halfSheet: true } });
  assert.equal(verdict.valid, false);
  assert.equal(verdict.reason, "half sheet is judged across three of your tickets, not on one");
});

test("a room that never opted in has no half sheet to claim", () => {
  const h = makeRoom();
  const host = h.host();
  const player = h.player("Asha", "sock-a");
  h.room.start({ socketId: host.socketId });
  const result = h.room.claim({ playerId: player.playerId, playerToken: player.playerToken, pattern: ON });
  assert.equal(result.code, ErrorCodes.UNKNOWN_PATTERN);
});

test("awarding a half sheet neither ends nor extends the round", () => {
  const { h, room, host, players } = readySeat();
  assert.equal(claim(room, players[0], ON).ok, true);
  assert.equal(room.state, GameState.RUNNING);
  const ended = room.end({ socketId: host.socketId });
  assert.equal(ended.ok, true, ended.error);
  assert.equal(room.state, GameState.COMPLETED);
  const late = h.room.claim({ playerId: players[0].playerId, playerToken: players[0].playerToken, pattern: ON });
  assert.equal(late.code, ErrorCodes.INVALID_STATE, "and a completed round takes no more claims");
});

test("a half sheet does not disturb the ticket-scoped prizes", () => {
  const { room, players } = readySeat();
  assert.equal(claim(room, players[0], ON).ok, true);
  // the seat's ticket 1 has only two marks, so no line is finished and no full
  // house exists: the other prizes stay honestly closed
  for (const pattern of ["topLine", "middleLine", "bottomLine", "fullHouse", "corners"]) {
    const result = claim(room, players[0], pattern);
    assert.equal(result.ok, false, pattern + " is not won by two marks on each of three tickets");
  }
  assert.equal(room.players.get(players[0].playerId).points, 20);
});

test("a disconnected seat reconnects to the half sheet it already won", () => {
  const { room, players } = readySeat();
  assert.equal(claim(room, players[0], ON).ok, true);
  room.detach("sock-1");
  const resumed = room.resume({
    playerId: players[0].playerId,
    playerToken: players[0].playerToken,
    socketId: "sock-again",
  });
  assert.equal(resumed.ok, true, resumed.error);
  const snapshot = room.playerSnapshot(players[0].playerId);
  const award = snapshot.awards.find((a) => a.pattern === ON);
  assert.deepEqual(award.ticketNos, [1, 2, 3]);
  assert.equal(snapshot.points, 20);
});

test("a rebuilt room still remembers the half sheet and the three tickets it named", () => {
  const { room, players } = readySeat();
  assert.equal(claim(room, players[0], ON).ok, true);
  const fresh = rebuild(room);
  assert.deepEqual(winners(fresh, ON), winners(room, ON), "including ticketNos, which the award is made of");
  const repeat = fresh.claim({ playerId: players[0].playerId, pattern: ON });
  assert.equal(repeat.ok, false);
  assert.equal(repeat.code, ErrorCodes.ALREADY_CLAIMED_BY_YOU);
});

test("the eligibility view never offers a claim the evaluator would refuse", () => {
  const { room, players } = startedRoom([{ name: "Asha", grids: FOUR.slice(0, 3) }], ON);
  callExact(room, [3, 11, 4, 12, 13]);
  assert.equal(room.claimability(players[0].playerId, ON).valid, false);
  callExact(room, [5]);
  const after = room.claimability(players[0].playerId, ON);
  assert.equal(after.valid, true);
  assert.deepEqual(after.ticketNos, [1, 2, 3]);
  const result = claim(room, players[0], ON);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.ticketNos, after.ticketNos);
});

test("the audit trail records the refusal and the payment", () => {
  const { room, players } = startedRoom([{ name: "Asha", grids: FOUR.slice(0, 2) }], ON);
  callExact(room, [3, 11, 4, 12]);
  assert.equal(claim(room, players[0], ON).ok, false, "two tickets is not enough");
  const paid = startedRoom([{ name: "Champa", grids: FOUR.slice(0, 3) }], ON);
  callExact(paid.room, [3, 11, 4, 12, 13, 5]);
  assert.equal(claim(paid.room, paid.players[0], ON).ok, true);
  const types = room.audit.map((entry) => entry.type);
  assert.equal(types.includes("claim-rejected"), true);
  assert.equal(paid.room.audit.some((entry) => entry.type === "claim"), true);
});
