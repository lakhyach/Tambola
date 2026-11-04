import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { Server } from "socket.io";
import { io as connectSocket } from "socket.io-client";
import { randomBytes, randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { HAS_DB, openDurableSchema } from "./pattern-harness.js";
import { hashPassword } from "../server/admin/password.js";
import { currentCode } from "../server/admin/mfa.js";
import { createModeratorAuth } from "../server/moderator/auth.js";
import { authorizeInstance, authorizeRoom } from "../server/moderator/authorization.js";
import { createModeratorRouter } from "../server/moderator/routes.js";
import { registerGameHandlers } from "../server/net/socket.js";
import { createAdminQueries } from "../server/admin/queries.js";
import { createThrottleSet } from "../server/admin/rate-limit.js";
import { createBookingService } from "../server/bookings/service.js";

const enabled = HAS_DB;
let env;
let key;
let mod;
let readOnlyMod;
let unassignedMod;
let suspendedMod;
let passwordHash;
let auth;
let processStack;
let regularRoom;
let regularRoom2;
let bumperRoom;
let legacyRoom;
let regularPlayer;
let regularPlayer2;
let bumperPlayer;
let legacyPlayer;

before(async () => {
  if (!enabled) return;
  env = await openDurableSchema({ prefix: "moderator" });
  key = randomBytes(32);
  mod = randomUUID();
  passwordHash = await hashPassword("Moderator passphrase 2026!");
  await env.db.query(`INSERT INTO moderator_accounts(moderator_id,username,password_hash,status,created_by)
    VALUES($1,'moderator.one',$2,'active','test-owner')`, [mod, passwordHash]);
  await env.db.query(`INSERT INTO moderator_instance_grants(moderator_id,instance_id,permissions,granted_by)
    VALUES($1,'regular',ARRAY['instance.read','instance.settings.update','room.create','room.read','room.start','room.pause','room.end','room.reset','players.read','players.manage','history.read','tickets.manage','reports.read'],'test-owner')`, [mod]);
  readOnlyMod = randomUUID(); unassignedMod = randomUUID(); suspendedMod = randomUUID();
  await env.db.query(`INSERT INTO moderator_accounts(moderator_id,username,password_hash,status,created_by)
    VALUES($1,'moderator.readonly',$3,'active','test-owner'),($2,'moderator.unassigned',$3,'active','test-owner'),($4,'moderator.suspended',$3,'suspended','test-owner')`, [readOnlyMod, unassignedMod, passwordHash, suspendedMod]);
  await env.db.query(`INSERT INTO moderator_instance_grants(moderator_id,instance_id,permissions,granted_by)
    VALUES($1,'regular',ARRAY['instance.read','room.read'],'test-owner'),($2,'regular',ARRAY['room.read'],'test-owner')`, [readOnlyMod, suspendedMod]);
  auth = createModeratorAuth({ db: env.db, mfaKey: key });
  processStack = env.newProcess();
  regularRoom = await processStack.controller.createManagedRoom({ instanceId: "regular" });
  regularRoom2 = await processStack.controller.createManagedRoom({ instanceId: "regular" });
  bumperRoom = await processStack.controller.createManagedRoom({ instanceId: "bumper" });
  await env.db.query("UPDATE game_instances SET status='active' WHERE instance_id='legacy'");
  legacyRoom = await processStack.controller.createManagedRoom({ instanceId: "legacy" });
  regularPlayer = await processStack.controller.joinRoom({ roomId: regularRoom.roomId, name: "Regular player", socketId: "test-regular-player" });
  regularPlayer2 = await processStack.controller.joinRoom({ roomId: regularRoom2.roomId, name: "Regular player two", socketId: "test-regular-player-two" });
  bumperPlayer = await processStack.controller.joinRoom({ roomId: bumperRoom.roomId, name: "Bumper player", socketId: "test-bumper-player" });
  legacyPlayer = await processStack.controller.joinRoom({ roomId: legacyRoom.roomId, name: "Legacy player", socketId: "test-legacy-player" });
  await env.db.query("UPDATE game_instances SET status='archived' WHERE instance_id='legacy'");
});

after(async () => { if (env) await env.close(); });

test("moderator credentials, MFA, sessions, live grants and room ownership are rechecked", { skip: !enabled }, async () => {
  const credentials = await auth.verifyCredentials({ username: "MODERATOR.ONE", password: "Moderator passphrase 2026!" });
  assert.equal(credentials.ok, true);
  assert.equal((await auth.verifyCredentials({ username: "moderator.one", password: "incorrect password" })).ok, false);

  const session = await auth.issueSession(mod);
  const beforeMfa = await auth.verifySession({ token: session.token });
  assert.equal(beforeMfa.mfaEnrolled, false);
  assert.equal((await authorizeInstance({ db: env.db, moderatorId: mod, instanceId: "regular", permission: "room.read" })).ok, true);
  assert.equal((await authorizeInstance({ db: env.db, moderatorId: mod, instanceId: "bumper", permission: "room.read" })).ok, false);
  assert.equal((await authorizeInstance({ db: env.db, moderatorId: mod, instanceId: "regular", permission: "room.reset" })).ok, true);
  assert.equal((await authorizeInstance({ db: env.db, moderatorId: mod, instanceId: "regular", permission: "tickets.manage" })).ok, true);
  assert.equal((await authorizeInstance({ db: env.db, moderatorId: readOnlyMod, instanceId: "regular", permission: "room.read" })).ok, true);
  assert.equal((await authorizeInstance({ db: env.db, moderatorId: readOnlyMod, instanceId: "regular", permission: "room.start" })).ok, false);
  assert.equal((await authorizeInstance({ db: env.db, moderatorId: readOnlyMod, instanceId: "bumper", permission: "room.read" })).ok, false);
  assert.equal((await authorizeInstance({ db: env.db, moderatorId: unassignedMod, instanceId: "regular", permission: "room.read" })).ok, false);
  assert.equal((await authorizeInstance({ db: env.db, moderatorId: suspendedMod, instanceId: "regular", permission: "room.read" })).ok, false);

  const enrollment = await auth.beginMfa(mod);
  assert.equal(enrollment.ok, true);
  const stored = await env.db.query("SELECT totp_secret_enc FROM moderator_accounts WHERE moderator_id=$1", [mod]);
  assert.notEqual(stored.rows[0].totp_secret_enc, enrollment.secret);
  const enrolled = await auth.confirmMfa(mod, currentCode({ secret: enrollment.secret }));
  assert.equal(enrolled.ok, true);
  assert.equal((await auth.verifySession({ sessionId: session.sessionId })).mfaEnrolled, true);
  await env.db.query("UPDATE moderator_accounts SET totp_last_step=NULL WHERE moderator_id=$1", [mod]);
  const challenge = await auth.createChallenge(mod, "aaaaaaaaaaaaaaaaaaaaaaaa");
  const code = currentCode({ secret: enrollment.secret });
  assert.equal(await auth.verifyChallenge({ token: challenge.challengeToken, code, ipHash: "bbbbbbbbbbbbbbbbbbbbbbbb" }), null);
  assert.equal((await auth.verifyChallenge({ token: challenge.challengeToken, code, ipHash: "aaaaaaaaaaaaaaaaaaaaaaaa" })).moderatorId, mod);

  const regularAccess = await authorizeRoom({ db: env.db, moderatorId: mod, roomId: regularRoom.roomId, permission: "room.read" });
  assert.equal(regularAccess.ok, true);
  const crossInstance = await authorizeRoom({ db: env.db, moderatorId: mod, roomId: bumperRoom.roomId, permission: "room.read" });
  assert.deepEqual(crossInstance, { ok: false, code: "FORBIDDEN" });
  assert.deepEqual(await authorizeRoom({ db: env.db, moderatorId: mod, roomId: legacyRoom.roomId, permission: "room.read" }), { ok: false, code: "FORBIDDEN" });

  await env.db.query("UPDATE moderator_instance_grants SET revoked_at=now(),revoked_by='test-owner' WHERE moderator_id=$1 AND instance_id='regular'", [mod]);
  assert.equal((await authorizeRoom({ db: env.db, moderatorId: mod, roomId: regularRoom.roomId, permission: "room.read" })).ok, false);
  assert.ok(await auth.verifySession({ sessionId: session.sessionId }), "grant revoke does not need session expiry");
  await auth.revokeSession(session.sessionId, "test-revoke");
  assert.equal(await auth.verifySession({ sessionId: session.sessionId }), null);

  await env.db.query("UPDATE moderator_accounts SET status='suspended' WHERE moderator_id=$1", [mod]);
  assert.equal(await auth.verifySession({ token: session.token }), null);

  const recoveryToken = randomBytes(32).toString("hex");
  const recoveryHash = (await import("node:crypto")).createHash("sha256").update(recoveryToken).digest("hex");
  await env.db.query(`INSERT INTO moderator_recovery_tokens(recovery_id,moderator_id,token_hash,created_by,expires_at)
    VALUES($1,$2,$3,'test-owner',now()+interval '30 minutes')`, [randomUUID(), mod, recoveryHash]);
  const recovered = await auth.completeRecovery({ token: recoveryToken, password: "New moderator passphrase 2026!" });
  assert.equal(recovered.ok, true);
  assert.equal((await auth.account(mod)).totp_confirmed_at, null, "recovery clears MFA enrollment instead of bypassing MFA");
  assert.equal((await auth.verifyCredentials({ username: "moderator.one", password: "New moderator passphrase 2026!" })).ok, true);
  assert.equal((await auth.completeRecovery({ token: recoveryToken, password: "Replay passphrase 2026!" })).ok, false, "recovery token is single-use");
  const expires = await auth.issueSession(mod);
  await env.db.query("UPDATE moderator_sessions SET expires_at=now()-interval '1 second' WHERE session_id=$1", [expires.sessionId]);
  assert.equal(await auth.verifySession({ sessionId: expires.sessionId }), null, "expired moderator sessions fail closed");
});

test("moderator HTTP routes enforce CSRF, MFA, instance scope and append-only audit", { skip: !enabled }, async () => {
  await env.db.query("UPDATE moderator_accounts SET status='active',totp_secret_enc=NULL,totp_confirmed_at=NULL,totp_last_step=NULL WHERE moderator_id=$1", [mod]);
  await env.db.query(`UPDATE moderator_instance_grants SET permissions=ARRAY['instance.read','instance.settings.update','room.create','room.read','room.start','room.pause','room.end','room.reset','players.read','players.manage','history.read','tickets.manage','bookings.read','bookings.manage','reports.read'],revoked_at=NULL,revoked_by=NULL WHERE moderator_id=$1 AND instance_id='regular'`, [mod]);
  const app = express();
  const service = createModeratorRouter({ db: env.db, controller: processStack.controller, registry: processStack.registry, queries: createAdminQueries({ db: env.db }), throttle: createThrottleSet({ db: env.db }), mfaKey: key });
  app.use("/api/moderator", service.router);
  const server = http.createServer(app);
  const io = new Server(server);
  registerGameHandlers(io, { rooms: processStack.registry, controller: processStack.controller, db: env.db, moderatorAuth: service.auth, limits: { burst: 200, perSecond: 100 } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const cookieMap = new Map();
  const cookies = () => [...cookieMap].map(([name, value]) => `${name}=${value}`).join("; ");
  async function request(path, { method = "GET", body, csrf = true } = {}) {
    const response = await fetch(origin + path, { method, headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(cookies() ? { Cookie: cookies() } : {}), ...(csrf && csrfToken && method !== "GET" ? { "X-CSRF-Token": csrfToken } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const line of response.headers.getSetCookie()) {
      const first = line.split(";", 1)[0]; const i = first.indexOf("="); cookieMap.set(first.slice(0, i), decodeURIComponent(first.slice(i + 1)));
    }
    return { response, data: await response.json() };
  }
  let csrfToken = null;
  try {
    const boot = await request("/api/moderator/session"); csrfToken = boot.data.csrfToken;
    assert.equal(boot.data.authenticated, false);
    const anonymous = await request("/api/moderator/instances/regular/rooms");
    assert.equal(anonymous.response.status, 401);
    const missingCsrf = await request("/api/moderator/signin", { method: "POST", body: { username: "moderator.one", password: "Moderator passphrase 2026!" }, csrf: false });
    assert.equal(missingCsrf.response.status, 403);
    const signin = await request("/api/moderator/signin", { method: "POST", body: { username: "moderator.one", password: "New moderator passphrase 2026!" } });
    assert.equal(signin.response.status, 200);
    assert.equal(signin.data.mfaRequired, false);
    const blocked = await request("/api/moderator/instances/regular/rooms");
    assert.equal(blocked.response.status, 403);
    assert.equal(blocked.data.code, "MFA_REQUIRED");
    const passwordBeforeMfa = await request("/api/moderator/account/password", { method: "POST", body: { currentPassword: "New moderator passphrase 2026!", newPassword: "Moderator account passphrase 2026 renewed!" } });
    assert.equal(passwordBeforeMfa.response.status, 403, "password change requires enrolled MFA");

    const enrollment = await request("/api/moderator/security/mfa/enroll", { method: "POST", body: {} });
    assert.equal(enrollment.response.status, 200);
    const confirm = await request("/api/moderator/security/mfa/confirm", { method: "POST", body: { code: currentCode({ secret: enrollment.data.secret }) } });
    assert.equal(confirm.response.status, 200);
    const rooms = await request("/api/moderator/instances/regular/rooms");
    assert.equal(rooms.response.status, 200);
    assert.ok(rooms.data.rooms.some((room) => room.room_code === regularRoom.roomId));

    const bookingService = createBookingService({ db: env.db });
    const future = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();
    const scheduled = await bookingService.createSession({ instanceId: "regular", actor: "test-owner", title: "Moderator booking test", startsAt: future(50), bookingOpensAt: future(-2), bookingClosesAt: future(45), capacity: 8 });
    await bookingService.updateSession({ instanceId: "regular", sessionId: scheduled.session.sessionId, actor: "test-owner", patch: { status: "open" } });
    const managedBooking = await bookingService.reserve({ sessionId: scheduled.session.sessionId, displayName: "Booked Guest", ticketCount: 2 });
    await bookingService.lookupOrTransition({ reservationId: managedBooking.reservation.reservationId, bookingToken: managedBooking.reservation.bookingToken, action: "confirm" });
    const bumperScheduled = await bookingService.createSession({ instanceId: "bumper", actor: "test-owner", title: "Foreign moderator booking test", startsAt: future(50), bookingOpensAt: future(-2), bookingClosesAt: future(45), capacity: 8 });
    await bookingService.updateSession({ instanceId: "bumper", sessionId: bumperScheduled.session.sessionId, actor: "test-owner", patch: { status: "open" } });
    const bumperBooking = await bookingService.reserve({ sessionId: bumperScheduled.session.sessionId, displayName: "Foreign Booked Guest", ticketCount: 1 });
    await bookingService.lookupOrTransition({ reservationId: bumperBooking.reservation.reservationId, bookingToken: bumperBooking.reservation.bookingToken, action: "confirm" });
    const malformedSessionId = "a".repeat(36);
    const noGrant = await request("/api/moderator/instances/bumper/bookings");
    assert.equal(noGrant.response.status, 404, "booking permission cannot cross an instance grant");
    await env.db.query("UPDATE moderator_instance_grants SET permissions=ARRAY['instance.read','bookings.read'],revoked_at=NULL WHERE moderator_id=$1 AND instance_id='regular'", [mod]);
    const malformedSessionFilter = await request(`/api/moderator/instances/regular/bookings?sessionId=${malformedSessionId}`);
    assert.equal(malformedSessionFilter.response.status, 400, "malformed UUID session filters are rejected before reaching PostgreSQL");
    const foreignSessionFilter = await request(`/api/moderator/instances/regular/bookings?sessionId=${bumperScheduled.session.sessionId}`);
    assert.equal(foreignSessionFilter.response.status, 200);
    assert.equal(foreignSessionFilter.data.reservations.length, 0, "a Bumper session identifier cannot reveal bookings through the Regular grant");
    const listedBookings = await request("/api/moderator/instances/regular/bookings?status=confirmed&search=Booked");
    assert.equal(listedBookings.response.status, 200);
    assert.equal(listedBookings.data.reservations.length, 1);
    assert.equal(listedBookings.data.reservations[0].displayName, "Booked Guest");
    assert.equal("bookingToken" in listedBookings.data.reservations[0], false, "moderator listings never disclose booking credentials");
    assert.equal("booking_token_hash" in listedBookings.data.reservations[0], false, "moderator listings never disclose credential hashes");
    const bookingDetail = await request(`/api/moderator/instances/regular/bookings/${managedBooking.reservation.reservationId}`);
    assert.equal(bookingDetail.response.status, 200);
    const malformedBookingDetail = await request(`/api/moderator/instances/regular/bookings/${malformedSessionId}`);
    assert.equal(malformedBookingDetail.response.status, 404, "malformed UUID booking identifiers use the non-disclosing not-found response");
    const foreignBookingDetail = await request(`/api/moderator/instances/regular/bookings/${bumperBooking.reservation.reservationId}`);
    assert.equal(foreignBookingDetail.response.status, 404, "a Bumper reservation identifier cannot be read through the Regular grant");
    assert.ok(bookingDetail.data.reservation.history.some((event) => event.action === "hold.confirm"));
    assert.equal("bookingToken" in bookingDetail.data.reservation, false, "moderator detail never discloses booking credentials");
    assert.equal("booking_token_hash" in bookingDetail.data.reservation, false, "moderator detail never discloses credential hashes");
    const readOnlyCancel = await request(`/api/moderator/instances/regular/bookings/${managedBooking.reservation.reservationId}/cancel`, { method: "POST", body: {} });
    assert.equal(readOnlyCancel.response.status, 404, "bookings.read never implies booking cancellation");
    assert.equal((await env.db.query("SELECT status FROM ticket_reservations WHERE reservation_id=$1", [managedBooking.reservation.reservationId])).rows[0].status, "confirmed", "read-only denial leaves the reservation unchanged");
    await env.db.query("UPDATE moderator_instance_grants SET permissions=ARRAY['instance.read','bookings.read','bookings.manage'],revoked_at=NULL WHERE moderator_id=$1 AND instance_id='regular'", [mod]);
    const malformedBookingCancel = await request(`/api/moderator/instances/regular/bookings/${malformedSessionId}/cancel`, { method: "POST", body: {} });
    assert.equal(malformedBookingCancel.response.status, 404, "malformed UUID cancellation identifiers are rejected before mutation");
    const foreignBookingCancel = await request(`/api/moderator/instances/regular/bookings/${bumperBooking.reservation.reservationId}/cancel`, { method: "POST", body: {} });
    assert.equal(foreignBookingCancel.response.status, 404, "a Bumper reservation cannot be cancelled through the Regular grant");
    assert.equal((await env.db.query("SELECT status FROM ticket_reservations WHERE reservation_id=$1", [bumperBooking.reservation.reservationId])).rows[0].status, "confirmed", "foreign cancellation denial leaves the Bumper reservation unchanged");
    const cancelledBooking = await request(`/api/moderator/instances/regular/bookings/${managedBooking.reservation.reservationId}/cancel`, { method: "POST", body: {} });
    assert.equal(cancelledBooking.response.status, 200);
    assert.equal(cancelledBooking.data.reservation.status, "cancelled");
    await env.db.query("UPDATE moderator_instance_grants SET permissions=ARRAY['instance.read','room.read'],revoked_at=NULL WHERE moderator_id=$1 AND instance_id='regular'", [mod]);
    const deniedBooking = await request("/api/moderator/instances/regular/bookings");
    assert.equal(deniedBooking.response.status, 404, "an existing room grant does not imply booking access");
    await env.db.query(`UPDATE moderator_instance_grants SET permissions=ARRAY['instance.read','instance.settings.update','room.create','room.read','room.start','room.pause','room.end','room.reset','players.read','players.manage','history.read','tickets.manage','bookings.read','bookings.manage','reports.read'] WHERE moderator_id=$1 AND instance_id='regular'`, [mod]);
    const substituted = await request(`/api/moderator/instances/regular/rooms/${bumperRoom.roomId}`);
    assert.equal(substituted.response.status, 404);
    const legacySubstitution = await request(`/api/moderator/instances/regular/rooms/${legacyRoom.roomId}`);
    assert.equal(legacySubstitution.response.status, 404);
    for (const foreignRoom of [bumperRoom, legacyRoom]) {
      for (const action of ["start", "pause", "resume", "end", "reset"]) {
        const denied = await request(`/api/moderator/instances/regular/rooms/${foreignRoom.roomId}/${action}`, { method: "POST", body: {} });
        assert.equal(denied.response.status, 404, `HTTP ${action} cannot target foreign room ${foreignRoom.roomId}`);
      }
      const deniedRemoval = await request(`/api/moderator/instances/regular/rooms/${foreignRoom.roomId}/players/${foreignRoom === bumperRoom ? bumperPlayer.playerId : legacyPlayer.playerId}`, { method: "DELETE", body: {} });
      assert.equal(deniedRemoval.response.status, 404, `HTTP removal cannot target foreign room ${foreignRoom.roomId}`);
      assert.equal(processStack.registry.get(foreignRoom.roomId).state, "WAITING", "denied foreign HTTP actions do not change room state");
    }
    const foreignPlayer = await request(`/api/moderator/instances/regular/players/${bumperPlayer.playerId}`);
    assert.equal(foreignPlayer.response.status, 404);
    const ownPlayer = await request(`/api/moderator/instances/regular/players/${regularPlayer.playerId}`);
    assert.equal(ownPlayer.response.status, 200);
    assert.ok(ownPlayer.data.player.memberships.every((membership) => [regularRoom.roomId, regularRoom2.roomId].includes(membership.roomId)));
    assert.equal((await request(`/api/moderator/instances/regular/players/${legacyPlayer.playerId}`)).response.status, 404);
    const report = await request("/api/moderator/instances/regular/reports/summary");
    assert.equal(report.response.status, 200);
    assert.ok(report.data.summary.every((row) => row.rooms <= 2));
    const foreignRemoval = await request(`/api/moderator/instances/regular/rooms/${regularRoom.roomId}/players/${bumperPlayer.playerId}`, { method: "DELETE", body: {} });
    assert.equal(foreignRemoval.response.status, 409);
    assert.ok(processStack.registry.get(bumperRoom.roomId).players.has(bumperPlayer.playerId));
    const legacyForeignRemoval = await request(`/api/moderator/instances/regular/rooms/${regularRoom.roomId}/players/${legacyPlayer.playerId}`, { method: "DELETE", body: {} });
    assert.equal(legacyForeignRemoval.response.status, 409);
    assert.ok(processStack.registry.get(legacyRoom.roomId).players.has(legacyPlayer.playerId));
    const otherRoomRemoval = await request(`/api/moderator/instances/regular/rooms/${regularRoom.roomId}/players/${regularPlayer2.playerId}`, { method: "DELETE", body: {} });
    assert.equal(otherRoomRemoval.response.status, 409, "a player ID from another room in the same instance is not a member of this room");
    assert.ok(processStack.registry.get(regularRoom2.roomId).players.has(regularPlayer2.playerId));

    const publicJoinSocket = connectSocket(origin, { transports: ["websocket"], forceNew: true, reconnection: false });
    await new Promise((resolve, reject) => { publicJoinSocket.once("connect", resolve); publicJoinSocket.once("connect_error", reject); });
    const publicJoin = (payload) => new Promise((resolve) => publicJoinSocket.emit("room:join", payload, resolve));
    const wrongPublicInstance = await publicJoin({ roomId: bumperRoom.roomId, name: "Wrong hall", instanceSlug: "regular" });
    assert.equal(wrongPublicInstance.code, "ROOM_NOT_FOUND");
    assert.equal((await io.in(bumperRoom.roomId).fetchSockets()).some((member) => member.id === publicJoinSocket.id), false);
    const rightPublicInstance = await publicJoin({ roomId: regularRoom2.roomId, name: "Right hall", instanceSlug: "regular" });
    assert.equal(rightPublicInstance.ok, true, JSON.stringify(rightPublicInstance));
    assert.equal((await io.in(regularRoom2.roomId).fetchSockets()).some((member) => member.id === publicJoinSocket.id), true);
    publicJoinSocket.disconnect();

    const setting = await request("/api/moderator/instances/regular/settings", { method: "PATCH", body: { description: "Regular managed by moderator" } });
    assert.equal(setting.response.status, 200);
    const settingsRow = await env.db.query("SELECT slug,display_name,description FROM game_instances WHERE instance_id='regular'");
    assert.equal(settingsRow.rows[0].slug, "regular");
    assert.equal(settingsRow.rows[0].display_name, "Regular Tambola");

    const playerSocket = connectSocket(origin, { transports: ["websocket"], forceNew: true, reconnection: false });
    await new Promise((resolve, reject) => { playerSocket.once("connect", resolve); playerSocket.once("connect_error", reject); });
    const playerEvent = (name, payload) => new Promise((resolve) => playerSocket.emit(name, payload, resolve));
    const resumed = await playerEvent("session:resume", { roomId: regularRoom.roomId, sessionToken: regularPlayer.sessionToken });
    assert.equal(resumed.ok, true);
    const sameRoomResume = await playerEvent("session:resume", { roomId: regularRoom.roomId, sessionToken: regularPlayer.sessionToken });
    assert.equal(sameRoomResume.ok, true, "the SPA may reverify a valid seat while changing routes on the same socket");
    const invalidSameRoomResume = await playerEvent("session:resume", { roomId: regularRoom.roomId, sessionToken: "0".repeat(48) });
    assert.equal(invalidSameRoomResume.code, "SESSION_UNKNOWN");
    assert.equal((await playerEvent("room:join", { roomId: bumperRoom.roomId, name: "Foreign Join" })).code, "ALREADY_IN_ROOM");
    assert.equal((await io.in(bumperRoom.roomId).fetchSockets()).some((member) => member.id === playerSocket.id), false);
    playerSocket.disconnect();

    const substitutedSocket = connectSocket(origin, { transports: ["websocket"], forceNew: true, reconnection: false });
    await new Promise((resolve, reject) => { substitutedSocket.once("connect", resolve); substitutedSocket.once("connect_error", reject); });
    const substitutedEvent = (name, payload) => new Promise((resolve) => substitutedSocket.emit(name, payload, resolve));
    assert.equal((await substitutedEvent("session:resume", { roomId: bumperRoom.roomId, sessionToken: regularPlayer.sessionToken })).code, "SESSION_INVALID");
    assert.equal((await io.in(bumperRoom.roomId).fetchSockets()).some((member) => member.id === substitutedSocket.id), false);
    substitutedSocket.disconnect();

    const session = await service.auth.verifySession({ token: cookieMap.get("tambola_moderator") });
    assert.ok(session);
    const tokenBeforePasswordChange = cookieMap.get("tambola_moderator");
    const socketTicketBeforePasswordChange = await service.auth.issueSocketTicket(session.sessionId);
    const wrongCurrentPassword = await request("/api/moderator/account/password", { method: "POST", body: { currentPassword: "Incorrect moderator password", newPassword: "Moderator account passphrase 2026 renewed!" } });
    assert.equal(wrongCurrentPassword.response.status, 401);
    assert.ok(await service.auth.verifySession({ token: tokenBeforePasswordChange }), "a refused password change leaves the current session active");
    const unchangedPassword = await request("/api/moderator/account/password", { method: "POST", body: { currentPassword: "New moderator passphrase 2026!", newPassword: "New moderator passphrase 2026!" } });
    assert.equal(unchangedPassword.response.status, 400);
    const missingPasswordCsrf = await request("/api/moderator/account/password", { method: "POST", body: { currentPassword: "New moderator passphrase 2026!", newPassword: "Moderator account passphrase 2026 renewed!" }, csrf: false });
    assert.equal(missingPasswordCsrf.response.status, 403, "password changes are CSRF protected");
    const passwordChange = await request("/api/moderator/account/password", { method: "POST", body: { currentPassword: "New moderator passphrase 2026!", newPassword: "Moderator account passphrase 2026 renewed!" } });
    assert.equal(passwordChange.response.status, 200);
    assert.equal(await service.auth.verifySession({ token: tokenBeforePasswordChange }), null, "password change revokes the previous session");
    assert.equal(await service.auth.consumeSocketTicket(socketTicketBeforePasswordChange), null, "password change invalidates outstanding socket tickets");
    const sessionAfterPasswordChange = await service.auth.verifySession({ token: cookieMap.get("tambola_moderator") });
    assert.ok(sessionAfterPasswordChange, "the current browser receives a replacement session");
    assert.equal((await service.auth.verifyCredentials({ username: "moderator.one", password: "New moderator passphrase 2026!" })).ok, false);
    assert.equal((await service.auth.verifyCredentials({ username: "moderator.one", password: "Moderator account passphrase 2026 renewed!" })).ok, true);
    const oldToken = cookieMap.get("tambola_moderator");
    const rotate = await request("/api/moderator/session/rotate", { method: "POST", body: {} });
    assert.equal(rotate.response.status, 200);
    assert.equal(await service.auth.verifySession({ token: oldToken }), null);
    const sessionAfterRotate = await service.auth.verifySession({ token: cookieMap.get("tambola_moderator") });
    const socketTicket = await service.auth.issueSocketTicket(sessionAfterRotate.sessionId);
    const socket = connectSocket(origin, { auth: { moderatorTicket: socketTicket }, transports: ["websocket"], forceNew: true, reconnection: false });
    await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("connect_error", reject); });
    assert.equal(await service.auth.consumeSocketTicket(socketTicket), null, "a consumed moderator socket ticket cannot be replayed");
    const expiredTicket = await service.auth.issueSocketTicket(sessionAfterRotate.sessionId);
    const expiredDigest = createHash("sha256").update(expiredTicket).digest("hex");
    await env.db.query("UPDATE moderator_socket_tickets SET expires_at=now()-interval '1 second' WHERE token_hash=$1", [expiredDigest]);
    assert.equal(await service.auth.consumeSocketTicket(expiredTicket), null, "an expired moderator socket ticket cannot be reused");
    const event = (name, payload) => new Promise((resolve) => socket.emit(name, payload, resolve));
    assert.equal((await event("game:start", {})).code, "NOT_ALLOWED", "moderator socket cannot become a host socket");
    for (const foreignRoom of [bumperRoom, legacyRoom]) {
      for (const action of ["start", "pause", "resume", "end", "reset"]) {
        const denied = await event(`moderator:room:${action}`, { roomId: foreignRoom.roomId });
        assert.equal(denied.ok, false, `${action} cannot target ${foreignRoom.roomId} without that instance grant`);
      }
      assert.equal(processStack.registry.get(foreignRoom.roomId).state, "WAITING", "denied foreign socket actions do not change room state");
    }
    const unknownSocketRoomId = "ZZZZZZZZ";
    for (const action of ["start", "pause", "resume", "end", "reset"]) {
      const denied = await event(`moderator:room:${action}`, { roomId: unknownSocketRoomId });
      assert.equal(denied.code, "NOT_ALLOWED", `${action} on an unknown but well-formed room ID fails closed without an internal error`);
    }
    const malformedSocketPayloads = [null, "ZZZZZZZZ", [], { roomId: 17 }, { roomId: "ZZZZZZZZ!" }, { roomId: "A".repeat(5000) }];
    for (const action of ["start", "pause", "resume", "end", "reset"]) {
      for (const payload of malformedSocketPayloads) {
        const denied = await event(`moderator:room:${action}`, payload);
        assert.equal(denied.code, "BAD_PAYLOAD", `${action} rejects malformed moderator socket payload ${JSON.stringify(payload).slice(0, 50)}`);
      }
    }
    const unknownSocketAudit = await env.db.query(`SELECT room_code,metadata FROM platform_audit
      WHERE actor=$1 AND action LIKE 'moderator.socket.room.%' AND result='failure'`, [session.username]);
    assert.equal(unknownSocketAudit.rows.filter((row) => row.metadata.requestedRoomId === unknownSocketRoomId && row.room_code === null).length, 5,
      "unknown socket room IDs are audited without violating the room foreign key");
    assert.equal((await event("moderator:room:start", { roomId: regularRoom.roomId })).ok, true);
    const members = await io.in(regularRoom.roomId).fetchSockets();
    assert.equal(members.some((member) => member.id === socket.id), false, "moderator is not subscribed to game broadcasts");
    assert.equal((await event("moderator:room:pause", { roomId: regularRoom.roomId })).ok, true);
    const removed = await request(`/api/moderator/instances/regular/rooms/${regularRoom.roomId}/players/${regularPlayer.playerId}`, { method: "DELETE", body: {} });
    assert.equal(removed.response.status, 200);
    const historicalMember = await env.db.query("SELECT left_at FROM room_members WHERE room_code=$1 AND player_id=$2", [regularRoom.roomId, regularPlayer.playerId]);
    assert.ok(historicalMember.rows[0].left_at, "moderator removal preserves the membership history");
    await env.db.query("UPDATE moderator_instance_grants SET revoked_at=now() WHERE moderator_id=$1 AND instance_id='regular'", [mod]);
    assert.equal((await request("/api/moderator/instances/regular/rooms")).response.status, 404, "live HTTP session loses a revoked grant immediately");
    assert.equal((await event("moderator:room:resume", { roomId: regularRoom.roomId })).ok, false, "grant revocation blocks the next active socket event");
    socket.disconnect();

    const audit = await env.db.query("INSERT INTO platform_audit(actor,actor_role,action,result) VALUES('test','system','moderator.test','success') RETURNING event_id");
    await assert.rejects(env.db.query("UPDATE platform_audit SET action='changed' WHERE event_id=$1", [audit.rows[0].event_id]), /append-only/);
    await assert.rejects(env.db.query("DELETE FROM platform_audit WHERE event_id=$1", [audit.rows[0].event_id]), /append-only/);
  } finally {
    await new Promise((resolve) => io.close(resolve));
  }
});
