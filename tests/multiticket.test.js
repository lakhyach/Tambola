/**
 * Phase 13: multiple tickets per seat.
 *
 * These cover the behaviour the single-ticket suite could not: a seat choosing
 * a ticket count before the round (server-enforced), the engine minting that
 * many distinct tickets at start, claims verified across all owned tickets with
 * the SERVER picking the winning one, and the whole set surviving a hydrate.
 * Everything runs on the deterministic helpers.js harness.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { ErrorCodes, GameState } from "../server/game/engine.js";
import { validateTicket } from "../server/game/ticket.js";
import { evaluateClaimAcrossTickets } from "../server/game/patterns.js";
import {
  makeRoom,
  callSpecific,
  TICKET_A,
  TICKET_B,
  TOP_LINE,
} from "./helpers.js";

const HOST_AUTH = (host) => ({ socketId: host.socketId });

// ------------------------------------------------------- patterns across tickets

test("a seat wins on whichever ticket actually completes the pattern", () => {
  const tickets = [
    { no: 1, grid: TICKET_A },
    { no: 2, grid: TICKET_B },
  ];
  // only ticket 2's top line is called
  const onTwo = evaluateClaimAcrossTickets("topLine", tickets, [4, 12, 25, 32, 51], {});
  assert.equal(onTwo.valid, true);
  assert.equal(onTwo.ticketNo, 2, "the server picked ticket 2, not the caller");

  // only ticket 1's top line is called
  const onOne = evaluateClaimAcrossTickets("topLine", tickets, TOP_LINE, {});
  assert.equal(onOne.valid, true);
  assert.equal(onOne.ticketNo, 1);

  // neither completes
  const none = evaluateClaimAcrossTickets("topLine", tickets, [3, 11], {});
  assert.equal(none.valid, false, "an incomplete claim stays incomplete");
});

test("a named ticketNo restricts the claim to that owned ticket", () => {
  const tickets = [
    { no: 1, grid: TICKET_A },
    { no: 2, grid: TICKET_B },
  ];
  // ticket 1 is complete, but the claim names ticket 2, which is not
  const wrong = evaluateClaimAcrossTickets("topLine", tickets, TOP_LINE, {}, { ticketNo: 2 });
  assert.equal(wrong.valid, false);
  assert.match(wrong.reason, /incomplete/i);

  // naming a ticket the seat does not hold is refused, not silently ignored
  const foreign = evaluateClaimAcrossTickets("topLine", tickets, TOP_LINE, {}, { ticketNo: 9 });
  assert.equal(foreign.valid, false);
  assert.match(foreign.reason, /belongs to you/);
});

test("earliest completion wins, ties broken by the lower ticket number", () => {
  const tickets = [
    { no: 1, grid: TICKET_A },
    { no: 2, grid: TICKET_B },
  ];
  // earlyFive completes on the fifth hit; ticket 1's whole top line called by
  // call 5 gives it five hits, while ticket 2 has none - so ticket 1 wins
  const early = evaluateClaimAcrossTickets("earlyFive", tickets, TOP_LINE, {});
  assert.equal(early.valid, true);
  assert.equal(early.ticketNo, 1, "the server picked the ticket that completed");
  assert.equal(early.completedOnCall, 5);

  // when both tickets complete with no distinguishing ordinal (lines carry no
  // completedOnCall), the tie breaks to the lower ticket number
  const both = evaluateClaimAcrossTickets("topLine", tickets, [...TOP_LINE, 4, 12, 25, 32, 51], {});
  assert.equal(both.valid, true);
  assert.deepEqual(both.winningTickets, [1, 2], "both tickets qualify");
  assert.equal(both.ticketNo, 1, "tie broken by the lower ticket number");
});

// ------------------------------------------------------------- selection rules

test("a seat picks its ticket count while waiting and sees that many tickets", () => {
  const h = makeRoom({ config: { maxTicketsPerPlayer: 4 } });
  const host = h.host();
  const alice = h.player("Alice", "sock-a");

  const picked = h.room.selectTickets({
    playerId: alice.playerId,
    playerToken: alice.playerToken,
    count: 3,
  });
  assert.equal(picked.ok, true);
  assert.equal(picked.ticketCount, 3);
  assert.equal(picked.tickets.length, 3);
  assert.deepEqual(picked.tickets.map((t) => t.no), [1, 2, 3], "tickets are numbered from 1");
  for (const t of picked.tickets) assert.deepEqual(validateTicket(t.grid).errors, [], "each ticket is legal");
});

test("the roster tells the host how many tickets each seat is playing, and never a grid", () => {
  const h = makeRoom({ config: { maxTicketsPerPlayer: 4 } });
  const host = h.host();
  const alice = h.player("Alice", "sock-a");
  const bob = h.player("Bob", "sock-b");
  h.room.selectTickets({ playerId: alice.playerId, playerToken: alice.playerToken, count: 3 });

  const rows = h.room.playersList();
  const seat = (name) => rows.find((p) => p.name === name);
  assert.equal(seat("Alice").tickets, 3, "the host can see who is ready to play");
  // A seat that never touches the picker still plays one ticket: start() issues
  // max(1, ticketCount). Reporting the minted grids instead showed 0 for every
  // such seat, which read as "not playing" for the host and for each new joiner.
  assert.equal(seat("Bob").tickets, 1, "an untouched seat still plays the one ticket it will be issued");
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), ["connected", "id", "isHost", "name", "points", "tickets"]);
    assert.equal(row.grid, undefined, "a roster row never carries a ticket grid");
  }

  // What the roster promised before the round is what the round issues.
  h.room.start(HOST_AUTH(host));
  for (const row of h.room.playersList()) {
    assert.equal(row.tickets, h.room.players.get(row.id).tickets.length, row.name + " reads as many tickets as it plays");
  }
});

test("the selection is server-enforced: over the ceiling is refused with TICKET_LIMIT", () => {
  const h = makeRoom({ config: { maxTicketsPerPlayer: 2 } });
  const host = h.host();
  const alice = h.player("Alice", "sock-a");

  const tooMany = h.room.selectTickets({
    playerId: alice.playerId,
    playerToken: alice.playerToken,
    count: 5,
  });
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.code, ErrorCodes.TICKET_LIMIT);
  assert.equal(tooMany.max, 2, "the room's ceiling is echoed back for a clear message");
});

test("a bad credential cannot move somebody else's selection", () => {
  const h = makeRoom({ config: { maxTicketsPerPlayer: 4 } });
  const host = h.host();
  const alice = h.player("Alice", "sock-a");
  const bob = h.player("Bob", "sock-b");

  const spoof = h.room.selectTickets({ playerId: alice.playerId, playerToken: bob.playerToken, count: 4 });
  assert.equal(spoof.ok, false);
  assert.equal(spoof.code, ErrorCodes.NOT_PLAYER);
});

test("shrinking keeps the tickets a player can already see and drops from the end", () => {
  const h = makeRoom({ config: { maxTicketsPerPlayer: 4 } });
  h.host();
  const alice = h.player("Alice", "sock-a");
  const three = h.room.selectTickets({ playerId: alice.playerId, playerToken: alice.playerToken, count: 3 });
  const before = three.tickets.map((t) => t.grid);

  const two = h.room.selectTickets({ playerId: alice.playerId, playerToken: alice.playerToken, count: 2 });
  assert.equal(two.tickets.length, 2);
  assert.deepEqual(two.tickets[0].grid, before[0], "the first ticket never changes under the player");
  assert.deepEqual(two.tickets[1].grid, before[1]);
});

test("tickets chosen are distinct within a seat", () => {
  const h = makeRoom({ config: { maxTicketsPerPlayer: 5 } });
  h.host();
  const alice = h.player("Alice", "sock-a");
  const picked = h.room.selectTickets({ playerId: alice.playerId, playerToken: alice.playerToken, count: 5 });
  const fingerprints = picked.tickets.map((t) => t.grid.flat().filter((n) => n != null).sort((a, b) => a - b).join(","));
  assert.equal(new Set(fingerprints).size, 5, "no two owned tickets are identical");
});

test("selection is locked the moment the game starts", () => {
  const h = makeRoom({ config: { maxTicketsPerPlayer: 4 } });
  const host = h.host();
  const alice = h.player("Alice", "sock-a");
  h.room.selectTickets({ playerId: alice.playerId, playerToken: alice.playerToken, count: 2 });
  h.room.start(HOST_AUTH(host));

  const late = h.room.selectTickets({ playerId: alice.playerId, playerToken: alice.playerToken, count: 4 });
  assert.equal(late.ok, false);
  assert.equal(late.code, ErrorCodes.INVALID_STATE);
});

// ----------------------------------------------------- late joiners (§5 policy)

test("a joiner arriving after the start is seated as a ticket-less spectator", () => {
  const h = makeRoom({ config: { maxTicketsPerPlayer: 4 } });
  const host = h.host();
  const alice = h.player("Alice", "sock-a");
  h.room.selectTickets({ playerId: alice.playerId, playerToken: alice.playerToken, count: 2 });
  h.room.start(HOST_AUTH(host));

  // a newcomer joins while the game is already RUNNING
  const late = h.player("Late", "sock-late");
  const snap = h.room.playerSnapshot(late.playerId);
  assert.equal(snap.state, "RUNNING");
  assert.equal(snap.tickets.length, 0, "a mid-game joiner holds no tickets");
  assert.ok(snap.players.some((p) => p.id === late.playerId), "but they are a seated participant");

  // they can never acquire tickets for the running round
  const pick = h.room.selectTickets({ playerId: late.playerId, playerToken: late.playerToken, count: 1 });
  assert.equal(pick.ok, false);
  assert.equal(pick.code, ErrorCodes.INVALID_STATE, "tickets are locked once started");

  // and an attempt to claim is refused by the server, not just hidden in the UI
  const claim = h.room.claim({ playerId: late.playerId, playerToken: late.playerToken, pattern: "topLine" });
  assert.equal(claim.ok, false);
  assert.equal(claim.code, ErrorCodes.NOT_PLAYER);

  // a spectator may still chat — presence, not silence
  const said = h.room.chat({ playerId: late.playerId, playerToken: late.playerToken, text: "just watching 👀" });
  assert.equal(said.ok, true);
});

test("once the round resets, that same spectator can pick tickets for the next game", () => {
  const h = makeRoom({ config: { maxTicketsPerPlayer: 4 } });
  const host = h.host();
  const alice = h.player("Alice", "sock-a");
  h.room.selectTickets({ playerId: alice.playerId, playerToken: alice.playerToken, count: 1 });
  h.room.start(HOST_AUTH(host));
  const late = h.player("Late", "sock-late");
  assert.equal(h.room.playerSnapshot(late.playerId).tickets.length, 0, "spectator this round");

  // the host ends and resets the room back to WAITING for a fresh round
  h.room.end(HOST_AUTH(host));
  h.room.reset(HOST_AUTH(host));

  const pick = h.room.selectTickets({ playerId: late.playerId, playerToken: late.playerToken, count: 2 });
  assert.equal(pick.ok, true, "the next round accepts their selection");
  assert.equal(pick.tickets.length, 2);
});

// ------------------------------------------------------------------- start

test("start issues exactly the chosen count per seat, privately numbered", () => {
  const h = makeRoom({ config: { maxTicketsPerPlayer: 4 } });
  const host = h.host();
  const alice = h.player("Alice", "sock-a");
  const bob = h.player("Bob", "sock-b");
  h.room.selectTickets({ playerId: alice.playerId, playerToken: alice.playerToken, count: 3 });
  // bob never chose: default of one ticket

  const started = h.room.start(HOST_AUTH(host));
  assert.equal(started.ok, true);
  assert.equal(started.ticketsIssued, 5, "1 for host + 3 for alice + 1 for bob");

  const aliceTickets = h.room.players.get(alice.playerId).tickets;
  assert.equal(aliceTickets.length, 3);
  assert.deepEqual(aliceTickets.map((t) => t.no), [1, 2, 3]);

  // each owned ticket was pushed privately to its socket, never broadcast
  const toAlice = h.direct.filter((e) => e.socketId === "sock-a" && e.event === "ticket:assigned");
  assert.equal(toAlice.length, 3, "one private push per owned ticket");
  assert.deepEqual(toAlice.map((e) => e.payload.ticketNo), [1, 2, 3]);
  for (const event of h.events) {
    assert.equal(JSON.stringify(event.payload).includes('"ticket"'), false, event.event + " leaked a ticket");
  }
});

// ------------------------------------------------------------------- claims

test("a claim across a seat's tickets awards once and names the winning ticket", () => {
  const h = makeRoom({ config: { maxTicketsPerPlayer: 4 } });
  const host = h.host();
  const alice = h.player("Alice", "sock-a");
  h.room.start(HOST_AUTH(host));
  // hand alice two tickets with different top lines so the choice is unambiguous
  h.room.players.get(alice.playerId).tickets = [
    { no: 1, grid: TICKET_A },
    { no: 2, grid: TICKET_B },
  ];

  // call only ticket 2's top line
  callSpecific(h.room, [4, 12, 25, 32, 51]);
  const won = h.room.claim({ playerId: alice.playerId, playerToken: alice.playerToken, pattern: "topLine" });
  assert.equal(won.ok, true);
  assert.equal(won.ticketNo, 2, "the server chose the ticket that actually completed");
  assert.equal(h.room.players.get(alice.playerId).points, 10);

  // a seat wins a pattern once, regardless of how many tickets it holds
  const again = h.room.claim({ playerId: alice.playerId, playerToken: alice.playerToken, pattern: "topLine" });
  assert.equal(again.ok, false);
  assert.equal(again.code, ErrorCodes.ALREADY_CLAIMED_BY_YOU);
});

test("a targeted claim against a non-winning ticket is refused", () => {
  const h = makeRoom({ config: { maxTicketsPerPlayer: 4 } });
  const host = h.host();
  const alice = h.player("Alice", "sock-a");
  h.room.start(HOST_AUTH(host));
  h.room.players.get(alice.playerId).tickets = [
    { no: 1, grid: TICKET_A },
    { no: 2, grid: TICKET_B },
  ];
  callSpecific(h.room, TOP_LINE); // ticket 1 is complete
  const bad = h.room.claim({ playerId: alice.playerId, playerToken: alice.playerToken, pattern: "topLine", ticketNo: 2 });
  assert.equal(bad.ok, false, "naming a ticket that is not complete does not award it");
  assert.equal(h.room.players.get(alice.playerId).points, 0);
});

// ------------------------------------------------------------------ snapshots

test("a player snapshot exposes all owned tickets but the roster only counts them", () => {
  const h = makeRoom({ config: { maxTicketsPerPlayer: 4 } });
  const host = h.host();
  const alice = h.player("Alice", "sock-a");
  h.room.selectTickets({ playerId: alice.playerId, playerToken: alice.playerToken, count: 2 });
  h.room.start(HOST_AUTH(host));

  const view = h.room.playerSnapshot(alice.playerId);
  assert.equal(view.tickets.length, 2);
  assert.equal(view.ticketCount, 2);
  assert.equal(view.maxTickets, 4);
  assert.deepEqual(view.ticket, view.tickets[0].grid, "the legacy single field mirrors ticket 1");

  const pub = h.room.publicSnapshot();
  for (const entry of pub.players) {
    assert.equal(entry.grid, undefined, "the roster still never ships a ticket grid");
    assert.equal(typeof entry.tickets, "number", "only how many, never which");
    assert.equal(Object.keys(entry).sort().join(","), "connected,id,isHost,name,points,tickets");
  }
});

test("hydrate restores a seat's whole ticket set and its chosen count", () => {
  const source = {
    roomId: "HYDRATE1",
    state: GameState.RUNNING,
    gameNumber: 1,
    hostPlayerId: "p1",
    draw: Array.from({ length: 90 }, (_, i) => i + 1),
    calledNumbers: [],
    cursor: 0,
    players: [
      {
        id: "p1",
        name: "Host",
        tickets: [{ no: 1, grid: TICKET_A }, { no: 2, grid: TICKET_B }],
        ticketCount: 2,
        points: 0,
        claims: [],
      },
    ],
  };
  const h = makeRoom({ roomId: "HYDRATE1" });
  h.room.hydrateFrom(source);
  const seat = h.room.players.get("p1");
  assert.equal(seat.tickets.length, 2);
  assert.deepEqual(seat.tickets.map((t) => t.no), [1, 2]);
  assert.equal(seat.ticketCount, 2);
});

test("legacy single-ticket durable state still normalises into one ticket", () => {
  const h = makeRoom({ roomId: "LEGACY1" });
  h.room.hydrateFrom({
    roomId: "LEGACY1",
    state: GameState.RUNNING,
    players: [{ id: "p1", name: "Solo", ticket: TICKET_A }],
    draw: Array.from({ length: 90 }, (_, i) => i + 1),
    calledNumbers: [],
    cursor: 0,
  });
  const seat = h.room.players.get("p1");
  assert.equal(seat.tickets.length, 1);
  assert.deepEqual(seat.tickets[0].grid, TICKET_A);
});

test("reset clears every owned ticket so the next round starts fresh", () => {
  const h = makeRoom({ config: { maxTicketsPerPlayer: 4 } });
  const host = h.host();
  const alice = h.player("Alice", "sock-a");
  h.room.selectTickets({ playerId: alice.playerId, playerToken: alice.playerToken, count: 3 });
  h.room.start(HOST_AUTH(host));
  assert.equal(h.room.players.get(alice.playerId).tickets.length, 3);
  h.room.end(HOST_AUTH(host));
  h.room.reset(HOST_AUTH(host));
  assert.deepEqual(h.room.players.get(alice.playerId).tickets, []);
});
