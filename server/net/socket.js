/**
 * Socket.IO boundary: the only place that talks to browsers.
 *
 * Responsibilities
 *  - validate and normalise every inbound payload   (net/validate.js)
 *  - resolve this socket's identity through a server-backed session token
 *    (persist/sessions.js, or the in-memory shim when no database is set)
 *  - bind each handler to the room the SOCKET belongs to, so a client cannot
 *    point a gameplay event at somebody else's room
 *  - forward every game intent through persist/controller.js, the only path
 *    that both executes a rule and commits it, and reply with its ack
 *
 * Phase 3 rule: nothing in here reaches the engine or the database directly.
 * `room:create/join` and `session:resume` hand out a sessionToken; every other
 * privileged event is authorised by the session already attached to this
 * socket, never by a credential the payload carries. Raw engine tokens
 * (hostToken / playerToken) no longer cross the wire at all.
 *
 * The full event contract lives in ./CONTRACT.md.
 */

import {
  sanePayload,
  asName,
  asRoomId,
  asToken,
  asPatternId,
  asPatternSwitches,
  asChatText,
  asBoolean,
  asInteger,
  createBudget,
  LEGACY_EVENTS,
} from "./validate.js";
import { ErrorCodes, TICKET_MIN } from "../game/engine.js";
import { authorizeRoom } from "../moderator/authorization.js";
import { buildSarvamAnnouncement, CALLER_FESTIVALS } from "../voice/sarvam-tts.js";

/** Send an ack response if the caller supplied a callback. */
function reply(ack, payload) {
  if (typeof ack === "function") {
    try {
      ack(payload);
    } catch {
      /* client vanished mid-flight */
    }
  }
}

function rejected(ack, code, message, extra = {}) {
  reply(ack, { ok: false, code, error: message, ...extra });
}

/**
 * socket.io lets the payload be omitted entirely (callback lands in the first
 * argument). Normalise both shapes.
 */
function normalise(args) {
  const [first, second] = args;
  if (typeof first === "function") return { payload: {}, ack: first };
  return { payload: first, ack: typeof second === "function" ? second : undefined };
}

/** Session codes that mean the browser's saved credential is dead, full stop. */
const SESSION_DEAD = new Set(["SESSION_INVALID", "SESSION_REVOKED", "SESSION_EXPIRED", "SESSION_ROTATED"]);

export function registerGameHandlers(io, { rooms, controller, log = () => {}, limits = {}, db = null, moderatorAuth = null, sarvamTts = null, allowPublicHosting = false, bookingRealtime = null } = {}) {
  io.on("connection", (socket) => {
    socket.data.session = null;
    const moderatorTicket = socket.handshake && socket.handshake.auth && socket.handshake.auth.moderatorTicket;
    socket.data.moderatorSocket = Boolean(moderatorTicket);
    const moderatorReady = moderatorTicket && moderatorAuth ? moderatorAuth.consumeSocketTicket(moderatorTicket).catch(() => null) : Promise.resolve(null);
    socket.data.moderatorReady = moderatorReady;
    const budget = createBudget({ burst: limits.burst ?? 40, perSecond: limits.perSecond ?? 20 });
    const voiceBudget = createBudget({ burst: 4, perSecond: 1 });

    socket.on("admin:booking-subscribe", (payload, ack) => {
      if (!budget()) return rejected(ack, ErrorCodes.RATE_LIMITED, "too many events, slow down");
      if (socket.data.moderatorSocket || typeof payload?.ticket !== "string" || !bookingRealtime) {
        return rejected(ack, "NOT_ALLOWED", "an authorized admin subscription is required");
      }
      const authorized = bookingRealtime.consume(payload.ticket);
      if (!authorized) return rejected(ack, "NOT_ALLOWED", "the admin subscription has expired");
      const subscriptions = socket.data.bookingSubscriptions || (socket.data.bookingSubscriptions = new Map());
      const room = bookingRealtime.room(authorized.instanceId);
      clearTimeout(subscriptions.get(authorized.instanceId));
      const expiry = setTimeout(() => {
        socket.leave(room);
        subscriptions.delete(authorized.instanceId);
      }, 120_000);
      expiry.unref?.();
      subscriptions.set(authorized.instanceId, expiry);
      socket.data.bookingAdminSession = authorized.ownerSessionId;
      socket.join(room);
      reply(ack, { ok: true });
    });

    socket.on("admin:booking-unsubscribe", (payload) => {
      const subscriptions = socket.data.bookingSubscriptions;
      const instanceId = typeof payload?.instanceId === "string" ? payload.instanceId : "";
      if (!subscriptions?.has(instanceId) || !bookingRealtime) return;
      clearTimeout(subscriptions.get(instanceId));
      subscriptions.delete(instanceId);
      socket.leave(bookingRealtime.room(instanceId));
    });
    socket.on("disconnect", () => {
      for (const timer of socket.data.bookingSubscriptions?.values() || []) clearTimeout(timer);
      socket.data.bookingSubscriptions?.clear();
    });

    /**
     * Wrap a handler: budget check, payload shape check, then the handler gets
     * a clean payload plus the server-side session for this socket. Handlers
     * may be async; a rejected promise is answered, never thrown on the wire.
     */
    const on = (event, handler, { requiresRoom = false, hostOnly = false } = {}) => {
      socket.on(event, async (...args) => {
        const { payload, ack } = normalise(args);
        if (!budget()) {
          return rejected(ack, ErrorCodes.RATE_LIMITED, "too many events, slow down");
        }
        if (socket.data.moderatorSocket) return rejected(ack, "NOT_ALLOWED", "moderator sockets cannot use player or host game events");
        const shape = sanePayload(payload);
        if (!shape.ok) {
          return rejected(ack, ErrorCodes.BAD_PAYLOAD, shape.error);
        }
        if (socket.data.session && ["room:create", "room:join", "session:resume"].includes(event)) {
          // The SPA may ask its own socket to resume after create/join as the
          // route changes. Permit that same-room credential recheck, but never
          // let a bound socket create a second room or switch room membership.
          // `controller.resume` still verifies the submitted server token.
          const targetRoomId = asRoomId(shape.value.roomId);
          if (!["room:join", "session:resume"].includes(event) || targetRoomId !== socket.data.session.roomId) {
            return rejected(ack, "ALREADY_IN_ROOM", "leave the current room before joining or resuming another room");
          }
        }
        const session = socket.data.session;
        if (requiresRoom && !session) {
          return rejected(ack, ErrorCodes.NOT_PLAYER, "you are not in a room yet");
        }
        const roomId = requiresRoom ? session.roomId : null;
        const room = requiresRoom ? rooms.get(roomId) : null;
        if (requiresRoom && !room) {
          return rejected(ack, ErrorCodes.ROOM_NOT_FOUND, "your room no longer exists");
        }
        if (hostOnly && !allowPublicHosting) {
          return rejected(ack, "NOT_ALLOWED", "live game controls are restricted to authorized administrators and moderators");
        }
        if (hostOnly && !room.isHostSocket(socket.id)) {
          return rejected(ack, ErrorCodes.NOT_HOST, "only the host may do that");
        }
        try {
          await handler({ socket, session, room, payload: shape.value, ack });
        } catch (error) {
          log("handler crashed", event, error && error.message);
          rejected(ack, "INTERNAL", "the server could not complete that action");
        }
      });
    };

    // ------------------------------------------------------------- room setup

    on("room:create", async ({ socket, payload, ack }) => {
      if (!allowPublicHosting) {
        return rejected(ack, "NOT_ALLOWED", "game rooms can only be created from an authorized management panel");
      }
      const name = asName(payload.name);
      if (!name) return rejected(ack, ErrorCodes.BAD_PAYLOAD, "name must be 3-20 characters");
      const instanceSlug = payload.instanceSlug === undefined ? null : payload.instanceSlug;
      if (instanceSlug !== null && (typeof instanceSlug !== "string" || !/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(instanceSlug))) {
        return rejected(ack, ErrorCodes.BAD_PAYLOAD, "instance is invalid");
      }
      const created = await controller.createRoom({ name, socketId: socket.id, instanceSlug });
      if (!created.ok) return reply(ack, created);
      socket.join(created.roomId);
      socket.data.session = {
        roomId: created.roomId,
        playerId: created.playerId,
        role: "host",
        sessionId: created.sessionId || null,
      };
      reply(ack, created);
    });

    on("room:join", async ({ socket, payload, ack }) => {
      const roomId = asRoomId(payload.roomId);
      const name = asName(payload.name);
      const rawReservationId = payload.reservationId;
      const rawBookingToken = payload.bookingToken;
      const hasReservation = rawReservationId !== undefined || rawBookingToken !== undefined;
      const bookingCredentialsValid = typeof rawReservationId === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawReservationId) &&
        typeof rawBookingToken === "string" && /^[a-f0-9]{64}$/i.test(rawBookingToken);
      if (!roomId) return rejected(ack, ErrorCodes.BAD_PAYLOAD, "room code must be 6-12 letters or digits");
      if (hasReservation && !bookingCredentialsValid) return rejected(ack, ErrorCodes.BAD_PAYLOAD, "both the booking reference and private booking code are required");
      if (!name && !bookingCredentialsValid) return rejected(ack, ErrorCodes.BAD_PAYLOAD, "name must be 3-20 characters");
      if (payload.name !== undefined && payload.name !== "" && !name && bookingCredentialsValid) return rejected(ack, ErrorCodes.BAD_PAYLOAD, "name must be 3-20 characters");
      const instanceSlug = typeof payload.instanceSlug === "string" ? payload.instanceSlug : null;
      if (instanceSlug !== null && !/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(instanceSlug)) {
        return rejected(ack, ErrorCodes.BAD_PAYLOAD, "invalid instance");
      }
      const joined = await controller.joinRoom({
        roomId, name, socketId: socket.id, instanceSlug,
        ...(bookingCredentialsValid ? { reservationId: rawReservationId, bookingToken: rawBookingToken.toLowerCase() } : {}),
      });
      if (!joined.ok) return reply(ack, joined);
      if (bookingCredentialsValid && db && bookingRealtime) {
        try {
          const booking = await db.query(`SELECT s.instance_id,s.session_id FROM ticket_reservations r
            JOIN game_sessions s ON s.session_id=r.session_id WHERE r.reservation_id=$1 AND s.room_code=$2`, [rawReservationId, roomId]);
          const target = booking.rows[0];
          if (target) io.to(bookingRealtime.room(target.instance_id)).emit("admin:booking-changed", { instanceId: target.instance_id, sessionId: target.session_id });
        } catch { /* the committed booking remains available through admin refresh/reconciliation */ }
      }
      socket.join(roomId);
      socket.data.session = {
        roomId,
        playerId: joined.playerId,
        role: "player",
        sessionId: joined.sessionId || null,
      };
      reply(ack, joined);
    });

    /** Read-only, authenticated seat check for an explicit resume prompt. */
    on("session:check", async ({ socket, payload, ack }) => {
      if (socket.data.session) return rejected(ack, "ALREADY_IN_ROOM", "this connection already has a game seat");
      const roomId = asRoomId(payload.roomId);
      const sessionToken = asToken(payload.sessionToken);
      const instanceSlug = payload.instanceSlug === undefined ? null : payload.instanceSlug;
      if (!roomId || !sessionToken) return rejected(ack, ErrorCodes.BAD_PAYLOAD, "saved seat details are invalid");
      if (instanceSlug !== null && (typeof instanceSlug !== "string" || !/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(instanceSlug))) {
        return rejected(ack, ErrorCodes.BAD_PAYLOAD, "game hall is invalid");
      }
      const result = await controller.checkSession({ roomId, sessionToken, instanceSlug });
      reply(ack, result);
    });

    /**
     * Reconnection. One credential, one seat, one room: the session token decides
     * what this socket may see, and a guessed room code without a token gets
     * nothing. A stale socket that resumed into a dead session is told so the
     * browser can clear what it saved.
     */
    on("session:resume", async ({ socket, payload, ack }) => {
      const roomId = asRoomId(payload.roomId);
      const sessionToken = asToken(payload.sessionToken);
      if (!roomId && !sessionToken) return rejected(ack, ErrorCodes.BAD_PAYLOAD, "nothing to resume");
      if (!roomId) return rejected(ack, ErrorCodes.BAD_PAYLOAD, "bad room code");
      if (!sessionToken) return rejected(ack, ErrorCodes.BAD_PAYLOAD, "bad session credential");

      const alreadyAttached = Boolean(socket.data.session);
      const resumed = await controller.resume({ roomId, sessionToken, socketId: socket.id });
      if (!resumed.ok) {
        // A failed credential probe must not clear an already-authenticated
        // socket's room binding; otherwise it could join a second room next.
        if (!alreadyAttached && (SESSION_DEAD.has(resumed.code) || resumed.code === ErrorCodes.ROOM_NOT_FOUND || resumed.code === ErrorCodes.UNKNOWN_PLAYER)) {
          socket.data.session = null;
        }
        return reply(ack, resumed);
      }
      socket.join(resumed.roomId);
      socket.data.session = {
        roomId: resumed.roomId,
        playerId: resumed.playerId,
        role: resumed.role === "host" ? "host" : "player",
        sessionId: resumed.sessionId || null,
      };
      reply(ack, resumed);
    });

    /** Deliberate credential rotation: the old token dies with this ack. */
    on("session:rotate", async ({ socket, payload, ack }) => {
      const sessionToken = asToken(payload.sessionToken);
      if (!sessionToken) return rejected(ack, ErrorCodes.BAD_PAYLOAD, "bad session credential");
      const rotated = await controller.rotateSession({ sessionToken });
      if (!rotated.ok) return reply(ack, rotated);
      reply(ack, { ok: true, sessionToken: rotated.sessionToken, sessionId: rotated.sessionId });
    });

    on(
      "room:state",
      async ({ socket, session, room, ack }) => {
        reply(ack, controller.state({ room, session }));
      },
      { requiresRoom: true }
    );

    on(
      "voice:audio",
      async ({ room, payload, ack }) => {
        if (!voiceBudget()) return rejected(ack, ErrorCodes.RATE_LIMITED, "caller voice requests are arriving too quickly");
        const number = asInteger(payload.number, { min: 1, max: 90 });
        const index = asInteger(payload.index, { min: 1, max: 90 });
        const language = payload.language;
        const includeCallout = payload.includeCallout === undefined ? true : payload.includeCallout;
        const festival = payload.festival === undefined ? "classic" : payload.festival;
        if (!sarvamTts) return rejected(ack, "VOICE_UNAVAILABLE", "caller voice service is unavailable");
        if (!Number.isInteger(number) || !Number.isInteger(index) || !["en", "hi", "hinglish"].includes(language)
          || typeof includeCallout !== "boolean" || !CALLER_FESTIVALS.includes(festival)) {
          return rejected(ack, ErrorCodes.BAD_PAYLOAD, "voice request is invalid");
        }
        // Only audio for an already committed server call can be synthesized.
        // The browser cannot choose text or ask for a future/predicted number.
        if (room.calledNumbers[index - 1] !== number) {
          return rejected(ack, "CALL_NOT_FOUND", "that number is not an official call in this room");
        }
        const text = buildSarvamAnnouncement(number, { language, includeCallout, festival });
        if (!text) return rejected(ack, "VOICE_UNAVAILABLE", "caller voice is unavailable");
        const result = await sarvamTts.generate({ text, language });
        if (!result.ok) return rejected(ack, result.code, "caller voice is temporarily unavailable");
        reply(ack, {
          ok: true,
          contentType: "audio/wav",
          audio: result.audio.toString("base64"),
          cache: result.cache,
          latencyMs: result.latencyMs ?? 0,
        });
      },
      { requiresRoom: true }
    );

    on(
      "room:leave",
      async ({ socket, session, room, ack }) => {
        const left = await controller.leave({ room, playerId: session.playerId, socketId: socket.id });
        if (left.ok) {
          socket.leave(session.roomId);
          socket.data.session = null;
        }
        reply(ack, left);
      },
      { requiresRoom: true }
    );

    // --------------------------------------------------------- host commands
    // No host token travels in any of these payloads: `hostOnly` checks that
    // THIS socket is the room's connected host, and the session bound it to the
    // room in the first place.

    on(
      "game:start",
      async ({ socket, room, ack }) => {
        reply(ack, await controller.start({ room, socketId: socket.id }));
      },
      { requiresRoom: true, hostOnly: true }
    );

    on(
      "room:remove-player",
      async ({ session, room, payload, ack }) => {
        const playerId = typeof payload.playerId === "string" && payload.playerId.trim().length <= 80
          ? payload.playerId.trim()
          : null;
        if (!playerId) return rejected(ack, ErrorCodes.BAD_PAYLOAD, "playerId is invalid");
        if (room.state !== "WAITING") return rejected(ack, ErrorCodes.INVALID_STATE, "participants can only be removed before the round starts");
        const targetSocketId = room.players.get(playerId)?.socketId || null;
        const result = await controller.removeParticipant({
          room,
          playerId,
          reason: "removed-by-host",
          actorPlayerId: session.playerId,
          waitingOnly: true,
        });
        if (!result.ok) return reply(ack, result);
        if (targetSocketId) {
          const targetSocket = io.sockets.sockets.get(targetSocketId);
          if (targetSocket) {
            targetSocket.emit("room:removed", { reason: "removed-by-host" });
            targetSocket.leave(room.roomId);
            targetSocket.data.session = null;
          }
        }
        reply(ack, { ok: true, removed: playerId });
      },
      { requiresRoom: true, hostOnly: true }
    );

    on(
      "game:call-next",
      async ({ socket, room, ack }) => {
        // no number is read from the payload, ever
        reply(ack, await controller.callNext({ room, socketId: socket.id, source: "host" }));
      },
      { requiresRoom: true, hostOnly: true }
    );

    for (const action of ["pause", "resume", "end", "reset"]) {
      on(
        "game:" + action,
        async ({ socket, room, ack }) => {
          reply(ack, await controller.transition({ room, socketId: socket.id, action }));
        },
        { requiresRoom: true, hostOnly: true }
      );
    }

    // Moderator sockets have a separate command namespace. They never join a
    // game room, and every event rechecks the live session and grant from the
    // database. A ticket or permission copied at handshake cannot outlive revoke.
    for (const action of ["start", "pause", "resume", "end", "reset"]) {
      socket.on(`moderator:room:${action}`, async (...args) => {
        const { payload, ack } = normalise(args);
        if (!socket.data.moderatorSocket || !moderatorAuth || !db) return rejected(ack, "UNAUTHENTICATED", "moderator socket authentication is required");
        if (!budget()) return rejected(ack, ErrorCodes.RATE_LIMITED, "too many events, slow down");
        const shape = sanePayload(payload);
        if (!shape.ok) return rejected(ack, ErrorCodes.BAD_PAYLOAD, shape.error);
        const roomId = asRoomId(shape.value.roomId);
        if (!roomId) return rejected(ack, ErrorCodes.BAD_PAYLOAD, "roomId is invalid");
        try {
          const handshakePrincipal = await moderatorReady;
          if (!handshakePrincipal) return rejected(ack, "UNAUTHENTICATED", "moderator session is expired or revoked");
          const principal = await moderatorAuth.verifySession({ sessionId: handshakePrincipal.sessionId });
          if (!principal || !principal.mfaEnrolled) return rejected(ack, "UNAUTHENTICATED", "moderator session is expired, revoked, or lacks MFA");
          const permission = { start: "room.start", pause: "room.pause", resume: "room.pause", end: "room.end", reset: "room.reset" }[action];
          const access = await authorizeRoom({ db, moderatorId: principal.moderatorId, roomId, permission });
          if (!access.ok) {
            await db.query(`INSERT INTO platform_audit(actor,actor_role,room_code,action,result,metadata)
              VALUES($1,'moderator',(SELECT room_code FROM rooms WHERE room_code=$2),$3,'failure',$4::jsonb)`, [principal.username, roomId, `moderator.socket.room.${action}`, JSON.stringify({ code: access.code, requestedRoomId: roomId })]);
            return rejected(ack, access.code === "LIFECYCLE" ? "INVALID_STATE" : "NOT_ALLOWED", "room not found or permission denied");
          }
          if (action === "start" && access.instanceStatus !== "active") return rejected(ack, "INVALID_STATE", "instance is not active");
          const ensured = await controller.ensureRoom({ roomId });
          if (!ensured.ok) return rejected(ack, ensured.code || "ROOM_NOT_FOUND", ensured.error || "room is unavailable");
          const room = ensured.room || rooms.get(roomId);
          if (!room) return rejected(ack, "ROOM_NOT_FOUND", "room is unavailable");
          const auth = { hostToken: room.hostCredential() };
          const result = action === "start" ? await controller.start({ room, auth }) : await controller.transition({ room, action, auth });
          if (!result.ok) return rejected(ack, result.code || "INVALID_STATE", result.error || "operation refused");
          await db.query(`INSERT INTO platform_audit(actor,actor_role,instance_id,room_code,action,result,metadata)
            VALUES($1,'moderator',$2,$3,$4,'success','{}'::jsonb)`, [principal.username, access.instanceId, roomId, `moderator.socket.room.${action}`]);
          reply(ack, { ok: true, state: room.state });
        } catch (error) {
          log("moderator socket authorization failed", action, error && error.message);
          rejected(ack, "INTERNAL", "the moderator operation could not be completed");
        }
      });
    }

    on(
      "game:set-autocall",
      async ({ socket, room, payload, ack }) => {
        const enabled = asBoolean(payload.enabled);
        const intervalMs = asInteger(payload.intervalMs, { min: 500, max: 120000 });
        if (intervalMs === null) return rejected(ack, ErrorCodes.BAD_PAYLOAD, "intervalMs must be 500-120000");
        reply(ack, await controller.setAutoCall({ room, socketId: socket.id, enabled, intervalMs }));
      },
      { requiresRoom: true, hostOnly: true }
    );


    /**
     * Prizes this room plays for. Host-only, and the engine refuses it once the
     * round has started - a player must be able to see the full prize list before
     * they buy into a game. Only optional pattern ids are accepted; the approved
     * six cannot be switched off from a browser.
     */
    on(
      "room:set-patterns",
      async ({ socket, room, payload, ack }) => {
        const patterns = asPatternSwitches(payload.patterns);
        if (!patterns) {
          return rejected(ack, ErrorCodes.BAD_PAYLOAD, "patterns must be a map of pattern id to true or false");
        }
        reply(ack, await controller.setPatterns({ room, socketId: socket.id, patterns }));
      },
      { requiresRoom: true, hostOnly: true }
    );

    // ------------------------------------------------------- player commands

    on(
      "claim:submit",
      async ({ socket, session, room, payload, ack }) => {
        const pattern = asPatternId(payload.pattern);
        if (!pattern) return rejected(ack, ErrorCodes.BAD_PAYLOAD, "pattern must be a known pattern id");
        // an optional ticketNo targets one owned ticket; the server never trusts
        // it as a hint about the grid, it only narrows which of the claimant's
        // own tickets the claim is checked against
        const ticketNo = asInteger(payload.ticketNo, { min: TICKET_MIN, max: Number.MAX_SAFE_INTEGER });
        if (ticketNo === null || ticketNo > room.roomTicketCapacity()) return rejected(ack, ErrorCodes.BAD_PAYLOAD, "ticketNo must be a ticket you hold");
        // identity comes from the socket's own session, never from the payload
        reply(
          ack,
          await controller.claim({ room, playerId: session.playerId, pattern, ticketNo, socketId: socket.id })
        );
      },
      { requiresRoom: true }
    );

    /**
     * A seat chooses how many tickets it wants, before the round starts. The
     * room ceiling and the WAITING-only lock are enforced by the engine, not
     * here; this layer only shapes the payload and binds it to this socket's own
     * seat, so nobody can select tickets for somebody else.
     */
    on(
      "tickets:select",
      async ({ socket, session, room, payload, ack }) => {
        const count = asInteger(payload.count, { min: TICKET_MIN, max: Number.MAX_SAFE_INTEGER });
        if (count === undefined || count === null) {
          return rejected(ack, ErrorCodes.BAD_PAYLOAD, "count must be a whole number of tickets");
        }
        reply(
          ack,
          await controller.selectTickets({ room, playerId: session.playerId, count, socketId: socket.id })
        );
      },
      { requiresRoom: true }
    );

    on(
      "chat:send",
      ({ socket, session, room, payload, ack }) => {
        const text = asChatText(payload.text, room.config.maxChatLength);
        if (!text) return rejected(ack, ErrorCodes.BAD_PAYLOAD, "message must be 1-" + room.config.maxChatLength + " characters");
        // chat is not game state: it is rate-limited, length-checked and
        // broadcast, but never persisted and never durable
        reply(ack, room.chat({ playerId: session.playerId, playerToken: room.playerCredential(session.playerId), text }));
      },
      { requiresRoom: true }
    );

    /**
     * What the room already said. A seat that arrived mid-round has seen none of
     * it, and an empty panel next to a lively room reads as a broken chat. Read
     * on demand rather than pushed on join, because the client's listeners are
     * not guaranteed to be mounted yet at that moment — and never replayed to
     * everybody, which is why chat stays out of the snapshot.
     */
    on(
      "chat:history",
      ({ room, ack }) => {
        reply(ack, { ok: true, messages: room.recentChat() });
      },
      { requiresRoom: true }
    );

    // ------------------------------------------------------------ housekeeping

    socket.on("disconnect", (reason) => {
      const session = socket.data.session;
      if (session) rooms.detachSocket(socket);
      log("socket disconnected", socket.id, reason);
    });

    // Old builds emitted these. They are refused loudly rather than silently
    // ignored, so a stale tab cannot be an alternative path into the game.
    for (const legacy of LEGACY_EVENTS) {
      socket.on(legacy, (_payload, ack) => {
        const message = "this game server no longer accepts '" + legacy + "'; reload the page";
        log("legacy event refused", legacy, socket.id);
        if (typeof _payload === "function") _payload({ ok: false, code: "LEGACY_EVENT", error: message });
        else if (typeof ack === "function") ack({ ok: false, code: "LEGACY_EVENT", error: message });
        socket.emit("app:error", { code: "LEGACY_EVENT", error: message });
      });
    }
  });

  return { io, rooms };
}
