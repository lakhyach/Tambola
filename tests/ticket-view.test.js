/**
 * Phase 18: the pure ticket view-model.
 *
 * These are the rules the ticket UI is allowed to believe:
 *  - a mark is a number in the server's called history, nothing else;
 *  - a ticket is only a ticket when the server issued numbers for it;
 *  - the active tab is a view preference that survives a refresh but never
 *    outlives the tickets it names.
 *
 * Run: npm test (this file needs no browser).
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  TICKET_MEMORY_KEY,
  activeTicketNo,
  callAnnouncement,
  myAwards,
  ordinal,
  placeOf,
  readTicketMemory,
  sheetsOf,
  tabTarget,
  ticketProgress,
  ticketSummaries,
  writeTicketMemory,
} from "../client/src/lib/ticketview.js";
import { TICKET_A, TICKET_B, TOP_LINE, MIDDLE_LINE } from "./helpers.js";

const EMPTY_GRID = [[null, null, null], [null, null, null], [null, null, null]];

function memory(initial) {
  const data = new Map(initial ? [[TICKET_MEMORY_KEY, JSON.stringify(initial)]] : []);
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

/* ------------------------------------------------------------------ sheets */

test("only a grid with numbers is a ticket", () => {
  assert.deepEqual(sheetsOf({ tickets: [{ no: 1, grid: EMPTY_GRID }] }), []);
  assert.deepEqual(sheetsOf({ tickets: [] }), []);
  assert.deepEqual(sheetsOf({}), []);
  assert.deepEqual(sheetsOf(null), []);
});

test("issued tickets keep the server's numbering and order", () => {
  const sheets = sheetsOf({
    tickets: [
      { no: 3, grid: TICKET_B },
      { no: 1, grid: TICKET_A },
    ],
  });
  assert.deepEqual(sheets.map((s) => s.no), [1, 3]);
  assert.deepEqual(sheets[0].grid, TICKET_A);
});

test("the legacy single ticket field still reads as ticket 1", () => {
  const sheets = sheetsOf({ ticket: TICKET_A });
  assert.equal(sheets.length, 1);
  assert.equal(sheets[0].no, 1);
});

/* ---------------------------------------------------------------- progress */

test("nothing called means nothing marked, and all 15 still to come", () => {
  const progress = ticketProgress(TICKET_A, []);
  assert.equal(progress.marked, 0);
  assert.equal(progress.total, 15);
  assert.equal(progress.toGo, 15);
  assert.equal(progress.complete, false);
  assert.deepEqual(progress.rows.map((r) => [r.marked, r.filled]), [[0, 5], [0, 5], [0, 5]]);
});

test("a complete line is exactly five marked in one row", () => {
  const progress = ticketProgress(TICKET_A, TOP_LINE);
  assert.equal(progress.marked, 5);
  assert.equal(progress.toGo, 10);
  assert.equal(progress.rows[0].complete, true);
  assert.equal(progress.rows[0].marked, 5);
  assert.equal(progress.rows[1].complete, false);
  assert.equal(progress.complete, false);
});

test("only numbers the ticket holds count, whatever the history size", () => {
  const history = [...TOP_LINE, ...MIDDLE_LINE, 1, 2, 3, 4, 5, 6, 7, 8, 9, 90];
  const progress = ticketProgress(TICKET_A, history);
  assert.equal(progress.marked, 10, "the extra calls are not on this ticket");
});

test("all fifteen called is complete, with nothing left to go", () => {
  const all = TICKET_A.flat().filter((n) => n != null);
  const progress = ticketProgress(TICKET_A, all);
  assert.equal(progress.marked, 15);
  assert.equal(progress.toGo, 0);
  assert.equal(progress.complete, true);
  assert.equal(progress.rows.every((r) => r.complete), true);
});

test("a Set and an array describe the same marks", () => {
  const fromArray = ticketProgress(TICKET_A, TOP_LINE);
  const fromSet = ticketProgress(TICKET_A, new Set(TOP_LINE));
  assert.deepEqual(fromSet, fromArray);
});

test("a malformed grid reports zero rather than inventing marks", () => {
  for (const grid of [null, undefined, []]) {
    const progress = ticketProgress(grid, [1, 2]);
    assert.equal(progress.marked, 0);
    assert.equal(progress.complete, false);
  }
  // A shape that is not a 3x9 ticket can never reach here: the server refuses
  // it during recovery (tests/ticket-integrity.test.js) and sheetsOf drops any
  // grid with no numbers at all. The counter itself only counts real cells.
  assert.equal(ticketProgress([[1, 2]], [1]).marked, 1);
});

test("summaries carry the ticket number beside its progress", () => {
  const summaries = ticketSummaries(
    [
      { no: 1, grid: TICKET_A },
      { no: 2, grid: TICKET_B },
    ],
    TOP_LINE
  );
  assert.deepEqual(summaries.map((s) => s.no), [1, 2]);
  assert.equal(summaries[0].marked, 5);
  assert.equal(summaries[1].marked, 0, "ticket 2 holds none of the top line");
});

/* ------------------------------------------------------------- active tab */

test("a remembered ticket wins only when the seat still owns it", () => {
  const sheets = [
    { no: 1, grid: TICKET_A },
    { no: 4, grid: TICKET_B },
  ];
  assert.equal(activeTicketNo(sheets, 4), 4);
  assert.equal(activeTicketNo(sheets, 2), 1, "a stale number falls back to the first ticket");
  assert.equal(activeTicketNo(sheets, null), 1);
  assert.equal(activeTicketNo([], 3), null);
});

test("arrow keys wrap, Home and End jump, other keys stay put", () => {
  assert.equal(tabTarget([1, 2, 3], 0, "ArrowRight"), 1);
  assert.equal(tabTarget([1, 2, 3], 2, "ArrowRight"), 0, "wraps to the first");
  assert.equal(tabTarget([1, 2, 3], 0, "ArrowLeft"), 2, "wraps to the last");
  assert.equal(tabTarget([1, 2, 3], 2, "Home"), 0);
  assert.equal(tabTarget([1, 2, 3], 0, "End"), 2);
  assert.equal(tabTarget([1, 2, 3], 1, "Enter"), 1);
  assert.equal(tabTarget([], 0, "ArrowRight"), 0);
});

test("the remembered tab is stored per room and merges with other rooms", () => {
  const storage = memory();
  assert.equal(readTicketMemory(storage, "ROOM1"), null, "nothing remembered yet");
  writeTicketMemory(storage, "ROOM1", 2);
  writeTicketMemory(storage, "ROOM2", 4);
  assert.equal(readTicketMemory(storage, "ROOM1"), 2);
  assert.equal(readTicketMemory(storage, "ROOM2"), 4);
  writeTicketMemory(storage, "ROOM1", 3);
  assert.equal(readTicketMemory(storage, "ROOM1"), 3, "a later visit updates its own room");
  assert.equal(readTicketMemory(storage, "ROOM2"), 4);
});

test("bad or unavailable storage degrades to 'no memory'", () => {
  assert.equal(readTicketMemory(null, "ROOM1"), null);
  assert.equal(readTicketMemory(memory(), ""), null);
  writeTicketMemory(null, "ROOM1", 2); // must not throw
  const broken = { getItem: () => "{not json", setItem: () => {} };
  assert.equal(readTicketMemory(broken, "ROOM1"), null);
  const throwing = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("quota");
    },
  };
  assert.equal(readTicketMemory(throwing, "ROOM1"), null);
  writeTicketMemory(throwing, "ROOM1", 1); // swallowed on purpose
});

/* ----------------------------------------------------------------- results */

test("ordinals read the way a result line needs them", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal), [
    "1st",
    "2nd",
    "3rd",
    "4th",
    "11th",
    "12th",
    "13th",
    "21st",
    "22nd",
    "101st",
  ]);
});

test("a seat's place comes from the server's standings", () => {
  const board = [
    { playerId: "p2", player: "Ravi", points: 30 },
    { playerId: "p1", player: "Asha", points: 20 },
  ];
  assert.equal(placeOf(board, "p1"), 2);
  assert.equal(placeOf(board, "p2"), 1);
  assert.equal(placeOf(board, "p9"), null);
  assert.equal(placeOf(null, "p1"), null);
});

test("my awards are only the ones this seat holds, with their ticket", () => {
  const awards = [
    { pattern: "topLine", playerId: "p1", ticketNo: 2, points: 10 },
    { pattern: "corners", playerId: "p2", ticketNo: 1, points: 10 },
  ];
  const mine = myAwards(awards, "p1");
  assert.equal(mine.length, 1);
  assert.equal(mine[0].ticketNo, 2);
  assert.deepEqual(myAwards(null, "p1"), []);
});

test("the spoken call names the number and what is left", () => {
  assert.equal(callAnnouncement(42, 48), "Number 42 called. 48 numbers left.");
  assert.equal(callAnnouncement(7, null), "Number 7 called.");
  assert.equal(callAnnouncement(null, 10), "");
  assert.equal(callAnnouncement(undefined, 10), "");
});
