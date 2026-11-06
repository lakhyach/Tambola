import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import http from "node:http";
import { HAS_DB, openDurableSchema } from "./pattern-harness.js";
import { createBookingService } from "../server/bookings/service.js";
import { createTicketInventoryService } from "../server/bookings/inventory.js";
import { createAdminBookingRouter, createPublicBookingRouter } from "../server/bookings/routes.js";
import { recoverRooms } from "../server/persist/recovery.js";

const future = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();

async function newNumberedSession(db, capacity) {
  const booking = createBookingService({ db });
  const created = await booking.createSession({
    instanceId: "regular",
    actor: "inventory-test",
    title: `Inventory ${randomUUID().slice(0, 8)}`,
    startsAt: future(60),
    bookingOpensAt: future(-2),
    bookingClosesAt: future(55),
    capacity,
    inventoryMode: "numbered",
  });
  assert.ok(created.session);
  assert.equal(created.session.inventoryMode, "numbered");
  assert.equal(created.session.inventoryState, "not_generated");
  return created.session.sessionId;
}

async function hold(db, sessionId, ticketCount, tokenChar) {
  const reservationId = randomUUID();
  await db.query(
    `INSERT INTO ticket_reservations(reservation_id,session_id,display_name,ticket_count,booking_token_hash,status,expires_at)
     VALUES($1,$2,$3,$4,$5,'held',now()+interval '10 minutes')`,
    [reservationId, sessionId, `Guest ${tokenChar}`, ticketCount, tokenChar.repeat(64)]
  );
  return reservationId;
}

test("numbered ticket inventory generates atomically, pages real grids, and allocates tickets once", { skip: !HAS_DB }, async () => {
  const env = await openDurableSchema({ prefix: "ticket_inventory" });
  try {
    const inventory = createTicketInventoryService({ db: env.db });
    const sessionId = await newNumberedSession(env.db, 200);
    const generated = await inventory.generateForSession({
      sessionId,
      requestedCount: 200,
      actor: { type: "host", label: "Synthetic Host" },
      idempotencyKey: "inventory-generation-200-01",
    });
    assert.equal(generated.generatedCount, 200);
    assert.equal(generated.status, "ready");
    const retry = await inventory.generateForSession({
      sessionId,
      requestedCount: 200,
      actor: { type: "host", label: "Synthetic Host" },
      idempotencyKey: "inventory-generation-200-01",
    });
    assert.equal(retry.idempotent, true);
    assert.equal(retry.generationBatchId, generated.generationBatchId);
    assert.equal((await inventory.generateForSession({ sessionId, requestedCount: 200, idempotencyKey: "inventory-generation-200-02" })).error, "INVENTORY_ALREADY_GENERATED");
    const persisted = await env.db.query(
      `SELECT count(*)::int AS total,count(DISTINCT ticket_id)::int AS ids,count(DISTINCT serial)::int AS serials,
          count(DISTINCT fingerprint)::int AS fingerprints,count(*) FILTER(WHERE jsonb_array_length(grid)=3)::int AS legal_shapes,
          min(serial_ordinal)::int AS first_ordinal,max(serial_ordinal)::int AS last_ordinal
         FROM session_tickets WHERE session_id=$1`, [sessionId]
    );
    assert.deepEqual(persisted.rows[0], { total: 200, ids: 200, serials: 200, fingerprints: 200, legal_shapes: 200, first_ordinal: 1, last_ordinal: 200 });

    await env.db.query("UPDATE game_sessions SET status='open' WHERE session_id=$1", [sessionId]);
    const firstPage = await inventory.listPublicCatalog({ sessionId, page: 1, pageSize: 25 });
    const finalPage = await inventory.listPublicCatalog({ sessionId, page: 8, pageSize: 25 });
    assert.equal(firstPage.total, 200);
    assert.equal(firstPage.inventoryTotal, 200);
    assert.equal(firstPage.tickets.length, 25);
    assert.equal(firstPage.tickets[0].serial, "TKT-0001");
    assert.equal(finalPage.tickets.length, 25);
    assert.equal(finalPage.tickets[24].serial, "TKT-0200");
    assert.equal(firstPage.tickets[0].grid.length, 3, "catalog exposes the stored ticket grid");
    assert.equal(await inventory.listAdminInventory({ instanceId: "bumper", sessionId }), null, "cross-instance catalog is not returned");
    assert.equal((await inventory.listAdminInventory({ instanceId: "regular", sessionId, status: "available", search: "TKT-0001" })).tickets[0].serial, "TKT-0001");

    const pageTickets = firstPage.tickets.slice(0, 2);
    const reservationA = await hold(env.db, sessionId, 1, "a");
    const reservationB = await hold(env.db, sessionId, 1, "b");
    const reservationC = await hold(env.db, sessionId, 1, "c");
    const attempts = await Promise.all([
      inventory.allocateToReservation({ sessionId, reservationId: reservationA, ticketIds: [pageTickets[0].ticketId] }),
      inventory.allocateToReservation({ sessionId, reservationId: reservationB, ticketIds: [pageTickets[0].ticketId] }),
    ]);
    assert.equal(attempts.filter((result) => !result.error).length, 1, "exactly one concurrent reservation receives a ticket");
    assert.equal(attempts.filter((result) => result.error === "TICKET_UNAVAILABLE").length, 1);
    const winner = attempts[0].error ? reservationB : reservationA;
    const otherReservations = winner === reservationA ? [reservationB, reservationC] : [reservationA, reservationC];
    const differentTickets = await Promise.all([
      inventory.allocateToReservation({ sessionId, reservationId: otherReservations[0], ticketIds: [pageTickets[1].ticketId] }),
      inventory.allocateToReservation({ sessionId, reservationId: otherReservations[1], ticketIds: [firstPage.tickets[2].ticketId] }),
    ]);
    assert.ok(differentTickets.every((result) => !result.error), "different tickets can be allocated concurrently");
    const idempotent = await inventory.allocateToReservation({ sessionId, reservationId: winner, ticketIds: [pageTickets[0].ticketId] });
    assert.equal(idempotent.idempotent, true);
    const publicAfterHolds = await inventory.listPublicCatalog({ sessionId, status: "reserved", pageSize: 100 });
    assert.equal(publicAfterHolds.total, 197, "public inventory omits held tickets even if the caller requests reserved status");
    assert.equal(publicAfterHolds.inventoryTotal, 197);
    assert.ok(publicAfterHolds.tickets.every((ticket) => ticket.status === "available"));
    assert.equal("playerName" in publicAfterHolds.tickets[0], false, "public inventory does not expose reservation names");

    await env.db.query("UPDATE ticket_reservations SET status='confirmed',confirmed_at=now() WHERE reservation_id=$1", [winner]);
    await inventory.markReservationEvent({ sessionId, reservationId: winner, action: "confirmed", actor: { type: "system", label: "test" } });
    assert.equal((await inventory.listAdminInventory({ instanceId: "regular", sessionId, status: "booked" })).total, 1);

    await env.db.query("UPDATE ticket_reservations SET status='cancelled',cancelled_at=now() WHERE reservation_id=$1", [winner]);
    const released = await inventory.releaseReservation({ sessionId, reservationId: winner, reason: "cancelled", actor: { type: "player", label: "Guest" } });
    assert.equal(released.releasedTicketIds.length, 1);
    assert.equal((await inventory.listAdminInventory({ instanceId: "regular", sessionId, status: "available" })).total, 198);
    const reservationD = await hold(env.db, sessionId, 1, "e");
    const reused = await inventory.allocateToReservation({ sessionId, reservationId: reservationD, ticketIds: [pageTickets[0].ticketId] });
    assert.equal(reused.idempotent, false);

    const expiringReservation = await hold(env.db, sessionId, 1, "f");
    await inventory.allocateToReservation({ sessionId, reservationId: expiringReservation, ticketIds: [firstPage.tickets[3].ticketId] });
    await env.db.query("UPDATE ticket_reservations SET expires_at=now()-interval '1 second' WHERE reservation_id=$1", [expiringReservation]);
    const staleTicket = await inventory.listPublicCatalog({ sessionId, status: "available", search: "TKT-0004", pageSize: 4 });
    assert.equal(staleTicket.total, 1, "catalog read expires stale holds before reporting availability");
    assert.equal((await env.db.query("SELECT status FROM ticket_reservations WHERE reservation_id=$1", [expiringReservation])).rows[0].status, "expired");
    const afterExpiryReservation = await hold(env.db, sessionId, 1, "g");
    const afterExpiry = await inventory.allocateToReservation({ sessionId, reservationId: afterExpiryReservation, ticketIds: [firstPage.tickets[3].ticketId] });
    assert.equal(afterExpiry.idempotent, false, "expired hold is released and its ticket can be allocated again");
    assert.equal((await env.db.query("SELECT status FROM ticket_reservations WHERE reservation_id=$1", [expiringReservation])).rows[0].status, "expired");

    const events = await env.db.query("SELECT action FROM session_ticket_events WHERE session_id=$1 ORDER BY event_id", [sessionId]);
    assert.ok(events.rows.some((row) => row.action === "generated"));
    assert.ok(events.rows.some((row) => row.action === "reserved"));
    assert.ok(events.rows.some((row) => row.action === "confirmed"));
    assert.ok(events.rows.some((row) => row.action === "released"));
    await assert.rejects(env.db.query("UPDATE session_ticket_events SET actor_label='changed' WHERE session_id=$1", [sessionId]), /append-only/);
    await assert.rejects(env.db.query("UPDATE session_tickets SET serial='TKT-9999' WHERE ticket_id=$1", [pageTickets[0].ticketId]), /immutable/);
    await assert.rejects(env.db.query("UPDATE ticket_inventory_batches SET requested_count=201 WHERE session_id=$1", [sessionId]), /immutable/);
    const releasedAllocation = await env.db.query("SELECT allocation_id FROM ticket_reservation_items WHERE reservation_id=$1 LIMIT 1", [winner]);
    await assert.rejects(env.db.query("DELETE FROM ticket_reservation_items WHERE allocation_id=$1", [releasedAllocation.rows[0].allocation_id]), /cannot be deleted/);
    await assert.rejects(env.db.query("UPDATE ticket_reservation_items SET released_at=now() WHERE allocation_id=$1", [releasedAllocation.rows[0].allocation_id]), /one release marker/);

    const otherSession = await newNumberedSession(env.db, 1);
    assert.equal((await inventory.generateForSession({ sessionId: otherSession, requestedCount: 1, idempotencyKey: "inventory-generation-200-01" })).error, "IDEMPOTENCY_KEY_REUSED");
    await inventory.generateForSession({ sessionId: otherSession, requestedCount: 1, idempotencyKey: "inventory-other-game-01" });
    const otherReservation = await hold(env.db, otherSession, 1, "d");
    assert.equal((await inventory.allocateToReservation({ sessionId: otherSession, reservationId: otherReservation, ticketIds: [pageTickets[0].ticketId] })).error, "TICKET_NOT_FOUND", "ticket IDs cannot be substituted across games");
  } finally {
    await env.close();
  }
});

test("numbered booking tickets persist into the game and survive process recovery without reminting", { skip: !HAS_DB }, async () => {
  const env = await openDurableSchema({ prefix: "ticket_game_issue" });
  try {
    const { registry, controller } = env.newProcess();
    const created = await controller.createRoom({ name: "Inventory Host", socketId: "inventory-host", instanceId: "regular" });
    assert.equal(created.ok, true, JSON.stringify(created));
    const booking = createBookingService({ db: env.db });
    const inventory = createTicketInventoryService({ db: env.db });
    const made = await booking.createSession({
      instanceId: "regular", actor: "synthetic-test", title: "Issued inventory fixture",
      startsAt: future(60), bookingOpensAt: future(-2), bookingClosesAt: future(55), capacity: 200,
      roomCode: created.roomId, inventoryMode: "numbered",
    });
    assert.ok(made.session);
    const generated = await inventory.generateForSession({ sessionId: made.session.sessionId, requestedCount: 200, actor: {type:"host",label:"Synthetic Host"}, idempotencyKey: "issue-fixture-0001" });
    assert.equal(generated.status, "ready", JSON.stringify(generated));
    const opened = await booking.updateSession({ instanceId: "regular", sessionId: made.session.sessionId, actor: "synthetic-test", patch: { status: "open" } });
    assert.ok(opened.session, JSON.stringify(opened));
    const catalogPages = [];
    for (let page = 1; page <= 8; page++) catalogPages.push(await inventory.listPublicCatalog({ sessionId: made.session.sessionId, page, pageSize: 25 }));
    const catalog = catalogPages.flatMap((page) => page.tickets);
    assert.equal(catalogPages[0].total, 200);
    assert.equal(catalog.length, 200, "all persisted catalog entries are browseable through pages");
    assert.equal(catalog.at(-1).serial, "TKT-0200");
    const selected = [catalog.at(-1)];
    const reservation = await booking.reserve({ sessionId: made.session.sessionId, displayName: "Synthetic Player", ticketCount: 1, ticketIds: selected.map((ticket) => ticket.ticketId) });
    assert.equal(reservation.reservation?.status, "held", JSON.stringify({ reservation, selected }));
    const confirmed = await booking.lookupOrTransition({ reservationId: reservation.reservation.reservationId, bookingToken: reservation.reservation.bookingToken, action: "confirm" });
    assert.equal(confirmed.reservation.status, "confirmed");
    const updatedCatalog = await inventory.listPublicCatalog({ sessionId: made.session.sessionId, page: 8, pageSize: 25 });
    assert.equal(updatedCatalog.total, 199, "a confirmed ticket is removed from the public booking catalog");
    assert.equal(updatedCatalog.tickets.some((ticket) => ticket.ticketId === selected[0].ticketId), false);
    const joined = await controller.joinRoom({
      roomId: created.roomId, name: "Synthetic Player", socketId: "inventory-player",
      instanceSlug: "regular", reservationId: reservation.reservation.reservationId,
      bookingToken: reservation.reservation.bookingToken,
    });
    assert.equal(joined.ok, true, JSON.stringify(joined));
    assert.deepEqual(joined.snapshot.tickets.map((ticket) => ticket.inventoryTicketId), selected.map((ticket) => ticket.ticketId));
    assert.deepEqual(joined.snapshot.tickets.map((ticket) => ticket.grid), selected.map((ticket) => ticket.grid));
    const afterAssignment = await inventory.listPublicCatalog({ sessionId: made.session.sessionId, page: 8, pageSize: 25 });
    assert.equal(afterAssignment.total, 199, "assigned tickets remain private from the public catalog");
    assert.equal(afterAssignment.tickets.some((ticket) => ticket.ticketId === selected[0].ticketId), false);
    const adminInventory = await inventory.listAdminInventory({ instanceId: "regular", sessionId: made.session.sessionId, status: "assigned", search: "TKT-0200" });
    assert.equal(adminInventory.tickets[0].playerName, "Synthetic Player");
    const inventoryCounts = await env.db.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER(WHERE a.ticket_id IS NULL)::int AS available,
              count(*) FILTER(WHERE a.released_at IS NULL AND r.status='confirmed' AND r.player_id IS NULL)::int AS booked,
              count(*) FILTER(WHERE a.released_at IS NULL AND r.player_id IS NOT NULL)::int AS assigned
         FROM session_tickets st LEFT JOIN ticket_reservation_items a ON a.session_id=st.session_id AND a.ticket_id=st.ticket_id AND a.released_at IS NULL
         LEFT JOIN ticket_reservations r ON r.session_id=a.session_id AND r.reservation_id=a.reservation_id
        WHERE st.session_id=$1`, [made.session.sessionId]
    );
    assert.deepEqual(inventoryCounts.rows[0], { total: 200, available: 199, booked: 0, assigned: 1 });

    const room = registry.get(created.roomId);
    const started = await controller.start({ room, socketId: "inventory-host" });
    assert.equal(started.ok, true, JSON.stringify(started));
    const issued = await env.db.query(
      `SELECT t.player_id,t.ticket_no,t.grid,t.inventory_ticket_id,t.inventory_session_id,t.inventory_reservation_id,st.serial
         FROM tickets t JOIN session_tickets st ON st.session_id=t.inventory_session_id AND st.ticket_id=t.inventory_ticket_id
        WHERE t.room_code=$1 AND t.player_id=$2 ORDER BY t.ticket_no`, [created.roomId, joined.playerId]
    );
    assert.equal(issued.rows.length, 1);
    assert.deepEqual(issued.rows.map((ticket) => ticket.inventory_ticket_id), selected.map((ticket) => ticket.ticketId));
    assert.deepEqual(issued.rows.map((ticket) => ticket.grid), selected.map((ticket) => ticket.grid));
    const eventCount = await env.db.query("SELECT count(*)::int AS count FROM session_ticket_events WHERE session_id=$1 AND action='issued'", [made.session.sessionId]);
    assert.equal(eventCount.rows[0].count, 1);
    const ended = await controller.transition({ room, socketId: "inventory-host", action: "end" });
    assert.equal(ended.ok, true, JSON.stringify(ended));

    const restarted = env.newProcess();
    const recovered = await recoverRooms({ store: env.store, registry: restarted.registry, log: () => {} });
    assert.equal(recovered.recovered.length, 1, JSON.stringify(recovered));
    const recoveredPlayer = restarted.registry.get(created.roomId).players.get(joined.playerId);
    assert.deepEqual(recoveredPlayer.tickets.map((ticket) => ticket.inventoryTicketId), selected.map((ticket) => ticket.ticketId));
    assert.deepEqual(recoveredPlayer.tickets.map((ticket) => ticket.serial), selected.map((ticket) => ticket.serial));
    assert.deepEqual(recoveredPlayer.tickets.map((ticket) => ticket.grid), selected.map((ticket) => ticket.grid));
    assert.equal(restarted.registry.get(created.roomId).state, "COMPLETED");
  } finally {
    await env.close();
  }
});

test("public ticket catalog hides inventory when its attached room is no longer waiting", { skip: !HAS_DB }, async () => {
  const env = await openDurableSchema({ prefix: "ticket_inventory_room" });
  try {
    const sessionId = await newNumberedSession(env.db, 2);
    const inventory = createTicketInventoryService({ db: env.db });
    await inventory.generateForSession({ sessionId, requestedCount: 2, idempotencyKey: "inventory-room-check-01" });
    await env.db.query("INSERT INTO rooms(room_code,game_instance_id,status,game_number) VALUES('ROOMTIK1','regular','WAITING',0)");
    await env.db.query("UPDATE game_sessions SET room_code='ROOMTIK1',status='open' WHERE session_id=$1", [sessionId]);
    assert.equal((await inventory.listPublicCatalog({ sessionId })).total, 2);
    await env.db.query("UPDATE rooms SET status='RUNNING',game_number=1 WHERE room_code='ROOMTIK1'");
    const hidden = await inventory.listPublicCatalog({ sessionId });
    assert.equal(hidden.total, 0, "catalog follows the public booking room eligibility rules");
    assert.equal(hidden.inventoryTotal, 0, "closed room inventory count is not exposed publicly");
  } finally {
    await env.close();
  }
});

test("durable generation persists complete inventory sizes through the 10,000-ticket limit", { skip: !HAS_DB }, async () => {
  const env = await openDurableSchema({ prefix: "ticket_inventory_scale" });
  try {
    const inventory = createTicketInventoryService({ db: env.db });
    for (const count of [1, 10, 100, 200, 500, 10_000]) {
      const sessionId = await newNumberedSession(env.db, count);
      const result = await inventory.generateForSession({
        sessionId,
        requestedCount: count,
        idempotencyKey: `inventory-scale-${String(count).padStart(5, "0")}`,
        actor: { type: "admin", label: "Synthetic Admin" },
      });
      assert.equal(result.generatedCount, count);
      const persisted = await env.db.query(
        `SELECT count(*)::int AS total,count(DISTINCT ticket_id)::int AS ids,
            count(DISTINCT serial)::int AS serials,count(DISTINCT fingerprint)::int AS fingerprints
           FROM session_tickets WHERE session_id=$1`, [sessionId]
      );
      assert.deepEqual(persisted.rows[0], { total: count, ids: count, serials: count, fingerprints: count });
    }
  } finally {
    await env.close();
  }
});

test("inventory generation failure rolls back the batch and never marks a partial catalog ready", { skip: !HAS_DB }, async () => {
  const env = await openDurableSchema({ prefix: "ticket_inventory_rollback" });
  try {
    const sessionId = await newNumberedSession(env.db, 10);
    const inventory = createTicketInventoryService({ db: env.db, generate: () => [] });
    await assert.rejects(inventory.generateForSession({ sessionId, requestedCount: 10, idempotencyKey: "inventory-generation-fail", actor: { type: "admin", label: "Synthetic Admin" } }), /complete requested inventory/);
    const session = await env.db.query("SELECT inventory_state FROM game_sessions WHERE session_id=$1", [sessionId]);
    assert.equal(session.rows[0].inventory_state, "not_generated");
    assert.equal(Number((await env.db.query("SELECT count(*)::int AS n FROM ticket_inventory_batches WHERE session_id=$1", [sessionId])).rows[0].n), 0);
    assert.equal(Number((await env.db.query("SELECT count(*)::int AS n FROM session_tickets WHERE session_id=$1", [sessionId])).rows[0].n), 0);
  } finally {
    await env.close();
  }
});

test("admin and player booking APIs generate, page, reserve, retry, confirm, and release specific tickets", { skip: !HAS_DB }, async () => {
  const env = await openDurableSchema({ prefix: "ticket_inventory_api" });
  const app = express();
  app.use("/api/public", createPublicBookingRouter({ db: env.db }));
  app.use("/api/admin", createAdminBookingRouter({
    db: env.db,
    ownerSessions: { async verify() { return { ok: true, ownerId: "inventory-owner", sessionId: "inventory-owner-session" }; } },
    ownerStore: { async getById() { return { ownerId: "inventory-owner", username: "inventory-owner", role: "super_admin" }; } },
    throttle: { adminMutation: { async check() { return { allowed: true }; }, async recordFailure() { return {}; } } },
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const csrf = "e".repeat(48);
  const ownerHeaders = { cookie: `tambola_owner=${"a".repeat(64)}; tambola_csrf=${csrf}`, "x-csrf-token": csrf, "content-type": "application/json" };
  async function request(path, { method = "GET", body, headers = {} } = {}) {
    const response = await fetch(`${base}${path}`, { method, headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  }
  try {
    const create = await request("/api/admin/instances/regular/sessions", {
      method: "POST", headers: ownerHeaders,
      body: { title: "Numbered inventory API", startsAt: future(60), bookingOpensAt: future(-2), bookingClosesAt: future(55), capacity: 4, inventoryMode: "numbered" },
    });
    assert.equal(create.status, 201);
    const sessionId = create.body.session.sessionId;
    const earlyOpen = await request(`/api/admin/instances/regular/sessions/${sessionId}`, { method: "PATCH", headers: ownerHeaders, body: { status: "open" } });
    assert.equal(earlyOpen.status, 409);
    assert.equal(earlyOpen.body.code, "INVENTORY_NOT_READY");

    const generate = await request(`/api/admin/instances/regular/sessions/${sessionId}/inventory`, {
      method: "POST", headers: ownerHeaders, body: { requestedCount: 4, idempotencyKey: "numbered-api-generation-01" },
    });
    assert.equal(generate.status, 201);
    assert.equal(generate.body.inventory.generatedCount, 4);
    const retryGenerate = await request(`/api/admin/instances/regular/sessions/${sessionId}/inventory`, {
      method: "POST", headers: ownerHeaders, body: { requestedCount: 4, idempotencyKey: "numbered-api-generation-01" },
    });
    assert.equal(retryGenerate.status, 200);
    assert.equal(retryGenerate.body.inventory.idempotent, true);

    const open = await request(`/api/admin/instances/regular/sessions/${sessionId}`, { method: "PATCH", headers: ownerHeaders, body: { status: "open" } });
    assert.equal(open.status, 200);
    const publicPage = await request(`/api/public/sessions/${sessionId}/tickets?page=1&pageSize=2`);
    assert.equal(publicPage.status, 200);
    assert.equal(publicPage.body.catalog.total, 4);
    assert.equal(publicPage.body.catalog.tickets.length, 2);
    assert.equal("reservationId" in publicPage.body.catalog.tickets[0], false, "public catalog never exposes a reservation reference");
    const adminPage = await request(`/api/admin/instances/regular/sessions/${sessionId}/tickets?page=1&pageSize=4`, { headers: { cookie: ownerHeaders.cookie } });
    assert.equal(adminPage.status, 200);
    const first = publicPage.body.catalog.tickets[0];
    const token = "f".repeat(64);
    const reserveBody = { displayName: "Player One", ticketCount: 1, ticketIds: [first.ticketId], bookingToken: token };
    const createdHold = await request(`/api/public/sessions/${sessionId}/reservations`, { method: "POST", body: reserveBody });
    assert.equal(createdHold.status, 201);
    assert.equal(createdHold.body.reservation.tickets[0].serial, first.serial);
    assert.deepEqual(createdHold.body.reservation.tickets[0].grid, first.grid);
    const retryHold = await request(`/api/public/sessions/${sessionId}/reservations`, { method: "POST", body: reserveBody });
    assert.equal(retryHold.status, 200);
    assert.equal(retryHold.body.idempotent, true);
    assert.equal(retryHold.body.reservation.reservationId, createdHold.body.reservation.reservationId);
    const changedSelection = await request(`/api/public/sessions/${sessionId}/reservations`, { method: "POST", body: { ...reserveBody, ticketIds: [publicPage.body.catalog.tickets[1].ticketId] } });
    assert.equal(changedSelection.status, 409);
    assert.equal(changedSelection.body.code, "IDEMPOTENCY_KEY_REUSED");
    const raced = await Promise.all([
      request(`/api/public/sessions/${sessionId}/reservations`, { method: "POST", body: { displayName: "Racer One", ticketCount: 1, ticketIds: [publicPage.body.catalog.tickets[1].ticketId], bookingToken: "1".repeat(64) } }),
      request(`/api/public/sessions/${sessionId}/reservations`, { method: "POST", body: { displayName: "Racer Two", ticketCount: 1, ticketIds: [publicPage.body.catalog.tickets[1].ticketId], bookingToken: "2".repeat(64) } }),
    ]);
    assert.deepEqual(raced.map((result) => result.status).sort(), [201, 409], "concurrent player API calls produce exactly one reservation for a ticket");
    assert.equal(raced.find((result) => result.status === 409).body.code, "TICKET_UNAVAILABLE");
    const secondPlayer = await request(`/api/public/sessions/${sessionId}/reservations`, { method: "POST", body: { ...reserveBody, displayName: "Player Two", ticketIds: [first.ticketId], bookingToken: "0".repeat(64) } });
    assert.equal(secondPlayer.status, 409);
    assert.equal(secondPlayer.body.code, "TICKET_UNAVAILABLE");
    assert.equal(Number((await env.db.query("SELECT count(*)::int AS n FROM ticket_reservations WHERE session_id=$1", [sessionId])).rows[0].n), 2, "failed concurrent and unavailable attempts leave no orphan holds");

    const reservationId = createdHold.body.reservation.reservationId;
    const confirmed = await request(`/api/public/reservations/${reservationId}/confirm`, { method: "POST", body: { bookingToken: token } });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.reservation.tickets[0].ticketId, first.ticketId);
    const bookedInventory = await request(`/api/admin/instances/regular/sessions/${sessionId}/tickets?status=booked&pageSize=4`, { headers: { cookie: ownerHeaders.cookie } });
    assert.equal(bookedInventory.body.inventory.total, 1);
    assert.equal(bookedInventory.body.inventory.tickets[0].playerName, "Player One");

    const cancelled = await request(`/api/public/reservations/${reservationId}/cancel`, { method: "POST", body: { bookingToken: token } });
    assert.equal(cancelled.status, 200);
    const available = await request(`/api/public/sessions/${sessionId}/tickets?status=available&pageSize=4`);
    assert.equal(available.body.catalog.total, 3);
    const releaseEvents = await env.db.query("SELECT count(*)::int AS n FROM session_ticket_events WHERE session_id=$1 AND action='released'", [sessionId]);
    assert.equal(releaseEvents.rows[0].n, 1, "cancel trigger releases the inventory row and records its event in the same transaction");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await env.close();
  }
});
