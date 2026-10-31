/**
 * PHASE 15 · Phase E — claim correctness and the edge cases a real round hits.
 *
 * These are engine-level tests on the injected clock/timers, so every scenario
 * below is deterministic: no sockets, no sleeping, no shuffled tickets. What is
 * pinned here:
 *
 *   - the completion ordinal every pattern reports (the basis of the window)
 *   - the shipped default rule: claim before the next number is called
 *   - grace windows, and turning the rule off, as configuration
 *   - two seats completing the same prize on the same call (one is paid)
 *   - one seat winning two different prizes on one call
 *   - duplicate claims, ticketless claims, claims after the final whistle
 *   - a claim prepared just before the game ends, and one prepared just before
 *     the next call lands (the durable prepare -> commit gap)
 */

import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, ErrorCodes } from "../server/game/engine.js";
import { evaluateClaim } from "../server/game/patterns.js";
import {
  makeRoom,
  giveTicket,
  callSpecific,
  callThrough,
  TICKET_A,
  TOP_LINE,
  MIDDLE_LINE,
  BOTTOM_LINE,
  CORNERS,
  ALL_FIFTEEN,
} from "./helpers.js";

const HOST_AUTH = (host) => ({ socketId: host.socketId });

/** Start a round with one ticketed player, ready to be driven by callSpecific. */
function seated(options = {}) {
  const h = makeRoom(options);
  const host = h.host();
  const alice = h.player("Alice", "sock-a");
  h.room.start(HOST_AUTH(host));
  giveTicket(h.room, alice.playerId, options.ticket || TICKET_A);
  return { h, host, alice };
}

const claimAs = (h, alice, pattern, extra = {}) =>
  h.room.claim({ playerId: alice.playerId, playerToken: alice.playerToken, pattern, ...extra });

// ------------------------------------------------------- completion ordinals

test("every pattern reports the call that completed it", () => {
  const cases = [
    ["earlyFive", [3, 11, 24, 31, 50], 5],
    ["topLine", TOP_LINE, 5],
    ["middleLine", MIDDLE_LINE, 5],
    ["bottomLine", BOTTOM_LINE, 5],
    ["corners", CORNERS, 4],
    ["fullHouse", ALL_FIFTEEN, 15],
  ];
  for (const [pattern, calls, expected] of cases) {
    const verdict = evaluateClaim(pattern, TICKET_A, calls, {});
    assert.equal(verdict.valid, true, pattern + " should be complete");
    assert.equal(verdict.completedOnCall, expected, pattern + " completed on call " + expected);
  }
});

test("completion is the LAST required number, not the first or the count", () => {
  // corners in a deliberately awkward order: the completing number is the third
  const verdict = evaluateClaim("corners", TICKET_A, [3, 50, 85, 36], {});
  assert.equal(verdict.completedOnCall, 4);
});

// ------------------------------------------------------------- the shipped rule

test("the shipped default is the traditional rule: claim before the next call", () => {
  assert.equal(DEFAULT_CONFIG.claimWindowCalls, 0);
});

test("a claim on the completing call wins; one call later it is too late", () => {
  const { h, alice } = seated();

  callSpecific(h.room, TOP_LINE);
  const onTime = claimAs(h, alice, "topLine");
  assert.equal(onTime.ok, true, JSON.stringify(onTime));
  assert.equal(h.room.players.get(alice.playerId).points, 10);

  callSpecific(h.room, BOTTOM_LINE);
  callSpecific(h.room, [2]); // one more call: the window has closed
  const tooLate = claimAs(h, alice, "bottomLine");
  assert.equal(tooLate.ok, false);
  assert.equal(tooLate.code, ErrorCodes.CLAIM_TOO_LATE);
  assert.equal(tooLate.late, true);
  assert.match(tooLate.reason, /claim too late/);
  assert.equal(h.room.players.get(alice.playerId).points, 10, "nothing was paid for the late claim");
  assert.equal(h.room.awards.has("bottomLine"), false);
});

test("window 1 gives exactly one call of grace", () => {
  const { h, alice } = seated({ config: { claimWindowCalls: 1 } });

  callSpecific(h.room, TOP_LINE);
  callSpecific(h.room, [2]);
  const withinGrace = claimAs(h, alice, "topLine");
  assert.equal(withinGrace.ok, true, JSON.stringify(withinGrace));

  callSpecific(h.room, MIDDLE_LINE);
  callSpecific(h.room, [4, 6]);
  const beyondGrace = claimAs(h, alice, "middleLine");
  assert.equal(beyondGrace.ok, false);
  assert.equal(beyondGrace.code, ErrorCodes.CLAIM_TOO_LATE);
});

test("a negative window turns the rule off, for rooms that prefer the old grace", () => {
  const { h, alice } = seated({ config: { claimWindowCalls: -1 } });
  callSpecific(h.room, ALL_FIFTEEN);
  callSpecific(h.room, [1, 2, 4, 6, 8, 9, 10, 12, 13, 14]);
  const lateButAllowed = claimAs(h, alice, "fullHouse");
  assert.equal(lateButAllowed.ok, true, JSON.stringify(lateButAllowed));
});

// ------------------------------------------------------------- races and ties

test("two seats completing the same prize on the same call: exactly one is paid", () => {
  const h = makeRoom();
  const host = h.host();
  const alice = h.player("Alice", "sock-a");
  const bob = h.player("Bob", "sock-b");
  h.room.start(HOST_AUTH(host));
  // the same fifteen numbers on both tickets: both complete on the same call
  giveTicket(h.room, alice.playerId, TICKET_A);
  giveTicket(h.room, bob.playerId, TICKET_A);
  callSpecific(h.room, ALL_FIFTEEN);

  const first = claimAs(h, alice, "fullHouse");
  const second = claimAs(h, bob, "fullHouse");
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.code, ErrorCodes.ALREADY_AWARDED);
  assert.equal(h.room.players.get(alice.playerId).points, 30);
  assert.equal(h.room.players.get(bob.playerId).points, 0, "the loser was not paid");
  assert.equal(h.room.awards.get("fullHouse").length, 1, "one award, not two");
});

test("one seat can win two different prizes on the same call", () => {
  const { h, alice } = seated();

  // The fifth call of this ticket completes Early Five AND the Top Line at
  // once; both claims land on that same call, so both are inside the window.
  callSpecific(h.room, TOP_LINE);
  assert.equal(claimAs(h, alice, "earlyFive").ok, true);
  assert.equal(claimAs(h, alice, "topLine").ok, true);

  // The last call of the ticket completes the corners and the full house together.
  callSpecific(h.room, [...MIDDLE_LINE, ...BOTTOM_LINE]);
  assert.equal(claimAs(h, alice, "corners").ok, true);
  assert.equal(claimAs(h, alice, "fullHouse").ok, true);

  assert.equal(h.room.players.get(alice.playerId).points, 20 + 10 + 20 + 30);
  assert.equal(h.room.claimLog.filter((entry) => entry.accepted).length, 4);
  assert.equal(h.room.awards.size, 4, "four separate prizes, one seat");
});

test("claiming the same prize twice never pays twice", () => {
  const { h, alice } = seated();
  callSpecific(h.room, TOP_LINE);
  assert.equal(claimAs(h, alice, "topLine").ok, true);
  const again = claimAs(h, alice, "topLine");
  assert.equal(again.ok, false);
  assert.equal(again.code, ErrorCodes.ALREADY_CLAIMED_BY_YOU);
  assert.equal(h.room.players.get(alice.playerId).points, 10);
});

test("a seat that joined mid-round has no ticket and cannot claim anything", () => {
  const h = makeRoom();
  const host = h.host();
  h.player("Alice", "sock-a");
  h.room.start(HOST_AUTH(host));
  callSpecific(h.room, TOP_LINE);

  // A seat present at the start is dealt a ticket; a spectator who arrives after
  // the first call is deliberately not, and the server says so rather than
  // inventing one. Phase D saw the same thing in a real browser.
  const watcher = h.player("Watcher", "sock-w");
  assert.deepEqual(h.room.players.get(watcher.playerId).tickets, []);

  const refused = h.room.claim({ playerId: watcher.playerId, playerToken: watcher.playerToken, pattern: "earlyFive" });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, ErrorCodes.NOT_PLAYER);
  assert.match(refused.error, /no ticket/);
});

// -------------------------------------------------- endings and prepare/commit

test("once the round is completed, claims are refused rather than paid", () => {
  const { h, host, alice } = seated();
  callSpecific(h.room, ALL_FIFTEEN);
  h.room.end(HOST_AUTH(host));
  const refused = claimAs(h, alice, "fullHouse");
  assert.equal(refused.ok, false);
  assert.equal(refused.code, ErrorCodes.INVALID_STATE);
  assert.equal(h.room.awards.size, 0);
});

test("the 90th call ends the round, so a claim arriving after it is refused", () => {
  const { h, host, alice } = seated();
  callThrough(h.room, host.socketId, 90);
  assert.equal(h.room.state, "COMPLETED", "all ninety calls finish the round");
  const refused = claimAs(h, alice, "earlyFive");
  assert.equal(refused.ok, false);
  assert.equal(refused.code, ErrorCodes.INVALID_STATE);
});

test("a claim prepared just before the host ends the round is not paid out", () => {
  const { h, host, alice } = seated();
  callSpecific(h.room, TOP_LINE);
  const prepared = h.room.prepareClaim({
    playerId: alice.playerId,
    playerToken: alice.playerToken,
    pattern: "topLine",
  });
  assert.equal(prepared.ok, true, JSON.stringify(prepared));

  h.room.end(HOST_AUTH(host));
  const committed = h.room.commitClaim(prepared);
  assert.equal(committed.ok, false);
  assert.equal(committed.code, ErrorCodes.INVALID_STATE);
  assert.equal(h.room.players.get(alice.playerId).points, 0);
  assert.equal(h.room.awards.size, 0);
});

test("a claim prepared just before the next call lands is refused at commit", () => {
  // This is the durable path's real gap: prepare, write to the database, commit.
  // If a call is recorded in between, the award must not be paid.
  const { h, alice } = seated();
  callSpecific(h.room, TOP_LINE);
  const prepared = h.room.prepareClaim({
    playerId: alice.playerId,
    playerToken: alice.playerToken,
    pattern: "topLine",
  });
  assert.equal(prepared.ok, true);

  callSpecific(h.room, [2]); // the next number went out while the write was in flight
  const committed = h.room.commitClaim(prepared);
  assert.equal(committed.ok, false);
  assert.equal(committed.code, ErrorCodes.CLAIM_TOO_LATE);
  assert.equal(h.room.players.get(alice.playerId).points, 0);
  assert.equal(h.room.awards.size, 0);
});

test("after the final whistle the awards and standings survive every seat leaving", () => {
  const h = makeRoom();
  const host = h.host();
  const alice = h.player("Alice", "sock-a");
  const bob = h.player("Bob", "sock-b");
  h.room.start(HOST_AUTH(host));
  giveTicket(h.room, alice.playerId, TICKET_A);
  callSpecific(h.room, ALL_FIFTEEN);
  assert.equal(claimAs(h, alice, "fullHouse").ok, true);

  h.room.end(HOST_AUTH(host));
  // everybody but the host closes their laptop, and stays away
  h.room.detach(alice.socketId);
  h.room.detach(bob.socketId);
  h.advance(120_000); // well past the disconnect grace

  const view = h.room.publicSnapshot();
  assert.equal(view.state, "COMPLETED");
  assert.equal(view.awards.length, 1);
  assert.equal(view.awards[0].name, "Alice");
  assert.equal(view.awards[0].points, 30);

  // the final board is the room's record: it must not shrink because seats closed
  const board = h.room.leaderboard();
  assert.equal(board.find((entry) => entry.player === "Alice").points, 30);
  assert.equal(board.find((entry) => entry.player === "Bob").points, 0);
  assert.equal(view.players.find((p) => p.name === "Alice").connected, false, "away, not erased");
  assert.equal(bob.playerId !== undefined, true, "the second seat was really in this round");

  // a new round, on the other hand, starts with the people who are present
  h.room.reset(HOST_AUTH(host));
  assert.equal(h.room.players.size, 1);
  assert.equal([...h.room.players.values()][0].id, host.playerId);
  assert.equal(h.timers.size, 0, "no grace timer outlived the round");
});
