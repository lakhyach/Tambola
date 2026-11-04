import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { HAS_DB, openDurableSchema } from "./pattern-harness.js";
import { hashPassword } from "../server/admin/password.js";
import { currentCode } from "../server/admin/mfa.js";
import { createModeratorRouter } from "../server/moderator/routes.js";
import { createAdminQueries } from "../server/admin/queries.js";
import { createThrottleSet } from "../server/admin/rate-limit.js";
import { createBookingService } from "../server/bookings/service.js";

test("moderator instance and room identifier matrix denies foreign and unknown targets without FK audit errors", { skip: !HAS_DB }, async () => {
  const env = await openDurableSchema({ prefix: "modidmatrix" });
  let server;
  try {
    const process = env.newProcess();
    const regularRoom = await process.controller.createManagedRoom({ instanceId: "regular" });
    const regularPlayer = await process.controller.joinRoom({ roomId: regularRoom.roomId, name: "Regular player", socketId: "matrix-regular-player" });
    assert.ok(regularPlayer.ok && regularPlayer.playerId, `Regular test player setup failed: ${JSON.stringify(regularPlayer)}`);
    const bumperRoom = await process.controller.createManagedRoom({ instanceId: "bumper" });
    const bumperPlayer = await process.controller.joinRoom({ roomId: bumperRoom.roomId, name: "Bumper player", socketId: "matrix-bumper-player" });
    assert.ok(bumperPlayer.ok && bumperPlayer.playerId, `Bumper test player setup failed: ${JSON.stringify(bumperPlayer)}`);
    await env.db.query("UPDATE game_instances SET status='active' WHERE instance_id='legacy'");
    const legacyRoom = await process.controller.createManagedRoom({ instanceId: "legacy" });
    const legacyPlayer = await process.controller.joinRoom({ roomId: legacyRoom.roomId, name: "Legacy player", socketId: "matrix-legacy-player" });
    assert.ok(legacyPlayer.ok && legacyPlayer.playerId, `Legacy test player setup failed: ${JSON.stringify(legacyPlayer)}`);
    await env.db.query("UPDATE game_instances SET status='archived' WHERE instance_id='legacy'");

    const bookings = createBookingService({ db: env.db });
    const future = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();
    const foreignSession = await bookings.createSession({ instanceId: "bumper", actor: "test-fixture", title: "Foreign identifier matrix", startsAt: future(45), bookingOpensAt: future(-2), bookingClosesAt: future(40), capacity: 5 });
    assert.equal((await bookings.updateSession({ instanceId: "bumper", sessionId: foreignSession.session.sessionId, actor: "test-fixture", patch: { status: "open" } })).error, undefined);
    const foreignReservation = await bookings.reserve({ sessionId: foreignSession.session.sessionId, displayName: "Foreign booking", ticketCount: 1 });
    assert.ok(foreignReservation.reservation);
    const regularSession = await bookings.createSession({ instanceId: "regular", actor: "test-fixture", title: "Regular identifier matrix", startsAt: future(50), bookingOpensAt: future(-2), bookingClosesAt: future(45), capacity: 5 });
    assert.equal((await bookings.updateSession({ instanceId: "regular", sessionId: regularSession.session.sessionId, actor: "test-fixture", patch: { status: "open" } })).error, undefined);
    const regularReservation = await bookings.reserve({ sessionId: regularSession.session.sessionId, displayName: "Regular booking", ticketCount: 1 });
    assert.ok(regularReservation.reservation);

    const moderatorId = randomUUID();
    const username = "instance-matrix-review";
    const password = "LocalMatrixReviewPassphrase9!";
    await env.db.query(`INSERT INTO moderator_accounts(moderator_id,username,password_hash,status,created_by)
      VALUES($1,$2,$3,'active','test-fixture')`, [moderatorId, username, await hashPassword(password)]);
    await env.db.query(`INSERT INTO moderator_instance_grants(moderator_id,instance_id,permissions,granted_by)
      VALUES($1,'regular',ARRAY['instance.read','instance.settings.update','room.create','room.read','room.start','room.pause','room.end','room.reset','players.read','players.manage','bookings.read','bookings.manage','bookings.assign','history.read','reports.read'],'test-fixture')`, [moderatorId]);

    const key = Buffer.alloc(32, 0x4d);
    const router = createModeratorRouter({ db: env.db, controller: process.controller, registry: process.registry, queries: createAdminQueries({ db: env.db }), throttle: createThrottleSet({ db: env.db }), mfaKey: key });
    const app = express();
    app.use("/api/moderator", router.router);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const cookieJar = new Map();
    const cookieHeader = () => [...cookieJar].map(([name, value]) => `${name}=${value}`).join("; ");
    let csrfToken = "";
    async function request(path, { method = "GET", body } = {}) {
      const response = await fetch(origin + path, {
        method,
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(cookieHeader() ? { Cookie: cookieHeader() } : {}),
          ...(method === "GET" ? {} : { "X-CSRF-Token": csrfToken }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const line of response.headers.getSetCookie()) {
        const first = line.split(";", 1)[0];
        const separator = first.indexOf("=");
        cookieJar.set(first.slice(0, separator), decodeURIComponent(first.slice(separator + 1)));
      }
      return { response, data: await response.json() };
    }

    const session = await request("/api/moderator/session");
    csrfToken = session.data.csrfToken;
    assert.equal(session.data.authenticated, false);
    const signIn = await request("/api/moderator/signin", { method: "POST", body: { username, password } });
    assert.equal(signIn.response.status, 200);
    const enrollment = await request("/api/moderator/security/mfa/enroll", { method: "POST", body: {} });
    assert.equal(enrollment.response.status, 200);
    const mfa = await request("/api/moderator/security/mfa/confirm", { method: "POST", body: { code: currentCode({ secret: enrollment.data.secret }) } });
    assert.equal(mfa.response.status, 200);
    const visibleInstances = await request("/api/moderator/instances");
    assert.deepEqual(visibleInstances.data.instances.map((instance) => instance.instance_id), ["regular"], "instance directory contains only the explicit grant");

    const roomCountBefore = Number((await env.db.query("SELECT count(*) AS n FROM rooms")).rows[0].n);
    const regularDescriptionBefore = (await env.db.query("SELECT description FROM game_instances WHERE instance_id='regular'")).rows[0].description;
    const unknownInstanceId = "instance-that-does-not-exist";
    const targetInstances = ["bumper", "legacy", unknownInstanceId];
    const readRoutes = ["rooms", "bookings", "players", "history", "reports/summary"];
    const foreignPlayerId = randomUUID();
    const unknownReservationId = randomUUID();
    const foreignReservationId = foreignReservation.reservation.reservationId;
    const instanceIds = ["regular", "bumper", "legacy", unknownInstanceId];
    const roomIds = [regularRoom.roomId, bumperRoom.roomId, legacyRoom.roomId, "ZZZZZZZZ"];
    const playerIds = [regularPlayer.playerId, bumperPlayer.playerId, legacyPlayer.playerId, foreignPlayerId];
    const sessionIds = [regularSession.session.sessionId, foreignSession.session.sessionId, randomUUID()];
    const reservationIds = [regularReservation.reservation.reservationId, foreignReservation.reservation.reservationId, randomUUID()];
    const regularBookings = await request(`/api/moderator/instances/regular/bookings?sessionId=${regularSession.session.sessionId}`);
    assert.equal(regularBookings.response.status, 200);
    assert.deepEqual(regularBookings.data.reservations.map((reservation) => reservation.reservationId), [regularReservation.reservation.reservationId], "booking list query returns only the granted instance session's reservation");
    const foreignSessionBookings = await request(`/api/moderator/instances/regular/bookings?sessionId=${foreignSession.session.sessionId}`);
    assert.equal(foreignSessionBookings.response.status, 200);
    assert.deepEqual(foreignSessionBookings.data.reservations, [], "a foreign tenant session ID cannot expose bookings through the granted instance");
    const unknownSessionBookings = await request(`/api/moderator/instances/regular/bookings?sessionId=${randomUUID()}`);
    assert.equal(unknownSessionBookings.response.status, 200);
    assert.deepEqual(unknownSessionBookings.data.reservations, [], "an unknown session ID returns no bookings");
    const malformedSessionBookings = await request("/api/moderator/instances/regular/bookings?sessionId=not-a-uuid");
    assert.equal(malformedSessionBookings.response.status, 400, "malformed booking-list session filter is rejected");
    const repeatedSessionBookings = await request(`/api/moderator/instances/regular/bookings?sessionId=${regularSession.session.sessionId}&sessionId=${foreignSession.session.sessionId}`);
    assert.equal(repeatedSessionBookings.response.status, 400, "repeated booking-list session filters cannot silently broaden the query");
    const invalidStatusBookings = await request("/api/moderator/instances/regular/bookings?status=all");
    assert.equal(invalidStatusBookings.response.status, 400, "unknown booking status filter is rejected");
    const repeatedStatusBookings = await request("/api/moderator/instances/regular/bookings?status=held&status=cancelled");
    assert.equal(repeatedStatusBookings.response.status, 400, "repeated booking status filters are rejected");
    const repeatedSearchBookings = await request("/api/moderator/instances/regular/bookings?search=Regular&search=Foreign");
    assert.equal(repeatedSearchBookings.response.status, 400, "repeated booking search filters are rejected");
    let deniedInstanceRequests = 0;
    for (const targetInstanceId of targetInstances) {
      const prefix = `/api/moderator/instances/${targetInstanceId}`;
      for (const route of readRoutes) {
        const result = await request(`${prefix}/${route}`);
        assert.equal(result.response.status, 404, `Regular-only grant cannot read ${route} through ${targetInstanceId}: ${JSON.stringify(result.data)}`);
        deniedInstanceRequests++;
      }
      const settings = await request(`${prefix}/settings`, { method: "PATCH", body: { description: "cross-tenant write must fail" } });
      assert.equal(settings.response.status, 404, `Regular-only grant cannot update settings through ${targetInstanceId}`);
      const createRoom = await request(`${prefix}/rooms`, { method: "POST", body: { name: "Denied cross-tenant room" } });
      assert.equal(createRoom.response.status, 404, `Regular-only grant cannot create rooms through ${targetInstanceId}`);
      const playerDetail = await request(`${prefix}/players/${foreignPlayerId}`);
      assert.equal(playerDetail.response.status, 404, `Regular-only grant cannot read player detail through ${targetInstanceId}`);
      const bookingDetail = await request(`${prefix}/bookings/${foreignReservationId}`);
      assert.equal(bookingDetail.response.status, 404, `Regular-only grant cannot read booking detail through ${targetInstanceId}`);
      const bookingCancel = await request(`${prefix}/bookings/${foreignReservationId}/cancel`, { method: "POST", body: {} });
      assert.equal(bookingCancel.response.status, 404, `Regular-only grant cannot cancel a booking through ${targetInstanceId}`);
      deniedInstanceRequests += 5;
    }

    // Cross the identifier dimensions while keeping the authorized path tenant
    // fixed to Regular: real Bumper/Legacy room, player, session and booking IDs
    // must not become usable by changing only a path or payload identifier.
    for (const foreign of [
      { label: "Bumper", room: bumperRoom.roomId, player: bumperPlayer.playerId },
      { label: "Legacy", room: legacyRoom.roomId, player: legacyPlayer.playerId },
    ]) {
      const detail = await request(`/api/moderator/instances/regular/rooms/${foreign.room}`);
      assert.equal(detail.response.status, 404, `${foreign.label} room detail hidden through Regular path`);
      for (const action of ["start", "pause", "resume", "end", "reset"]) {
        const result = await request(`/api/moderator/instances/regular/rooms/${foreign.room}/${action}`, { method: "POST", body: {} });
        assert.equal(result.response.status, 404, `${foreign.label} room ${action} denied through Regular path`);
      }
      const playerDetail = await request(`/api/moderator/instances/regular/players/${foreign.player}`);
      assert.equal(playerDetail.response.status, 404, `${foreign.label} player hidden through Regular path`);
      const removal = await request(`/api/moderator/instances/regular/rooms/${foreign.room}/players/${foreign.player}`, { method: "DELETE", body: {} });
      assert.equal(removal.response.status, 404, `${foreign.label} player removal denied through Regular path`);
    }
    for (const foreignInstanceId of ["bumper", "legacy"]) {
      const path = `/api/moderator/instances/${foreignInstanceId}/rooms/${regularRoom.roomId}`;
      assert.equal((await request(path)).response.status, 404, `Regular room detail hidden through ${foreignInstanceId} path`);
      for (const action of ["start", "pause", "resume", "end", "reset"]) {
        const result = await request(`${path}/${action}`, { method: "POST", body: {} });
        assert.equal(result.response.status, 404, `Regular room ${action} denied through ${foreignInstanceId} path`);
      }
      const removal = await request(`${path}/players/${bumperPlayer.playerId}`, { method: "DELETE", body: {} });
      assert.equal(removal.response.status, 404, `foreign path cannot target a real player through ${foreignInstanceId}`);
    }
    const foreignAssignment = await request(`/api/moderator/instances/regular/bookings/sessions/${foreignSession.session.sessionId}/room`, { method: "PUT", body: { roomCode: regularRoom.roomId } });
    assert.equal(foreignAssignment.response.status, 404, "a Bumper session cannot be assigned through Regular");
    const unknownAssignment = await request(`/api/moderator/instances/regular/bookings/sessions/${randomUUID()}/room`, { method: "PUT", body: { roomCode: regularRoom.roomId } });
    assert.equal(unknownAssignment.response.status, 404, "an unknown session cannot be assigned through Regular");
    for (const method of ["GET", "POST"]) {
      const bookingPath = `/api/moderator/instances/regular/bookings/${unknownReservationId}${method === "POST" ? "/cancel" : ""}`;
      const unknownBooking = await request(bookingPath, { method, ...(method === "POST" ? { body: {} } : {}) });
      assert.equal(unknownBooking.response.status, 404, `unknown booking ${method} fails closed`);
    }
    assert.equal((await request(`/api/moderator/instances/regular/players/${foreignPlayerId}`)).response.status, 404, "unknown player detail fails closed");
    const unknownRemoval = await request(`/api/moderator/instances/regular/rooms/${regularRoom.roomId}/players/${foreignPlayerId}`, { method: "DELETE", body: {} });
    assert.equal(unknownRemoval.response.status, 409, "unknown player in an owned room is refused by the live controller");
    assert.equal(Number((await env.db.query("SELECT count(*) AS n FROM rooms")).rows[0].n), roomCountBefore, "denied targets created no rooms");
    const foreignRoomState = await env.db.query("SELECT room_code,status FROM rooms WHERE room_code = ANY($1::text[]) ORDER BY room_code", [[bumperRoom.roomId, legacyRoom.roomId]]);
    assert.deepEqual(foreignRoomState.rows, [
      { room_code: bumperRoom.roomId, status: "WAITING" },
      { room_code: legacyRoom.roomId, status: "WAITING" },
    ].sort((left, right) => left.room_code.localeCompare(right.room_code)), "foreign room lifecycle state is unchanged");
    assert.equal((await env.db.query("SELECT left_at FROM room_members WHERE player_id=$1", [bumperPlayer.playerId])).rows[0].left_at, null, "foreign Bumper player remains active");
    assert.equal((await env.db.query("SELECT left_at FROM room_members WHERE player_id=$1", [legacyPlayer.playerId])).rows[0].left_at, null, "foreign Legacy player remains active");
    assert.equal((await env.db.query("SELECT left_at FROM room_members WHERE player_id=$1", [regularPlayer.playerId])).rows[0].left_at, null, "authorized control player was not removed");
    assert.equal((await env.db.query("SELECT description FROM game_instances WHERE instance_id='regular'")).rows[0].description, regularDescriptionBefore, "denied targets changed no tenant settings");

    const unknownRoomId = "ZZZZZZZZ";
    assert.equal((await env.db.query("SELECT 1 FROM rooms WHERE room_code=$1", [unknownRoomId])).rowCount, 0);
    const unknownRoomRoutes = [
      [`/api/moderator/instances/regular/rooms/${unknownRoomId}`, {}],
      ...["start", "pause", "resume", "end", "reset"].map((action) => [`/api/moderator/instances/regular/rooms/${unknownRoomId}/${action}`, { method: "POST", body: {} }]),
      [`/api/moderator/instances/regular/rooms/${unknownRoomId}/players/${foreignPlayerId}`, { method: "DELETE", body: {} }],
    ];
    for (const [path, options] of unknownRoomRoutes) {
      const result = await request(path, options);
      assert.equal(result.response.status, 404, `unknown room target fails closed: ${JSON.stringify(result.data)}`);
    }

    // Tenant path × room ID matrix; the only positive case is read-only.
    for (const instanceId of instanceIds) {
      for (const roomId of roomIds) {
        if (instanceId === "regular" && roomId === regularRoom.roomId) {
          assert.equal((await request(`/api/moderator/instances/${instanceId}/rooms/${roomId}`)).response.status, 200);
          continue;
        }
        const prefix = `/api/moderator/instances/${instanceId}/rooms/${roomId}`;
        assert.ok((await request(prefix)).response.status >= 400, `room detail denied for path=${instanceId}, room=${roomId}`);
        for (const action of ["start", "pause", "resume", "end", "reset"]) {
          const result = await request(`${prefix}/${action}`, { method: "POST", body: {} });
          assert.ok(result.response.status >= 400, `room ${action} denied for path=${instanceId}, room=${roomId}`);
        }
      }
    }

    // Tenant path × player ID matrix with one read-only positive control.
    for (const instanceId of instanceIds) {
      for (const playerId of playerIds) {
        const result = await request(`/api/moderator/instances/${instanceId}/players/${playerId}`);
        if (instanceId === "regular" && playerId === regularPlayer.playerId) assert.equal(result.response.status, 200);
        else assert.equal(result.response.status, 404, `player detail denied for path=${instanceId}, player=${playerId}`);
      }
    }

    // Assignment path × session ID × room body ID matrix. Skip the single
    // own-to-own positive cell to keep this denial campaign non-mutating.
    for (const instanceId of instanceIds) {
      for (const sessionId of sessionIds) {
        for (const roomId of roomIds) {
          if (instanceId === "regular" && sessionId === regularSession.session.sessionId && roomId === regularRoom.roomId) continue;
          const result = await request(`/api/moderator/instances/${instanceId}/bookings/sessions/${sessionId}/room`, { method: "PUT", body: { roomCode: roomId } });
          assert.ok(result.response.status >= 400, `assignment denied for path=${instanceId}, session=${sessionId}, room=${roomId}`);
        }
      }
    }

    // Reservation detail and cancellation cross tenant path × reservation
    // IDs. The sole own-to-own cancellation is skipped to preserve both holds.
    for (const instanceId of instanceIds) {
      for (const reservationId of reservationIds) {
        if (instanceId === "regular" && reservationId === regularReservation.reservation.reservationId) continue;
        const detail = await request(`/api/moderator/instances/${instanceId}/bookings/${reservationId}`);
        assert.equal(detail.response.status, 404, `reservation detail denied for path=${instanceId}, reservation=${reservationId}`);
        const cancellation = await request(`/api/moderator/instances/${instanceId}/bookings/${reservationId}/cancel`, { method: "POST", body: {} });
        assert.ok(cancellation.response.status >= 400, `reservation cancellation denied for path=${instanceId}, reservation=${reservationId}`);
      }
    }

    // Removal path × room ID × player ID matrix without the destructive
    // own-room/own-player combination.
    for (const instanceId of instanceIds) {
      for (const roomId of roomIds) {
        for (const playerId of playerIds) {
          if (instanceId === "regular" && roomId === regularRoom.roomId && playerId === regularPlayer.playerId) continue;
          const result = await request(`/api/moderator/instances/${instanceId}/rooms/${roomId}/players/${playerId}`, { method: "DELETE", body: {} });
          assert.ok(result.response.status >= 400, `player removal denied for path=${instanceId}, room=${roomId}, player=${playerId}`);
        }
      }
    }

    // Hostile-but-well-formed URL segments and malformed IDs/payloads must be
    // rejected by validation or authorization, never interpreted as SQL or
    // leaked as server errors. Body probes use an owned session/route so the
    // parser is exercised before the service can mutate a reservation.
    const malformedIds = [
      "x",
      "ZZZZZZZZ!",
      "' OR 1=1 --",
      "a".repeat(100),
      "２", // full-width digit is not an ASCII room identifier
      "room\u200bcode", // zero-width formatting character
      "regular/rooms", // encoded path separator
      "regular\u0000room", // encoded NUL in a path parameter
      "e\u0301", // combining Unicode sequence
    ];
    const segment = (value) => encodeURIComponent(value);
    for (const value of malformedIds) {
      const badInstance = await request(`/api/moderator/instances/${segment(value)}/rooms`);
      assert.equal(badInstance.response.status, 404, `malformed instance segment rejected: ${value.slice(0, 24)}`);
      const badRoom = await request(`/api/moderator/instances/regular/rooms/${segment(value)}`);
      assert.equal(badRoom.response.status, 404, `malformed room segment rejected: ${value.slice(0, 24)}`);
      const badPlayer = await request(`/api/moderator/instances/regular/players/${segment(value)}`);
      assert.equal(badPlayer.response.status, 404, `malformed player segment rejected: ${value.slice(0, 24)}`);
      const badReservation = await request(`/api/moderator/instances/regular/bookings/${segment(value)}`);
      assert.equal(badReservation.response.status, 404, `malformed reservation segment rejected: ${value.slice(0, 24)}`);
      const badSession = await request(`/api/moderator/instances/regular/bookings/sessions/${segment(value)}/room`, { method: "PUT", body: { roomCode: regularRoom.roomId } });
      assert.equal(badSession.response.status, 400, `malformed session segment rejected: ${value.slice(0, 24)}`);
    }
    for (const roomCode of ["", "ABC", "ZZZZZZZZ!", "A".repeat(13), "O0I1ST", "２3ABCD", "A\u200bBCDE", 17, null, { nested: "value" }]) {
      const malformedAssignment = await request(`/api/moderator/instances/regular/bookings/sessions/${regularSession.session.sessionId}/room`, { method: "PUT", body: { roomCode } });
      assert.equal(malformedAssignment.response.status, 400, `malformed roomCode payload rejected: ${JSON.stringify(roomCode)}`);
    }

    const audit = await env.db.query(`SELECT instance_id,room_code,metadata FROM platform_audit
      WHERE actor=$1 AND result='failure' ORDER BY event_id`, [username]);
    assert.ok(audit.rows.some((row) => row.instance_id === null && row.metadata.requestedInstanceId === unknownInstanceId), "unknown instance is retained in audit metadata without an invalid FK");
    assert.ok(audit.rows.some((row) => row.instance_id === "regular" && row.room_code === null && row.metadata.requestedRoomId === unknownRoomId), "unknown room is retained in audit metadata without an invalid FK");
    assert.equal(Number((await env.db.query("SELECT count(*) AS n FROM ticket_reservations")).rows[0].n), 2, "the cross-tenant requests create no additional reservations");
    assert.equal((await env.db.query("SELECT status FROM ticket_reservations WHERE reservation_id=$1", [foreignReservationId])).rows[0].status, "held", "foreign reservation remains unchanged");
    assert.equal((await env.db.query("SELECT status FROM ticket_reservations WHERE reservation_id=$1", [regularReservation.reservation.reservationId])).rows[0].status, "held", "regular control reservation remains unchanged");
    assert.equal(Number((await env.db.query("SELECT count(*) AS n FROM ticket_reservation_audit WHERE reservation_id=$1", [foreignReservationId])).rows[0].n), 1, "denied booking reads/cancellations add no reservation audit events");
    assert.equal(Number((await env.db.query("SELECT count(*) AS n FROM ticket_reservation_audit WHERE reservation_id=$1", [regularReservation.reservation.reservationId])).rows[0].n), 1, "denied identifier combinations add no control reservation audit events");
    assert.equal((await env.db.query("SELECT room_code FROM game_sessions WHERE session_id=$1", [regularSession.session.sessionId])).rows[0].room_code, null, "denied assignment combinations did not assign the Regular session");
    assert.equal((await env.db.query("SELECT room_code FROM game_sessions WHERE session_id=$1", [foreignSession.session.sessionId])).rows[0].room_code, null, "denied assignment combinations did not assign the Bumper session");
    assert.deepEqual([regularRoom.ok, bumperRoom.ok, legacyRoom.ok], [true, true, true]);
    assert.equal(deniedInstanceRequests, targetInstances.length * (readRoutes.length + 5));
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await env.close();
  }
});
