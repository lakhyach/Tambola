/**
 * Winning-pattern rules: pure verification plus server-side claim arbitration.
 * Run with: npm test
 *
 * callSpecific() only seeds the engine's own official call history so a test can
 * reason about concrete numbers. Nothing in these tests lets a client supply a
 * called number - the authorised draw path is covered in engine.test.js.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { evaluateClaim, getPattern, enabledPatternIds, PATTERNS, DEFERRED_PATTERNS } from "../server/game/patterns.js";
import { validateTicket } from "../server/game/ticket.js";
import { ErrorCodes } from "../server/game/engine.js";
import {
  makeRoom,
  giveTicket,
  callSpecific,
  TICKET_A,
  TICKET_B,
  TOP_LINE,
  MIDDLE_LINE,
  BOTTOM_LINE,
  CORNERS,
  ALL_FIFTEEN,
} from "./helpers.js";

test("the registry holds the minimum pattern set, all exclusive", () => {
  for (const id of ["earlyFive", "topLine", "middleLine", "bottomLine", "fullHouse", "corners"]) {
    const pattern = PATTERNS[id];
    assert.ok(pattern, id + " is registered");
    assert.equal(typeof pattern.check, "function");
    assert.ok(Number.isInteger(pattern.points) && pattern.points > 0, id + " has points");
    assert.equal(pattern.exclusive, true);
    assert.ok(pattern.definition.length > 20, id + " carries a written definition");
  }
});

test("deferred patterns are documented, not silently dropped", () => {
  for (const id of Object.keys(DEFERRED_PATTERNS)) {
    assert.equal(PATTERNS[id], undefined, id + " must stay unimplemented until defined");
    assert.ok(DEFERRED_PATTERNS[id].reason.length > 30, id + " states the ambiguity");
    assert.equal(getPattern(id, {}), null, id + " cannot be claimed");
  }
});

test("a legal ticket is required by the fixture itself", () => {
  assert.deepEqual(validateTicket(TICKET_A).errors, []);
  assert.deepEqual(validateTicket(TICKET_B).errors, []);
  assert.equal(new Set(ALL_FIFTEEN).size, 15);
});

// --------------------------------------------------------------- line patterns

test("top line needs all five numbered cells, no fewer", () => {
  const four = evaluateClaim("topLine", TICKET_A, TOP_LINE.slice(0, 4));
  assert.equal(four.valid, false);
  assert.equal(four.reason, "line incomplete");
  assert.deepEqual(four.missing, [TOP_LINE[4]]);

  const complete = evaluateClaim("topLine", TICKET_A, TOP_LINE);
  assert.equal(complete.valid, true);
  assert.equal(complete.points, 10);
});

test("middle and bottom lines check their own rows only", () => {
  assert.equal(evaluateClaim("middleLine", TICKET_A, MIDDLE_LINE).valid, true);
  assert.equal(evaluateClaim("bottomLine", TICKET_A, BOTTOM_LINE).valid, true);
  // calling the middle row must not complete the top or bottom row
  assert.equal(evaluateClaim("topLine", TICKET_A, MIDDLE_LINE).valid, false);
  assert.equal(evaluateClaim("bottomLine", TICKET_A, MIDDLE_LINE).valid, false);
  // and extra called numbers outside the row must not help either
  const padded = MIDDLE_LINE.concat([1, 2, 3, 4, 5, 6]);
  assert.equal(evaluateClaim("topLine", TICKET_A, padded).valid, false);
});

test("lines are the five numbered cells, not the nine grid columns", () => {
  // TICKET_A's top row has empty cells at columns 4,6,7,8; those blanks carry no
  // numbers so they cannot be "missing", and the row completes after 5 calls
  const result = evaluateClaim("topLine", TICKET_A, TOP_LINE);
  assert.equal(result.valid, true);
  assert.equal(TOP_LINE.length, 5);
});

test("line check refuses to run on a malformed ticket", () => {
  const broken = [
    [1, 2, 3, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null],
  ];
  assert.throws(() => evaluateClaim("topLine", broken, [1, 2, 3]), /needs a legal ticket/);
});

// ------------------------------------------------------------- early five rule

test("early five is the first five ticket numbers called", () => {
  const four = evaluateClaim("earlyFive", TICKET_A, [3, 11, 24, 31]);
  assert.equal(four.valid, false);
  assert.equal(four.reason, "fewer than five ticket numbers called");
  assert.equal(four.needed, 1);

  const five = evaluateClaim("earlyFive", TICKET_A, [3, 11, 24, 31, 50]);
  assert.equal(five.valid, true);
  assert.equal(five.completedOnCall, 5);
  assert.equal(five.points, 20);
});

test("early five cannot be destroyed by a sixth hit", () => {
  // the old UI approximated this with marked-cell counts, so marking or a later
  // call could make the prize unclaimable. Here more hits never invalidate it.
  const six = evaluateClaim("earlyFive", TICKET_A, [3, 11, 24, 31, 50, 7]);
  assert.equal(six.valid, true);
  assert.equal(six.completedOnCall, 5, "completion stays at call 5");

  const many = evaluateClaim("earlyFive", TICKET_A, ALL_FIFTEEN);
  assert.equal(many.valid, true, "still claimable with all 15 called");
  assert.equal(many.completedOnCall, 5, "the fifth hit was call 5, not call 15");
  assert.equal(many.hits, 15);

  // and it survives a long tail of unrelated calls in between
  const scattered = [3, 10, 11, 2, 24, 5, 31, 6, 9, 50, 70, 71];
  assert.equal(evaluateClaim("earlyFive", TICKET_A, scattered).valid, true);
  assert.equal(evaluateClaim("earlyFive", TICKET_A, scattered).completedOnCall, 10);
});

test("early five counts only the claimant's own numbers", () => {
  // ten calls, of which only four are on TICKET_A
  const calls = [3, 11, 24, 31, 1, 2, 4, 5, 6, 90];
  const result = evaluateClaim("earlyFive", TICKET_A, calls);
  assert.equal(result.valid, false);
  assert.equal(result.needed, 1);
});

test("completedOnCall is the ordinal of the fifth hit, enabling a call window", () => {
  // only 3, 24, 31, 50 and 11 are on TICKET_A; the fifth of them lands on call 9
  const history = [1, 2, 4, 5, 3, 24, 31, 50, 11];
  const result = evaluateClaim("earlyFive", TICKET_A, history);
  assert.equal(result.valid, true);
  assert.equal(result.completedOnCall, 9);
});

test("an optional early-five window can be switched on by config", () => {
  const history = [1, 2, 4, 5, 3, 24, 31, 50, 11];
  const config = { earlyFiveMaxCalls: 5 };
  const late = evaluateClaim("earlyFive", TICKET_A, history, config);
  assert.equal(late.valid, false);
  assert.match(late.reason, /window of 5 calls/);
  // same history, no window configured -> valid
  assert.equal(evaluateClaim("earlyFive", TICKET_A, history).valid, true);
  // and a history that completes inside the window stays valid with the window on
  assert.equal(evaluateClaim("earlyFive", TICKET_A, [3, 24, 31, 50, 11], config).valid, true);
});

// ----------------------------------------------------------------- corners

test("corners are the outer numbered cells of the top and bottom rows", () => {
  assert.deepEqual(CORNERS, [3, 50, 36, 85]);
  for (const missing of CORNERS) {
    const partial = CORNERS.filter((n) => n !== missing);
    const result = evaluateClaim("corners", TICKET_A, partial);
    assert.equal(result.valid, false, "corner " + missing + " is required");
    assert.deepEqual(result.missing, [missing]);
  }
  assert.equal(evaluateClaim("corners", TICKET_A, CORNERS).valid, true);
});

// -------------------------------------------------------------- full house

test("full house needs every one of the fifteen", () => {
  const almost = ALL_FIFTEEN.slice(0, 14);
  const result = evaluateClaim("fullHouse", TICKET_A, almost);
  assert.equal(result.valid, false);
  assert.deepEqual(result.missing, [ALL_FIFTEEN[14]]);
  assert.equal(evaluateClaim("fullHouse", TICKET_A, ALL_FIFTEEN).valid, true);
  assert.equal(getPattern("fullHouse").points, 30);
});

test("unknown or malformed pattern ids never verify", () => {
  for (const id of ["nope", "earlyFive ", "", "FULLHOUSE", "star"]) {
    const result = evaluateClaim(id, TICKET_A, ALL_FIFTEEN);
    assert.equal(result.valid, false, id + " rejected");
  }
  assert.equal(evaluateClaim("topLine", null, [1, 2, 3, 4, 5]).valid, false);
  assert.equal(evaluateClaim("topLine", "ticket", [1, 2, 3, 4, 5]).reason, "claimant has no legal ticket");
});

test("patterns can be disabled per room", () => {
  const config = { patterns: { corners: false } };
  assert.equal(getPattern("corners", config), null);
  assert.equal(evaluateClaim("corners", TICKET_A, CORNERS, config).valid, false);
  assert.equal(enabledPatternIds(config).includes("corners"), false);
  assert.equal(enabledPatternIds({}).length, Object.keys(PATTERNS).length);
});

// -------------------------------------------------------------- arbitration

test("a claim is verified against the server history, not the client's word", () => {
  const h = makeRoom();
  const host = h.host();
  const alice = h.player("Alice", "sock-a");
  h.room.start({ socketId: host.socketId });
  giveTicket(h.room, alice.playerId, TICKET_A);

  // nothing called yet - a client shouting "top line" gets nothing
  const early = h.room.claim({ playerId: alice.playerId, playerToken: alice.playerToken, pattern: "topLine" });
  assert.equal(early.ok, false);
  assert.equal(early.code, ErrorCodes.INVALID_STATE);
  assert.match(early.error, /line incomplete/);
  assert.equal(h.room.players.get(alice.playerId).points, 0, "rejected claim awards no points");

  callSpecific(h.room, TOP_LINE);
  const win = h.room.claim({ playerId: alice.playerId, playerToken: alice.playerToken, pattern: "topLine" });
  assert.equal(win.ok, true);
  assert.equal(win.points, 10);
  assert.equal(h.room.players.get(alice.playerId).points, 10);
});

test("the first valid claim takes an exclusive prize, the second cannot", () => {
  const h = makeRoom();
  const host = h.host();
  const a = h.player("Alpha", "sock-1");
  const b = h.player("Beta", "sock-2");
  h.room.start({ socketId: host.socketId });
  // both players genuinely hold a complete top line
  giveTicket(h.room, a.playerId, TICKET_A);
  giveTicket(h.room, b.playerId, TICKET_A);

  callSpecific(h.room, TOP_LINE);
  const first = h.room.claim({ playerId: a.playerId, playerToken: a.playerToken, pattern: "topLine" });
  const second = h.room.claim({ playerId: b.playerId, playerToken: b.playerToken, pattern: "topLine" });
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.code, ErrorCodes.ALREADY_AWARDED);
  assert.equal(second.awardedTo, a.playerId);
  assert.equal(h.room.players.get(b.playerId).points, 0);
  assert.equal(h.room.awards.get("topLine").length, 1, "exactly one winner recorded");
});

test("repeating your own winning claim reports it back instead of double-paying", () => {
  const h = makeRoom();
  const host = h.host();
  const a = h.player("Alpha", "sock-1");
  h.room.start({ socketId: host.socketId });
  giveTicket(h.room, a.playerId, TICKET_A);
  callSpecific(h.room, TOP_LINE);
  assert.equal(h.room.claim({ playerId: a.playerId, playerToken: a.playerToken, pattern: "topLine" }).ok, true);
  const again = h.room.claim({ playerId: a.playerId, playerToken: a.playerToken, pattern: "topLine" });
  assert.equal(again.ok, false);
  assert.equal(again.code, ErrorCodes.ALREADY_CLAIMED_BY_YOU);
  assert.equal(h.room.players.get(a.playerId).points, 10, "points paid once");
  assert.equal(h.room.players.get(a.playerId).claims.length, 1);
});

test("ten simultaneous claims for one exclusive pattern pay exactly once", () => {
  const h = makeRoom();
  const host = h.host();
  const contenders = [];
  for (let i = 0; i < 10; i++) contenders.push(h.player("Contender" + i, "sock-" + i));
  h.room.start({ socketId: host.socketId });
  for (const c of contenders) giveTicket(h.room, c.playerId, TICKET_A);
  callSpecific(h.room, TOP_LINE);

  const results = contenders.map((c) =>
    h.room.claim({ playerId: c.playerId, playerToken: c.playerToken, pattern: "topLine" })
  );
  const winners = results.filter((r) => r.ok);
  assert.equal(winners.length, 1, "exactly one success");
  assert.equal(h.room.awards.get("topLine").length, 1);
  const paid = contenders.reduce((sum, c) => sum + h.room.players.get(c.playerId).points, 0);
  assert.equal(paid, 10, "one prize of 10 points, ever");
  // the other nine are told the truth, not silently ignored
  assert.equal(results.filter((r) => !r.ok).length, 9);
});

test("claim checks run in order: identity, ticket, state, pattern, award, proof", () => {
  const h = makeRoom();
  const host = h.host();
  const player = h.player("Alice", "sock-a");

  // 1. stranger
  assert.equal(h.room.claim({ playerId: "deadbeef", pattern: "topLine" }).code, ErrorCodes.NOT_PLAYER);
  // 1b. right id, wrong credential
  assert.equal(
    h.room.claim({ playerId: player.playerId, playerToken: "ffffffffffffffffffffffff", pattern: "topLine" }).code,
    ErrorCodes.NOT_PLAYER
  );
  // 2. no ticket yet (game not started)
  assert.equal(
    h.room.claim({ playerId: player.playerId, playerToken: player.playerToken, pattern: "topLine" }).code,
    ErrorCodes.NOT_PLAYER
  );
  // 3. wrong state
  h.room.start({ socketId: host.socketId });
  giveTicket(h.room, player.playerId, TICKET_A);
  h.room.pause({ socketId: host.socketId });
  assert.equal(
    h.room.claim({ playerId: player.playerId, playerToken: player.playerToken, pattern: "topLine" }).code,
    ErrorCodes.INVALID_STATE
  );
  h.room.resumeGame({ socketId: host.socketId });
  // 4. unknown pattern
  assert.equal(
    h.room.claim({ playerId: player.playerId, playerToken: player.playerToken, pattern: "notAPattern" }).code,
    ErrorCodes.UNKNOWN_PATTERN
  );
  // 8. unproven pattern
  const unproven = h.room.claim({ playerId: player.playerId, playerToken: player.playerToken, pattern: "fullHouse" });
  assert.equal(unproven.ok, false);
  assert.equal(unproven.code, ErrorCodes.INVALID_STATE);
  assert.match(unproven.reason, /full house incomplete/);
});

test("every rejected and accepted claim lands in the audit log", () => {
  const h = makeRoom();
  const host = h.host();
  const a = h.player("Alpha", "sock-1");
  h.room.start({ socketId: host.socketId });
  giveTicket(h.room, a.playerId, TICKET_A);
  h.room.claim({ playerId: a.playerId, playerToken: a.playerToken, pattern: "topLine" });
  callSpecific(h.room, TOP_LINE);
  h.room.claim({ playerId: a.playerId, playerToken: a.playerToken, pattern: "topLine" });
  assert.equal(h.room.claimLog.length, 2);
  assert.equal(h.room.claimLog[0].accepted, false);
  assert.equal(h.room.claimLog[1].accepted, true);
  assert.equal(h.room.hostSnapshot().claimLog.length, 2);
});

test("multipleWinnersPerPattern is opt-in and changes arbitration", () => {
  const h = makeRoom({ config: { multipleWinnersPerPattern: true } });
  const host = h.host();
  const a = h.player("Alpha", "sock-1");
  const b = h.player("Beta", "sock-2");
  h.room.start({ socketId: host.socketId });
  giveTicket(h.room, a.playerId, TICKET_A);
  giveTicket(h.room, b.playerId, TICKET_A);
  callSpecific(h.room, TOP_LINE);
  assert.equal(h.room.claim({ playerId: a.playerId, playerToken: a.playerToken, pattern: "topLine" }).ok, true);
  assert.equal(h.room.claim({ playerId: b.playerId, playerToken: b.playerToken, pattern: "topLine" }).ok, true);
  assert.equal(h.room.awards.get("topLine").length, 2);
});

test("a full house ends the scoring correctly and shows on the leaderboard", () => {
  const h = makeRoom();
  const host = h.host();
  const a = h.player("Alpha", "sock-1");
  const b = h.player("Beta", "sock-2");
  h.room.start({ socketId: host.socketId });
  giveTicket(h.room, a.playerId, TICKET_A);
  giveTicket(h.room, b.playerId, TICKET_B);
  callSpecific(h.room, TOP_LINE);
  h.room.claim({ playerId: a.playerId, playerToken: a.playerToken, pattern: "topLine" });
  callSpecific(h.room, MIDDLE_LINE);
  h.room.claim({ playerId: a.playerId, playerToken: a.playerToken, pattern: "middleLine" });
  callSpecific(h.room, BOTTOM_LINE);
  const full = h.room.claim({ playerId: a.playerId, playerToken: a.playerToken, pattern: "fullHouse" });
  assert.equal(full.ok, true);
  assert.equal(h.room.players.get(a.playerId).points, 50);
  assert.deepEqual(full.leaderboard[0], {
    playerId: a.playerId,
    player: "Alpha",
    points: 50,
    claims: ["topLine", "middleLine", "fullHouse"],
  });
  assert.equal(full.leaderboard[1].player, "Beta");
  assert.equal(full.leaderboard[1].points, 0, "B never claimed");
  assert.equal(full.awards.length, 3);
  assert.equal(h.lastEvent("claim:result").won, true);
});
