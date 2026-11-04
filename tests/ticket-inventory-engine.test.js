import test from "node:test";
import assert from "node:assert/strict";
import { GameState } from "../server/game/engine.js";
import { makeRoom, TICKET_A, TICKET_B } from "./helpers.js";

const HOST_AUTH = (host) => ({ socketId: host.socketId });
const inventoryTicket = (id, serial, grid) => ({ inventoryTicketId: id, serial, grid });

test("prevalidated inventory tickets retain stable identity through assignment, start, and private snapshots", () => {
  const h = makeRoom();
  const host = h.host();
  const player = h.player("Booked Player", "sock-booked");
  assert.equal(h.room.lockTicketCount({ playerId: player.playerId, count: 2 }).ok, true);
  const selected = [
    inventoryTicket("inv-1", "TKT-0001", TICKET_A),
    inventoryTicket("inv-2", "TKT-0002", TICKET_B),
  ];

  const assigned = h.room.assignInventoryTickets({
    playerId: player.playerId,
    playerToken: player.playerToken,
    tickets: selected,
  });
  assert.equal(assigned.ok, true);
  assert.equal(assigned.inventoryLocked, true);
  assert.deepEqual(assigned.tickets.map(({ no, inventoryTicketId, serial }) => ({ no, inventoryTicketId, serial })), [
    { no: 1, inventoryTicketId: "inv-1", serial: "TKT-0001" },
    { no: 2, inventoryTicketId: "inv-2", serial: "TKT-0002" },
  ]);

  const retried = h.room.assignInventoryTickets({ playerId: player.playerId, playerToken: player.playerToken, tickets: selected });
  assert.equal(retried.ok, true);
  assert.equal(retried.idempotent, true);
  const changed = h.room.assignInventoryTickets({
    playerId: player.playerId,
    playerToken: player.playerToken,
    tickets: [inventoryTicket("inv-other", "TKT-0009", TICKET_A), inventoryTicket("inv-2", "TKT-0002", TICKET_B)],
  });
  assert.equal(changed.ok, false);
  assert.equal(changed.code, "TICKET_INVENTORY_LOCKED");

  const started = h.room.start(HOST_AUTH(host));
  assert.equal(started.ok, true);
  const held = h.room.players.get(player.playerId).tickets;
  assert.deepEqual(held.map(({ no, inventoryTicketId, serial, grid }) => ({ no, inventoryTicketId, serial, grid })), [
    { no: 1, inventoryTicketId: "inv-1", serial: "TKT-0001", grid: TICKET_A },
    { no: 2, inventoryTicketId: "inv-2", serial: "TKT-0002", grid: TICKET_B },
  ]);

  const snapshot = h.room.playerSnapshot(player.playerId);
  assert.deepEqual(snapshot.tickets.map(({ no, inventoryTicketId, serial }) => ({ no, inventoryTicketId, serial })), [
    { no: 1, inventoryTicketId: "inv-1", serial: "TKT-0001" },
    { no: 2, inventoryTicketId: "inv-2", serial: "TKT-0002" },
  ]);
  const events = h.direct.filter((entry) => entry.socketId === player.socketId && entry.event === "ticket:assigned");
  assert.deepEqual(events.map(({ payload }) => ({ ticketNo: payload.ticketNo, inventoryTicketId: payload.inventoryTicketId, serial: payload.serial })), [
    { ticketNo: 1, inventoryTicketId: "inv-1", serial: "TKT-0001" },
    { ticketNo: 2, inventoryTicketId: "inv-2", serial: "TKT-0002" },
  ]);
  assert.equal(JSON.stringify(h.events).includes("TKT-0001"), false, "room broadcasts do not leak ticket serials or grids");
});

test("inventory assignment rejects invalid, duplicate, mismatched, and foreign seat input without changing tickets", () => {
  const h = makeRoom();
  h.host();
  const alice = h.player("Alice", "sock-a");
  const bob = h.player("Bob", "sock-b");
  h.room.lockTicketCount({ playerId: alice.playerId, count: 1 });

  const foreign = h.room.assignInventoryTickets({ playerId: alice.playerId, playerToken: bob.playerToken, tickets: [inventoryTicket("id-a", "TKT-1", TICKET_A)] });
  assert.equal(foreign.code, "NOT_PLAYER");
  const wrongCount = h.room.assignInventoryTickets({ playerId: alice.playerId, playerToken: alice.playerToken, tickets: [] });
  assert.equal(wrongCount.code, "TICKET_INVENTORY_COUNT");
  const badGrid = h.room.assignInventoryTickets({ playerId: alice.playerId, playerToken: alice.playerToken, tickets: [inventoryTicket("id-a", "TKT-1", [[1]])] });
  assert.equal(badGrid.code, "TICKET_INVENTORY_INVALID");
  assert.equal(h.room.players.get(alice.playerId).tickets.length, 0);

  const assigned = h.room.assignInventoryTickets({ playerId: alice.playerId, playerToken: alice.playerToken, tickets: [inventoryTicket("shared-id", "TKT-1", TICKET_A)] });
  assert.equal(assigned.ok, true);
  const collision = h.room.assignInventoryTickets({ playerId: bob.playerId, playerToken: bob.playerToken, tickets: [inventoryTicket("shared-id", "TKT-2", TICKET_B)] });
  assert.equal(collision.code, "TICKET_INVENTORY_DUPLICATE");
  assert.equal(h.room.players.get(bob.playerId).tickets.length, 0);
});

test("start fails closed without mutating the waiting game when a locked inventory is incomplete", () => {
  const h = makeRoom();
  const host = h.host();
  const player = h.player("Booked Player", "sock-booked");
  h.room.lockTicketCount({ playerId: player.playerId, count: 2 });
  assert.equal(h.room.assignInventoryTickets({
    playerId: player.playerId,
    playerToken: player.playerToken,
    tickets: [inventoryTicket("inv-1", "TKT-0001", TICKET_A), inventoryTicket("inv-2", "TKT-0002", TICKET_B)],
  }).ok, true);
  h.room.players.get(player.playerId).tickets.pop();
  const beforeEvents = h.events.length;
  const beforeDirect = h.direct.length;

  const result = h.room.start(HOST_AUTH(host));
  assert.equal(result.ok, false);
  assert.equal(result.code, "TICKET_INVENTORY_INCOMPLETE");
  assert.equal(h.room.state, GameState.WAITING);
  assert.deepEqual(h.room.draw, []);
  assert.equal(h.room.players.get(player.playerId).tickets.length, 1, "start does not mint a replacement grid");
  assert.equal(h.events.length, beforeEvents);
  assert.equal(h.direct.length, beforeDirect);
});

test("reselecting the same count cannot remint a damaged inventory-locked ticket set", () => {
  const h = makeRoom();
  const host = h.host();
  const player = h.player("Booked Player", "sock-booked");
  h.room.lockTicketCount({ playerId: player.playerId, count: 2 });
  assert.equal(h.room.assignInventoryTickets({
    playerId: player.playerId,
    playerToken: player.playerToken,
    tickets: [inventoryTicket("inv-1", "TKT-0001", TICKET_A), inventoryTicket("inv-2", "TKT-0002", TICKET_B)],
  }).ok, true);
  const seat = h.room.players.get(player.playerId);
  seat.tickets.pop();
  const beforeEvents = h.events.length;
  const beforeDirect = h.direct.length;

  const result = h.room.selectTickets({ playerId: player.playerId, playerToken: player.playerToken, count: 2 });
  assert.equal(result.ok, false);
  assert.equal(result.code, "TICKET_INVENTORY_INCOMPLETE");
  assert.equal(seat.tickets.length, 1, "the engine leaves the damaged assigned set untouched");
  assert.equal(seat.tickets[0].inventoryTicketId, "inv-1");
  assert.equal(h.room.state, GameState.WAITING);
  assert.equal(h.events.length, beforeEvents);
  assert.equal(h.direct.length, beforeDirect);

  // The same path is safely idempotent only while the complete set is intact.
  seat.tickets.push({ no: 2, inventoryTicketId: "inv-2", serial: "TKT-0002", grid: TICKET_B });
  const retry = h.room.selectTickets({ playerId: player.playerId, playerToken: player.playerToken, count: 2 });
  assert.equal(retry.ok, true);
  assert.equal(retry.idempotent, true);
  assert.deepEqual(retry.tickets.map((ticket) => ticket.serial), ["TKT-0001", "TKT-0002"]);
});

test("hydration preserves inventory ID and serial for an assigned ticket", () => {
  const h = makeRoom({ roomId: "INVTICKET" });
  h.room.hydrateFrom({
    roomId: "INVTICKET",
    state: GameState.WAITING,
    players: [{
      id: "p1", name: "Booked Player", tickets: [inventoryTicket("inv-durable", "TKT-0042", TICKET_A)],
      ticketCount: 1, ticketSelectionLocked: true, inventoryLocked: true,
    }],
    draw: [], calledNumbers: [], cursor: 0,
  });
  assert.deepEqual(h.room.players.get("p1").tickets, [{ no: 1, inventoryTicketId: "inv-durable", serial: "TKT-0042", grid: TICKET_A }]);
  assert.equal(h.room.playerSnapshot("p1").tickets[0].inventoryTicketId, "inv-durable");
  assert.equal(h.room.playerSnapshot("p1").tickets[0].serial, "TKT-0042");
  assert.deepEqual(h.room.integrityErrors(), []);
});

test("legacy count-selected tickets keep their existing shape and are still minted at start", () => {
  const h = makeRoom();
  const host = h.host();
  const player = h.player("Legacy Player", "sock-legacy");
  const selected = h.room.selectTickets({ playerId: player.playerId, playerToken: player.playerToken, count: 1 });
  assert.equal(selected.ok, true);
  assert.equal(selected.tickets[0].inventoryTicketId, undefined);
  assert.equal(selected.tickets[0].serial, undefined);
  const started = h.room.start(HOST_AUTH(host));
  assert.equal(started.ok, true);
  assert.equal(h.room.players.get(player.playerId).tickets[0].inventoryTicketId, undefined);
  assert.equal(h.room.players.get(player.playerId).tickets[0].serial, undefined);
  const pushed = h.direct.find((entry) => entry.socketId === player.socketId && entry.event === "ticket:assigned");
  assert.ok(pushed);
  assert.equal(pushed.payload.inventoryTicketId, undefined);
  assert.equal(pushed.payload.serial, undefined);
});

test("inventory tickets and stable identity survive room reset and the next start", () => {
  const h = makeRoom();
  const host = h.host();
  const player = h.player("Booked Player", "sock-booked");
  h.room.lockTicketCount({ playerId: player.playerId, count: 1 });
  const original = inventoryTicket("inv-across-rounds", "TKT-0042", TICKET_A);
  assert.equal(h.room.assignInventoryTickets({ playerId: player.playerId, playerToken: player.playerToken, tickets: [original] }).ok, true);

  assert.equal(h.room.start(HOST_AUTH(host)).ok, true);
  const firstRoundTicket = { ...h.room.players.get(player.playerId).tickets[0] };
  assert.equal(h.room.end(HOST_AUTH(host)).ok, true);
  assert.equal(h.room.reset(HOST_AUTH(host)).ok, true);
  const waitingTicket = h.room.players.get(player.playerId).tickets[0];
  assert.equal(waitingTicket.inventoryTicketId, "inv-across-rounds");
  assert.equal(waitingTicket.serial, "TKT-0042");
  assert.deepEqual(waitingTicket.grid, TICKET_A);

  assert.equal(h.room.start(HOST_AUTH(host)).ok, true);
  const nextRoundTicket = h.room.players.get(player.playerId).tickets[0];
  assert.equal(nextRoundTicket.no, firstRoundTicket.no, "legacy per-seat number remains stable");
  assert.equal(nextRoundTicket.inventoryTicketId, firstRoundTicket.inventoryTicketId);
  assert.equal(nextRoundTicket.serial, firstRoundTicket.serial);
  assert.deepEqual(nextRoundTicket.grid, firstRoundTicket.grid, "the engine does not remint an inventory-backed ticket");
});
