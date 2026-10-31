/**
 * Phase 14 §5: what a player's screen really shows, derived from a REAL snapshot.
 *
 * The browser pass caught a defect no unit test had: a seat that joined while a
 * round was already running was shown a ticket panel headed "YOUR TICKET 0/15
 * MARKED" above a grid with no numbers in it, with live Claim buttons next to it.
 * The server had behaved correctly — a mid-round joiner holds no tickets, because
 * selection is locked at start — and the client had papered over that true state
 * with a fabricated empty grid, which is exactly what "a control that appears not
 * to work" and "misleading interface text" look like when they ship.
 *
 * So these tests pipe the engine's own snapshots through the client's derivation
 * (client/src/lib/playerview.js) and assert the screen can only ever land in one
 * of three honest states. If a future change invents a placeholder again, the
 * snapshot that produced the bug fails here first.
 *
 * They also pin the one line of text beside the claim controls: it used to read
 * "claims open while running" whatever the state was, so a finished round went on
 * promising a control that round would never offer — the same class of §5 defect,
 * one tier smaller.
 *
 * Run with: npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { canClaim, claimNote, rosterStatistic, rosterTally, ticketPanel, ticketSheets } from "../client/src/lib/playerview.js";
import { giveTicket, makeRoom } from "./helpers.js";

const HOST_AUTH = (host) => ({ socketId: host.socketId });

/** A round with one seated player holding a real ticket, already running. */
function runningRound(options = {}) {
  const h = makeRoom({ config: { maxTicketsPerPlayer: 4 }, ...options });
  const host = h.host();
  const alice = h.player("Alice", "sock-a");
  h.room.selectTickets({ playerId: alice.playerId, playerToken: alice.playerToken, count: options.count ?? 1 });
  h.room.start(HOST_AUTH(host));
  return { h, host, alice };
}

// ------------------------------------------------ the state that produced the bug

test("a mid-round joiner is shown as watching, never as an empty ticket", () => {
  const { h, alice } = runningRound();
  const late = h.player("Late", "sock-late");
  const snap = h.room.playerSnapshot(late.playerId);

  assert.equal(snap.state, "RUNNING");
  assert.equal(snap.tickets.length, 0, "the server genuinely issued this seat nothing");
  assert.equal(snap.ticket, null, "and said so with null, not an empty grid");

  const sheets = ticketSheets(snap);
  assert.deepEqual(sheets, [], "no ticket may be conjured from an absent one");
  assert.equal(ticketPanel({ state: snap.state, sheets }), "spectator");
  assert.equal(canClaim({ state: snap.state, sheets }), false, "no claim button for a seat that cannot win");
  assert.notEqual(alice.playerId, late.playerId);
});

test("a placeholder grid is never treated as a ticket", () => {
  // the exact value the old view built when the server sent nothing
  for (const snap of [
    { ticket: [[], [], []], tickets: [] },
    { ticket: null, tickets: [] },
    { ticket: undefined, tickets: undefined },
    { ticket: [[null, null], [null], []] },
    {},
    null,
  ]) {
    assert.deepEqual(ticketSheets(snap), [], "no numbers, no ticket: " + JSON.stringify(snap));
  }
});

test("a spectator's own state is not confused with a player's", () => {
  const { h, alice } = runningRound();
  const late = h.player("Late", "sock-late");
  const seated = ticketSheets(h.room.playerSnapshot(alice.playerId));
  const watching = ticketSheets(h.room.playerSnapshot(late.playerId));

  assert.equal(seated.length, 1, "Alice played this round");
  assert.equal(watching.length, 0, "Late did not");
  assert.equal(ticketPanel({ state: "RUNNING", sheets: seated }), "tickets");
  assert.equal(ticketPanel({ state: "RUNNING", sheets: watching }), "spectator");
});

// ------------------------------------------------------------- the other states

test("before the round, a seat with nothing chosen yet is told to choose", () => {
  const h = makeRoom();
  const host = h.host();
  const bob = h.player("Bob", "sock-b");
  const snap = h.room.playerSnapshot(bob.playerId);

  assert.equal(snap.state, "WAITING");
  assert.equal(ticketPanel({ state: snap.state, sheets: ticketSheets(snap) }), "choose", "not a broken-looking blank grid");
  assert.equal(canClaim({ state: snap.state, sheets: [] }), false);
});

test("the same spectator becomes a player once the host resets", () => {
  const { h, host } = runningRound();
  const late = h.player("Late", "sock-late");
  assert.equal(ticketPanel({ state: h.room.playerSnapshot(late.playerId).state, sheets: ticketSheets(h.room.playerSnapshot(late.playerId)) }), "spectator");

  const ended = h.room.end(HOST_AUTH(host));
  assert.equal(ended.ok, true, "the host ends the round");
  const reset = h.room.reset(HOST_AUTH(host));
  assert.equal(reset.ok, true, "and opens the next one");

  const afterReset = h.room.playerSnapshot(late.playerId);
  assert.equal(afterReset.state, "WAITING");
  assert.equal(ticketPanel({ state: afterReset.state, sheets: ticketSheets(afterReset) }), "choose", "their turn to pick is next round, and the screen says so");

  const picked = h.room.selectTickets({ playerId: late.playerId, playerToken: late.playerToken, count: 3 });
  assert.equal(picked.ok, true);
  const withTickets = h.room.playerSnapshot(late.playerId);
  assert.deepEqual(ticketSheets(withTickets).map((t) => t.no), [1, 2, 3]);
  assert.equal(ticketPanel({ state: withTickets.state, sheets: ticketSheets(withTickets) }), "tickets");
});

test("a running seat with tickets can claim; paused and completed cannot", () => {
  const { h, alice } = runningRound();
  const sheets = ticketSheets(h.room.playerSnapshot(alice.playerId));
  assert.equal(sheets.length, 1);
  assert.equal(canClaim({ state: "RUNNING", sheets }), true);
  assert.equal(ticketPanel({ state: "RUNNING", sheets }), "tickets");

  for (const state of ["PAUSED", "COMPLETED", "WAITING"]) {
    assert.equal(canClaim({ state, sheets }), false, "claims are a running-round action: " + state);
    assert.equal(ticketPanel({ state, sheets }), "tickets", "the ticket they played stays visible");
  }
});

test("the host's own screen keeps their ticket while the round runs", () => {
  const { h, host } = runningRound();
  giveTicket(h.room, host.playerId, [
    [3, 11, 24, 31, null, 50, null, null, null],
    [7, 15, 28, null, 42, null, 61, null, null],
    [null, null, null, 36, null, 57, 66, 74, 85],
  ]);
  const snap = h.room.hostSnapshot();
  const sheets = ticketSheets(snap);

  assert.equal(sheets.length, 1, "the host plays too, and sees their real ticket");
  assert.equal(ticketPanel({ state: snap.state, sheets }), "tickets");
  assert.equal(canClaim({ state: snap.state, sheets }), true);
});

// -------------------------------------------------------------- snapshot shapes

test("multi-ticket snapshots keep every sheet and its number", () => {
  const snap = {
    tickets: [
      { no: 2, grid: [[1, 2], [3]] },
      { no: 1, grid: [[9, 8], [7]] },
      { no: 3, grid: [] },
      null,
      { no: 4 },
    ],
  };
  const sheets = ticketSheets(snap);
  assert.deepEqual(sheets.map((t) => t.no), [1, 2], "ordered by ticket number, empties and junk dropped");
});

test("a single-ticket snapshot is accepted without a tickets array", () => {
  const sheets = ticketSheets({ ticket: [[5, null, 14]] });
  assert.equal(sheets.length, 1);
  assert.equal(sheets[0].no, 1);
  assert.deepEqual(sheets[0].grid, [[5, null, 14]]);
});

test("nothing any snapshot can throw at the derivation", () => {
  for (const junk of [undefined, null, {}, { tickets: "no" }, { tickets: [1, 2] }, { ticket: "grid" }, { ticket: {} }]) {
    const sheets = ticketSheets(junk);
    assert.ok(Array.isArray(sheets), "always a list");
    assert.equal(ticketPanel({ sheets }), "choose", "an unreadable snapshot never claims a ticket");
  }
});

// ---------------------------------------------------------------- the claim note

test("the note beside the claim buttons is absent exactly when the buttons are live", () => {
  const { h, alice } = runningRound();
  const sheets = ticketSheets(h.room.playerSnapshot(alice.playerId));

  assert.equal(claimNote({ state: "RUNNING", sheets }), null, "a running seat with a ticket is told nothing, because it can act");
  assert.equal(canClaim({ state: "RUNNING", sheets }), true);

  // the invariant the browser defect broke: a live-looking button with a note
  // saying claims are closed, or the other way round, is the misleading text
  for (const state of ["WAITING", "RUNNING", "PAUSED", "COMPLETED", "WHATEVER"]) {
    for (const seat of [sheets, []]) {
      const live = canClaim({ state, sheets: seat });
      assert.equal(claimNote({ state, sheets: seat }) === null, live, "note and buttons agree in " + state + " with " + seat.length + " ticket(s)");
    }
  }
});

test("a finished round stops promising claims that will never open", () => {
  const { h, host, alice } = runningRound();
  const sheets = ticketSheets(h.room.playerSnapshot(alice.playerId));

  const paused = h.room.pause(HOST_AUTH(host));
  assert.equal(paused.ok, true);
  assert.equal(h.room.playerSnapshot(alice.playerId).state, "PAUSED");
  assert.match(claimNote({ state: "PAUSED", sheets }), /resume/, "paused says who reopens it");

  const ended = h.room.end(HOST_AUTH(host));
  assert.equal(ended.ok, true);
  const snap = h.room.playerSnapshot(alice.playerId);
  assert.equal(snap.state, "COMPLETED");
  assert.equal(claimNote({ state: snap.state, sheets: ticketSheets(snap) }), "this round is finished", "no promise of claims this round cannot keep");
});

test("the note always explains a disabled button, including for a watching seat", () => {
  const { h } = runningRound();
  const late = h.player("Late", "sock-late");
  const snap = h.room.playerSnapshot(late.playerId);
  const sheets = ticketSheets(snap);
  assert.equal(canClaim({ state: snap.state, sheets }), false);

  const note = claimNote({ state: snap.state, sheets });
  assert.equal(note, "no ticket this round");
  assert.ok(note.length > 0, "a disabled control says why, in the state the server is in");

  for (const state of ["WAITING", "COMPLETED"]) {
    const why = claimNote({ state, sheets });
    assert.ok(why, "never a bare disabled button with no reason: " + state);
    assert.notEqual(why, "no ticket this round", "a finished round is not the same as a ticketless one");
  }
});

// ------------------------------------------------------- the roster's right edge

test("the roster counts tickets before a round and points during it", () => {
  assert.deepEqual(rosterStatistic({ points: 0, tickets: 2 }, "WAITING"), { value: 2, unit: "tickets" });
  assert.deepEqual(rosterStatistic({ points: 0, tickets: 1 }, "WAITING"), { value: 1, unit: "ticket" });
  assert.equal(rosterStatistic({ points: 0, tickets: 0 }, "WAITING"), null, "an unlabelled zero is not shown");

  assert.deepEqual(rosterStatistic({ points: 0, tickets: 2 }, "RUNNING"), { value: 0, unit: "pts" }, "a live zero is real score");
  assert.deepEqual(
    rosterStatistic({ points: 20, tickets: 2 }, "WAITING"),
    { value: 2, unit: "tickets" },
    "before a round the actionable fact is the ticket count"
  );
  assert.deepEqual(rosterStatistic({ points: 5 }, "COMPLETED"), { value: 5, unit: "pts" });
  assert.equal(rosterStatistic({}, "PAUSED").value, 0, "a paused round still has a score");
});

test("the roster's seat count is worded for the state the server is in", () => {
  assert.equal(rosterTally("WAITING", 3), "3 seated");
  assert.equal(rosterTally("RUNNING", 3), "3 playing");
  assert.equal(rosterTally("PAUSED", 3), "3 playing");
  assert.equal(rosterTally("COMPLETED", 3), "3 played");
  assert.equal(rosterTally("WAITING", undefined), "0 seated", "a missing count is zero, not NaN");
});
