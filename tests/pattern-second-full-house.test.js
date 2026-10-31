/**
 * Second Full House - the next ticket to finish all fifteen, after the first.
 *
 * This is the pattern the settlement engine was inspected for. It is a separate
 * registry key, so it arbitrates on its own lock and its own winner list, but it
 * reads the first Full House's award, including WHICH TICKET took it. Two rules
 * hold it in shape: nothing is claimable before the first is awarded, and the
 * winning ticket can never be paid a second time - while a different player's
 * identically numbered ticket, or a second ticket of the same seat, stays fair
 * game. Enabling it changes nothing about when the round ends.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { ErrorCodes, GameState } from "../server/game/engine.js";
import { ticketNumbers } from "../server/game/ticket.js";
import { EXAMPLE_TICKET } from "../server/game/pattern-geometry.js";
import { claim, callExact, drawLeadingWith, giveTickets, rebuild, startedRoom, winners } from "./pattern-harness.js";
import { TICKET_A, TICKET_B, callThrough, makeRoom } from "./helpers.js";

// Full House is an approved rule and is on by default, so only second place needs
// opting in - and a room may not switch the approved rule off either.
const SECOND_ONLY = "secondFullHouse";
const A15 = ticketNumbers(TICKET_A);
const B15 = ticketNumbers(TICKET_B);
const EXAMPLE15 = ticketNumbers(EXAMPLE_TICKET);

function twoSeats() {
  return startedRoom(
    [
      { name: "Asha", grids: [TICKET_A] },
      { name: "Ravi", grids: [TICKET_B] },
    ],
    SECOND_ONLY
  );
}

test("there is no second place until the first full house is awarded", () => {
  const { room, players } = twoSeats();
  callExact(room, A15);
  const early = claim(room, players[0], "secondFullHouse");
  assert.equal(early.ok, false, "a finished ticket is not yet a SECOND finished ticket");
  assert.equal(early.reason, "the first Full House has not been claimed yet, so there is no second place to claim");
  assert.deepEqual(winners(room, "secondFullHouse"), []);

  const first = claim(room, players[0], "fullHouse");
  assert.equal(first.ok, true, first.error);
  assert.equal(first.points, 30, "and the first place still pays its own 30, not the second place's 15");
});

test("the next ticket to finish all fifteen wins the second full house", () => {
  const { room, players } = twoSeats();
  callExact(room, A15);
  assert.equal(claim(room, players[0], "fullHouse").ok, true);

  callExact(room, B15);
  const second = claim(room, players[1], "secondFullHouse");
  assert.equal(second.ok, true, second.error);
  assert.equal(second.label, "Second Full House");
  assert.equal(second.points, 15);
  assert.equal(second.ticketNo, 1, "Ravi's own first ticket, which the exclusion must not confuse with Asha's");
  assert.deepEqual(winners(room, "fullHouse"), [
    {
      playerId: players[0].playerId,
      name: "Asha",
      ticketNo: 1,
      ticketNos: null,
      winnerOrdinal: 1,
      points: 30,
      callIndex: 15,
    },
  ]);
  assert.deepEqual(winners(room, "secondFullHouse"), [
    {
      playerId: players[1].playerId,
      name: "Ravi",
      ticketNo: 1,
      ticketNos: null,
      winnerOrdinal: 1,
      points: 15,
      callIndex: 30,
    },
  ]);
  assert.equal(room.players.get(players[0].playerId).points, 30);
  assert.equal(room.players.get(players[1].playerId).points, 15);
  assert.deepEqual(
    room.awardList().map((a) => a.pattern),
    ["fullHouse", "secondFullHouse"],
    "the board keeps them as two separate awards, in the order they landed"
  );
});

test("the ticket that won the first full house can never win the second", () => {
  const { room, players } = twoSeats();
  callExact(room, A15);
  assert.equal(claim(room, players[0], "fullHouse").ok, true);

  const repeat = claim(room, players[0], "secondFullHouse");
  assert.equal(repeat.ok, false, "Asha's ticket 1 is spent on that position");
  assert.equal(repeat.reason, "your ticket 1 already won the first Full House, so it cannot win the second");
  assert.deepEqual(winners(room, "secondFullHouse"), []);
  assert.equal(room.players.get(players[0].playerId).points, 30, "and no points moved");
});

test("a fourteen-number ticket is refused with the number still missing", () => {
  const { room, players } = twoSeats();
  callExact(room, A15);
  assert.equal(claim(room, players[0], "fullHouse").ok, true);
  callExact(room, B15.slice(0, 14));
  const short = claim(room, players[1], "secondFullHouse");
  assert.equal(short.ok, false);
  assert.equal(short.reason, "full house incomplete");
  assert.deepEqual(short.missing, [B15[14]]);
});

test("one seat may take first on one ticket and second on another", () => {
  const { room, players } = startedRoom([{ name: "Asha", grids: [TICKET_A, TICKET_B] }], SECOND_ONLY);
  callExact(room, A15);
  const first = claim(room, players[0], "fullHouse");
  assert.equal(first.ok, true, first.error);
  assert.equal(first.ticketNo, 1);

  // Asha's only other ticket is now the next one to finish
  callExact(room, B15);
  const named = claim(room, players[0], "secondFullHouse", { ticketNo: 1 });
  assert.equal(named.ok, false, "and the claim cannot point at the ticket that already won");
  assert.equal(named.reason, "your ticket 1 already won the first Full House, so it cannot win the second");

  const second = claim(room, players[0], "secondFullHouse");
  assert.equal(second.ok, true, second.error);
  assert.equal(second.ticketNo, 2, "a different ticket of the same seat is a different ticket");
  assert.equal(second.points, 15);
  assert.equal(room.players.get(players[0].playerId).points, 45, "30 + 15, never 30 + 30");
  assert.deepEqual(room.players.get(players[0].playerId).claims, ["fullHouse", "secondFullHouse"]);

  const again = claim(room, players[0], "secondFullHouse");
  assert.equal(again.code, ErrorCodes.ALREADY_CLAIMED_BY_YOU, "and the same seat is not paid twice for second place");
});

test("two seats finishing on the same call split first and second", () => {
  const { room, players } = startedRoom(
    [
      { name: "Asha", grids: [EXAMPLE_TICKET] },
      { name: "Ravi", grids: [EXAMPLE_TICKET] },
      { name: "Meena", grids: [EXAMPLE_TICKET] },
    ],
    SECOND_ONLY
  );
  callExact(room, EXAMPLE15);
  for (const seat of players) {
    assert.equal(room.claimability(seat.playerId, "fullHouse").valid, true, "all three tickets are finished");
  }

  const first = claim(room, players[0], "fullHouse");
  assert.equal(first.ok, true, first.error);

  const winnerTriesSecond = claim(room, players[0], "secondFullHouse");
  assert.equal(winnerTriesSecond.ok, false, "and the first-place seat is barred by its own ticket");
  assert.equal(winnerTriesSecond.reason, "your ticket 1 already won the first Full House, so it cannot win the second");

  const second = claim(room, players[1], "secondFullHouse");
  assert.equal(second.ok, true, second.error, "Ravi's ticket 1 is his own, so the exclusion does not bar him");
  assert.equal(second.ticketNo, 1);

  const third = claim(room, players[2], "secondFullHouse");
  assert.equal(third.ok, false, "second place is one prize, not a queue");
  assert.equal(third.code, ErrorCodes.ALREADY_AWARDED);

  assert.equal(winners(room, "fullHouse").length, 1);
  assert.equal(winners(room, "secondFullHouse").length, 1);
});

test("a second full house claim that arrives after the next number is called is refused as late", () => {
  const { room, players } = twoSeats();
  callExact(room, A15);
  assert.equal(claim(room, players[0], "fullHouse").ok, true);
  callExact(room, B15);
  callExact(room, [1, 2]);
  const late = claim(room, players[1], "secondFullHouse");
  assert.equal(late.ok, false);
  assert.equal(late.code, ErrorCodes.CLAIM_TOO_LATE);
  assert.deepEqual(winners(room, "secondFullHouse"), []);
});

test("a claim naming a ticket the seat does not hold is refused", () => {
  const { room, players } = twoSeats();
  callExact(room, A15);
  assert.equal(claim(room, players[0], "fullHouse").ok, true);
  callExact(room, B15);
  const result = claim(room, players[1], "secondFullHouse", { ticketNo: 3 });
  assert.equal(result.reason, "no ticket number 3 belongs to you");
});

test("awarding the first full house does not end the round while second place is live", () => {
  const { room, host, players } = twoSeats();
  room.draw = drawLeadingWith([...A15, ...B15]);
  callThrough(room, host.socketId, 15);
  assert.equal(room.state, GameState.RUNNING, "fifteen calls is nowhere near the end");

  const first = claim(room, players[0], "fullHouse");
  assert.equal(first.ok, true, first.error);
  assert.equal(room.state, GameState.RUNNING, "and the first full house did not finish the game");

  callThrough(room, host.socketId, 15);
  assert.equal(room.state, GameState.RUNNING, "the second ticket is now finished but not yet claimed");
  const second = claim(room, players[1], "secondFullHouse");
  assert.equal(second.ok, true, second.error);
  assert.equal(room.state, GameState.RUNNING, "nor did the second full house finish it");

  callThrough(room, host.socketId, 60);
  assert.equal(room.state, GameState.COMPLETED, "the round ends on all 90 numbers, as it always did");
});

test("an unclaimed second full house does not keep the game running", () => {
  const { h, room, host, players } = twoSeats();
  callExact(room, A15);
  assert.equal(claim(room, players[0], "fullHouse").ok, true);
  assert.equal(room.state, GameState.RUNNING);

  const ended = room.end({ socketId: host.socketId });
  assert.equal(ended.ok, true, ended.error);
  assert.equal(room.state, GameState.COMPLETED, "the host can still close the round with second place unresolved");
  assert.deepEqual(winners(room, "secondFullHouse"), [], "and an unclaimed prize is simply not paid");
  const late = h.room.claim({
    playerId: players[1].playerId,
    playerToken: players[1].playerToken,
    pattern: "secondFullHouse",
  });
  assert.equal(late.code, ErrorCodes.INVALID_STATE, "with no attempt to pay it afterwards");
});

test("a room that never opted in pays nothing for second place", () => {
  const h = makeRoom();
  const host = h.host();
  const asha = h.player("Asha", "sock-a");
  const ravi = h.player("Ravi", "sock-b");
  giveTickets(h.room, asha.playerId, [TICKET_A]);
  giveTickets(h.room, ravi.playerId, [TICKET_B]);
  h.room.start({ socketId: host.socketId });
  callExact(h.room, A15);
  const first = h.room.claim({ playerId: asha.playerId, playerToken: asha.playerToken, pattern: "fullHouse" });
  assert.equal(first.ok, true, first.error);
  callExact(h.room, B15);
  const result = h.room.claim({ playerId: ravi.playerId, playerToken: ravi.playerToken, pattern: "secondFullHouse" });
  assert.equal(result.ok, false);
  assert.equal(result.code, ErrorCodes.UNKNOWN_PATTERN, "the name is not a prize until the room opts into it");
  assert.equal(h.room.awardList().filter((a) => a.pattern === "secondFullHouse").length, 0);
});

test("reconnect and recovery keep both awards and the ticket that earned the first", () => {
  const { room, players } = twoSeats();
  callExact(room, A15);
  assert.equal(claim(room, players[0], "fullHouse").ok, true);
  callExact(room, B15);
  assert.equal(claim(room, players[1], "secondFullHouse").ok, true);

  room.detach("sock-1");
  const resumed = room.resume({
    playerId: players[0].playerId,
    playerToken: players[0].playerToken,
    socketId: "sock-again",
  });
  assert.equal(resumed.ok, true, resumed.error);
  const snapshot = room.playerSnapshot(players[0].playerId);
  assert.deepEqual(snapshot.claims, ["fullHouse"]);
  assert.deepEqual(
    snapshot.awards.map((a) => [a.pattern, a.name, a.ticketNo]),
    [
      ["fullHouse", "Asha", 1],
      ["secondFullHouse", "Ravi", 1],
    ]
  );

  // a rebuilt board keeps both rows, and keeps refusing repeats of them
  const fresh = rebuild(room);
  assert.deepEqual(winners(fresh, "fullHouse"), winners(room, "fullHouse"));
  assert.deepEqual(winners(fresh, "secondFullHouse"), winners(room, "secondFullHouse"));
  const repeat = fresh.claim({ playerId: players[0].playerId, pattern: "secondFullHouse" });
  assert.equal(repeat.ok, false);
  assert.equal(repeat.code, ErrorCodes.ALREADY_AWARDED, "Ravi took second place on the rebuilt board too");
  assert.equal(winners(fresh, "secondFullHouse").length, 1, "and nothing new was paid by the side");

  // and when second place is still open on the rebuilt board, the exclusion must
  // still know WHICH ticket won the first - that only works if the award's ticket
  // number survived the restart
  const only = twoSeats();
  callExact(only.room, A15);
  assert.equal(claim(only.room, only.players[0], "fullHouse").ok, true);
  const rebuilt = rebuild(only.room);
  const barred = rebuilt.claim({ playerId: only.players[0].playerId, pattern: "secondFullHouse" });
  assert.equal(barred.ok, false);
  assert.equal(barred.reason, "your ticket 1 already won the first Full House, so it cannot win the second");
  const otherSeat = rebuilt.claim({ playerId: only.players[1].playerId, pattern: "secondFullHouse" });
  assert.equal(otherSeat.ok, false, "Ravi is not finished yet, so nobody may take it on his ticket");
  assert.equal(otherSeat.reason, "full house incomplete");
});

test("the eligibility view never offers a second full house the evaluator would refuse", () => {
  const { room, players } = twoSeats();
  callExact(room, A15);
  assert.equal(claim(room, players[0], "fullHouse").ok, true);

  // Ravi's ticket is not finished and first place is paid: not claimable yet
  assert.equal(room.claimability(players[1].playerId, "secondFullHouse").valid, false);
  assert.equal(room.claimability(players[1].playerId, "secondFullHouse").reason, "full house incomplete");

  callExact(room, B15);
  const after = room.claimability(players[1].playerId, "secondFullHouse");
  assert.equal(after.valid, true, "Ravi's ticket is finished and the first place has been paid");
  assert.equal(after.ticketNo, 1);
  const result = claim(room, players[1], "secondFullHouse");
  assert.equal(result.ok, true, result.error);
  assert.equal(result.ticketNo, after.ticketNo);

  const winnerAgain = room.claimability(players[0].playerId, "secondFullHouse");
  assert.equal(winnerAgain.valid, false, "and the panel never offers Asha what the evaluator would refuse");
});

test("the audit trail records the refusal, the payment and both awards", () => {
  const { room, players } = twoSeats();
  callExact(room, A15);
  assert.equal(claim(room, players[1], "secondFullHouse").ok, false, "no first place yet");
  assert.equal(claim(room, players[0], "fullHouse").ok, true);
  callExact(room, B15);
  assert.equal(claim(room, players[1], "secondFullHouse").ok, true);
  const types = room.audit.map((entry) => entry.type);
  assert.equal(types.includes("claim-rejected"), true);
  assert.equal(types.filter((type) => type === "claim").length, 2);
  const paid = room.audit.filter((entry) => entry.type === "claim").map((entry) => entry.pattern);
  assert.deepEqual(paid, ["fullHouse", "secondFullHouse"]);
});
