import express from "express";
import { createHash } from "node:crypto";
import { readOwnerToken, verifyCsrf } from "../admin/cookies.js";
import { createBookingService } from "./service.js";
import { isUuid } from "../identifiers.js";
import { PATTERNS } from "../game/patterns.js";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOKEN_RE = /^[a-f0-9]{64}$/;
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function statusFor(error) {
  switch (error) {
    case "INVALID_TITLE": case "INVALID_SCHEDULE": case "INVALID_SCHEDULE_TIME": case "BOOKING_OPENS_NOT_BEFORE_CLOSES": case "BOOKING_CLOSES_NOT_BEFORE_START": case "INVALID_ROOM_CODE": case "INVALID_CAPACITY": case "INVALID_HOLD_DURATION": case "INVALID_TIME_ZONE": case "INVALID_NAME": case "INVALID_PHONE": case "INVALID_TICKET_COUNT": case "INVALID_INPUT": case "INVALID_INVENTORY_MODE": case "INVALID_INVENTORY_COUNT": case "INVALID_IDEMPOTENCY_KEY": case "INVALID_TICKET_SELECTION": case "INVALID_BOOKING_MODE": case "INVALID_AUTO_START": case "AUTO_START_ROOM_REQUIRED": case "INVALID_WINNING_PATTERNS": return 400;
    case "INSTANCE_NOT_FOUND": case "SESSION_NOT_FOUND": case "SESSION_UNAVAILABLE": case "RESERVATION_NOT_FOUND": return 404;
    case "INSTANCE_NOT_ACTIVE": case "SESSION_NOT_ACTIVE": case "SESSION_NOT_OPENABLE": case "SESSION_ROOM_INVALID": case "SESSION_HAS_ASSIGNED_RESERVATIONS": case "RESERVATION_TICKET_LIMIT": case "TICKET_LIMIT": case "CAPACITY_FULL": case "CAPACITY_BELOW_BOOKED": case "INVALID_TRANSITION": case "INVALID_RESERVATION_STATE": case "BOOKING_CLOSED": case "CANCELLATION_CLOSED": case "RESERVATION_ASSIGNED": case "INVENTORY_NOT_READY": case "INVENTORY_COUNT_MISMATCH": case "INVENTORY_ALREADY_GENERATED": case "INVENTORY_STATE_INVALID": case "INVENTORY_CAPACITY_LOCKED": case "LEGACY_SESSION": case "SESSION_NOT_GENERATABLE": case "IDEMPOTENCY_KEY_REUSED": case "SESSION_CREATE_KEY_REUSED": case "TICKET_SELECTION_REQUIRED": case "TICKET_SELECTION_REQUIRES_INVENTORY": case "TICKET_UNAVAILABLE": case "TICKET_NOT_FOUND": case "TICKET_COUNT_MISMATCH": case "SHEET_SELECTION_INVALID": case "RESERVATION_ALREADY_ALLOCATED": case "RESERVATION_NOT_ACTIVE": case "NO_ALLOCATED_TICKETS": case "RESERVATION_STATE_MISMATCH": case "RESERVATION_NOT_CONFIRMED": case "RESERVATION_NOT_ASSIGNED": case "AUTO_START_ALREADY_STARTED": case "WINNING_PATTERNS_LOCKED": return 409;
    case "RESERVATION_EXPIRED": return 410;
    default: return 500;
  }
}

function fail(res, error) {
  const status = statusFor(error);
  const safeCode = error || "BOOKING_FAILED";
  const messages = {
    INVALID_TITLE: "title must be 1-100 characters", INVALID_SCHEDULE: "booking must open before it closes, and closing must be before the scheduled start", INVALID_SCHEDULE_TIME: "enter valid local date and time values; this wall time may not exist in the selected timezone", BOOKING_OPENS_NOT_BEFORE_CLOSES: "booking opening must be earlier than booking closing", BOOKING_CLOSES_NOT_BEFORE_START: "booking closing must be earlier than the scheduled start", INVALID_TIME_ZONE: "choose a valid IANA event timezone", INVALID_WINNING_PATTERNS: "choose supported winning patterns and point values",
    INVALID_ROOM_CODE: "room code is invalid", SESSION_ROOM_INVALID: "room must belong to this instance and be a new waiting room",
    SESSION_HAS_ASSIGNED_RESERVATIONS: "a session with seated bookings cannot be cancelled or moved to another room",
    INVALID_CAPACITY: "ticket capacity must be between 1 and 10000", INVALID_HOLD_DURATION: "hold duration must be between 60 and 900 seconds",
    INVALID_NAME: "name must be 3-20 characters",
    INVALID_PHONE: "enter a phone number with country code, such as +919876543210",
    INVALID_TICKET_COUNT: "ticket count must be a whole number between 1 and 10000",
    INVALID_BOOKING_MODE: "choose random, half-sheet or full-sheet booking",
    SHEET_SELECTION_INVALID: "choose a complete six-ticket sheet or a valid three-ticket half-sheet",
    INVALID_INVENTORY_MODE: "inventory mode must be legacy or numbered", INVALID_INVENTORY_COUNT: "inventory size must be between 1 and 10000",
    INVALID_IDEMPOTENCY_KEY: "idempotency key format is invalid", INVALID_TICKET_SELECTION: "select a valid set of distinct tickets matching the requested count",
    INVENTORY_NOT_READY: "ticket inventory must be generated before booking or publishing this session",
    INVENTORY_COUNT_MISMATCH: "generated ticket count must match this session's capacity",
    INVENTORY_ALREADY_GENERATED: "this session already has a different ticket inventory",
    INVENTORY_STATE_INVALID: "ticket inventory is in an unexpected state",
    IDEMPOTENCY_KEY_REUSED: "this idempotency key was already used for a different request",
    SESSION_CREATE_KEY_REUSED: "this session creation key was already used for different details",
    TICKET_SELECTION_REQUIRED: "select the requested number of tickets from the available catalog",
    TICKET_SELECTION_REQUIRES_INVENTORY: "this legacy session does not use individually numbered ticket selection",
    TICKET_UNAVAILABLE: "one or more selected tickets were just reserved by another player",
    TICKET_NOT_FOUND: "one or more selected tickets do not belong to this game",
    TICKET_LIMIT: "ticket count exceeds the remaining capacity for this session", RESERVATION_TICKET_LIMIT: "ticket count exceeds the remaining capacity for this session",
    INSTANCE_NOT_FOUND: "instance not found", INSTANCE_NOT_ACTIVE: "sessions can only be created for active instances", SESSION_NOT_FOUND: "session not found", SESSION_UNAVAILABLE: "session is not available for booking",
    SESSION_NOT_ACTIVE: "sessions can only be created for active instances", SESSION_NOT_OPENABLE: "session is not eligible to open for booking",
    CAPACITY_FULL: "not enough tickets remain", CAPACITY_BELOW_BOOKED: "capacity cannot be lower than the existing reservations",
    INVALID_TRANSITION: "that session status change is not allowed", AUTO_START_ROOM_REQUIRED: "automatic start requires a valid waiting room", INVALID_AUTO_START: "automatic start must be true or false", AUTO_START_ALREADY_STARTED: "a started session's automatic start cannot be changed", BOOKING_CLOSED: "booking is closed",
    RESERVATION_NOT_FOUND: "reservation could not be found", RESERVATION_EXPIRED: "the reservation hold has expired",
    INVALID_RESERVATION_STATE: "that reservation can no longer be changed", CANCELLATION_CLOSED: "the cancellation window has closed", RESERVATION_ASSIGNED: "an assigned reservation cannot be cancelled by an operator",
  };
  return res.status(status).json({ ok: false, code: safeCode, error: messages[safeCode] || "booking request could not be completed" });
}

function addNoStore(router) {
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options", "nosniff"); next(); });
}

function bodyDeadline(router) {
  router.use((req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    let finished = false;
    const clear = () => { if (!finished) { finished = true; clearTimeout(timer); } };
    const timer = setTimeout(() => {
      if (finished || res.headersSent) return;
      clear(); res.setHeader("Connection", "close"); res.status(408).json({ ok: false, code: "REQUEST_TIMEOUT", error: "request body timed out" });
    }, 10000);
    timer.unref?.(); req.on("end", clear); req.on("aborted", clear); res.on("finish", clear); next();
  });
}

export function createPublicBookingRouter({ db, now, io = null, bookingRealtime = null } = {}) {
  const router = express.Router();
  const service = createBookingService({ db, now });
  bodyDeadline(router); addNoStore(router); router.use(express.json({ limit: "8kb" }));
  const budget = createPublicRequestBudget({ now });
  async function notifyAdmin(reservationId) {
    if (!io || !bookingRealtime) return;
    const target = await service.bookingEventTarget(reservationId);
    if (target) io.to(bookingRealtime.room(target.instance_id)).emit("admin:booking-changed", { instanceId: target.instance_id, sessionId: target.session_id });
  }

  router.get("/instances/:slug/sessions", wrap(async (req, res) => {
    if (!SLUG_RE.test(req.params.slug) || req.params.slug.length > 48) return fail(res, "INSTANCE_NOT_FOUND");
    res.json({ ok: true, sessions: await service.listPublicSessions(req.params.slug) });
  }));
  router.get("/sessions/:sessionId", wrap(async (req, res) => {
    if (!isUuid(req.params.sessionId)) return fail(res, "SESSION_NOT_FOUND");
    const session = await service.getPublicSession(req.params.sessionId);
    if (!session) return fail(res, "SESSION_NOT_FOUND");
    res.json({ ok: true, session });
  }));
  router.get("/rooms/:roomCode/session", wrap(async (req, res) => {
    const session = await service.getPublicSessionForRoom(req.params.roomCode);
    if (!session) return fail(res, "SESSION_NOT_FOUND");
    res.json({ ok: true, session });
  }));
  router.post("/rooms/:roomCode/tickets/find", budget, wrap(async (req, res) => {
    const term = typeof req.body?.q === "string" ? req.body.q.trim() : "";
    if (term.length < 3 || term.length > 40) return fail(res, "INVALID_INPUT");
    const result = await service.findPublicTicketsForRoom(req.params.roomCode, term);
    if (!result) return fail(res, "SESSION_NOT_FOUND");
    res.json({ ok: true, tickets: result.tickets });
  }));
  router.get("/sessions/:sessionId/tickets", wrap(async (req, res) => {
    if (!isUuid(req.params.sessionId)) return fail(res, "SESSION_NOT_FOUND");
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    const pageSize = req.query.pageSize === undefined ? 24 : Number(req.query.pageSize);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) return fail(res, "INVALID_INPUT");
    const catalog = await service.listPublicTicketCatalog({ sessionId: req.params.sessionId, page, pageSize, search: req.query.search || "", status: req.query.status || null });
    if (!catalog) return fail(res, "SESSION_NOT_FOUND");
    res.json({ ok: true, catalog });
  }));
  router.post("/sessions/:sessionId/reservations", budget, wrap(async (req, res) => {
    if (!isUuid(req.params.sessionId)) return fail(res, "SESSION_NOT_FOUND");
    if (typeof req.body?.bookingToken !== "string" || !TOKEN_RE.test(req.body.bookingToken)) return fail(res, "INVALID_INPUT");
    const result = await service.reserve({ sessionId: req.params.sessionId, displayName: req.body?.displayName, phoneNumber: req.body?.phoneNumber, ticketCount: req.body?.ticketCount, ticketIds: req.body?.ticketIds, bookingMode: req.body?.bookingMode ?? "random", bookingToken: req.body?.bookingToken });
    if (result.error) return fail(res, result.error);
    await notifyAdmin(result.reservation.reservationId);
    res.status(result.idempotent ? 200 : 201).json({ ok: true, idempotent: Boolean(result.idempotent), reservation: result.reservation });
  }));
  router.post("/reservations/:reservationId/confirm", budget, wrap(async (req, res) => {
    if (!isUuid(req.params.reservationId)) return fail(res, "RESERVATION_NOT_FOUND");
    const result = await service.lookupOrTransition({ reservationId: req.params.reservationId, bookingToken: req.body?.bookingToken, action: "confirm" });
    if (result.error) return fail(res, result.error);
    await notifyAdmin(result.reservation.reservationId);
    res.json({ ok: true, reservation: result.reservation });
  }));
  router.post("/reservations/:reservationId/lookup", budget, wrap(async (req, res) => {
    if (!isUuid(req.params.reservationId)) return fail(res, "RESERVATION_NOT_FOUND");
    const result = await service.lookupOrTransition({ reservationId: req.params.reservationId, bookingToken: req.body?.bookingToken, action: "lookup" });
    if (result.error) return fail(res, result.error);
    res.json({ ok: true, reservation: result.reservation });
  }));
  router.post("/reservations/:reservationId/cancel", budget, wrap(async (req, res) => {
    if (!isUuid(req.params.reservationId)) return fail(res, "RESERVATION_NOT_FOUND");
    const result = await service.lookupOrTransition({ reservationId: req.params.reservationId, bookingToken: req.body?.bookingToken, action: "cancel" });
    if (result.error) return fail(res, result.error);
    await notifyAdmin(result.reservation.reservationId);
    res.json({ ok: true, reservation: result.reservation });
  }));
  return router;
}

/** One-process fixed-window request budget; this app owns a single DB lease. */
export function createPublicRequestBudget({ windowMs = 60_000, maxRequests = 40, maxKeys = 5000, now = () => Date.now() } = {}) {
  const buckets = new Map();
  return (req, res, next) => {
    const key = createHash("sha256").update(String(req.ip || req.socket?.remoteAddress || "unknown")).digest("hex");
    const at = now();
    let bucket = buckets.get(key);
    if (!bucket || at - bucket.startedAt >= windowMs || at < bucket.startedAt) {
      bucket = { startedAt: at, count: 0 };
      buckets.delete(key);
      if (buckets.size >= maxKeys) {
        for (const [storedKey, stored] of buckets) {
          if (at - stored.startedAt >= windowMs || at < stored.startedAt) buckets.delete(storedKey);
        }
      }
      if (buckets.size >= maxKeys) buckets.delete(buckets.keys().next().value);
      buckets.set(key, bucket);
    }
    if (bucket.count >= maxRequests) {
      const retryAfterMs = Math.max(1, windowMs - (at - bucket.startedAt));
      res.setHeader("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
      return res.status(429).json({ ok: false, code: "RATE_LIMITED", error: "too many booking requests; try again later" });
    }
    bucket.count += 1;
    next();
  };
}

export function createAdminBookingRouter({ db, ownerSessions, ownerStore, throttle, audit = null, requireMfa = false, now, controller = null, io = null, bookingRealtime = null, posterService = null } = {}) {
  const router = express.Router();
  const service = createBookingService({ db, now });
  bodyDeadline(router); addNoStore(router); router.use(express.json({ limit: "8kb" }));
  const requireOwner = wrap(async (req, res, next) => {
    const token = readOwnerToken(req);
    const verified = token && await ownerSessions.verify({ token });
    if (!verified?.ok) return res.status(401).json({ ok: false, code: "UNAUTHENTICATED", error: "owner sign-in required" });
    const owner = await ownerStore.getById(verified.ownerId);
    if (!owner) return res.status(401).json({ ok: false, code: "UNAUTHENTICATED", error: "owner sign-in required" });
    if (owner.role !== "super_admin") {
      await audit?.record({ actor: owner.username, action: "authorization.denied", targetType: "platform_api", targetId: req.path, metadata: { method: req.method, actorRole: owner.role, requiredRole: "super_admin" } }).catch(() => {});
      return res.status(403).json({ ok: false, code: "FORBIDDEN", error: "Super Admin permission is required" });
    }
    if (requireMfa && !owner.mfaEnrolled) return res.status(403).json({ ok: false, code: "MFA_REQUIRED", error: "enroll a second factor before using platform operations" });
    req.owner = { ownerId: owner.ownerId, username: owner.username, role: owner.role, sessionId: verified.sessionId };
    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
      if (!verifyCsrf(req)) return res.status(403).json({ ok: false, code: "CSRF_FAILED", error: "missing or invalid CSRF token" });
      try {
        const key = `session:${req.owner.sessionId}`;
        const limiter = throttle?.adminMutation;
        if (limiter) {
          const gate = await limiter.check({ key });
          if (!gate.allowed) { res.setHeader("Retry-After", String(Math.max(1, Math.ceil(gate.retryAfterMs / 1000)))); return res.status(429).json({ ok: false, code: "RATE_LIMITED", error: "too many requests" }); }
          const spent = await limiter.recordFailure({ key });
          if (spent.locked) return res.status(429).json({ ok: false, code: "RATE_LIMITED", error: "too many requests" });
        }
      } catch { return res.status(503).json({ ok: false, code: "ADMIN_UNAVAILABLE", error: "the control centre cannot check its safety limits" }); }
    }
    next();
  });
  router.get("/instances/:instanceId/sessions", requireOwner, wrap(async (req, res) => {
    const sessions = await service.listAdminSessions(req.params.instanceId);
    if (!sessions) return fail(res, "INSTANCE_NOT_FOUND");
    res.json({ ok: true, sessions });
  }));
  router.post("/booking-events/ticket", requireOwner, wrap(async (req, res) => {
    const instanceId = req.body?.instanceId;
    if (typeof instanceId !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(instanceId)) return fail(res, "INSTANCE_NOT_FOUND");
    const found = await db.query("SELECT 1 FROM game_instances WHERE instance_id=$1", [instanceId]);
    if (!found.rowCount) return fail(res, "INSTANCE_NOT_FOUND");
    const ticket = bookingRealtime?.issue({ instanceId, ownerSessionId: req.owner.sessionId });
    if (!ticket) return res.status(503).json({ ok: false, code: "REALTIME_UNAVAILABLE", error: "booking updates are unavailable right now" });
    res.json({ ok: true, ticket });
  }));
  router.post("/instances/:instanceId/sessions/:sessionId/inventory", requireOwner, wrap(async (req, res) => {
    if (!isUuid(req.params.sessionId)) return fail(res, "SESSION_NOT_FOUND");
    const result = await service.generateInventory({
      instanceId: req.params.instanceId,
      sessionId: req.params.sessionId,
      requestedCount: req.body?.requestedCount,
      idempotencyKey: req.body?.idempotencyKey,
      actor: { type: "super_admin", label: req.owner.username },
    });
    if (result.error) return fail(res, result.error);
    res.status(result.idempotent ? 200 : 201).json({ ok: true, inventory: result });
  }));
  router.get("/instances/:instanceId/sessions/:sessionId/tickets", requireOwner, wrap(async (req, res) => {
    if (!isUuid(req.params.sessionId)) return fail(res, "SESSION_NOT_FOUND");
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    const pageSize = req.query.pageSize === undefined ? 24 : Number(req.query.pageSize);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) return fail(res, "INVALID_INPUT");
    const inventory = await service.listAdminTicketInventory({
      instanceId: req.params.instanceId, sessionId: req.params.sessionId, page, pageSize,
      search: req.query.search || "", status: req.query.status || null,
    });
    if (!inventory) return fail(res, "SESSION_NOT_FOUND");
    res.json({ ok: true, inventory });
  }));
  router.get("/instances/:instanceId/reservations", requireOwner, wrap(async (req, res) => {
    if (req.query.sessionId && !isUuid(req.query.sessionId)) return fail(res, "SESSION_NOT_FOUND");
    const reservations = await service.listAdminReservations(req.params.instanceId, {
      sessionId: req.query.sessionId || null, status: req.query.status || null, search: req.query.search || "",
    });
    if (!reservations) return fail(res, "INSTANCE_NOT_FOUND");
    res.json({ ok: true, reservations });
  }));
  router.post("/instances/:instanceId/sessions/:sessionId/reservations", requireOwner, wrap(async (req, res) => {
    if (!isUuid(req.params.sessionId)) return fail(res, "SESSION_NOT_FOUND");
    if (typeof req.body?.bookingToken !== "string" || !TOKEN_RE.test(req.body.bookingToken)) return fail(res, "INVALID_INPUT");
    const result = await service.reserve({
      instanceId: req.params.instanceId,
      sessionId: req.params.sessionId,
      displayName: req.body.displayName,
      phoneNumber: req.body.phoneNumber,
      ticketCount: req.body.ticketCount,
      ticketIds: req.body.ticketIds,
      bookingMode: req.body.bookingMode ?? "random",
      bookingToken: req.body.bookingToken,
      actorType: "super_admin",
      actorLabel: req.owner.username,
      allowPrivate: true,
    });
    if (result.error) return fail(res, result.error);
    if (io && bookingRealtime) io.to(bookingRealtime.room(req.params.instanceId)).emit("admin:booking-changed", { instanceId: req.params.instanceId, sessionId: req.params.sessionId });
    res.status(result.idempotent ? 200 : 201).json({ ok: true, idempotent: Boolean(result.idempotent), reservation: result.reservation });
  }));
  router.get("/instances/:instanceId/reservations/:reservationId", requireOwner, wrap(async (req, res) => {
    if (!isUuid(req.params.reservationId)) return fail(res, "RESERVATION_NOT_FOUND");
    const reservation = await service.getAdminReservation(req.params.instanceId, req.params.reservationId);
    if (!reservation) return fail(res, "RESERVATION_NOT_FOUND");
    res.json({ ok: true, reservation });
  }));
  router.post("/instances/:instanceId/reservations/:reservationId/cancel", requireOwner, wrap(async (req, res) => {
    if (!isUuid(req.params.reservationId)) return fail(res, "RESERVATION_NOT_FOUND");
    const result = await service.cancelByOperator({ instanceId: req.params.instanceId, reservationId: req.params.reservationId, actorType: "super_admin", actorLabel: req.owner.username });
    if (result.error) return fail(res, result.error);
    if (io && bookingRealtime) {
      const target = await service.bookingEventTarget(req.params.reservationId);
      if (target) io.to(bookingRealtime.room(target.instance_id)).emit("admin:booking-changed", { instanceId: target.instance_id, sessionId: target.session_id });
    }
    res.json({ ok: true, reservation: result.reservation });
  }));
  router.post("/instances/:instanceId/sessions", requireOwner, wrap(async (req, res) => {
    const body = req.body || {};
    let roomCode = body.roomCode ?? null;
    let managedRoomCode = null;
    let createManagedRoom = null;
    if (body.createRoom === true) {
      if (roomCode || !controller?.createManagedRoom || !controller?.publishManagedRoom || !controller?.discardManagedRoom) return fail(res, "INVALID_INPUT");
      if (typeof body.title !== "string" || body.title.trim().length < 1 || body.title.trim().length > 100) return fail(res, "INVALID_TITLE");
      if (!Array.isArray(body.winningPatterns) || !body.winningPatterns.length || body.winningPatterns.some((entry) => !entry || !Object.hasOwn(PATTERNS, entry.id) || !Number.isSafeInteger(entry.points) || entry.points < 0 || entry.points > 100000) || new Set(body.winningPatterns.map((entry) => entry.id)).size !== body.winningPatterns.length) return fail(res, "INVALID_WINNING_PATTERNS");
      const selected = new Map((Array.isArray(body.winningPatterns) ? body.winningPatterns : []).map((entry) => [entry?.id, entry?.points]));
      const enabled = Object.fromEntries(Object.keys(PATTERNS).map((id) => [id, selected.has(id)]));
      const points = Object.fromEntries([...selected.entries()]);
      createManagedRoom = async (transactionClient) => {
        const createdRoom = await controller.createManagedRoom({
          hostName: "Operator",
          instanceId: req.params.instanceId,
          transactionClient,
          overrides: { name: body.title.trim().replace(/\s+/g, " ").slice(0, 40), patterns: enabled, patternPoints: points },
        });
        if (createdRoom.ok) managedRoomCode = createdRoom.roomId;
        return createdRoom;
      };
    }
    let result;
    try {
      result = await service.createSession({
        instanceId: req.params.instanceId, actor: req.owner.username, title: body.title,
        startsAt: body.startsAt, bookingOpensAt: body.bookingOpensAt, bookingClosesAt: body.bookingClosesAt,
        capacity: body.capacity, holdSeconds: body.reservationTtlSeconds ?? 600, roomCode,
        inventoryMode: body.inventoryMode ?? "legacy", timeZone: body.timeZone ?? "UTC", autoStartEnabled: body.autoStartEnabled ?? false, winningPatterns: body.winningPatterns,
        idempotencyKey: body.idempotencyKey ?? null,
        createManagedRoom,
      });
    } catch (error) {
      if (managedRoomCode) controller.discardManagedRoom({ roomId: managedRoomCode });
      throw error;
    }
    if (result.error) {
      if (managedRoomCode) controller.discardManagedRoom({ roomId: managedRoomCode });
      return fail(res, result.error);
    }
    if (managedRoomCode) controller.publishManagedRoom({ roomId: managedRoomCode });
    res.status(result.idempotent ? 200 : 201).json({ ok: true, idempotent: result.idempotent, session: result.session, roomCode: result.session.roomCode });
  }));
  router.patch("/instances/:instanceId/sessions/:sessionId", requireOwner, wrap(async (req, res) => {
    if (!isUuid(req.params.sessionId)) return fail(res, "SESSION_NOT_FOUND");
    const body = req.body || {};
    const allowed = new Set(["title", "startsAt", "bookingOpensAt", "bookingClosesAt", "capacity", "reservationTtlSeconds", "status", "roomCode", "timeZone", "autoStartEnabled", "winningPatterns"]);
    if (Object.keys(body).some((key) => !allowed.has(key))) return fail(res, "INVALID_INPUT");
    const result = await service.updateSession({
      instanceId: req.params.instanceId, sessionId: req.params.sessionId, actor: req.owner.username,
      patch: { ...body, holdSeconds: body.reservationTtlSeconds },
    });
    if (result.error) return fail(res, result.error);
    if (body.winningPatterns !== undefined && result.session.roomCode && controller?.configureSessionPatterns) {
      const synced = await controller.configureSessionPatterns({ roomId: result.session.roomCode, winningPatterns: result.session.winningPatterns || [] });
      if (!synced.ok) return fail(res, synced.code || "SESSION_ROOM_INVALID");
    }
    let automaticPoster;
    if (body.status === "open" && posterService?.createSessionPoster) {
      try {
        const poster = await posterService.createSessionPoster({ instanceId: req.params.instanceId, sessionId: req.params.sessionId, actor: req.owner.username });
        automaticPoster = poster.error ? { error: poster.error } : poster;
      } catch {
        automaticPoster = { error: "POSTER_AUTO_GENERATION_FAILED" };
      }
    }
    res.json({ ok: true, session: result.session, ...(automaticPoster ? { automaticPoster } : {}) });
  }));
  router.delete("/instances/:instanceId/sessions/:sessionId", requireOwner, wrap(async (req, res) => {
    if (!isUuid(req.params.sessionId)) return fail(res, "SESSION_NOT_FOUND");
    const result = await service.updateSession({ instanceId: req.params.instanceId, sessionId: req.params.sessionId, actor: req.owner.username, patch: { status: "cancelled" } });
    if (result.error) return fail(res, result.error);
    res.json({ ok: true, session: result.session });
  }));
  return router;
}
