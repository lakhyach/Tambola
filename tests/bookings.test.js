import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import http from "node:http";
import pg from "pg";
import { HAS_DB, openDurableSchema } from "./pattern-harness.js";
import { createBookingService } from "../server/bookings/service.js";
import { createAdminBookingRouter, createPublicBookingRouter } from "../server/bookings/routes.js";
import { connectionToDatabase } from "../scripts/pg-cli.js";
import { createBookingRealtime } from "../server/bookings/realtime.js";

test("instance-scoped scheduled booking holds are private, expiring and capacity safe", { skip: !HAS_DB }, async () => {
  const env = await openDurableSchema({ prefix: "booking" });
  const service = createBookingService({ db: env.db });
  const token = "a".repeat(64);
  const app = express();
  const bookingRealtime = createBookingRealtime();
  const emitted = [];
  const io = { to(room) { return { emit(event, payload) { emitted.push({ room, event, payload }); } }; } };
  app.use("/api/public", createPublicBookingRouter({ db: env.db, io, bookingRealtime }));
  app.use("/api/admin", createAdminBookingRouter({
    db: env.db,
    ownerSessions: { async verify() { return { ok: true, ownerId: "owner-test", sessionId: "session-test" }; } },
    ownerStore: { async getById() { return { ownerId: "owner-test", username: "owner", role: "super_admin" }; } },
    throttle: { adminMutation: { async check() { return { allowed: true }; }, async recordFailure() { return {}; } } },
    io, bookingRealtime,
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const adminHeaders = { cookie: `tambola_owner=${token}; tambola_csrf=${"b".repeat(48)}`, "x-csrf-token": "b".repeat(48), "content-type": "application/json" };
  const future = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();
  const configuredPatterns = [{ id: "earlyFive", points: 77 }, { id: "fullHouse", points: 300 }];
  const createPayload = (capacity = 5) => ({ title: "Community game", startsAt: future(40), bookingOpensAt: future(-2), bookingClosesAt: future(35), capacity, winningPatterns: configuredPatterns });
  try {
    assert.equal((await fetch(`${base}/api/admin/instances/regular/sessions`)).status, 401);
    assert.equal((await fetch(`${base}/api/admin/instances/regular/sessions`, {
      method: "POST", headers: { cookie: `tambola_owner=${token}`, "content-type": "application/json" }, body: JSON.stringify(createPayload()),
    })).status, 403);
    const firstCreatePayload = { ...createPayload(), idempotencyKey: "9".repeat(64) };
    const createResponse = await fetch(`${base}/api/admin/instances/regular/sessions`, { method: "POST", headers: adminHeaders, body: JSON.stringify(firstCreatePayload) });
    assert.equal(createResponse.status, 201);
    const created = (await createResponse.json()).session;
    const repeatedCreateResponse = await fetch(`${base}/api/admin/instances/regular/sessions`, { method: "POST", headers: adminHeaders, body: JSON.stringify(firstCreatePayload) });
    assert.equal(repeatedCreateResponse.status, 200, "a retry after a lost create response returns the original session");
    const repeatedCreate = await repeatedCreateResponse.json();
    assert.equal(repeatedCreate.idempotent, true);
    assert.equal(repeatedCreate.session.sessionId, created.sessionId);
    const changedCreateResponse = await fetch(`${base}/api/admin/instances/regular/sessions`, {
      method: "POST", headers: adminHeaders,
      body: JSON.stringify({ ...firstCreatePayload, title: "A different game" }),
    });
    assert.equal(changedCreateResponse.status, 409, "a creation key cannot be reused for different session details");
    assert.equal(created.status, "draft");
    assert.equal(created.capacity, 5);
    assert.equal(created.available, 5);
    assert.equal(created.heldTicketCount, 0);
    assert.equal(created.confirmedTicketCount, 0);
    assert.equal(created.reservationCount, 0);
    assert.deepEqual(created.winningPatterns.map(({ id, points }) => ({ id, points })), configuredPatterns);
    const persistedRules = await env.db.query("SELECT winning_patterns FROM game_sessions WHERE session_id=$1", [created.sessionId]);
    assert.deepEqual(persistedRules.rows[0].winning_patterns, { earlyFive: 77, fullHouse: 300 });

    const invalidRules = await service.updateSession({ instanceId: "regular", sessionId: created.sessionId, actor: "owner", patch: { winningPatterns: [{ id: "unknown", points: 5 }] } });
    assert.equal(invalidRules.error, "INVALID_WINNING_PATTERNS");

    // AdminSessions sends the event timezone whenever an operator edits a
    // session. Keep that client/server contract explicit in the route test.
    const editResponse = await fetch(`${base}/api/admin/instances/regular/sessions/${created.sessionId}`, {
      method: "PATCH", headers: adminHeaders, body: JSON.stringify({
        title: created.title,
        startsAt: created.startsAt,
        bookingOpensAt: created.bookingOpensAt,
        bookingClosesAt: created.bookingClosesAt,
        capacity: created.capacity,
        timeZone: "Asia/Kolkata",
        roomCode: null,
      }),
    });
    assert.equal(editResponse.status, 200);
    assert.equal((await editResponse.json()).session.timeZone, "Asia/Kolkata");

    const unpublished = await fetch(`${base}/api/public/instances/regular/sessions`);
    assert.deepEqual((await unpublished.json()).sessions, []);
    const openResponse = await fetch(`${base}/api/admin/instances/regular/sessions/${created.sessionId}`, {
      method: "PATCH", headers: adminHeaders, body: JSON.stringify({ status: "open" }),
    });
    assert.equal(openResponse.status, 200);
    const openSession = (await openResponse.json()).session;
    assert.equal(openSession.status, "open");
    assert.equal((await (await fetch(`${base}/api/public/instances/bumper/sessions`)).json()).sessions.length, 0);
    const publicList = await (await fetch(`${base}/api/public/instances/regular/sessions`)).json();
    assert.equal(publicList.sessions.length, 1);
    assert.equal(publicList.sessions[0].sessionId, created.sessionId);
    assert.equal((await (await fetch(`${base}/api/public/sessions/${created.sessionId}`)).json()).session.available, 5);

    const ticketResponse = await fetch(`${base}/api/admin/booking-events/ticket`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ instanceId: "regular" }) });
    assert.equal(ticketResponse.status, 200);
    const subTicket = (await ticketResponse.json()).ticket;
    assert.deepEqual(bookingRealtime.consume(subTicket), { instanceId: "regular", ownerSessionId: "session-test" });
    assert.equal(bookingRealtime.consume(subTicket), null, "a booking subscription ticket is single use");

    const scheduledOnly = await service.createSession({ instanceId: "regular", actor: "owner", title: "Scheduled listing check", startsAt: future(40), bookingOpensAt: future(10), bookingClosesAt: future(35), capacity: 4 });
    await service.updateSession({ instanceId: "regular", sessionId: scheduledOnly.session.sessionId, actor: "owner", patch: { status: "open" } });
    const scheduledPublic = await service.getPublicSession(scheduledOnly.session.sessionId);
    assert.equal(scheduledPublic.bookingStatus, "not_open", "published future sessions are listed before booking opens");
    assert.equal((await service.listPublicSessions("regular")).some((session) => session.sessionId === scheduledOnly.session.sessionId), true);
    assert.equal((await service.reserve({ sessionId: scheduledOnly.session.sessionId, displayName: "Early Guest", ticketCount: 1 })).error, "SESSION_UNAVAILABLE", "listing a scheduled session does not open booking early");

    const bookingClosed = await service.createSession({ instanceId: "regular", actor: "owner", title: "Closed booking listing check", startsAt: future(40), bookingOpensAt: future(-10), bookingClosesAt: future(5), capacity: 4 });
    const publishedBeforeClose = await service.updateSession({ instanceId: "regular", sessionId: bookingClosed.session.sessionId, actor: "owner", patch: { status: "open" } });
    assert.equal(publishedBeforeClose.session.status, "open", "publish the session while its booking window is still valid");
    await env.db.query("UPDATE game_sessions SET booking_closes_at=clock_timestamp()-interval '1 second' WHERE session_id=$1", [bookingClosed.session.sessionId]);
    const closedPublicSession = await service.getPublicSession(bookingClosed.session.sessionId);
    assert.equal(closedPublicSession.bookingStatus, "closed", "future games remain visible after their booking window closes");
    assert.equal((await service.reserve({ sessionId: bookingClosed.session.sessionId, displayName: "Late Guest", ticketCount: 1 })).error, "BOOKING_CLOSED", "a request after the closed window receives the clear booking-closed result");

    const alreadyClosed = await service.createSession({ instanceId: "regular", actor: "owner", title: "Cannot publish after booking closes", startsAt: future(40), bookingOpensAt: future(-10), bookingClosesAt: future(-1), capacity: 4 });
    const publishedAfterClose = await service.updateSession({ instanceId: "regular", sessionId: alreadyClosed.session.sessionId, actor: "owner", patch: { status: "open" } });
    assert.equal(publishedAfterClose.session.status, "open", "future sessions can remain visible after booking closes");
    assert.equal((await service.getPublicSession(alreadyClosed.session.sessionId)).bookingStatus, "closed");
    assert.equal((await service.reserve({ sessionId: alreadyClosed.session.sessionId, displayName: "Late Guest", ticketCount: 1 })).error, "BOOKING_CLOSED");

    const idempotencyToken = "c".repeat(64);
    const holdResponse = await fetch(`${base}/api/public/sessions/${created.sessionId}/reservations`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: "  Guest   One ", ticketCount: 2, bookingToken: idempotencyToken }),
    });
    assert.equal(holdResponse.status, 201);
    const held = (await holdResponse.json()).reservation;
    assert.deepEqual(emitted.at(-1), { room: "admin-bookings:regular", event: "admin:booking-changed", payload: { instanceId: "regular", sessionId: created.sessionId } });
    assert.equal(held.status, "held");
    assert.equal(held.ticketCount, 2);
    assert.match(held.bookingToken, /^[a-f0-9]{64}$/);
    const stored = await env.db.query("SELECT display_name,booking_token_hash,status FROM ticket_reservations WHERE reservation_id=$1", [held.reservationId]);
    assert.equal(stored.rows[0].display_name, "Guest One");
    assert.notEqual(stored.rows[0].booking_token_hash, held.bookingToken);
    assert.equal(stored.rows[0].status, "held");
    const retryResponse = await fetch(`${base}/api/public/sessions/${created.sessionId}/reservations`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: "Guest One", ticketCount: 2, bookingToken: idempotencyToken }),
    });
    assert.equal(retryResponse.status, 200);
    const retry = await retryResponse.json();
    assert.equal(retry.idempotent, true);
    assert.equal(retry.reservation.reservationId, held.reservationId);
    assert.equal((await env.db.query("SELECT count(*)::int AS n FROM ticket_reservations WHERE session_id=$1", [created.sessionId])).rows[0].n, 1);

    const badLookup = await fetch(`${base}/api/public/reservations/${held.reservationId}/lookup`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingToken: "0".repeat(64) }),
    });
    assert.equal(badLookup.status, 404);
    const confirmResponse = await fetch(`${base}/api/public/reservations/${held.reservationId}/confirm`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingToken: held.bookingToken }),
    });
    assert.equal(confirmResponse.status, 200);
    assert.equal((await confirmResponse.json()).reservation.status, "confirmed");
    assert.equal(Number((await env.db.query("SELECT count(*)::int AS n FROM auth_throttle WHERE scope='booking-public'")).rows[0].n), 0, "valid booking actions do not accumulate authentication failure strikes");
    const ownerSessions = (await (await fetch(`${base}/api/admin/instances/regular/sessions`, { headers: { cookie: `tambola_owner=${token}` } })).json()).sessions;
    assert.equal(ownerSessions.find((session) => session.sessionId === created.sessionId)?.confirmedTicketCount, 2);
    const cancelResponse = await fetch(`${base}/api/public/reservations/${held.reservationId}/cancel`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingToken: held.bookingToken }),
    });
    assert.equal(cancelResponse.status, 200);
    assert.equal((await cancelResponse.json()).reservation.status, "cancelled");
    const capacityAfterCancel = await fetch(`${base}/api/public/sessions/${created.sessionId}`);
    assert.equal(capacityAfterCancel.status, 200);
    assert.equal((await capacityAfterCancel.json()).session.available, 5, "public session availability reflects the released reservation immediately");
    const ownerReservations = await fetch(`${base}/api/admin/instances/regular/reservations?status=cancelled&search=Guest` , { headers: { cookie: `tambola_owner=${token}` } });
    assert.equal(ownerReservations.status, 200);
    const ownerRows = (await ownerReservations.json()).reservations;
    assert.equal(ownerRows.length, 1);
    const ownerDetail = await fetch(`${base}/api/admin/instances/regular/reservations/${held.reservationId}`, { headers: { cookie: `tambola_owner=${token}` } });
    assert.equal((await ownerDetail.json()).reservation.history.some((event) => event.action === "hold.cancel"), true);

    const operatorCancelHold = await service.reserve({ sessionId: created.sessionId, displayName: "Operator Cancel Guest", ticketCount: 1 });
    await service.lookupOrTransition({ reservationId: operatorCancelHold.reservation.reservationId, bookingToken: operatorCancelHold.reservation.bookingToken, action: "confirm" });
    const eventsBeforeOperatorCancel = emitted.length;
    const operatorCancelResponse = await fetch(`${base}/api/admin/instances/regular/reservations/${operatorCancelHold.reservation.reservationId}/cancel`, {
      method: "POST", headers: adminHeaders, body: JSON.stringify({}),
    });
    assert.equal(operatorCancelResponse.status, 200);
    assert.equal((await operatorCancelResponse.json()).reservation.status, "cancelled");
    assert.deepEqual(emitted.slice(eventsBeforeOperatorCancel).at(-1), {
      room: "admin-bookings:regular", event: "admin:booking-changed",
      payload: { instanceId: "regular", sessionId: created.sessionId },
    }, "an operator cancellation commits and publishes the live inventory refresh");

    const hold = await service.reserve({ sessionId: created.sessionId, displayName: "Expired", ticketCount: 1 });
    await env.db.query("UPDATE ticket_reservations SET expires_at=now()-interval '1 second' WHERE reservation_id=$1", [hold.reservation.reservationId]);
    const expiredLookup = await fetch(`${base}/api/public/reservations/${hold.reservation.reservationId}/lookup`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingToken: hold.reservation.bookingToken }),
    });
    assert.equal(expiredLookup.status, 200);
    assert.equal((await expiredLookup.json()).reservation.status, "expired", "the public lookup route exposes an expired status to the credential holder");
    assert.equal((await service.lookupOrTransition({ reservationId: hold.reservation.reservationId, bookingToken: hold.reservation.bookingToken, action: "lookup" })).reservation.status, "expired");

    const raceCreate = await service.createSession({ instanceId: "regular", actor: "owner", ...createPayload(3) });
    const raceOpen = await service.updateSession({ instanceId: "regular", sessionId: raceCreate.session.sessionId, actor: "owner", patch: { status: "open" } });
    assert.equal(raceOpen.session.status, "open");
    const race = await Promise.all(Array.from({ length: 10 }, (_, i) => service.reserve({ sessionId: raceCreate.session.sessionId, displayName: `Racer ${i}`, ticketCount: 1 })));
    assert.equal(race.filter((r) => r.reservation).length, 3);
    assert.equal(race.filter((r) => r.error === "CAPACITY_FULL").length, 7);
    assert.equal((await service.getPublicSession(raceCreate.session.sessionId)).available, 0);
    const soldOutDetail = await fetch(`${base}/api/public/sessions/${raceCreate.session.sessionId}`);
    assert.equal(soldOutDetail.status, 200);
    assert.equal((await soldOutDetail.json()).session.available, 0, "public detail keeps a sold-out session visible with zero availability");
    const soldOutDirectory = await fetch(`${base}/api/public/instances/regular/sessions`);
    const soldOutSession = (await soldOutDirectory.json()).sessions.find((session) => session.sessionId === raceCreate.session.sessionId);
    assert.equal(soldOutSession?.available, 0, "public directory can render the sold-out state without exposing a private room code");

    const retryCreate = await service.createSession({ instanceId: "regular", actor: "owner", ...createPayload(3) });
    await service.updateSession({ instanceId: "regular", sessionId: retryCreate.session.sessionId, actor: "owner", patch: { status: "open" } });
    const repeated = await Promise.all(Array.from({ length: 8 }, () => service.reserve({ sessionId: retryCreate.session.sessionId, displayName: "Same Request", ticketCount: 1, bookingToken: "d".repeat(64) })));
    assert.equal(repeated.filter((result) => !result.idempotent && result.reservation).length, 1);
    assert.equal(repeated.filter((result) => result.idempotent).length, 7);
    assert.equal(new Set(repeated.map((result) => result.reservation.reservationId)).size, 1);
    assert.equal((await env.db.query("SELECT count(*)::int AS n FROM ticket_reservations WHERE session_id=$1", [retryCreate.session.sessionId])).rows[0].n, 1);

    await env.db.query("UPDATE game_instances SET public_visible=false WHERE instance_id='regular'");
    assert.deepEqual(await service.listPublicSessions("regular"), []);
    await env.db.query("UPDATE game_instances SET public_visible=true,status='paused' WHERE instance_id='regular'");
    assert.deepEqual(await service.listPublicSessions("regular"), []);
    await env.db.query("UPDATE game_instances SET status='active' WHERE instance_id='regular'");
    const archiveState = await service.updateSession({ instanceId: "regular", sessionId: raceCreate.session.sessionId, actor: "owner", patch: { status: "cancelled" } });
    assert.equal(archiveState.session.status, "cancelled");
    const cancelledSessionDetail = await fetch(`${base}/api/public/sessions/${raceCreate.session.sessionId}`);
    assert.equal(cancelledSessionDetail.status, 404, "a cancelled session is unavailable to the public booking detail route");
    await service.updateSession({ instanceId: "regular", sessionId: retryCreate.session.sessionId, actor: "owner", patch: { status: "cancelled" } });
    const staleSession = await service.createSession({ instanceId: "regular", actor: "owner", ...createPayload(3) });
    await service.updateSession({ instanceId: "regular", sessionId: staleSession.session.sessionId, actor: "owner", patch: { status: "open" } });
    const staleHold = await service.reserve({ sessionId: staleSession.session.sessionId, displayName: "Elapsed Holder", ticketCount: 1 });
    await env.db.query("UPDATE ticket_reservations SET expires_at=now()-interval '1 second' WHERE reservation_id=$1", [staleHold.reservation.reservationId]);
    const staleCancelled = await service.updateSession({ instanceId: "regular", sessionId: staleSession.session.sessionId, actor: "owner", patch: { status: "cancelled" } });
    assert.equal(staleCancelled.session.status, "cancelled");
    assert.equal((await env.db.query("SELECT status FROM ticket_reservations WHERE reservation_id=$1", [staleHold.reservation.reservationId])).rows[0].status, "expired", "session closure preserves an elapsed hold as expired");
    const staleAudit = await env.db.query("SELECT action FROM ticket_reservation_audit WHERE reservation_id=$1 ORDER BY event_id", [staleHold.reservation.reservationId]);
    assert.deepEqual(staleAudit.rows.map((row) => row.action), ["hold.create", "hold.expire"], "expired holds do not receive a misleading hold.cancel event");
    const stillPublic = (await service.listPublicSessions("regular")).map((session) => session.sessionId);
    assert.ok(stillPublic.includes(created.sessionId), "the active created session remains public");
    for (const hiddenId of [raceCreate.session.sessionId, retryCreate.session.sessionId, staleSession.session.sessionId]) {
      assert.equal(stillPublic.includes(hiddenId), false, "cancelled sessions are removed from public listings");
    }
    await env.db.query("UPDATE game_instances SET status='archived',public_visible=false WHERE instance_id='regular'");
    assert.deepEqual(await service.listPublicSessions("regular"), []);
    const audit = await env.db.query("SELECT action FROM ticket_reservation_audit WHERE session_id=$1 ORDER BY event_id", [created.sessionId]);
    assert.ok(audit.rows.some((row) => row.action === "hold.create"));
    assert.ok(audit.rows.some((row) => row.action === "hold.confirm"));
    assert.ok(audit.rows.some((row) => row.action === "hold.cancel"));
    assert.ok(audit.rows.some((row) => row.action === "hold.expire"));
    await assert.rejects(() => env.db.query("DELETE FROM ticket_reservation_audit WHERE session_id=$1", [created.sessionId]));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await env.close();
  }
});

test("confirmed reservations bind once to the correct waiting room and lock its ticket count", { skip: !HAS_DB }, async () => {
  const env = await openDurableSchema({ prefix: "booking_join" });
  const service = createBookingService({ db: env.db });
  const { controller, registry } = env.newProcess({ autoCall: false });
  const future = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();
  try {
    const created = await controller.createRoom({ name: "Room Host", socketId: "booking-host", instanceId: "regular" });
    assert.equal(created.ok, true);
    const sessionResult = await service.createSession({
      instanceId: "regular", actor: "owner", title: "Reserved game", startsAt: future(40),
      bookingOpensAt: future(-2), bookingClosesAt: future(35), capacity: 10,
    });
    assert.equal(sessionResult.session.status, "draft");
    assert.equal(sessionResult.session.ticketLimit, 10);
    assert.equal((await service.updateSession({ instanceId: "regular", sessionId: sessionResult.session.sessionId, actor: "owner", patch: { roomCode: created.roomId, status: "open" } })).session.roomCode, created.roomId);
    assert.equal((await service.getPublicSession(sessionResult.session.sessionId)).ticketLimit, 10);
    assert.equal((await service.reserve({ sessionId: sessionResult.session.sessionId, displayName: "Above capacity", ticketCount: 11 })).error, "TICKET_LIMIT");
    const largeSession = await service.createSession({ instanceId: "regular", actor: "owner", title: "Large reservation", startsAt: future(55), bookingOpensAt: future(-2), bookingClosesAt: future(50), capacity: 200 });
    await service.updateSession({ instanceId: "regular", sessionId: largeSession.session.sessionId, actor: "owner", patch: { status: "open" } });
    const largeHold = await service.reserve({ sessionId: largeSession.session.sessionId, displayName: "Large Booker", ticketCount: 150 });
    assert.equal(largeHold.reservation.ticketCount, 150, "a single booking can exceed the former 12-ticket schema ceiling within session capacity");
    const largeConfirmed = await service.lookupOrTransition({ reservationId: largeHold.reservation.reservationId, bookingToken: largeHold.reservation.bookingToken, action: "confirm" });
    assert.equal(largeConfirmed.reservation.ticketCount, 150);
    const deferredRoom = await service.createSession({ instanceId: "regular", actor: "owner", title: "Deferred room selection", startsAt: future(60), bookingOpensAt: future(-2), bookingClosesAt: future(55), capacity: 8 });
    await service.updateSession({ instanceId: "regular", sessionId: deferredRoom.session.sessionId, actor: "owner", patch: { status: "open" } });
    const tooManyForRoom = await service.reserve({ sessionId: deferredRoom.session.sessionId, displayName: "Five Tickets", ticketCount: 5 });
    await service.lookupOrTransition({ reservationId: tooManyForRoom.reservation.reservationId, bookingToken: tooManyForRoom.reservation.bookingToken, action: "confirm" });
    const roomForDeferred = await controller.createRoom({ name: "Deferred Room Host", socketId: "deferred-room-host", instanceId: "regular" });
    const attached = await service.updateSession({ instanceId: "regular", sessionId: deferredRoom.session.sessionId, actor: "owner", patch: { roomCode: roomForDeferred.roomId } });
    assert.equal(attached.session.roomCode, roomForDeferred.roomId, "more than four tickets can be attached without a legacy room cap");
    const publicSession = await service.getPublicSession(sessionResult.session.sessionId);
    assert.equal(publicSession.roomCode, undefined, "public availability never reveals the attached private room code");
    assert.equal((await service.listPublicSessions("regular"))[0].roomCode, undefined);
    const reserved = await service.reserve({ sessionId: sessionResult.session.sessionId, displayName: "Reserved Guest", ticketCount: 2 });
    assert.equal(reserved.reservation.status, "held");
    const confirmed = await service.lookupOrTransition({ reservationId: reserved.reservation.reservationId, bookingToken: reserved.reservation.bookingToken, action: "confirm" });
    assert.equal(confirmed.reservation.status, "confirmed");
    assert.equal(confirmed.reservation.session.roomCode, created.roomId, "the owner-assigned room is disclosed after the booking credential is proved");
    assert.equal((await service.lookupOrTransition({ reservationId: reserved.reservation.reservationId, bookingToken: "0".repeat(64), action: "lookup" })).error, "RESERVATION_NOT_FOUND");

    const withoutBooking = await controller.joinRoom({ roomId: created.roomId, name: "Guest Person", socketId: "guest-no-booking", instanceSlug: "regular" });
    assert.equal(withoutBooking.code, "BOOKING_REQUIRED");
    const joined = await controller.joinRoom({ roomId: created.roomId, name: "ignored client name", socketId: "booked-guest", instanceSlug: "regular", reservationId: reserved.reservation.reservationId, bookingToken: reserved.reservation.bookingToken });
    assert.equal(joined.ok, true, JSON.stringify(joined));
    assert.equal(joined.name, "Reserved Guest");
    assert.equal(joined.snapshot.ticketCount, 2);
    assert.equal(joined.snapshot.tickets.length, 2);

    const member = await env.db.query("SELECT ticket_count,booking_reservation_id FROM room_members WHERE room_code=$1 AND player_id=$2", [created.roomId, joined.playerId]);
    assert.equal(member.rows[0].ticket_count, 2);
    assert.equal(member.rows[0].booking_reservation_id, reserved.reservation.reservationId);
    const storedReservation = await env.db.query("SELECT player_id,room_code,status FROM ticket_reservations WHERE reservation_id=$1", [reserved.reservation.reservationId]);
    assert.equal(storedReservation.rows[0].player_id, joined.playerId);
    assert.equal(storedReservation.rows[0].room_code, created.roomId);

    const replay = await controller.joinRoom({ roomId: created.roomId, name: "Reserved Guest", socketId: "booked-replay", reservationId: reserved.reservation.reservationId, bookingToken: reserved.reservation.bookingToken });
    assert.equal(replay.code, "RESERVATION_NOT_FOUND");
    const reconnected = await controller.resume({ roomId: created.roomId, sessionToken: joined.sessionToken, socketId: "booked-reconnect" });
    assert.equal(reconnected.ok, true);
    assert.equal(reconnected.snapshot.ticketCount, 2, "ordinary room credentials recover the booked ticket count without the booking token");
    const room = registry.get(created.roomId);
    const changedCount = await controller.selectTickets({ room, playerId: joined.playerId, count: 3, socketId: "booked-guest" });
    assert.equal(changedCount.code, "BOOKING_TICKET_COUNT_LOCKED");
    const sameCount = await controller.selectTickets({ room, playerId: joined.playerId, count: 2, socketId: "booked-guest" });
    assert.equal(sameCount.ok, true);
    assert.equal((await service.lookupOrTransition({ reservationId: reserved.reservation.reservationId, bookingToken: reserved.reservation.bookingToken, action: "cancel" })).error, "CANCELLATION_CLOSED");
    assert.equal((await service.updateSession({ instanceId: "regular", sessionId: sessionResult.session.sessionId, actor: "owner", patch: { status: "cancelled" } })).error, "SESSION_HAS_ASSIGNED_RESERVATIONS");

    const audit = await env.db.query("SELECT action FROM ticket_reservation_audit WHERE reservation_id=$1 ORDER BY event_id", [reserved.reservation.reservationId]);
    assert.deepEqual(audit.rows.map((row) => row.action), ["hold.create", "hold.confirm", "hold.assign"]);
    const bumperRoom = await controller.createRoom({ name: "Bumper Host", socketId: "bumper-booking-host", instanceId: "bumper" });
    const coldProcess = env.newProcess({ autoCall: false });
    const recovered = await coldProcess.controller.resume({ roomId: created.roomId, sessionToken: joined.sessionToken, socketId: "booked-restart-resume" });
    assert.equal(recovered.ok, true);
    assert.equal(recovered.snapshot.ticketCount, 2);
    assert.equal(recovered.snapshot.ticketSelectionLocked, true, "restart recovery preserves the reservation lock without restoring its secret token");
    const substituted = await controller.joinRoom({ roomId: bumperRoom.roomId, name: "Reserved Guest", socketId: "cross-instance-booking", reservationId: reserved.reservation.reservationId, bookingToken: reserved.reservation.bookingToken });
    assert.equal(substituted.code, "RESERVATION_NOT_FOUND");
    assert.equal((await env.db.query("SELECT 1 FROM room_members WHERE room_code=$1 AND player_id=$2", [bumperRoom.roomId, joined.playerId])).rowCount, 0);

    const lifecycleRoom = await controller.createRoom({ name: "Closing booking room", socketId: "lifecycle-host", instanceId: "regular" });
    const lifecycleSession = await service.createSession({ instanceId: "regular", actor: "owner", title: "Lifecycle game", startsAt: future(80), bookingOpensAt: future(-2), bookingClosesAt: future(75), capacity: 4, roomCode: lifecycleRoom.roomId, inventoryMode: "numbered" });
    const generated = await service.generateInventory({ instanceId: "regular", sessionId: lifecycleSession.session.sessionId, requestedCount: 4, actor: { type: "owner", label: "owner" }, idempotencyKey: "latejoin-regular-v1" });
    assert.equal(generated.generatedCount, 4);
    await service.updateSession({ instanceId: "regular", sessionId: lifecycleSession.session.sessionId, actor: "owner", patch: { status: "open" } });
    const publicCatalog = await service.listPublicTicketCatalog({ sessionId: lifecycleSession.session.sessionId, page: 1, pageSize: 4, status: "available" });
    assert.equal(publicCatalog.tickets.length, 4);
    const selectedTicket = publicCatalog.tickets[0];
    const lifecycleReservation = await service.reserve({ sessionId: lifecycleSession.session.sessionId, displayName: "Waiting Guest", ticketCount: 1, ticketIds: [selectedTicket.ticketId] });
    await service.lookupOrTransition({ reservationId: lifecycleReservation.reservation.reservationId, bookingToken: lifecycleReservation.reservation.bookingToken, action: "confirm" });
    const lifecycleGame = registry.get(lifecycleRoom.roomId);
    assert.equal((await controller.start({ room: lifecycleGame, auth: { hostToken: lifecycleGame.hostCredential() } })).ok, true);
    assert.equal((await env.db.query("SELECT status FROM game_sessions WHERE session_id=$1", [lifecycleSession.session.sessionId])).rows[0].status, "open");
    assert.equal((await env.db.query("SELECT status FROM ticket_reservations WHERE reservation_id=$1", [lifecycleReservation.reservation.reservationId])).rows[0].status, "confirmed");
    const lateJoined = await controller.joinRoom({ roomId: lifecycleRoom.roomId, name: "Waiting Guest", socketId: "late-booked-player", instanceSlug: "regular", reservationId: lifecycleReservation.reservation.reservationId, bookingToken: lifecycleReservation.reservation.bookingToken });
    assert.equal(lateJoined.ok, true, JSON.stringify(lateJoined));
    assert.equal(lateJoined.state, "RUNNING");
    assert.equal(lateJoined.snapshot.tickets.length, 1);
    assert.deepEqual(lateJoined.snapshot.tickets[0].grid, selectedTicket.grid, "the selected numbered ticket is visible to the late player");
    const persistedTicket = await env.db.query("SELECT t.inventory_ticket_id,t.grid FROM tickets t WHERE t.room_code=$1 AND t.game_number=1 AND t.player_id=$2", [lifecycleRoom.roomId, lateJoined.playerId]);
    assert.equal(persistedTicket.rowCount, 1, "the late booked ticket is written to the already-running game");
    assert.equal(persistedTicket.rows[0].inventory_ticket_id, selectedTicket.ticketId, "the live game retains the exact inventory identity");
    assert.deepEqual(persistedTicket.rows[0].grid, selectedTicket.grid, "the durable game ticket matches the issued catalog grid");
    const recoveredLateJoin = await env.newProcess({ autoCall: false }).controller.resume({ roomId: lifecycleRoom.roomId, sessionToken: lateJoined.sessionToken, socketId: "late-booked-reconnect" });
    assert.equal(recoveredLateJoin.ok, true);
    assert.equal(recoveredLateJoin.snapshot.tickets.length, 1, "numbered ticket assignment survives process reload and reconnect");
    assert.deepEqual(recoveredLateJoin.snapshot.tickets[0].grid, selectedTicket.grid);
    assert.equal((await service.getPublicSession(lifecycleSession.session.sessionId)).bookingStatus, "closed", "a running game remains visible while ticket sales close");
    assert.equal((await service.reserve({ sessionId: lifecycleSession.session.sessionId, displayName: "Late Booker", ticketCount: 1, ticketIds: [publicCatalog.tickets[1].ticketId] })).error, "SESSION_UNAVAILABLE", "starting the room closes new reservations");
    const lifecycleAudit = await env.db.query("SELECT action,metadata->>'reason' AS reason FROM ticket_reservation_audit WHERE session_id=$1 ORDER BY event_id", [lifecycleSession.session.sessionId]);
    assert.ok(lifecycleAudit.rows.some((event) => event.action === "hold.assign"));
    assert.equal(lifecycleAudit.rows.some((event) => event.action === "hold.cancel" && event.reason === "room-started"), false, "a confirmed booking survives game start");
  } finally {
    for (const roomId of registry.rooms.keys()) registry.close(roomId, "test finished");
    await env.close();
  }
});

test("winning patterns and reward points persist independently per scheduled session", { skip: !HAS_DB }, async () => {
  const env = await openDurableSchema({ prefix: "session_rules" });
  const process = env.newProcess();
  let coldProcess = null;
  const service = createBookingService({ db: env.db });
  const future = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();
  try {
    const rooms = await Promise.all([
      process.controller.createRoom({ name: "Rules Host A", socketId: "rules-host-a", instanceId: "regular" }),
      process.controller.createRoom({ name: "Rules Host B", socketId: "rules-host-b", instanceId: "regular" }),
    ]);
    const rulesA = [{ id: "earlyFive", points: 80 }, { id: "fullHouse", points: 250 }];
    const rulesB = [{ id: "topLine", points: 5 }];
    const create = (title, roomCode, winningPatterns) => service.createSession({
      instanceId: "regular", actor: "owner-test", title, startsAt: future(90), bookingOpensAt: future(-1), bookingClosesAt: future(80), capacity: 10, roomCode, winningPatterns,
    });
    const a = await create("Rule set A", rooms[0].roomId, rulesA);
    const b = await create("Rule set B", rooms[1].roomId, rulesB);
    assert.equal(a.error, undefined); assert.equal(b.error, undefined);
    for (const [roomCode, session] of [[rooms[0].roomId, a.session], [rooms[1].roomId, b.session]]) {
      assert.deepEqual(await process.controller.configureSessionPatterns({ roomId: roomCode, winningPatterns: session.winningPatterns }), { ok: true });
    }
    const roomA = process.registry.get(rooms[0].roomId);
    const roomB = process.registry.get(rooms[1].roomId);
    assert.deepEqual(roomA.stateView().enabledPatterns, ["earlyFive", "fullHouse"]);
    assert.equal(roomA.config.patternPoints.earlyFive, 80);
    assert.deepEqual(roomB.stateView().enabledPatterns, ["topLine"]);
    assert.equal(roomB.config.patternPoints.topLine, 5);
    coldProcess = env.newProcess();
    const recoveredRoom = await coldProcess.controller.ensureRoom({ roomId: rooms[0].roomId });
    assert.equal(recoveredRoom.ok, true);
    assert.deepEqual(recoveredRoom.room.stateView().enabledPatterns, ["earlyFive", "fullHouse"]);
    assert.equal(recoveredRoom.room.config.patternPoints.earlyFive, 80, "the reward survives a cold process rebuild");
    const durable = await env.db.query("SELECT winning_patterns FROM game_sessions WHERE session_id = ANY($1::uuid[]) ORDER BY title", [[a.session.sessionId, b.session.sessionId]]);
    assert.deepEqual(durable.rows.map((row) => row.winning_patterns), [{ earlyFive: 80, fullHouse: 250 }, { topLine: 5 }]);
    roomA.start({ socketId: "rules-host-a" });
    const locked = await process.controller.configureSessionPatterns({ roomId: rooms[0].roomId, winningPatterns: rulesB });
    assert.equal(locked.code, "WINNING_PATTERNS_LOCKED");
  } finally {
    for (const roomId of process.registry.rooms.keys()) process.registry.close(roomId, "test finished");
    for (const roomId of coldProcess?.registry.rooms.keys() || []) coldProcess.registry.close(roomId, "test finished");
    await env.close();
  }
});

test("owner session creation provisions and binds a generated room on the selected instance", { skip: !HAS_DB }, async () => {
  const env = await openDurableSchema({ prefix: "managed_session" });
  const process = env.newProcess();
  const token = "c".repeat(64);
  const app = express();
  app.use("/api/admin", createAdminBookingRouter({
    db: env.db, controller: process.controller,
    ownerSessions: { async verify() { return { ok: true, ownerId: "owner-test", sessionId: "session-test" }; } },
    ownerStore: { async getById() { return { ownerId: "owner-test", username: "owner", role: "super_admin" }; } },
    throttle: { adminMutation: { async check() { return { allowed: true }; }, async recordFailure() { return {}; } } },
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { cookie: `tambola_owner=${token}; tambola_csrf=${"d".repeat(48)}`, "x-csrf-token": "d".repeat(48), "content-type": "application/json" };
  try {
    const response = await fetch(`${base}/api/admin/instances/regular/sessions`, {
      method: "POST", headers, body: JSON.stringify({
        title: "Owner game", startsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        bookingOpensAt: new Date(Date.now() - 60_000).toISOString(), bookingClosesAt: new Date(Date.now() + 50 * 60_000).toISOString(),
        capacity: 6, inventoryMode: "numbered", createRoom: true,
        winningPatterns: [{ id: "topLine", points: 11 }, { id: "fullHouse", points: 90 }],
      }),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.match(body.session.roomCode, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6,12}$/);
    assert.equal(body.roomCode, body.session.roomCode);
    const stored = await env.db.query(`SELECT s.instance_id,s.room_code,r.game_instance_id,r.config
      FROM game_sessions s JOIN rooms r ON r.room_code=s.room_code WHERE s.session_id=$1`, [body.session.sessionId]);
    assert.equal(stored.rows[0].instance_id, "regular");
    assert.equal(stored.rows[0].game_instance_id, "regular");
    assert.deepEqual(stored.rows[0].config.patterns, { earlyFive: false, topLine: true, middleLine: false, bottomLine: false, corners: false, fullHouse: true, earlySeven: false, star: false, box: false, secondFullHouse: false, halfSheet: false });
    assert.deepEqual(stored.rows[0].config.patternPoints, { topLine: 11, fullHouse: 90 });
    assert.equal((await env.db.query("SELECT count(*)::int AS n FROM rooms WHERE room_code=$1", [body.roomCode])).rows[0].n, 1);
  } finally {
    server.close();
    for (const roomId of process.registry.rooms.keys()) process.registry.close(roomId, "test finished");
    await env.close();
  }
});

test("public player waiting room receives a timezone-aware server schedule without private booking data", { skip: !HAS_DB }, async () => {
  const env = await openDurableSchema({ prefix: "player_schedule" });
  const process = env.newProcess();
  const service = createBookingService({ db: env.db });
  try {
    const room = await process.controller.createRoom({ name: "Schedule Host", socketId: "schedule-host", instanceId: "regular" });
    const future = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();
    const created = await service.createSession({ instanceId: "regular", actor: "owner-test", title: "IST schedule", startsAt: future(30), bookingOpensAt: future(-1), bookingClosesAt: future(25), capacity: 4, roomCode: room.roomId, timeZone: "Asia/Kolkata" });
    await service.updateSession({ instanceId: "regular", sessionId: created.session.sessionId, actor: "owner-test", patch: { status: "open" } });
    const publicSession = await service.getPublicSessionForRoom(room.roomId);
    assert.equal(publicSession.sessionId, created.session.sessionId);
    assert.equal(publicSession.timeZone, "Asia/Kolkata");
    assert.equal(publicSession.autoStartEnabled, false);
    assert.match(publicSession.serverTime, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(Object.hasOwn(publicSession, "roomCode"), false);
    assert.equal(Object.hasOwn(publicSession, "bookingToken"), false);
    assert.equal(Object.hasOwn(publicSession, "winningPatterns"), false);

    const cancelled = await service.updateSession({ instanceId: "regular", sessionId: created.session.sessionId, actor: "owner-test", patch: { status: "cancelled" } });
    assert.equal(cancelled.session.status, "cancelled");
    assert.equal((await service.getPublicSessionForRoom(room.roomId)).status, "cancelled", "a previously published cancellation remains visible to room visitors");
    const completedRoom = await process.controller.createRoom({ name: "Completed Host", socketId: "completed-host", instanceId: "regular" });
    const completedSession = await service.createSession({ instanceId: "regular", actor: "owner-test", title: "Completed schedule", startsAt: future(30), bookingOpensAt: future(-1), bookingClosesAt: future(25), capacity: 4, roomCode: completedRoom.roomId });
    await service.updateSession({ instanceId: "regular", sessionId: completedSession.session.sessionId, actor: "owner-test", patch: { status: "open" } });
    await service.updateSession({ instanceId: "regular", sessionId: completedSession.session.sessionId, actor: "owner-test", patch: { status: "completed" } });
    assert.equal((await service.getPublicSessionForRoom(completedRoom.roomId)).status, "completed", "a completed published session remains visible to room visitors");
  } finally {
    for (const roomId of process.registry.rooms.keys()) process.registry.close(roomId, "test finished");
    await env.close();
  }
});

test("booking sessions, reservations, and audit survive an isolated backup and restore", { skip: !HAS_DB, timeout: 180_000 }, async () => {
  const env = await openDurableSchema({ prefix: "booking_backup" });
  const service = createBookingService({ db: env.db });
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "tambola-booking-restore-"));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const script = (name) => path.join(repoRoot, "scripts", name);
  const future = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();
  let restoredDatabase = null;
  try {
    const session = await service.createSession({ instanceId: "regular", actor: "restore-test", title: "Booking restore fixture", startsAt: future(40), bookingOpensAt: future(-2), bookingClosesAt: future(35), capacity: 8 });
    await service.updateSession({ instanceId: "regular", sessionId: session.session.sessionId, actor: "restore-test", patch: { status: "open" } });
    const reservation = await service.reserve({ sessionId: session.session.sessionId, displayName: "Restore Guest", ticketCount: 2 });
    await service.lookupOrTransition({ reservationId: reservation.reservation.reservationId, bookingToken: reservation.reservation.bookingToken, action: "confirm" });
    const sourceReservation = (await env.db.query(`SELECT reservation_id,session_id,display_name,ticket_count,booking_token_hash,status,
      expires_at::text,created_at::text,confirmed_at::text,cancelled_at::text FROM ticket_reservations WHERE reservation_id=$1`, [reservation.reservation.reservationId])).rows[0];
    const sourceAudit = (await env.db.query(`SELECT event_id,session_id,reservation_id,action,actor_type,actor_label,metadata,occurred_at::text
      FROM ticket_reservation_audit WHERE reservation_id=$1 ORDER BY event_id`, [reservation.reservation.reservationId])).rows;
    assert.deepEqual(sourceAudit.map((event) => event.action), ["hold.create", "hold.confirm"]);

    const childEnv = { ...process.env, DB_SCHEMA: env.schema, BACKUP_DIR: scratchDir, RESTORE_CHECK_KEEP: "1" };
    const backup = spawnSync(process.execPath, ["--env-file-if-exists=.env", script("backup.js")], { cwd: repoRoot, env: childEnv, encoding: "utf8", timeout: 90_000, maxBuffer: 8 * 1024 * 1024 });
    assert.equal(backup.status, 0, `backup failed: ${backup.stdout}\n${backup.stderr}`);
    const manifestFiles = fs.readdirSync(scratchDir).filter((name) => name.endsWith(".manifest.json"));
    assert.equal(manifestFiles.length, 1);
    const manifest = JSON.parse(fs.readFileSync(path.join(scratchDir, manifestFiles[0]), "utf8"));
    assert.ok(manifest.tables.includes("game_sessions"));
    assert.ok(manifest.tables.includes("ticket_reservations"));
    assert.ok(manifest.tables.includes("ticket_reservation_audit"));
    assert.equal(manifest.rowCountByTable.ticket_reservations, 1);
    assert.equal(manifest.rowCountByTable.ticket_reservation_audit, 4);

    const restore = spawnSync(process.execPath, ["--env-file-if-exists=.env", script("restore-check.js")], { cwd: repoRoot, env: childEnv, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
    const restoredDbMatch = restore.stdout.match(/created throwaway database "(tambola_rc_[a-f0-9]+)"/);
    if (restoredDbMatch) restoredDatabase = restoredDbMatch[1];
    assert.equal(restore.status, 0, `restore check failed: ${restore.stdout}\n${restore.stderr}`);
    assert.match(restore.stdout, /RESTORE CHECK PASSED/);
    assert.ok(restoredDatabase, `restore output names the isolated database for content verification: ${restore.stdout}`);
    assert.match(restore.stdout, /RESTORE_CHECK_KEEP=1 — leaving/);
    const dump = fs.readdirSync(scratchDir).find((name) => name.endsWith(".dump"));
    const verification = JSON.parse(fs.readFileSync(path.join(scratchDir, dump.replace(/\.dump$/, ".restore-check.json")), "utf8"));
    assert.equal(verification.status, "passed");
    assert.equal(verification.checksumStatus, "match");
    assert.equal(verification.rows, Object.values(manifest.rowCountByTable).reduce((sum, count) => sum + count, 0));

    const restored = new pg.Pool({ connectionString: connectionToDatabase(process.env.DATABASE_URL, restoredDatabase), max: 1, connectionTimeoutMillis: 8000 });
    try {
      const restoredReservation = (await restored.query(`SELECT reservation_id,session_id,display_name,ticket_count,booking_token_hash,status,
        expires_at::text,created_at::text,confirmed_at::text,cancelled_at::text FROM ${env.schema}.ticket_reservations WHERE reservation_id=$1`, [reservation.reservation.reservationId])).rows[0];
      assert.deepEqual(restoredReservation, sourceReservation, "restore preserves the complete confirmed reservation record, including token hash and lifecycle timestamps");
      const restoredAudit = (await restored.query(`SELECT event_id,session_id,reservation_id,action,actor_type,actor_label,metadata,occurred_at::text
        FROM ${env.schema}.ticket_reservation_audit WHERE reservation_id=$1 ORDER BY event_id`, [reservation.reservation.reservationId])).rows;
      assert.deepEqual(restoredAudit, sourceAudit, "restore preserves every ordered reservation audit event and its metadata");
    } finally {
      await restored.end();
    }
  } finally {
    if (restoredDatabase) {
      const admin = new pg.Pool({ connectionString: connectionToDatabase(process.env.DATABASE_URL, "postgres"), max: 1, connectionTimeoutMillis: 8000 });
      try { await admin.query(`DROP DATABASE IF EXISTS ${JSON.stringify(restoredDatabase)} WITH (FORCE)`); }
      finally { await admin.end(); }
    }
    fs.rmSync(scratchDir, { recursive: true, force: true });
    await env.close();
  }
});
