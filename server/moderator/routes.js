import express from "express";
import { createHash } from "node:crypto";
import { createModeratorAuth } from "./auth.js";
import { authorizeInstance, authorizeRoom } from "./authorization.js";
import { clearModeratorCookie, ensureCsrf, MODERATOR_COOKIE, readCookie, setModeratorCookie, verifyModeratorCsrf } from "./cookies.js";
import { decryptSecret, encryptSecret, verifyCode } from "../admin/mfa.js";
import { createBookingService } from "../bookings/service.js";
import { isSafePathIdentifier, isUuid } from "../identifiers.js";

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const safeUser = (value) => typeof value === "string" && /^[a-z0-9._-]{3,40}$/i.test(value.trim()) ? value.trim().toLowerCase() : null;
const safeRoomName = (value) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= 40 ? value.trim() : "Moderator room";

export function createModeratorRouter({ db, controller, registry, queries, throttle, mfaKey = null, log = () => {} } = {}) {
  if (!db) throw new Error("moderator authentication requires PostgreSQL");
  const router = express.Router();
  const auth = createModeratorAuth({ db, mfaKey });
  const bookings = createBookingService({ db });
  router.use(express.json({ limit: "16kb" }));
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options", "nosniff"); next(); });
  router.use((req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    if (!verifyModeratorCsrf(req)) return res.status(403).json({ ok: false, code: "CSRF_FAILED", error: "missing or invalid CSRF token" });
    next();
  });

  const ipHash = (req) => createHash("sha256").update(`${req.ip || ""}|moderator-auth`).digest("hex").slice(0, 24);
  async function audit(req, actor, action, result, instanceId = null, roomId = null, metadata = {}) {
    // Denied routes can contain arbitrary instance/room IDs. Keep the attempt
    // in append-only history without letting invalid foreign-key references
    // turn the intended 404 denial into an internal error.
    const safeAuditIdentifier = (value) => isSafePathIdentifier(value) ? value : null;
    await db.query(`INSERT INTO platform_audit(actor,actor_role,instance_id,room_code,action,result,metadata,request_id)
      VALUES($1,$2,
        (SELECT instance_id FROM game_instances WHERE instance_id=$3),
        (SELECT room_code FROM rooms WHERE room_code=$4),
        $5,$6,$7,$8)`, [actor || "system", actor ? "moderator" : "system", safeAuditIdentifier(instanceId), safeAuditIdentifier(roomId), action, result, JSON.stringify(metadata), req.id || null]);
  }
  const boundedPathId = (value) => typeof value === "string"
    ? value.slice(0, 80).replace(/[\u0000-\u001f\u007f]/g, "\ufffd")
    : null;
  async function resolve(req) {
    const token = readCookie(req, MODERATOR_COOKIE);
    const session = await auth.verifySession({ token });
    if (!session) return null;
    req.moderator = session;
    return session;
  }
  async function requireSession(req, res, { mfa = false } = {}) {
    const session = await resolve(req);
    if (!session) { clearModeratorCookie(res); res.status(401).json({ ok: false, code: "UNAUTHENTICATED", error: "moderator sign-in required" }); return null; }
    if (mfa && !session.mfaEnrolled) { res.status(403).json({ ok: false, code: "MFA_REQUIRED", error: "complete moderator MFA enrollment before using instance grants" }); return null; }
    return session;
  }
  async function gateInstance(req, res, permission, { mfa = true } = {}) {
    const session = await requireSession(req, res, { mfa });
    if (!session) return null;
    const result = await authorizeInstance({ db, moderatorId: session.moderatorId, instanceId: req.params.instanceId, permission });
    if (!result.ok) {
      await audit(req, session.username, `authz.${permission}`, "failure", req.params.instanceId, null, {
        code: result.code, requestedInstanceId: boundedPathId(req.params.instanceId),
      });
      res.status(result.code === "LIFECYCLE" ? 409 : 404).json({ ok: false, code: result.code === "LIFECYCLE" ? "INSTANCE_UNAVAILABLE" : "NOT_FOUND", error: result.code === "LIFECYCLE" ? "instance lifecycle does not allow this operation" : "instance not found or access denied" });
      return null;
    }
    return { session, ...result };
  }
  async function gateRoom(req, res, permission, { mfa = true } = {}) {
    const session = await requireSession(req, res, { mfa });
    if (!session) return null;
    const result = await authorizeRoom({ db, moderatorId: session.moderatorId, roomId: req.params.roomId, instanceId: req.params.instanceId, permission });
    if (!result.ok) {
      await audit(req, session.username, `authz.${permission}`, "failure", req.params.instanceId || null, req.params.roomId, {
        code: result.code, requestedInstanceId: boundedPathId(req.params.instanceId), requestedRoomId: boundedPathId(req.params.roomId),
      });
      res.status(result.code === "LIFECYCLE" ? 409 : 404).json({ ok: false, code: result.code === "LIFECYCLE" ? "ROOM_UNAVAILABLE" : "NOT_FOUND", error: result.code === "LIFECYCLE" ? "room or instance lifecycle does not allow this operation" : "room not found or access denied" });
      return null;
    }
    return { session, ...result };
  }

  router.get("/session", wrap(async (req, res) => {
    const csrfToken = ensureCsrf(req, res);
    const session = await resolve(req);
    res.json({ ok: true, authenticated: Boolean(session), moderator: session ? { username: session.username, mfaEnrolled: session.mfaEnrolled } : null, csrfToken });
  }));

  router.post("/invite/accept", wrap(async (req, res) => {
    const { token, password } = req.body || {};
    if (typeof password !== "string" || password.length < 12 || password.length > 200) return res.status(400).json({ ok: false, code: "INVALID_INPUT", error: "choose a password between 12 and 200 characters" });
    const accepted = await auth.acceptInvite({ token, password });
    if (!accepted.ok) {
      await audit(req, null, "moderator.invite.accept", "failure");
      return res.status(400).json({ ok: false, code: "INVITE_INVALID", error: "invitation is invalid, expired, or already used" });
    }
    await audit(req, null, "moderator.invite.accepted", "success", null, null, { moderatorId: accepted.moderatorId });
    res.json({ ok: true });
  }));

  router.post("/recovery/complete", wrap(async (req, res) => {
    const { recoveryToken, password } = req.body || {};
    if (typeof password !== "string" || password.length < 12 || password.length > 200) return res.status(400).json({ ok: false, code: "INVALID_INPUT", error: "choose a password between 12 and 200 characters" });
    const ip = ipHash(req);
    const limiter = throttle?.signinIp;
    const key = `moderator-recovery:${ip}`;
    if (limiter) {
      const state = await limiter.check({ key });
      if (!state.allowed) return res.status(429).json({ ok: false, code: "RATE_LIMITED", error: "too many recovery attempts" });
    }
    const recovered = await auth.completeRecovery({ token: recoveryToken, password });
    if (!recovered.ok) {
      if (limiter) await limiter.recordFailure({ key });
      await audit(req, null, "moderator.recovery.complete", "failure");
      return res.status(400).json({ ok: false, code: "RECOVERY_INVALID", error: "recovery token is invalid, expired, or already used" });
    }
    if (limiter) await limiter.recordSuccess({ key });
    await audit(req, null, "moderator.recovery.complete", "success", null, null, { moderatorId: recovered.moderatorId, mfaResetRequired: true });
    res.json({ ok: true, mfaEnrollmentRequired: true });
  }));

  router.post("/signin", wrap(async (req, res) => {
    const username = safeUser(req.body?.username);
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!username || password.length < 8 || password.length > 200) return res.status(400).json({ ok: false, code: "INVALID_INPUT", error: "username and password are required" });
    const ip = ipHash(req);
    const key = `${username}|${ip}`;
    const limiter = throttle?.signin;
    const ipLimiter = throttle?.signinIp;
    if (limiter || ipLimiter) {
      const state = limiter ? await limiter.check({ key: `moderator:${key}` }) : null;
      const ipState = ipLimiter ? await ipLimiter.check({ key: `moderator:${ip}` }) : null;
      if ((state && !state.allowed) || (ipState && !ipState.allowed)) return res.status(429).json({ ok: false, code: "RATE_LIMITED", error: "too many sign-in attempts" });
    }
    const verified = await auth.verifyCredentials({ username, password });
    if (!verified.ok) {
      if (limiter) await limiter.recordFailure({ key: `moderator:${key}` });
      if (ipLimiter) await ipLimiter.recordFailure({ key: `moderator:${ip}` });
      await audit(req, null, "moderator.signin", "failure", null, null, { username });
      return res.status(401).json({ ok: false, code: "INVALID_CREDENTIALS", error: "username or password is not valid" });
    }
    if (limiter) await limiter.recordSuccess({ key: `moderator:${key}` });
    if (ipLimiter) await ipLimiter.recordSuccess({ key: `moderator:${ip}` });
    await audit(req, verified.username, "moderator.signin.password", "success");
    if (verified.mfaEnrolled) {
      const challenge = await auth.createChallenge(verified.moderatorId, ip);
      return res.json({ ok: true, mfaRequired: true, ...challenge });
    }
    const created = await auth.issueSession(verified.moderatorId);
    setModeratorCookie(res, created.token);
    res.json({ ok: true, authenticated: true, mfaRequired: false, csrfToken: ensureCsrf(req, res) });
  }));

  router.post("/signin/mfa", wrap(async (req, res) => {
    const ip = ipHash(req);
    const mfaLimiter = throttle?.mfa;
    if (mfaLimiter) {
      const state = await mfaLimiter.check({ key: `moderator:${ip}` });
      if (!state.allowed) return res.status(429).json({ ok: false, code: "RATE_LIMITED", error: "too many authenticator attempts" });
    }
    const valid = await auth.verifyChallenge({ token: req.body?.challengeToken, code: req.body?.code, ipHash: ip });
    if (!valid) {
      if (mfaLimiter) await mfaLimiter.recordFailure({ key: `moderator:${ip}` });
      await audit(req, null, "moderator.signin.mfa", "failure");
      return res.status(401).json({ ok: false, code: "MFA_INVALID", error: "sign-in challenge or authenticator code is invalid" });
    }
    if (mfaLimiter) await mfaLimiter.recordSuccess({ key: `moderator:${ip}` });
    const created = await auth.issueSession(valid.moderatorId);
    setModeratorCookie(res, created.token);
    await audit(req, valid.username, "moderator.signin.mfa", "success");
    res.json({ ok: true, authenticated: true, mfaRequired: false, csrfToken: ensureCsrf(req, res) });
  }));

  router.post("/signout", wrap(async (req, res) => {
    const session = await requireSession(req, res, { mfa: false });
    if (!session) return;
    await auth.revokeSession(session.sessionId);
    await audit(req, session.username, "moderator.signout", "success");
    clearModeratorCookie(res);
    res.json({ ok: true });
  }));

  router.post("/session/rotate", wrap(async (req, res) => {
    const session = await requireSession(req, res, { mfa: true });
    if (!session) return;
    await auth.revokeSession(session.sessionId, "rotated");
    const created = await auth.issueSession(session.moderatorId);
    setModeratorCookie(res, created.token);
    await audit(req, session.username, "moderator.session.rotate", "success");
    res.json({ ok: true });
  }));

  router.post("/account/password", wrap(async (req, res) => {
    const session = await requireSession(req, res, { mfa: true });
    if (!session) return;
    const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
    const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
    if (currentPassword.length < 8 || currentPassword.length > 200 || newPassword.length < 12 || newPassword.length > 200) {
      return res.status(400).json({ ok: false, code: "INVALID_INPUT", error: "enter your current password and choose a new password between 12 and 200 characters" });
    }
    const limiter = throttle?.credentialChange;
    const key = `moderator-password:${session.sessionId}`;
    if (limiter) {
      const state = await limiter.check({ key });
      if (!state.allowed) return res.status(429).json({ ok: false, code: "RATE_LIMITED", error: "too many password-change attempts" });
    }
    const changed = await auth.changePassword({ moderatorId: session.moderatorId, sessionId: session.sessionId, currentPassword, newPassword });
    if (!changed.ok) {
      if (limiter) await limiter.recordFailure({ key });
      await audit(req, session.username, "moderator.password.change", "failure", null, null, { code: changed.code });
      if (changed.code === "PASSWORD_UNCHANGED") return res.status(400).json({ ok: false, code: changed.code, error: "choose a password different from your current password" });
      if (changed.code === "MFA_REQUIRED") return res.status(403).json({ ok: false, code: changed.code, error: "enroll an authenticator before changing account security settings" });
      if (changed.code === "SESSION_INVALID" || changed.code === "ACCOUNT_INACTIVE") return res.status(401).json({ ok: false, code: "UNAUTHENTICATED", error: "moderator sign-in required" });
      return res.status(401).json({ ok: false, code: "INVALID_CREDENTIALS", error: "current password is not valid" });
    }
    if (limiter) await limiter.recordSuccess({ key });
    setModeratorCookie(res, changed.token);
    await audit(req, session.username, "moderator.password.change", "success");
    res.json({ ok: true, csrfToken: ensureCsrf(req, res) });
  }));

  router.get("/me", wrap(async (req, res) => {
    const session = await requireSession(req, res, { mfa: false });
    if (!session) return;
    const rows = await db.query(`SELECT i.instance_id,i.slug,i.display_name,i.status,g.permissions
      FROM moderator_instance_grants g JOIN game_instances i USING(instance_id)
      WHERE g.moderator_id=$1 AND g.revoked_at IS NULL ORDER BY i.display_name`, [session.moderatorId]);
    res.json({ ok: true, moderator: { username: session.username, mfaEnrolled: session.mfaEnrolled }, instances: rows.rows });
  }));

  router.post("/security/mfa/enroll", wrap(async (req, res) => {
    const session = await requireSession(req, res, { mfa: false });
    if (!session) return;
    const result = await auth.beginMfa(session.moderatorId);
    if (!result.ok) return res.status(409).json({ ok: false, code: result.code, error: result.code === "MFA_UNAVAILABLE" ? "server MFA key is not configured" : "MFA enrollment cannot be started" });
    await audit(req, session.username, "moderator.mfa.enroll.start", "success");
    res.json({ ok: true, secret: result.secret, uri: result.uri });
  }));

  router.post("/security/mfa/confirm", wrap(async (req, res) => {
    const session = await requireSession(req, res, { mfa: false });
    if (!session) return;
    const mfaLimiter = throttle?.mfa;
    const key = `moderator-enroll:${session.moderatorId}`;
    if (mfaLimiter) {
      const state = await mfaLimiter.check({ key });
      if (!state.allowed) return res.status(429).json({ ok: false, code: "RATE_LIMITED", error: "too many authenticator attempts" });
    }
    const result = await auth.confirmMfa(session.moderatorId, req.body?.code);
    if (!result.ok) {
      if (mfaLimiter) await mfaLimiter.recordFailure({ key });
      await audit(req, session.username, "moderator.mfa.enroll.confirm", "failure", null, null, { code: result.code });
      return res.status(401).json({ ok: false, code: result.code, error: "authenticator code did not verify" });
    }
    if (mfaLimiter) await mfaLimiter.recordSuccess({ key });
    await audit(req, session.username, "moderator.mfa.enroll.confirm", "success");
    res.json({ ok: true, mfaEnrolled: true });
  }));

  router.get("/socket-ticket", wrap(async (req, res) => {
    const session = await requireSession(req, res, { mfa: true });
    if (!session) return;
    const token = await auth.issueSocketTicket(session.sessionId);
    res.json({ ok: true, token, expiresInSeconds: 90 });
  }));

  router.get("/instances", wrap(async (req, res) => {
    const session = await requireSession(req, res, { mfa: true });
    if (!session) return;
    const result = await db.query(`SELECT i.instance_id,i.slug,i.display_name,i.description,i.status,i.branding,g.permissions
      FROM moderator_instance_grants g JOIN game_instances i USING(instance_id)
      WHERE g.moderator_id=$1 AND g.revoked_at IS NULL ORDER BY i.display_name`, [session.moderatorId]);
    res.json({ ok: true, instances: result.rows });
  }));

  router.get("/instances/:instanceId/rooms", wrap(async (req, res) => {
    const access = await gateInstance(req, res, "room.read"); if (!access) return;
    const result = await db.query(`SELECT r.room_code,r.status,r.game_number,r.config->>'name' AS name,r.created_at,r.updated_at,r.closed_at,
      (SELECT count(*) FROM room_members m WHERE m.room_code=r.room_code AND m.left_at IS NULL)::int AS players
      FROM rooms r WHERE r.game_instance_id=$1 ORDER BY r.updated_at DESC LIMIT 200`, [access.instanceId]);
    res.json({ ok: true, rooms: result.rows });
  }));

  router.get("/instances/:instanceId/bookings", wrap(async (req, res) => {
    const access = await gateInstance(req, res, "bookings.read"); if (!access) return;
    const query = req.query || {};
    for (const key of ["sessionId", "status", "search"]) {
      if (Object.hasOwn(query, key) && typeof query[key] !== "string") {
        return res.status(400).json({ ok: false, code: "INVALID_INPUT", error: `${key} must be a single value` });
      }
    }
    const sessionId = typeof query.sessionId === "string" ? query.sessionId : null;
    if (sessionId && !isUuid(sessionId)) return res.status(400).json({ ok: false, code: "INVALID_INPUT", error: "session id is invalid" });
    const status = typeof query.status === "string" ? query.status : null;
    if (status && !["held", "confirmed", "cancelled", "expired"].includes(status)) {
      return res.status(400).json({ ok: false, code: "INVALID_INPUT", error: "booking status is invalid" });
    }
    const reservations = await bookings.listAdminReservations(access.instanceId, {
      sessionId, status, search: typeof query.search === "string" ? query.search : "",
    });
    await audit(req, access.session.username, "moderator.bookings.read", "success", access.instanceId, null, { count: reservations?.length || 0 });
    res.json({ ok: true, reservations });
  }));

  router.get("/instances/:instanceId/bookings/sessions", wrap(async (req, res) => {
    const access = await gateInstance(req, res, "bookings.assign"); if (!access) return;
    const sessions = await bookings.listAdminSessions(access.instanceId);
    const visibleSessions = access.permissions.includes("room.read")
      ? sessions
      : (sessions || []).map((session) => ({ ...session, roomCode: null }));
    await audit(req, access.session.username, "moderator.booking.sessions.read", "success", access.instanceId, null, { count: visibleSessions?.length || 0 });
    res.json({ ok: true, sessions: visibleSessions });
  }));

  router.put("/instances/:instanceId/bookings/sessions/:sessionId/room", wrap(async (req, res) => {
    const access = await gateInstance(req, res, "bookings.assign"); if (!access) return;
    const requestedRoomId = typeof req.body?.roomCode === "string" ? req.body.roomCode.trim().toUpperCase() : "";
    if (!isUuid(req.params.sessionId) || !/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6,12}$/.test(requestedRoomId)) {
      return res.status(400).json({ ok: false, code: "INVALID_INPUT", error: "session and room identifiers are invalid" });
    }
    if (!access.permissions.includes("room.read")) {
      await audit(req, access.session.username, "moderator.booking.assign_room", "failure", access.instanceId, null, { code: "ROOM_READ_REQUIRED", requestedRoomId });
      return res.status(403).json({ ok: false, code: "ROOM_READ_REQUIRED", error: "room read permission is required to assign a session" });
    }
    const result = await bookings.assignSessionRoom({ instanceId: access.instanceId, sessionId: req.params.sessionId, roomCode: requestedRoomId, actor: access.session.username });
    if (result.error) {
      await audit(req, access.session.username, "moderator.booking.assign_room", "failure", access.instanceId, null, { code: result.error, sessionId: req.params.sessionId, requestedRoomId });
      const status = result.error === "SESSION_NOT_FOUND" ? 404 : 409;
      return res.status(status).json({ ok: false, code: result.error, error: result.error === "SESSION_ROOM_INVALID" ? "choose a waiting room from this instance" : "session cannot be assigned in its current state" });
    }
    await audit(req, access.session.username, "moderator.booking.assign_room", "success", access.instanceId, result.roomCode, { sessionId: result.sessionId, alreadyAssigned: result.alreadyAssigned });
    res.json({ ok: true, sessionId: result.sessionId, roomCode: result.roomCode, alreadyAssigned: result.alreadyAssigned });
  }));

  router.get("/instances/:instanceId/bookings/:reservationId", wrap(async (req, res) => {
    const access = await gateInstance(req, res, "bookings.read"); if (!access) return;
    if (!isUuid(req.params.reservationId)) return res.status(404).json({ ok: false, code: "NOT_FOUND", error: "booking not found or access denied" });
    const reservation = await bookings.getAdminReservation(access.instanceId, req.params.reservationId);
    if (!reservation) return res.status(404).json({ ok: false, code: "NOT_FOUND", error: "booking not found or access denied" });
    const permissions = access.permissions || [];
    if (!permissions.includes("room.read")) {
      reservation.assignedRoomCode = null;
      reservation.sessionRoomCode = null;
    }
    await audit(req, access.session.username, "moderator.booking.read", "success", access.instanceId, reservation.assignedRoomCode, { reservationId: reservation.reservationId });
    res.json({ ok: true, reservation });
  }));

  router.post("/instances/:instanceId/bookings/:reservationId/cancel", wrap(async (req, res) => {
    const access = await gateInstance(req, res, "bookings.manage"); if (!access) return;
    if (!isUuid(req.params.reservationId)) return res.status(404).json({ ok: false, code: "NOT_FOUND", error: "booking not found or access denied" });
    const result = await bookings.cancelByOperator({ instanceId: access.instanceId, reservationId: req.params.reservationId, actorType: "moderator", actorLabel: access.session.username });
    if (result.error) {
      await audit(req, access.session.username, "moderator.booking.cancel", "failure", access.instanceId, null, { code: result.error });
      const status = result.error === "RESERVATION_NOT_FOUND" ? 404 : result.error === "RESERVATION_EXPIRED" ? 410 : 409;
      return res.status(status).json({ ok: false, code: result.error, error: result.error === "RESERVATION_ASSIGNED" ? "assigned bookings cannot be cancelled" : "booking cannot be cancelled in its current state" });
    }
    await audit(req, access.session.username, "moderator.booking.cancel", "success", access.instanceId, null, { reservationId: req.params.reservationId });
    res.json({ ok: true, reservation: result.reservation });
  }));

  router.patch("/instances/:instanceId/settings", wrap(async (req, res) => {
    const access = await gateInstance(req, res, "instance.settings.update"); if (!access) return;
    const description = req.body?.description;
    if (typeof description !== "string" || description.trim().length > 500) return res.status(400).json({ ok: false, code: "INVALID_INPUT", error: "description must be a string of at most 500 characters" });
    const updated = await db.query(`UPDATE game_instances SET description=$2,updated_by=$3
      WHERE instance_id=$1 RETURNING instance_id,description`, [access.instanceId, description.trim(), access.session.username]);
    await audit(req, access.session.username, "moderator.instance.description.update", "success", access.instanceId);
    res.json({ ok: true, instance: updated.rows[0] });
  }));

  router.post("/instances/:instanceId/rooms", wrap(async (req, res) => {
    const access = await gateInstance(req, res, "room.create"); if (!access) return;
    if (access.instanceStatus !== "active") return res.status(409).json({ ok: false, code: "INSTANCE_UNAVAILABLE", error: "instance is not active" });
    const created = await controller.createManagedRoom({ hostName: "Moderator", instanceId: access.instanceId, overrides: { name: safeRoomName(req.body?.name) } });
    if (!created.ok) return res.status(409).json({ ok: false, code: created.code, error: created.error || "room creation failed" });
    await audit(req, access.session.username, "moderator.room.create", "success", access.instanceId, created.roomId);
    res.status(201).json({ ok: true, roomId: created.roomId });
  }));

  router.get("/instances/:instanceId/rooms/:roomId", wrap(async (req, res) => {
    const access = await gateRoom(req, res, "room.read"); if (!access) return;
    const room = await queries.roomDetail(req.params.roomId);
    if (!room) return res.status(404).json({ ok: false, code: "NOT_FOUND", error: "room not found or access denied" });
    const permissions = access.permissions || (await authorizeInstance({ db, moderatorId: access.session.moderatorId, instanceId: access.instanceId, permission: "room.read" })).permissions || [];
    if (!permissions.includes("players.read")) room.members = [];
    if (!permissions.includes("tickets.manage")) room.tickets = [];
    if (!permissions.includes("history.read")) { room.calledNumbers = []; room.claims = []; room.awards = []; room.rounds = []; room.gameAudit = []; }
    res.json({ ok: true, room });
  }));

  router.get("/instances/:instanceId/players", wrap(async (req, res) => {
    const access = await gateInstance(req, res, "players.read"); if (!access) return;
    const result = await db.query(`SELECT DISTINCT p.player_id,p.display_name,p.created_at
      FROM players p JOIN room_members m USING(player_id) JOIN rooms r USING(room_code)
      WHERE r.game_instance_id=$1 ORDER BY p.created_at DESC LIMIT 500`, [access.instanceId]);
    res.json({ ok: true, players: result.rows });
  }));

  router.get("/instances/:instanceId/players/:playerId", wrap(async (req, res) => {
    const access = await gateInstance(req, res, "players.read"); if (!access) return;
    if (!isSafePathIdentifier(req.params.playerId)) return res.status(404).json({ ok: false, code: "NOT_FOUND", error: "player not found or access denied" });
    const result = await db.query(`SELECT p.player_id,p.display_name,p.created_at,
        jsonb_agg(jsonb_build_object('roomId',r.room_code,'status',CASE WHEN m.left_at IS NULL THEN 'active' ELSE 'left' END,'joinedAt',m.joined_at,'leftAt',m.left_at)
          ORDER BY m.joined_at DESC) AS memberships
      FROM players p JOIN room_members m USING(player_id) JOIN rooms r USING(room_code)
      WHERE p.player_id=$1 AND r.game_instance_id=$2
      GROUP BY p.player_id`, [req.params.playerId, access.instanceId]);
    if (!result.rowCount) return res.status(404).json({ ok: false, code: "NOT_FOUND", error: "player not found or access denied" });
    res.json({ ok: true, player: result.rows[0] });
  }));

  router.delete("/instances/:instanceId/rooms/:roomId/players/:playerId", wrap(async (req, res) => {
    const access = await gateRoom(req, res, "players.manage"); if (!access) return;
    if (!isSafePathIdentifier(req.params.playerId)) return res.status(404).json({ ok: false, code: "NOT_FOUND", error: "room or player not found" });
    const ensured = await controller.ensureRoom({ roomId: req.params.roomId });
    if (!ensured.ok) return res.status(404).json({ ok: false, code: "NOT_FOUND", error: "room or player not found" });
    const room = ensured.room || registry.get(req.params.roomId);
    if (!room || room.state === "COMPLETED" || room.state === "CLOSED") return res.status(409).json({ ok: false, code: "ROOM_UNAVAILABLE", error: "players can only be removed from a live room" });
    const result = await controller.removeParticipant({ room, playerId: req.params.playerId, reason: "moderator-removed" });
    if (!result.ok) return res.status(409).json({ ok: false, code: result.code, error: result.error || "player could not be removed" });
    await audit(req, access.session.username, "moderator.player.remove", "success", access.instanceId, req.params.roomId, { playerId: req.params.playerId });
    res.json({ ok: true, removed: true });
  }));

  router.get("/instances/:instanceId/history", wrap(async (req, res) => {
    const access = await gateInstance(req, res, "history.read"); if (!access) return;
    const result = await db.query(`SELECT r.room_code,r.status,r.game_number,r.created_at,r.closed_at,
      count(DISTINCT g.game_number)::int AS rounds,count(DISTINCT a.award_id)::int AS awards
      FROM rooms r LEFT JOIN games g USING(room_code) LEFT JOIN awards a USING(room_code)
      WHERE r.game_instance_id=$1 GROUP BY r.room_code ORDER BY r.created_at DESC LIMIT 500`, [access.instanceId]);
    res.json({ ok: true, history: result.rows });
  }));

  router.get("/instances/:instanceId/reports/summary", wrap(async (req, res) => {
    const access = await gateInstance(req, res, "reports.read"); if (!access) return;
    const result = await db.query(`SELECT r.status,count(DISTINCT r.room_code)::int AS rooms,
        count(DISTINCT g.game_number)::int AS games,count(DISTINCT m.player_id)::int AS players,
        count(DISTINCT a.award_id)::int AS awards
      FROM rooms r LEFT JOIN games g USING(room_code) LEFT JOIN room_members m USING(room_code)
      LEFT JOIN awards a USING(room_code)
      WHERE r.game_instance_id=$1 GROUP BY r.status ORDER BY r.status`, [access.instanceId]);
    res.json({ ok: true, instanceId: access.instanceId, summary: result.rows });
  }));

  const actions = { start: "room.start", pause: "room.pause", resume: "room.pause", end: "room.end", reset: "room.reset" };
  for (const [action, permission] of Object.entries(actions)) {
    router.post(`/instances/:instanceId/rooms/:roomId/${action}`, wrap(async (req, res) => {
      const access = await gateRoom(req, res, permission); if (!access) return;
      if (action === "start" && access.instanceStatus !== "active") return res.status(409).json({ ok: false, code: "INSTANCE_UNAVAILABLE", error: "instance is not active" });
      const ensured = await controller.ensureRoom({ roomId: req.params.roomId });
      if (!ensured.ok) return res.status(409).json({ ok: false, code: ensured.code, error: ensured.error });
      const room = ensured.room || registry.get(req.params.roomId);
      if (!room) return res.status(404).json({ ok: false, code: "NOT_FOUND", error: "room not found or access denied" });
      const authz = { hostToken: room.hostCredential() };
      const result = action === "start" ? await controller.start({ room, auth: authz }) : await controller.transition({ room, action, auth: authz });
      if (!result.ok) return res.status(409).json({ ok: false, code: result.code, error: result.error || "room operation failed" });
      await audit(req, access.session.username, `moderator.room.${action}`, "success", access.instanceId, room.roomId);
      res.json({ ok: true, state: room.state });
    }));
  }

  router.use((error, _req, res, _next) => {
    log("moderator API error", error && error.message);
    if (res.headersSent) return;
    res.status(500).json({ ok: false, code: "INTERNAL", error: "the moderator service could not complete that request" });
  });

  return { router, auth };
}
