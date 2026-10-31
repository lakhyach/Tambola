/**
 * Phase 18: the multi-ticket lifecycle, end to end on the engine.
 *
 * The suite is deliberately about what the PLAYER can prove, not about the
 * presentation: how many tickets a seat holds, that the count locks at start,
 * that marking is derivable for every ticket from the official history, that a
 * claim names the ticket that won it, and that a reconnect or a recovery never
 * changes a seat's tickets. Marking itself is client-side arithmetic over
 * `calledNumbers` (lib/ticketview.js), so the engine tests assert the data it is
 * derived from rather than a stored "marked" flag that could drift.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { ErrorCodes, GameState, TICKET_MAX } from "../server/game/engine.js";
import { validateTicket, ticketNumbers } from "../server/game/ticket.js";
import { TICKET_A, TICKET_B, TOP_LINE, MIDDLE_LINE, makeRoom, callSpecific } from "./helpers.js";

const HOST_AUTH = (host) => ({ socketId: host.socketId });

/** How many of a ticket's 15 numbers are in the official history. */
function markedOn(grid, calledNumbers) {
  const called = new Set(calledNumbers);
  return ticketNumbers(grid).filter((n) => called.has(n)).length;
}

/** Fingerprint: the 15 numbers sorted, which is what makes two grids "same". */
function fingerprint(grid) {
  return ticketNumbers(grid).slice().sort((a, b) => a - b).join(",");
}

function seatTickets(room, playerId) {
  return room.players.get(playerId).tickets;
}

// ------------------------------------------------------- selection lifecycle

for (const count of [1, 2, 3, 4]) {
  test("a seat playing " + count + " ticket(s) gets exactly that many legal, distinct tickets", () => {
    const h = makeRoom({ config: { maxTicketsPerPlayer: 4 } });
    const host = h.host();
    const alice = h.player("Alice", "sock-a");

    const picked = h.room.selectTickets({ playerId: alice.playerId, playerToken: alice.playerToken, count });
    assert.equal(picked.ok, true);
    assert.equal(picked.ticketCount, count);

    const started = h.room.start(HOST_AUTH(host));
    assert.equal(started.ok, true);
    assert.equal(started.ticketsIssued, count + 1, "the host plays one ticket too");

    const tickets = seatTickets(h.room, alice.playerId);
    assert.equal(tickets.length, count);
    assert.deepEqual(tickets.map((t) => t.no), Array.from({ length: count }, (_, i) => i + 1));
    const prints = new Set();
    for (const ticket of tickets) {
      assert.deepEqual(validateTicket(ticket.grid).errors, [], "ticket " + ticket.no + " is legal");
      const print = fingerprint(ticket.grid);
      assert.equal(prints.has(print), false, "two tickets share the same 15 numbers");
      prints.add(print);
    }

    const snapshot = h.room.playerSnapshot(alice.playerId);
    assert.equal(snapshot.tickets.length, count);
    assert.equal(snapshot.ticketCount, count);
    assert.deepEqual(snapshot.tickets.map((t) => t.no), tickets.map((t) => t.no));
  });
}

test("the room maximum is honoured at the hard ceiling too", () => {
  const h = makeRoom({ config: { maxTicketsPerPlayer: TICKET_MAX } });
  h.host();
  const alice = h.player("Alice", "sock-a");
  const picked = h.room.selectTickets({ playerId: alice.playerId, playerToken: alice.playerToken, count: TICKET_MAX });
  assert.equal(picked.ok, true);
  assert.equal(picked.tickets.length, TICKET_MAX);
  assert.equal(h.room.ticketCeiling(), TICKET_MAX);
});

test("a count above the room maximum is refused, not clamped silently", () => {
  const h = makeRoom({ config: { maxTicketsPerPlayer: 2 } });
  h.host();
  const alice = h.player("Alice", "sock-a");
  const tooMany = h.room.selectTickets({ playerId: alice.playerId, playerToken: alice.playerToken, count: 3 });
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.code, ErrorCodes.TICKET_LIMIT);
  assert.equal(tooMany.max, 2);
  assert.equal(seatTickets(h.room, alice.playerId).length, 0, "a refused pick mints nothing");
});

test("tickets lock the moment the round starts", () => {
  const h = makeRoom({ config: { maxTicketsPerPlayer: 4 } });
  const host = h.host();
  const alice = h.player("Alice", "sock-a");
  h.room.selectTickets({ playerId: alice.playerId, playerToken: alice.playerToken, count: 2 });
  h.room.start(HOST_AUTH(host));

  const before = seatTickets(h.room, alice.playerId).map((t) => fingerprint(t.grid));
  for (const state of [GameState.RUNNING, GameState.PAUSED, GameState.COMPLETED]) {
    if (h.room.state !== state) {
      if (state === GameState.PAUSED) h.room.pause(HOST_AUTH(host));
      if (state === GameState.COMPLETED) h.room.end(HOST_AUTH(host));
    }
    const attempt = h.room.selectTickets({ playerId: alice.playerId, playerToken: alice.playerToken, count: 4 });
    assert.equal(attempt.ok, false, "selection must be refused while " + state);
    assert.equal(attempt.code, ErrorCodes.INVALID_STATE);
    assert.deepEqual(seatTickets(h.room, alice.playerId).map((t) => fingerprint(t.grid)), before, "tickets did not change");
  }
});

// ---------------------------------------------------------- marking across all

test("every owned ticket is marked from the same official history", () => {
  const h = makeRoom({ config: { maxTicketsPerPlayer: 4 } });
  const host = h.host();
  const alice = h.player("Alice", "sock-a");
  h.room.selectTickets({ playerId: alice.playerId, playerToken: alice.playerToken, count: 3 });
  h.room.start(HOST_AUTH(host));

  const tickets = seatTickets(h.room, alice.playerId);
  callSpecific(h.room, TOP_LINE);
  const snapshot = h.room.playerSnapshot(alice.playerId);

  // the number the client marks for each ticket is derivable from the snapshot
  for (const ticket of tickets) {
    const expected = ticketNumbers(ticket.grid).filter((n) => new Set(snapshot.calledNumbers).has(n)).length;
    assert.equal(markedOn(ticket.grid, snapshot.calledNumbers), expected);
  }
  // the called history is shared: every ticket sees the same official numbers
  assert.deepEqual(snapshot.calledNumbers, TOP_LINE);
  assert.equal(h.room.calledNumbers.length, TOP_LINE.length, "marking never changes the draw");
});

test("a ticket with no calls stays at zero and cannot win a line", () => {
  const h = makeRoom({ config: { maxTicketsPerPlayer: 4 } });
  const host = h.host();
  const alice = h.player("Alice", "sock-a");
  h.room.start(HOST_AUTH(host));
  h.room.players.get(alice.playerId).tickets = [
    { no: 1, grid: TICKET_A },
    { no: 2, grid: TICKET_B },
  ];
  callSpecific(h.room, TOP_LINE); // only ticket 1's top line
  assert.equal(markedOn(TICKET_B, h.room.calledNumbers), 0, "ticket 2 has nothing called");
  const claim = h.room.claim({ playerId: alice.playerId, playerToken: alice.playerToken, pattern: "topLine", ticketNo: 2 });
  assert.equal(claim.ok, false);
  assert.equal(h.room.players.get(alice.playerId).points, 0);
});

// --------------------------------------------------------------- claim tickets

test("a claim from any ticket is awarded with that ticket's number on record", () => {
  const h = makeRoom({ config: { maxTicketsPerPlayer: 4 } });
  const host = h.host();
  const alice = h.player("Alice", "sock-a");
  h.room.start(HOST_AUTH(host));
  h.room.players.get(alice.playerId).tickets = [
    { no: 1, grid: TICKET_A },
    { no: 2, grid: TICKET_A.map((row) => row.slice()) }, // same numbers, different slot
    { no: 3, grid: TICKET_B },
  ];
  h.room.players.get(alice.playerId).ticketCount = 3;

  callSpecific(h.room, TOP_LINE); // tickets 1 and 2 complete together, 3 does not
  const claim = h.room.claim({ playerId: alice.playerId, playerToken: alice.playerToken, pattern: "topLine" });
  assert.equal(claim.ok, true);
  assert.equal(claim.ticketNo, 1, "ties go to the lower ticket number");

  const award = h.room.awardList().find((a) => a.pattern === "topLine");
  assert.equal(award.ticketNo, 1, "the winner record names the ticket");
  assert.equal(award.playerId, alice.playerId);
  assert.deepEqual(h.room.leaderboard()[0].claims, ["topLine"]);
});

test("a claim refusals never award a different ticket's pattern", () => {
  const h = makeRoom({ config: { maxTicketsPerPlayer: 4 } });
  const host = h.host();
  const alice = h.player("Alice", "sock-a");
  h.room.start(HOST_AUTH(host));
  h.room.players.get(alice.playerId).tickets = [
    { no: 1, grid: TICKET_A },
    { no: 2, grid: TICKET_B },
  ];
  callSpecific(h.room, MIDDLE_LINE); // ticket 1 middle line
  const wrong = h.room.claim({ playerId: alice.playerId, playerToken: alice.playerToken, pattern: "topLine", ticketNo: 2 });
  assert.equal(wrong.ok, false);
  assert.equal(h.room.awards.size, 0);
  const right = h.room.claim({ playerId: alice.playerId, playerToken: alice.playerToken, pattern: "middleLine", ticketNo: 1 });
  assert.equal(right.ok, true);
  assert.equal(right.ticketNo, 1);
});

// ------------------------------------------------------------- reconnection

test("a reconnect finds the same tickets, the same calls and the same score", () => {
  const h = makeRoom({ config: { maxTicketsPerPlayer: 4 } });
  const host = h.host();
  const alice = h.player("Alice", "sock-a");
  h.room.selectTickets({ playerId: alice.playerId, playerToken: alice.playerToken, count: 3 });
  h.room.start(HOST_AUTH(host));
  const before = seatTickets(h.room, alice.playerId).map((t) => fingerprint(t.grid));

  callSpecific(h.room, [...TOP_LINE, 4, 12]);
  // the browser dropped: a new socket, the same session token
  const resumed = h.room.resume({ playerId: alice.playerId, playerToken: alice.playerToken, socketId: "sock-a2" });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.resumed, true);
  const snapshot = resumed.snapshot;
  assert.deepEqual(snapshot.tickets.map((t) => fingerprint(t.grid)), before, "no ticket changed across a reconnect");
  assert.deepEqual(snapshot.calledNumbers, h.room.calledNumbers);
  assert.equal(snapshot.calledCount, 7);
  assert.equal(snapshot.playerId, alice.playerId);
  assert.equal(h.room.players.get(alice.playerId).socketId, "sock-a2");
});

test("a reconnect after a claim keeps the award and its ticket", () => {
  const h = makeRoom({ config: { maxTicketsPerPlayer: 4 } });
  const host = h.host();
  const alice = h.player("Alice", "sock-a");
  h.room.start(HOST_AUTH(host));
  h.room.players.get(alice.playerId).tickets = [{ no: 1, grid: TICKET_A }];
  callSpecific(h.room, TOP_LINE);
  h.room.claim({ playerId: alice.playerId, playerToken: alice.playerToken, pattern: "topLine" });

  const resumed = h.room.resume({ playerId: alice.playerId, playerToken: alice.playerToken, socketId: "sock-a2" });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.snapshot.points, 10);
  assert.deepEqual(resumed.snapshot.claims, ["topLine"]);
  const award = resumed.snapshot.awards.find((a) => a.pattern === "topLine");
  assert.equal(award.ticketNo, 1);
});

test("a duplicate claim event cannot award twice", () => {
  const h = makeRoom({ config: { maxTicketsPerPlayer: 4 } });
  const host = h.host();
  const alice = h.player("Alice", "sock-a");
  h.room.start(HOST_AUTH(host));
  h.room.players.get(alice.playerId).tickets = [{ no: 1, grid: TICKET_A }];
  callSpecific(h.room, TOP_LINE);
  const first = h.room.claim({ playerId: alice.playerId, playerToken: alice.playerToken, pattern: "topLine" });
  const second = h.room.claim({ playerId: alice.playerId, playerToken: alice.playerToken, pattern: "topLine" });
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.code, ErrorCodes.ALREADY_CLAIMED_BY_YOU);
  assert.equal(h.room.players.get(alice.playerId).points, 10, "points were awarded once");
  assert.equal(h.room.awardList().filter((a) => a.pattern === "topLine").length, 1);
});

// --------------------------------------------------------- recovery + rounds

test("a hydrated round restores every seat's ticket set unchanged", () => {
  const h = makeRoom({ roomId: "PLAY18A" });
  // the durable draw plan must open with the numbers already called
  const plan = [...TOP_LINE, ...Array.from({ length: 90 }, (_, i) => i + 1).filter((n) => !TOP_LINE.includes(n))];
  h.room.hydrateFrom({
    roomId: "PLAY18A",
    state: GameState.RUNNING,
    gameNumber: 1,
    hostPlayerId: "p1",
    draw: plan,
    calledNumbers: TOP_LINE,
    cursor: TOP_LINE.length,
    players: [
      {
        id: "p1",
        name: "Alice",
        tickets: [
          { no: 1, grid: TICKET_A },
          { no: 2, grid: TICKET_B },
        ],
        ticketCount: 2,
        points: 0,
        claims: [],
      },
    ],
  });
  h.room.assertIntegrity();
  const snapshot = h.room.playerSnapshot("p1");
  assert.deepEqual(snapshot.tickets.map((t) => t.no), [1, 2]);
  assert.deepEqual(snapshot.calledNumbers, TOP_LINE);
  assert.equal(markedOn(snapshot.tickets[0].grid, snapshot.calledNumbers), 5);
  assert.equal(markedOn(snapshot.tickets[1].grid, snapshot.calledNumbers), 0);
});

test("a completed round keeps the tickets and the awards for review", () => {
  const h = makeRoom({ config: { maxTicketsPerPlayer: 4 } });
  const host = h.host();
  const alice = h.player("Alice", "sock-a");
  h.room.start(HOST_AUTH(host));
  // pin the grid so the completed-round read-out has exact numbers to check
  h.room.players.get(alice.playerId).tickets = [{ no: 1, grid: TICKET_A }];
  callSpecific(h.room, TOP_LINE);
  h.room.claim({ playerId: alice.playerId, playerToken: alice.playerToken, pattern: "topLine" });
  const ended = h.room.end(HOST_AUTH(host));
  assert.equal(ended.ok, true);
  assert.equal(h.room.state, GameState.COMPLETED);

  const snapshot = h.room.playerSnapshot(alice.playerId);
  assert.equal(snapshot.state, GameState.COMPLETED);
  assert.equal(snapshot.tickets.length, 1);
  assert.equal(snapshot.points, 10);
  assert.equal(snapshot.awards.find((a) => a.pattern === "topLine").ticketNo, 1);
});

test("a seat that joins a running round spectates without a ticket", () => {
  const h = makeRoom({ config: { maxTicketsPerPlayer: 4 } });
  const host = h.host();
  h.room.start(HOST_AUTH(host));
  const late = h.room.join({ name: "Late", socketId: "sock-late" });
  assert.equal(late.ok, true, "joining mid-round is allowed");
  const snapshot = h.room.playerSnapshot(late.playerId);
  assert.deepEqual(snapshot.tickets, []);
  assert.equal(snapshot.ticketCount, 1, "the count the next round will honour");
  const claim = h.room.claim({ playerId: late.playerId, playerToken: late.playerToken, pattern: "topLine" });
  assert.equal(claim.ok, false);
});

// ------------------------------------------------------------- room isolation

test("two rooms never see or accept each other's tickets", () => {
  const a = makeRoom({ roomId: "ROOM-A", seed: 101 });
  const b = makeRoom({ roomId: "ROOM-B", seed: 202 });
  const hostA = a.host();
  const hostB = b.host();
  const aliceA = a.player("Alice", "sock-a");
  b.player("Bob", "sock-b");

  a.room.selectTickets({ playerId: aliceA.playerId, playerToken: aliceA.playerToken, count: 3 });
  a.room.start(HOST_AUTH(hostA));
  b.room.start(HOST_AUTH(hostB));

  assert.equal(a.room.roomId, "ROOM-A");
  assert.equal(b.room.roomId, "ROOM-B");
  assert.equal(b.room.players.has(aliceA.playerId), false, "a playerId is not a key into another room");

  // Alice's credential means nothing in room B
  const foreign = b.room.claim({ playerId: aliceA.playerId, playerToken: aliceA.playerToken, pattern: "topLine" });
  assert.equal(foreign.ok, false);
  assert.equal(foreign.code, ErrorCodes.NOT_PLAYER);

  // no snapshot of B carries A's grids
  const serialised = JSON.stringify([b.room.publicSnapshot(), b.room.hostSnapshot(), b.room.playerSnapshot("p1")]);
  const alicePrints = seatTickets(a.room, aliceA.playerId).map((t) => fingerprint(t.grid));
  for (const print of alicePrints) {
    assert.equal(serialised.includes(print), false, "room B leaked room A's numbers");
  }
});

test("room B's host never receives room A's ticket assignment", () => {
  const a = makeRoom({ roomId: "ROOM-A", seed: 7 });
  const b = makeRoom({ roomId: "ROOM-B", seed: 8 });
  const hostA = a.host();
  const hostB = b.host();
  a.player("Alice", "sock-a");
  b.player("Bob", "sock-b");
  a.room.start(HOST_AUTH(hostA));
  b.room.start(HOST_AUTH(hostB));

  const issued = (h) => h.direct.filter((e) => e.event === "ticket:assigned");
  const sockets = (h) => new Set(issued(h).map((e) => e.socketId));
  const grids = (h) => new Set(issued(h).map((e) => fingerprint(e.payload.ticket)));

  // each room mints only for its own seats, and no grid appears in both rooms
  assert.deepEqual([...sockets(a)].sort(), ["sock-a", "sock-host"]);
  assert.deepEqual([...sockets(b)].sort(), ["sock-b", "sock-host"]);
  for (const print of grids(a)) {
    assert.equal(grids(b).has(print), false, "the same 15 numbers were issued in both rooms");
  }
  assert.equal(issued(a).length, 2, "Alice's two tickets plus the host's one");
  assert.equal(issued(b).length, 2, "Bob's and the host's single tickets");
});
