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

test("moderator booking.assign is explicit, instance-scoped, and atomic without touching reservations", { skip: !HAS_DB }, async () => {
  const env = await openDurableSchema({ prefix: "modbookingassign" });
  let server;
  try {
    const process = env.newProcess();
    const [regularRoomA, regularRoomB, bumperRoom] = await Promise.all([
      process.controller.createManagedRoom({ instanceId: "regular" }),
      process.controller.createManagedRoom({ instanceId: "regular" }),
      process.controller.createManagedRoom({ instanceId: "bumper" }),
    ]);
    assert.deepEqual([regularRoomA.ok, regularRoomB.ok, bumperRoom.ok], [true, true, true]);

    const service = createBookingService({ db: env.db });
    const future = Date.now() + 60 * 60 * 1000;
    const makeSession = (instanceId, title, roomCode = null) => service.createSession({
      instanceId, actor: "assignment-test", title,
      bookingOpensAt: new Date(future).toISOString(),
      bookingClosesAt: new Date(future + 60 * 60 * 1000).toISOString(),
      startsAt: new Date(future + 2 * 60 * 60 * 1000).toISOString(),
      capacity: 20, roomCode,
    });
    const session = await makeSession("regular", "Moderator assignment fixture");
    const foreignSession = await makeSession("bumper", "Foreign assignment fixture");
    const wrongRoomSession = await makeSession("regular", "Wrong room fixture");
    const readOnlySession = await makeSession("regular", "Read-only grant fixture");
    assert.ok(session.session?.sessionId && foreignSession.session?.sessionId && wrongRoomSession.session?.sessionId && readOnlySession.session?.sessionId);

    const moderatorId = randomUUID();
    const username = "booking-assignment-review";
    const password = "LocalBookingAssignmentPass9!";
    await env.db.query(`INSERT INTO moderator_accounts(moderator_id,username,password_hash,status,created_by)
      VALUES($1,$2,$3,'active','test-fixture')`, [moderatorId, username, await hashPassword(password)]);
    const assignPermissions = ["bookings.assign", "room.read"];
    await env.db.query(`INSERT INTO moderator_instance_grants(moderator_id,instance_id,permissions,granted_by)
      VALUES($1,'regular',$2,'test-fixture')`, [moderatorId, assignPermissions]);

    const router = createModeratorRouter({
      db: env.db,
      controller: process.controller,
      registry: process.registry,
      queries: createAdminQueries({ db: env.db }),
      throttle: createThrottleSet({ db: env.db }),
      mfaKey: Buffer.alloc(32, 0x4a),
    });
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

    const boot = await request("/api/moderator/session");
    csrfToken = boot.data.csrfToken;
    assert.equal((await request("/api/moderator/signin", { method: "POST", body: { username, password } })).response.status, 200);
    const enrollment = await request("/api/moderator/security/mfa/enroll", { method: "POST", body: {} });
    assert.equal(enrollment.response.status, 200);
    assert.equal((await request("/api/moderator/security/mfa/confirm", { method: "POST", body: { code: currentCode({ secret: enrollment.data.secret }) } })).response.status, 200);

    const list = await request("/api/moderator/instances/regular/bookings/sessions");
    assert.equal(list.response.status, 200, JSON.stringify(list.data));
    assert.ok(list.data.sessions.some((item) => item.sessionId === session.session.sessionId));
    assert.ok(list.data.sessions.every((item) => !("displayName" in item) && !("bookingToken" in item)));

    const assignmentPath = `/api/moderator/instances/regular/bookings/sessions/${session.session.sessionId}/room`;
    const races = await Promise.all([
      request(assignmentPath, { method: "PUT", body: { roomCode: regularRoomA.roomId } }),
      request(assignmentPath, { method: "PUT", body: { roomCode: regularRoomB.roomId } }),
    ]);
    assert.equal(races.filter((result) => result.response.status === 200).length, 1, "exactly one concurrent room assignment succeeds");
    assert.equal(races.filter((result) => result.response.status === 409 && result.data.code === "SESSION_ALREADY_ASSIGNED").length, 1);
    const assignedSession = (await env.db.query("SELECT room_code FROM game_sessions WHERE session_id=$1", [session.session.sessionId])).rows[0];
    assert.ok([regularRoomA.roomId, regularRoomB.roomId].includes(assignedSession.room_code));

    const idempotent = await request(assignmentPath, { method: "PUT", body: { roomCode: assignedSession.room_code } });
    assert.equal(idempotent.response.status, 200);
    assert.equal(idempotent.data.alreadyAssigned, true);

    const foreignRoom = await request(`/api/moderator/instances/regular/bookings/sessions/${wrongRoomSession.session.sessionId}/room`, { method: "PUT", body: { roomCode: bumperRoom.roomId } });
    assert.equal(foreignRoom.response.status, 409);
    assert.equal(foreignRoom.data.code, "SESSION_ROOM_INVALID");
    assert.equal((await env.db.query("SELECT room_code FROM game_sessions WHERE session_id=$1", [wrongRoomSession.session.sessionId])).rows[0].room_code, null);
    const foreignInstance = await request(`/api/moderator/instances/bumper/bookings/sessions/${foreignSession.session.sessionId}/room`, { method: "PUT", body: { roomCode: bumperRoom.roomId } });
    assert.equal(foreignInstance.response.status, 404);

    await env.db.query("UPDATE moderator_instance_grants SET permissions=ARRAY['bookings.assign'] WHERE moderator_id=$1 AND instance_id='regular'", [moderatorId]);
    const missingRoomRead = await request(`/api/moderator/instances/regular/bookings/sessions/${readOnlySession.session.sessionId}/room`, { method: "PUT", body: { roomCode: regularRoomA.roomId } });
    assert.equal(missingRoomRead.response.status, 403);
    assert.equal(missingRoomRead.data.code, "ROOM_READ_REQUIRED");
    await env.db.query("UPDATE moderator_instance_grants SET permissions=ARRAY['bookings.read','room.read'] WHERE moderator_id=$1 AND instance_id='regular'", [moderatorId]);
    const missingAssign = await request(`/api/moderator/instances/regular/bookings/sessions/${readOnlySession.session.sessionId}/room`, { method: "PUT", body: { roomCode: regularRoomA.roomId } });
    assert.equal(missingAssign.response.status, 404, "bookings.read does not imply session assignment");
    assert.equal((await env.db.query("SELECT room_code FROM game_sessions WHERE session_id=$1", [readOnlySession.session.sessionId])).rows[0].room_code, null);

    const audit = await env.db.query(`SELECT action,actor_type,actor_label,metadata FROM ticket_reservation_audit
      WHERE session_id=$1 ORDER BY event_id`, [session.session.sessionId]);
    assert.deepEqual(audit.rows.map((row) => row.action), ["session.create", "session.assign_room"]);
    assert.equal(audit.rows[1].actor_type, "moderator");
    assert.equal(audit.rows[1].actor_label, username);
    assert.equal(audit.rows[1].metadata.roomCode, assignedSession.room_code);
    assert.equal(Number((await env.db.query("SELECT count(*) AS n FROM ticket_reservations")).rows[0].n), 0);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await env.close();
  }
});
