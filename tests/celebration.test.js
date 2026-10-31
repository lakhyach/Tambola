/**
 * Celebration event mapping (§4) — pure logic, run under the plain node suite.
 *
 * These guard the trust boundary: only a VERIFIED server event becomes a
 * celebration, the winner/tie/no-winner decision mirrors the server leaderboard
 * exactly, and the idempotency key is stable so the same award cannot fire twice.
 * Run with: npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { patternEvent, finalEvent, finalOutcome } from "../client/src/lib/celebration.js";

// --------------------------------------------------------------- pattern wins

test("only a confirmed win (won === true) becomes a celebration", () => {
  const win = { won: true, pattern: "topLine", playerId: "p1", name: "Alice", label: "Top Line", points: 10, ticketNo: 2 };
  assert.ok(patternEvent(win, "ROOM1", "en"), "a real win maps to an event");
  assert.equal(patternEvent({ ...win, won: false }, "ROOM1", "en"), null, "a lost claim never celebrates");
  assert.equal(patternEvent({ ...win, won: undefined }, "ROOM1", "en"), null, "missing won is not a win");
  assert.equal(patternEvent(null, "ROOM1", "en"), null);
  assert.equal(patternEvent({}, "ROOM1", "en"), null);
});

test("a pattern event carries the winner, ticket and verified pattern and localises it", () => {
  const win = { won: true, pattern: "fullHouse", playerId: "p7", name: "रवि", label: "Full House", points: 30, ticketNo: 4 };
  const en = patternEvent(win, "ROOM1", "en");
  assert.equal(en.kind, "pattern");
  assert.equal(en.name, "रवि");
  assert.equal(en.label, "Full House");
  assert.equal(en.ticketNo, 4);
  assert.equal(en.points, 30);
  assert.match(en.message, /रवि/);
  assert.match(en.message, /Full House/);
  const hi = patternEvent(win, "ROOM1", "hi");
  assert.match(hi.message, /जीता/);
});

test("the pattern id is stable and room-scoped so the same award cannot double-fire", () => {
  const win = { won: true, pattern: "corners", playerId: "p1", name: "Alice", label: "Corners", points: 20, ticketNo: 1 };
  const a = patternEvent(win, "ROOM1", "en");
  const b = patternEvent(win, "ROOM1", "en");
  assert.equal(a.id, b.id, "same claim, same id");
  const otherRoom = patternEvent(win, "ROOM2", "en");
  assert.notEqual(a.id, otherRoom.id, "id is scoped to the room");
  const otherTicket = patternEvent({ ...win, ticketNo: 3 }, "ROOM1", "en");
  assert.notEqual(a.id, otherTicket.id, "a distinct ticket is a distinct award");
  // a null ticket still produces a valid, stable key
  const noTicket = patternEvent({ ...win, ticketNo: null }, "ROOM1", "en");
  assert.equal(noTicket.id, patternEvent({ ...win, ticketNo: null }, "ROOM1", "en").id);
});

// ---------------------------------------------------------------- finale logic

const LB = [
  { playerId: "a", player: "Alice", points: 40 },
  { playerId: "b", player: "Bob", points: 30 },
  { playerId: "c", player: "Cara", points: 10 },
];

test("finalOutcome picks the single top scorer", () => {
  const out = finalOutcome(LB);
  assert.equal(out.kind, "single");
  assert.deepEqual(out.winners.map((w) => w.player), ["Alice"]);
  assert.equal(out.top, 40);
});

test("finalOutcome reports an explicit tie among equal top scorers", () => {
  const tied = [
    { playerId: "a", player: "Alice", points: 40 },
    { playerId: "b", player: "Bob", points: 40 },
    { playerId: "c", player: "Cara", points: 10 },
  ];
  const out = finalOutcome(tied);
  assert.equal(out.kind, "tie");
  assert.deepEqual(out.winners.map((w) => w.player), ["Alice", "Bob"]);
});

test("finalOutcome treats an all-zero or empty leaderboard as no winner", () => {
  assert.equal(finalOutcome([{ playerId: "a", player: "Alice", points: 0 }]).kind, "none");
  assert.equal(finalOutcome([]).kind, "none");
});

test("finalEvent localises the outcome and carries the standings", () => {
  const completed = { reason: "all 90 numbers called", leaderboard: LB, awards: [{ pattern: "topLine" }] };
  const single = finalEvent(completed, "ROOM1", "en");
  assert.equal(single.kind, "final");
  assert.equal(single.id, "final:ROOM1");
  assert.equal(single.reason, "all 90 numbers called");
  assert.deepEqual(single.leaderboard, LB);
  assert.match(single.message, /Alice wins the game/);

  const tied = finalEvent({ ...completed, leaderboard: [{ player: "Alice", points: 5 }, { player: "Bob", points: 5 }] }, "ROOM1", "en");
  assert.match(tied.message, /tie between Alice, Bob/);

  const none = finalEvent({ reason: "host ended the game", leaderboard: [{ player: "Alice", points: 0 }] }, "ROOM1", "en");
  assert.match(none.message, /no winner/i);

  const hi = finalEvent(completed, "ROOM1", "hi");
  assert.match(hi.message, /जीता/);
});

test("finalEvent tolerates a malformed payload without throwing", () => {
  assert.equal(finalEvent({}, "ROOM1", "en").outcome.kind, "none");
  assert.equal(finalEvent(undefined, "ROOM1", "en").message.length > 0, true);
});
