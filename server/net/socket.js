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
  asChatText,
  asBoolean,
  asInteger,
  createBudget,
  LEGACY_EVENTS,
} from "./validate.js";
import { ErrorCodes, TICKET_MIN, TICKET_MAX } from "../game/engine.js";

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

export function registerGameHandlers(io, { rooms, controller, log = () => {}, limits = {} } = {}) {
  io.on("connection", (socket) => {
    socket.data.session = null;
    const budget = createBudget({ burst: limits.burst ?? 40, perSecond: limits.perSecond ?? 20 });

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
        const shape = sanePayload(payload);
        if (!shape.ok) {
          return rejected(ack, ErrorCodes.BAD_PAYLOAD, shape.error);
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
      const name = asName(payload.name);
      if (!name) return rejected(ack, ErrorCodes.BAD_PAYLOAD, "name must be 3-20 characters");
      const created = await controller.createRoom({ name, socketId: socket.id });
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
      if (!roomId) return rejected(ack, ErrorCodes.BAD_PAYLOAD, "room code must be 6-12 letters or digits");
      if (!name) return rejected(ack, ErrorCodes.BAD_PAYLOAD, "name must be 3-20 characters");
      const joined = await controller.joinRoom({ roomId, name, socketId: socket.id });
      if (!joined.ok) return reply(ack, joined);
      socket.join(roomId);
      socket.data.session = {
        roomId,
        playerId: joined.playerId,
        role: "player",
        sessionId: joined.sessionId || null,
      };
      reply(ack, joined);
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

      const resumed = await controller.resume({ roomId, sessionToken, socketId: socket.id });
      if (!resumed.ok) {
        if (SESSION_DEAD.has(resumed.code) || resumed.code === ErrorCodes.ROOM_NOT_FOUND || resumed.code === ErrorCodes.UNKNOWN_PLAYER) {
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

    // ------------------------------------------------------- player commands

    on(
      "claim:submit",
      async ({ socket, session, room, payload, ack }) => {
        const pattern = asPatternId(payload.pattern);
        if (!pattern) return rejected(ack, ErrorCodes.BAD_PAYLOAD, "pattern must be a known pattern id");
        // an optional ticketNo targets one owned ticket; the server never trusts
        // it as a hint about the grid, it only narrows which of the claimant's
        // own tickets the claim is checked against
        const ticketNo = asInteger(payload.ticketNo, { min: TICKET_MIN, max: TICKET_MAX });
        if (ticketNo === null) return rejected(ack, ErrorCodes.BAD_PAYLOAD, "ticketNo must be a ticket you hold");
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
        const count = asInteger(payload.count, { min: TICKET_MIN, max: TICKET_MAX });
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
