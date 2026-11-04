/**
 * The persistence controller: the only place where a game intent is both
 * executed and saved.
 *
 * Everything the transport accepts comes through here, and the transport never
 * talks to the engine and the database separately. Three invariants are this
 * file's whole reason to exist.
 *
 * 1. ONE WRITER PER ROOM. `runExclusive` chains every durable operation for a
 *    room, so an await in the middle of a write cannot let a second write
 *    interleave. That is what keeps the engine's synchronous check-then-act
 *    reasoning valid once durability is added, for host requests, claims and
 *    scheduler ticks alike.
 *
 * 2. DURABLE BEFORE AUTHORITATIVE. A number or an award is written by the
 *    database first and only then applied to the live room. The room's
 *    emissions are held in net/dispatch.js while the write is in flight and are
 *    released on commit or destroyed on failure, so nothing reaches a browser
 *    that the database does not already have.
 *
 * 3. FAIL CLOSED. If a write cannot be made, the buffered events are thrown
 *    away, the room is rebuilt from what the database actually says, and the
 *    caller is told the save failed. If the rebuild cannot be trusted the room
 *    is frozen with a reason instead of carrying on with invented state.
 *
 * Without a database (`store` absent) every method takes the Phase 2 in-memory
 * path unchanged, so the engine tests describe the same behaviour as before.
 */

import { ErrorCodes, GameState, IntegrityError } from "../game/engine.js";
import { validateRoomDefaults } from "../instances/room-defaults.js";

/**
 * What a client is allowed to see about the room's configuration.
 * `name` is the operator's label for the table, not a secret: players already
 * see it on the join screen, and the admin pages read it back from storage.
 */
const PUBLIC_CONFIG_KEYS = [
  "name",
  "callIntervalMs",
  "autoCall",
  "maxPlayers",
  "disconnectGraceMs",
  "chatIntervalMs",
  "maxChatLength",
  "earlyFiveMaxCalls",
  "claimWindowCalls",
  "patterns",
  "multipleWinnersPerPattern",
];

function publicConfig(config = {}) {
  const out = {};
  for (const key of PUBLIC_CONFIG_KEYS) if (config[key] !== undefined) out[key] = config[key];
  return out;
}

const PERSIST_MESSAGE =
  "the server could not save that, so it did not happen. Nothing was announced - try again in a moment.";

export function createGameController({ store, sessions, registry: initialRegistry, log = () => {}, now = () => Date.now() } = {}) {
  const chains = new Map();
  const frozen = new Map();
  const durable = Boolean(store);
  // The registry and this controller need each other: the registry's rooms
  // must emit through this controller's gates, and this controller must find
  // rooms through the registry. bindRegistry() closes that loop once both
  // exist; `registry` below is this mutable binding, not the constructor arg.
  let registry = initialRegistry || null;
  let scheduler = null;
  let auditPending = 0;

  /** The scheduler is built after the controller; this wires them together. */
  function bindScheduler(next) {
    scheduler = next;
  }

  function bindRegistry(next) {
    if (!registry && next) registry = next;
    return registry;
  }

  // ------------------------------------------------------------- serialization

  function runExclusive(roomId, task) {
    const tail = chains.get(roomId) || Promise.resolve();
    const result = tail.then(task, task);
    chains.set(
      roomId,
      result.then(
        () => undefined,
        () => undefined
      )
    );
    return result;
  }

  function forgetQueue(roomId) {
    chains.delete(roomId);
    frozen.delete(roomId);
  }

  // ------------------------------------------------------- operator (owner) paths
  //
  // These drive the SAME durable engine + store paths a connected host uses,
  // just authorised by an already-authenticated operator instead of a host
  // socket. Nothing here bypasses one-writer-per-room, durable-before-
  // authoritative, or fail-closed; the caller (server/admin) is responsible for
  // proving the owner session before it ever reaches these.

  /** Create a room on the owner's behalf. A phantom host seat stands in for the
   *  absent browser host so lifecycle rules (which need an owner) still hold. */
  async function createManagedRoom({ hostName = "Operator", overrides, instanceId = "regular" } = {}) {
    const socketId = "operator:" + Math.random().toString(36).slice(2, 10);
    const created = await createRoom({ name: hostName, socketId, overrides, instanceId });
    if (!created.ok) return created;
    // the operator does not need a browser session token for the phantom host;
    // revoke it so a leaked ack could never resume a seat nobody owns
    if (created.sessionId && sessions) {
      await sessions.revoke({ sessionId: created.sessionId, roomId: created.roomId, reason: "operator-seat" }).catch(() => {});
    }
    const room = registry.get(created.roomId);
    return {
      ok: true,
      roomId: created.roomId,
      state: room ? room.state : created.state,
      enabledPatterns: room ? room.stateView().enabledPatterns : undefined,
    };
  }

  /** Remove a disruptive participant without touching their earned history. */
  async function removeParticipant({ room, playerId, reason = "removed-by-operator", actorPlayerId = null, waitingOnly = false }) {
    const blocked = refuseFrozen(room.roomId);
    if (blocked) return blocked;
    if (waitingOnly && room.state !== GameState.WAITING) {
      return { ok: false, code: ErrorCodes.INVALID_STATE, error: "participants can only be removed before the round starts" };
    }
    if (room.hostPlayerId === playerId) {
      return { ok: false, code: "NOT_ALLOWED", error: "the host seat cannot be removed while the room lives" };
    }
    if (!room.players.has(playerId)) {
      return { ok: false, code: ErrorCodes.UNKNOWN_PLAYER, error: "no such participant in this room" };
    }
    if (!durable) {
      room.dropPlayer(playerId, reason, { actorPlayerId, actorRole: actorPlayerId ? "host" : null });
      if (sessions) await sessions.revoke({ roomId: room.roomId, playerId, reason }).catch(() => {});
      return { ok: true, removed: playerId };
    }
    return runExclusive(room.roomId, async () => {
      if (waitingOnly && room.state !== GameState.WAITING) {
        return { ok: false, code: ErrorCodes.INVALID_STATE, error: "participants can only be removed before the round starts" };
      }
      const gate = registry.dispatchFor(room.roomId);
      gate.suspend();
      try {
        // the engine drops the live seat and stamps `left_at`; the tickets,
        // claims and awards that player already earned stay attached to history
        room.dropPlayer(playerId, reason, { actorPlayerId, actorRole: actorPlayerId ? "host" : null });
        await store.markSeatLeft({ roomId: room.roomId, playerId, reason, actorPlayerId, actorRole: actorPlayerId ? "host" : null });
        await sessions.revoke({ roomId: room.roomId, playerId, reason });
        gate.flush();
        return { ok: true, removed: playerId };
      } catch (error) {
        gate.discard();
        return degrade(room.roomId, error, null);
      }
    });
  }

  function freeze(roomId, reason) {
    frozen.set(roomId, reason);
    log("room frozen", roomId, reason);
    if (scheduler) scheduler.cancel(roomId);
  }

  function frozenReason(roomId) {
    return frozen.get(roomId) || null;
  }

  function refuseFrozen(roomId) {
    const reason = frozenReason(roomId);
    if (!reason) return null;
    return {
      ok: false,
      code: "RECOVERY_REQUIRED",
      error: "this room is not playing while its state is being sorted out: " + reason,
      roomId,
    };
  }

  function persistFailure(error, roomId) {
    const detail = (error && error.message) || "unknown database failure";
    log("persist failed", roomId, (error && error.code) || "-", detail);
    return { ok: false, code: "PERSIST_FAILED", error: PERSIST_MESSAGE };
  }

  /**
   * A durable write failed. Throw away what was about to be broadcast and put
   * the room back exactly as the database describes it.
   */
  async function degrade(roomId, error, gate) {
    if (gate) gate.discard();
    const result = persistFailure(error, roomId);
    if (error instanceof IntegrityError || error && error.code === "RECOVERY_REQUIRED") {
      freeze(roomId, (error && error.message) || "inconsistent state");
      await store.setRecoveryError({ roomId, error: frozenReason(roomId) }).catch(() => {});
      return { ok: false, code: "RECOVERY_REQUIRED", error: result.error };
    }
    const rebuilt = await rehydrate(roomId).catch((rebuildError) => rebuildError);
    if (rebuilt instanceof Error) {
      freeze(roomId, rebuilt.message);
      await store.setRecoveryError({ roomId, error: rebuilt.message }).catch(() => {});
      return { ok: false, code: "RECOVERY_REQUIRED", error: "the room could not be rebuilt: " + rebuilt.message };
    }
    return result;
  }

  /**
   * Rebuild one room from durable state and re-attach the sockets that are
   * still connected, so a reload never loses live connections either.
   */
  async function rehydrate(roomId) {
    const bundle = await store.loadRoomBundle({ roomId });
    if (!bundle.room || bundle.room.closed_at) {
      registry.close(roomId, "room is closed in the database");
      forgetQueue(roomId);
      return null;
    }
    // frozen by an earlier boot: the note travels with the rows, so a rebuild
    // without an operator clearing it can never resume play on its own
    if (bundle.room.recovery_error) {
      freeze(roomId, bundle.room.recovery_error);
      return null;
    }
    // lazy import avoided: recovery is a peer of this module, not a dependency
    const { buildHydrationSource } = await import("./recovery.js");
    const source = buildHydrationSource(bundle, { log });
    if (scheduler) scheduler.cancel(roomId);
    registry.rooms.delete(roomId);
    const room = registry.restore({ roomId, hydrate: source, overrides: source.config });
    room.assertIntegrity();
    room.gameNumber = source.gameNumber;

    const attached = await reattachLiveSockets(room);
    if (room.state === GameState.RUNNING && room.config.autoCall && scheduler) {
      await scheduler.recover(room, source.schedule);
    }
    log("room rehydrated", roomId, room.state, "calls", room.cursor, "seats", attached);
    return room;
  }

  /**
   * Live sockets are the truth about who is connected right now. After a
   * rebuild every session still held by a connected socket re-claims its seat.
   */
  async function reattachLiveSockets(room) {
    if (!registry.hub || typeof registry.hub.for !== "function") return 0;
    const sockets = await registry.ioSocketsFor(room.roomId).catch(() => []);
    let attached = 0;
    for (const entry of sockets || []) {
      const session = entry.session;
      if (!session || session.roomId !== room.roomId || !session.playerId) continue;
      if (!room.players.has(session.playerId)) continue;
      const result = room.attachAuthenticated({ playerId: session.playerId, socketId: entry.socketId });
      if (result.ok) attached += 1;
    }
    return attached;
  }

  // ----------------------------------------------------------------- audit log

  /**
   * Event types the store already writes inside the transaction that caused
   * them. Mirroring those again would double every row in audit_events (and race
   * the seat insert, so a join row could hit the players foreign key before the
   * player existed). The engine log stays the complete in-process record.
   */
  const STORE_AUDITED_EVENTS = new Set([
    "room-created",
    "join",
    "left",
    "host-set",
    "room-closed",
    "start",
    "completed",
    "call",
    "claim",
    "claim-rejected",
  ]);

  /**
   * The engine records an event on every state change. This mirrors the ones
   * the store does not write itself into audit_events: connection facts, seat
   * removals and the transitions that have no row of their own (pause, resume,
   * reset, auto-call).
   */
  function onAudit(roomId, entry) {
    if (!durable) return;
    if (!entry || STORE_AUDITED_EVENTS.has(entry.type)) return;
    if (auditPending > 2000) {
      log("audit backlog too large, dropping", roomId, entry && entry.type);
      return;
    }
    auditPending += 1;
    runExclusive(roomId, async () => {
      auditPending -= 1;
      try {
        const room = registry.get(roomId);
        const gameNumber = room ? room.gameNumber : null;
        await store.appendAudit({
          roomId,
          gameNumber,
          playerId: entry.player || null,
          type: entry.type,
          detail: withoutReserved(entry),
          at: entry.at,
        });
        await mirrorSeatFact(roomId, entry);
      } catch (error) {
        log("audit write failed", roomId, entry && entry.type, error && error.message);
      }
    }).catch(() => {});
  }

  function withoutReserved(entry) {
    const { at, type, player, ...rest } = entry;
    return rest;
  }

  /** Connection facts and vacated seats: history is kept, never deleted. */
  async function mirrorSeatFact(roomId, entry) {
    if (entry.type === "disconnect") {
      await store.markSeat({ roomId, playerId: entry.player, connected: false, seen: false });
      return;
    }
    if (entry.type === "resume") {
      await store.markSeat({ roomId, playerId: entry.player, connected: true });
      return;
    }
    if (entry.type === "removed") {
      // a swept host seat stays active: the room is theirs and still waiting
      if (entry.wasHost) return;
      await store.markSeatLeft({ roomId, playerId: entry.player, reason: entry.reason || "removed", actorPlayerId: entry.actorPlayerId || null, actorRole: entry.actorRole || null });
      return;
    }
    if (entry.type === "host-lost") {
      await store.markSeat({ roomId, playerId: entry.player, connected: false, seen: false });
      const room = registry.get(roomId);
      if (room && room.state === GameState.PAUSED) {
        await store.setStatus({ roomId, to: GameState.PAUSED });
        await store.setScheduleFlags({ roomId, autoCall: false, nextDueAt: null });
        if (scheduler) scheduler.cancel(roomId);
      }
    }
  }

  // ------------------------------------------------------------- room lifecycle

  async function createRoom({ name, socketId, overrides, instanceId = "regular", instanceSlug = null }) {
    if (instanceSlug !== null) {
      if (typeof instanceSlug !== "string" || !/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(instanceSlug)) {
        return { ok: false, code: "BAD_PAYLOAD", error: "instance is invalid" };
      }
      if (!durable) {
        if (instanceSlug !== "regular") return { ok: false, code: "INSTANCE_UNAVAILABLE", error: "that game hall is not available" };
        instanceId = "regular";
      } else {
        instanceId = await store.publicInstanceIdBySlug({ slug: instanceSlug });
        if (!instanceId) return { ok: false, code: "INSTANCE_UNAVAILABLE", error: "that game hall is not available" };
      }
    }
    let themeVersionId = null;
    if (durable) {
      const instanceStatus = await store.instanceStatus({ instanceId });
      if (instanceStatus !== "active") return { ok: false, code: "INSTANCE_UNAVAILABLE", error: "rooms can only be created in an active instance" };
      if (typeof store.themeVersionForInstance === "function") themeVersionId = await store.themeVersionForInstance({ instanceId });
    }
    let roomConfig = { ...(overrides || {}) };
    if (durable && typeof store.instanceRoomDefaults === "function") {
      const defaultsResult = validateRoomDefaults(await store.instanceRoomDefaults({ instanceId }));
      if (defaultsResult.error) {
        return { ok: false, code: "INSTANCE_CONFIGURATION_INVALID", error: "this game hall has invalid room defaults" };
      }
      roomConfig = { ...defaultsResult.roomDefaults, ...roomConfig };
    }
    const room = registry.create(roomConfig);
    const gate = registry.dispatchFor(room.roomId);
    if (!durable) {
      const joined = room.join({ name, socketId });
      if (!joined.ok) {
        registry.close(room.roomId, "host could not join");
        return joined;
      }
      room.setHost({ socketId, playerId: joined.playerId });
      const issued = await sessions.issue({ roomId: room.roomId, playerId: joined.playerId, role: "host" });
      return {
        ok: true,
        roomId: room.roomId,
        sessionToken: issued.sessionToken,
        sessionId: issued.sessionId,
        playerId: joined.playerId,
        name: joined.name,
        role: "host",
        state: room.state,
        enabledPatterns: room.stateView().enabledPatterns,
      };
    }

    gate.suspend();
    try {
      const joined = room.join({ name, socketId });
      if (!joined.ok) {
        gate.discard();
        registry.close(room.roomId, "host could not join");
        return joined;
      }
      room.setHost({ socketId, playerId: joined.playerId });
      await store.createRoom({
        roomId: room.roomId,
        config: { ...publicConfig(room.config), ...(themeVersionId ? { themeVersionId } : {}) },
        instanceId,
        host: { playerId: joined.playerId, name: joined.name, connected: true },
      });
      await store.upsertSchedule({
        roomId: room.roomId,
        gameNumber: 0,
        autoCall: room.config.autoCall,
        intervalMs: room.config.callIntervalMs,
        nextDueAt: null,
      });
      const issued = await sessions.issue({ roomId: room.roomId, playerId: joined.playerId, role: "host" });
      gate.flush();
      return {
        ok: true,
        roomId: room.roomId,
        sessionToken: issued.sessionToken,
        sessionId: issued.sessionId,
        playerId: joined.playerId,
        name: joined.name,
        role: "host",
        state: room.state,
        enabledPatterns: room.stateView().enabledPatterns,
      };
    } catch (error) {
      gate.discard();
      registry.close(room.roomId, "the room could not be saved");
      return persistFailure(error, room.roomId);
    }
  }

  async function joinRoom({ roomId, name, socketId, instanceSlug = null, reservationId = null, bookingToken = null }) {
    let booking = null;
    if (durable) {
      if (instanceSlug !== null) {
        const actualSlug = await store.instanceSlugForRoom({ roomId });
        if (!actualSlug || actualSlug !== instanceSlug) {
          return { ok: false, code: ErrorCodes.ROOM_NOT_FOUND, error: "no game with that room code" };
        }
      } else if (typeof roomId !== "string") {
        return { ok: false, code: ErrorCodes.ROOM_NOT_FOUND, error: "no game with that room code" };
      }
      const status = await store.instanceStatusForRoom({ roomId });
      if (status === "paused" || status === "archived") return { ok: false, code: "INSTANCE_UNAVAILABLE", error: "this game instance is not accepting new players" };
      const bookingSession = await store.bookingSessionForRoom({ roomId });
      if (bookingSession) {
        if (bookingSession.status !== "open" || bookingSession.instance_status !== "active" || bookingSession.room_status !== "WAITING" || Number(bookingSession.game_number) !== 0) {
          return { ok: false, code: "SESSION_UNAVAILABLE", error: "this scheduled room is not accepting new bookings" };
        }
        if (!reservationId || !bookingToken) return { ok: false, code: "BOOKING_REQUIRED", error: "join this scheduled room with your confirmed booking reference and private code" };
        booking = await store.reservationForRoomJoin({ roomId, reservationId, bookingToken });
        if (!booking) return { ok: false, code: "RESERVATION_NOT_FOUND", error: "that confirmed booking is not available for this room" };
        name = booking.displayName;
      } else if (reservationId || bookingToken) {
        return { ok: false, code: "RESERVATION_NOT_FOUND", error: "that confirmed booking is not available for this room" };
      }
    } else {
      if (instanceSlug !== null) return { ok: false, code: "INSTANCE_UNAVAILABLE", error: "public instance joining requires durable storage" };
      if (reservationId || bookingToken) return { ok: false, code: "INSTANCE_UNAVAILABLE", error: "scheduled bookings require durable storage" };
    }
    const blocked = refuseFrozen(roomId);
    if (blocked) return blocked;
    const room = registry.get(roomId);
    if (!room) return { ok: false, code: ErrorCodes.ROOM_NOT_FOUND, error: "no game with that room code" };
    // a room an earlier boot froze is refused even though its rows are readable
    if (durable && room.recoveryError) {
      freeze(roomId, room.recoveryError);
      return refuseFrozen(roomId);
    }

    if (!durable) {
      const joined = room.join({ name, socketId });
      if (!joined.ok) return joined;
      const issued = await sessions.issue({ roomId, playerId: joined.playerId, role: "player" });
      return {
        ...joined,
        sessionToken: issued.sessionToken,
        role: "player",
        state: room.state,
        snapshot: room.playerSnapshot(joined.playerId),
      };
    }

    const gate = registry.dispatchFor(roomId);
    gate.suspend();
    let createdPlayerId = null;
    try {
      const joined = room.join({ name, socketId });
      if (!joined.ok) {
        gate.discard();
        return joined;
      }
      createdPlayerId = joined.playerId;
      if (booking) {
        const locked = room.lockTicketCount({ playerId: joined.playerId, count: booking.ticketCount });
        if (!locked.ok) {
          room.dropPlayer(joined.playerId, "booking ticket allocation failed");
          gate.discard();
          return locked;
        }
        if (booking.inventoryMode === "numbered") {
          const assigned = room.assignInventoryTickets({
            playerId: joined.playerId,
            socketId,
            playerToken: room.playerCredential(joined.playerId),
            tickets: (booking.tickets || []).map((ticket) => ({
              ...ticket,
              inventorySessionId: booking.sessionId,
              inventoryReservationId: booking.reservationId,
            })),
          });
          if (!assigned.ok) {
            room.dropPlayer(joined.playerId, "booking ticket inventory could not be restored");
            gate.discard();
            return assigned;
          }
        } else {
          const selection = room.selectTickets({ playerId: joined.playerId, count: booking.ticketCount, socketId, playerToken: room.playerCredential(joined.playerId) });
          if (!selection.ok) {
            room.dropPlayer(joined.playerId, "booking ticket allocation failed");
            gate.discard();
            return selection;
          }
        }
        const registered = await store.addParticipantFromBooking({
          roomId, playerId: joined.playerId, name: joined.name, connected: true,
          reservationId, bookingToken, expectedTicketIds: (booking.tickets || []).map((ticket) => ticket.inventoryTicketId),
        });
        if (!registered.ok) {
          room.dropPlayer(joined.playerId, "booking could not be assigned");
          gate.discard();
          return registered;
        }
      } else {
        await store.addParticipant({ roomId, playerId: joined.playerId, name: joined.name, connected: true });
      }
      const issued = await sessions.issue({ roomId, playerId: joined.playerId, role: "player" });
      gate.flush();
      return {
        ...joined,
        ...(booking ? { name: joined.name, ticketCount: booking.ticketCount, snapshot: room.playerSnapshot(joined.playerId) } : {}),
        sessionToken: issued.sessionToken,
        role: "player",
        state: room.state,
        snapshot: room.playerSnapshot(joined.playerId),
      };
    } catch (error) {
      gate.discard();
      if (createdPlayerId) room.dropPlayer(createdPlayerId, "the seat could not be saved");
      return degrade(roomId, error, null);
    }
  }

  /**
   * Reconnection. The session credential, not a room code, decides what this
   * socket is allowed to see - and it only ever unlocks one seat in one room.
   */
  async function resume({ roomId, sessionToken, socketId }) {
    const verified = await sessions.verify({ sessionToken, roomId });
    if (!verified.ok) return verified;
    const target = verified.roomId;
    const blocked = refuseFrozen(target);
    if (blocked) return blocked;

    if (!durable) {
      const room = registry.get(target);
      if (!room) return { ok: false, code: ErrorCodes.ROOM_NOT_FOUND, error: "no game with that room code" };
      if (verified.role === "host" && room.hostPlayerId && room.hostPlayerId !== verified.playerId) {
        await sessions.revoke({ sessionId: verified.sessionId, roomId: target, reason: "host-mismatch" });
        return { ok: false, code: "SESSION_INVALID", error: "this session no longer owns that room" };
      }
      const attached = room.attachAuthenticated({ playerId: verified.playerId, socketId });
      if (!attached.ok) {
        await sessions.revoke({ sessionId: verified.sessionId, roomId: target, reason: "seat-gone" }).catch(() => {});
        return attached;
      }
      return {
        ok: true,
        role: attached.role,
        playerId: verified.playerId,
        roomId: target,
        sessionId: verified.sessionId,
        resumed: true,
        snapshot: attached.snapshot,
      };
    }

    return runExclusive(target, async () => {
      let room = registry.get(target);
      if (!room) {
        try {
          room = await rehydrate(target);
        } catch (error) {
          freeze(target, (error && error.message) || "could not be rebuilt");
          return refuseFrozen(target);
        }
        if (!room) return { ok: false, code: ErrorCodes.ROOM_NOT_FOUND, error: "that room is closed" };
      }

      if (verified.role === "host" && room.hostPlayerId && room.hostPlayerId !== verified.playerId) {
        await sessions.revoke({ sessionId: verified.sessionId, roomId: target, reason: "host-mismatch" });
        return { ok: false, code: "SESSION_INVALID", error: "this session no longer owns that room" };
      }

      const gate = registry.dispatchFor(target);
      gate.suspend();
      const attached = room.attachAuthenticated({ playerId: verified.playerId, socketId });
      if (!attached.ok) {
        gate.discard();
        await sessions.revoke({ sessionId: verified.sessionId, reason: "seat-gone" }).catch(() => {});
        return attached;
      }
      try {
        if (durable) await store.markSeat({ roomId: target, playerId: verified.playerId, connected: true });
        gate.flush();
      } catch (error) {
        gate.discard();
        return degrade(target, error, null);
      }
      return {
        ok: true,
        role: attached.role,
        playerId: verified.playerId,
        roomId: target,
        sessionId: verified.sessionId,
        resumed: true,
        snapshot: attached.snapshot,
      };
    });
  }

  /**
   * Credential rotation. The transport exposes it as an explicit event because
   * an automatic swap on every resume would make a retried request look like a
   * theft. Nothing about the game changes; only the browser's proof of who it
   * is gets replaced, and the old token stops working with this ack.
   */
  async function rotateSession({ sessionToken }) {
    const rotated = await sessions.rotate({ sessionToken });
    if (!rotated.ok) return rotated;
    return { ok: true, sessionToken: rotated.sessionToken, sessionId: rotated.sessionId, roomId: rotated.roomId };
  }

  function state({ room, session }) {
    const blocked = refuseFrozen(room.roomId);
    if (blocked) return blocked;
    return {
      ok: true,
      snapshot: session.role === "host" ? room.hostSnapshot() : room.playerSnapshot(session.playerId),
    };
  }

  async function leave({ room, playerId, socketId }) {
    const blocked = refuseFrozen(room.roomId);
    if (blocked) return blocked;
    // the engine still checks its own seat credential; the controller holds it
    const left = room.leave({ playerId, playerToken: room.playerCredential(playerId) });
    if (!left.ok || !durable) return left;
    return runExclusive(room.roomId, async () => {
      const gate = registry.dispatchFor(room.roomId);
      gate.suspend();
      try {
        await store.markSeatLeft({ roomId: room.roomId, playerId, reason: "left" });
        await sessions.revoke({ roomId: room.roomId, playerId, reason: "left" });
        gate.flush();
        return { ok: true, left: true };
      } catch (error) {
        gate.discard();
        return degrade(room.roomId, error, null);
      }
    });
  }

  async function closeRoom({ roomId, reason = "room closed" }) {
    if (durable) {
      await store.closeRoom({ roomId, reason }).catch((error) => log("close failed", roomId, error && error.message));
      if (scheduler) scheduler.cancel(roomId);
    }
    forgetQueue(roomId);
    return registry.close(roomId, reason);
  }

  /**
   * A seat picks how many tickets it wants before the round begins.
   *
   * The engine decides the room ceiling and the WAITING-only lock; this method
   * runs the memory intent and, in durable mode, records the chosen count on
   * room_members.ticket_count so a restart restores the same selection. The
   * ticket grids themselves are minted at selection time for live visibility,
   * but only the COUNT is durable until start() (there is no games row for a
   * round that has not begun), and start() re-mints to the stored count.
   */
  async function selectTickets({ room, playerId, count, socketId }) {
    const blocked = refuseFrozen(room.roomId);
    if (blocked) return blocked;
    if (!durable) {
      return room.selectTickets({
        playerId,
        count,
        socketId,
        playerToken: room.playerCredential(playerId),
      });
    }
    return runExclusive(room.roomId, async () => {
      const bookedCount = await store.bookedTicketCount({ roomId: room.roomId, playerId });
      if (bookedCount !== null && count !== bookedCount) {
        return { ok: false, code: "BOOKING_TICKET_COUNT_LOCKED", error: "ticket count is fixed by the confirmed reservation", ticketCount: bookedCount, maxTickets: bookedCount };
      }
      const result = room.selectTickets({
        playerId,
        count,
        socketId,
        playerToken: room.playerCredential(playerId),
      });
      if (!result.ok) return result;
      try {
        const saved = await store.setTicketCount({ roomId: room.roomId, playerId, count: result.ticketCount });
        if (!saved.ok) {
          if (bookedCount !== null) room.selectTickets({ playerId, count: bookedCount, socketId, playerToken: room.playerCredential(playerId) });
          return saved;
        }
        return result;
      } catch (error) {
        return degrade(room.roomId, error, null);
      }
    });
  }

  // ----------------------------------------------------------------- game flow

  async function start({ room, socketId, auth }) {
    const blocked = refuseFrozen(room.roomId);
    if (blocked) return blocked;
    const hostAuth = auth || { socketId };
    if (!durable) return room.start(hostAuth);

    return runExclusive(room.roomId, async () => {
      const gate = registry.dispatchFor(room.roomId);
      gate.suspend();
      const result = room.start(hostAuth);
      if (!result.ok) {
        gate.discard();
        return result;
      }
      const gameNumber = (room.gameNumber || 0) + 1;
      try {
        await store.startGame({
          roomId: room.roomId,
          gameNumber,
          drawSequence: room.draw,
          config: publicConfig(room.config),
          tickets: [...room.players.values()].flatMap((player) =>
            player.tickets.map((t) => ({
              playerId: player.id, ticketNo: t.no, grid: t.grid,
              inventoryTicketId: t.inventoryTicketId || null,
              inventorySessionId: t.inventorySessionId || null,
              inventoryReservationId: t.inventoryReservationId || null,
            }))
          ),
          ticketCounts: [...room.players.values()].map((player) => ({
            playerId: player.id,
            count: player.ticketCount,
          })),
        });
        room.gameNumber = gameNumber;
        const nextDueAt = room.config.autoCall ? new Date(now() + Number(room.config.callIntervalMs)) : null;
        await store.upsertSchedule({
          roomId: room.roomId,
          gameNumber,
          autoCall: Boolean(room.config.autoCall),
          intervalMs: room.config.callIntervalMs,
          nextDueAt,
          resetTick: true,
        });
        if (room.config.autoCall && scheduler) scheduler.arm(room, { nextDueAt });
        gate.flush();
        return {
          ok: true,
          state: room.state,
          gameNumber,
          ticketsIssued: [...room.players.values()].reduce((n, p) => n + p.tickets.length, 0),
          snapshot: room.hostSnapshot(),
        };
      } catch (error) {
        return degrade(room.roomId, error, gate);
      }
    });
  }

  /**
   * Call the next number. Durable first: the number comes out of the stored
   * draw plan inside the transaction, and only the row that the transaction
   * wrote is allowed to reach the wire.
   */
  async function callNext({ room, socketId, source = "host", auth }) {
    const blocked = refuseFrozen(room.roomId);
    if (blocked) return blocked;
    const hostAuth = auth || { socketId };
    if (!durable) {
      if (source === "host") {
        const denied = room.assertHost(hostAuth);
        if (denied) return denied;
      }
      return room.drawNext({ source });
    }

    return runExclusive(room.roomId, async () => {
      if (source === "host") {
        const denied = room.assertHost(hostAuth);
        if (denied) return denied;
      }
      if (room.state === GameState.PAUSED) return failOf(ErrorCodes.INVALID_STATE, "game is paused");
      if (room.state !== GameState.RUNNING) {
        return failOf(ErrorCodes.INVALID_STATE, "game is " + room.state, { state: room.state });
      }
      if (room.cursor >= room.draw.length) {
        return failOf(ErrorCodes.DRAW_EXHAUSTED, "all 90 numbers have been called");
      }

      const gate = registry.dispatchFor(room.roomId);
      gate.suspend();
      const expectedIndex = room.cursor + 1;
      try {
        const committed = await store.recordCall({
          roomId: room.roomId,
          gameNumber: room.gameNumber,
          expectedIndex,
          source,
        });
        if (!committed.ok) {
          gate.discard();
          return mapRefusal(committed, room);
        }
        if (committed.duplicate) {
          gate.discard();
          throw new IntegrityError(
            "the database already held a call at position " + expectedIndex + ", which the server did not expect",
            { roomId: room.roomId }
          );
        }
        const applied = room.applyCommittedCall({
          number: committed.number,
          index: committed.index,
          source,
          calledAt: committed.calledAt,
        });
        if (committed.completed) {
          if (scheduler) scheduler.cancel(room.roomId);
          await store.disarmSchedule({ roomId: room.roomId, gameNumber: room.gameNumber });
        } else if (source === "host" && room.config.autoCall && scheduler) {
          // a manual call resets this room's clock rather than stacking on it
          const nextDueAt = new Date(now() + Number(room.config.callIntervalMs));
          await store.setScheduleFlags({ roomId: room.roomId, nextDueAt });
          scheduler.arm(room, { nextDueAt, intervalMs: room.config.callIntervalMs });
        }
        gate.flush();
        return applied;
      } catch (error) {
        return degrade(room.roomId, error, gate);
      }
    });
  }

  /**
   * A scheduler tick. The tick itself is claimed in the database before a
   * number is chosen, which is what makes "two timers, one tick" impossible.
   */
  async function handleTick(room) {
    const blocked = refuseFrozen(room.roomId);
    if (blocked) return blocked;
    if (room.state !== GameState.RUNNING) {
      if (scheduler) scheduler.cancel(room.roomId);
      return { ok: false, code: ErrorCodes.INVALID_STATE, error: "game is " + room.state };
    }
    const claimed = await store.claimTick({
      roomId: room.roomId,
      gameNumber: room.gameNumber,
      dueAt: now(),
    });
    if (!claimed.claimed) {
      // somebody else already owns this deadline; keep waiting, never double-call
      if (scheduler) await scheduler.rearmFromRow(room);
      return { ok: false, code: "NOT_DUE", error: "this room's tick was already taken" };
    }
    const result = await callNext({ room, source: "scheduler" });
    if (result && result.ok && room.state === GameState.RUNNING && scheduler) {
      scheduler.arm(room, {
        nextDueAt: new Date(claimed.nextDueAt),
        intervalMs: room.config.callIntervalMs,
      });
    } else if (room.state !== GameState.RUNNING && scheduler) {
      scheduler.cancel(room.roomId);
    }
    return { ...result, tick: claimed.tick };
  }

  /** Pause, resume, end, reset: the engine decides, the row records, both agree. */
  async function transition({ room, socketId, action, auth }) {
    const blocked = refuseFrozen(room.roomId);
    if (blocked) return blocked;
    const hostAuth = auth || { socketId };
    if (!durable) return runMemoryTransition(room, hostAuth, action);

    return runExclusive(room.roomId, async () => {
      const gate = registry.dispatchFor(room.roomId);
      gate.suspend();
      const result = runMemoryTransition(room, hostAuth, action);
      if (!result.ok) {
        gate.discard();
        return result;
      }
      try {
        if (action === "pause") {
          await store.setStatus({ roomId: room.roomId, to: GameState.PAUSED });
          await store.setScheduleFlags({ roomId: room.roomId, autoCall: false, nextDueAt: null });
          if (scheduler) scheduler.cancel(room.roomId);
        }
        if (action === "resume") {
          await store.setStatus({ roomId: room.roomId, to: GameState.RUNNING });
          if (room.config.autoCall) {
            const nextDueAt = new Date(now() + Number(room.config.callIntervalMs));
            await store.setScheduleFlags({ roomId: room.roomId, autoCall: true, intervalMs: room.config.callIntervalMs, nextDueAt });
            if (scheduler) scheduler.arm(room, { nextDueAt, intervalMs: room.config.callIntervalMs });
          }
        }
        if (action === "end") {
          await store.setStatus({ roomId: room.roomId, to: GameState.COMPLETED });
          await store.completeGame({ roomId: room.roomId, gameNumber: room.gameNumber, reason: "host ended the game" });
          await store.disarmSchedule({ roomId: room.roomId, gameNumber: room.gameNumber });
          if (scheduler) scheduler.cancel(room.roomId);
        }
        if (action === "reset") {
          await store.setStatus({ roomId: room.roomId, to: GameState.WAITING });
          await store.disarmSchedule({ roomId: room.roomId });
          await store.saveConfig({ roomId: room.roomId, config: publicConfig(room.config) });
          if (scheduler) scheduler.cancel(room.roomId);
        }
        gate.flush();
        return result;
      } catch (error) {
        return degrade(room.roomId, error, gate);
      }
    });
  }

  function runMemoryTransition(room, auth, action) {
    if (action === "pause") return room.pause(auth);
    if (action === "resume") return room.resumeGame(auth);
    if (action === "end") return room.end(auth);
    if (action === "reset") return room.reset(auth);
    return failOf(ErrorCodes.BAD_PAYLOAD, "unknown game action: " + action);
  }

  async function setAutoCall({ room, socketId, enabled, intervalMs, auth }) {
    const blocked = refuseFrozen(room.roomId);
    if (blocked) return blocked;
    const hostAuth = auth || { socketId };
    const result = room.setAutoCall({ enabled, intervalMs, ...hostAuth });
    if (!result.ok || !durable) return result;

    return runExclusive(room.roomId, async () => {
      try {
        await store.saveConfig({ roomId: room.roomId, config: publicConfig(room.config) });
        const nextDueAt =
          room.config.autoCall && room.state === GameState.RUNNING
            ? new Date(now() + Number(room.config.callIntervalMs))
            : null;
        await store.upsertSchedule({
          roomId: room.roomId,
          gameNumber: room.gameNumber,
          autoCall: Boolean(room.config.autoCall),
          intervalMs: room.config.callIntervalMs,
          nextDueAt,
        });
        if (scheduler) {
          if (nextDueAt) scheduler.arm(room, { nextDueAt, intervalMs: room.config.callIntervalMs });
          else scheduler.cancel(room.roomId);
        }
        return result;
      } catch (error) {
        return degrade(room.roomId, error, null);
      }
    });
  }


  /**
   * Opt the room into additional winning patterns.
   *
   * Same shape as setAutoCall: the engine decides whether the request is legal
   * (host credential, WAITING only, known optional pattern ids), and in durable
   * mode the resulting config is written to the room row before the change is
   * acknowledged, so a restart cannot quietly drop back to the default pattern
   * set while players still see the extra prizes.
   */
  async function setPatterns({ room, socketId, patterns, auth }) {
    const blocked = refuseFrozen(room.roomId);
    if (blocked) return blocked;
    const hostAuth = auth || { socketId };
    const result = room.setPatterns({ patterns, ...hostAuth });
    if (!result.ok || !durable) return result;

    return runExclusive(room.roomId, async () => {
      try {
        await store.saveConfig({ roomId: room.roomId, config: publicConfig(room.config) });
        return result;
      } catch (error) {
        return degrade(room.roomId, error, null);
      }
    });
  }

  // -------------------------------------------------------------------- claims

  /**
   * Claim arbitration, durable first: prepare in memory (pure checks), let the
   * database decide exclusivity under a lock, only then award in memory. A
   * restart cannot undo a winner because the winner is a row, not a variable.
   */
  async function claim({ room, playerId, pattern, ticketNo, socketId }) {
    const blocked = refuseFrozen(room.roomId);
    if (blocked) return blocked;
    if (!durable) {
      return room.claim({ playerId, pattern, ticketNo, socketId, playerToken: room.playerCredential(playerId) });
    }

    return runExclusive(room.roomId, async () => {
      const gate = registry.dispatchFor(room.roomId);
      const prepared = room.prepareClaim({
        playerId,
        pattern,
        ticketNo,
        socketId,
        playerToken: room.playerCredential(playerId),
      });
      if (!prepared.ok) {
        // the refusal is decided in memory; logging it must not change the answer
        await store
          .recordClaimDecision({
            roomId: room.roomId,
            gameNumber: room.gameNumber,
            playerId,
            pattern,
            status: "REJECTED",
            reason: prepared.reason || prepared.error,
            callIndex: room.cursor,
          })
          .catch((error) => log("rejected claim not logged", room.roomId, error && error.message));
        return prepared;
      }

      gate.suspend();
      try {
        const award = await store.recordAward({
          roomId: room.roomId,
          gameNumber: room.gameNumber,
          playerId: prepared.prepared.playerId,
          pattern: prepared.prepared.pattern,
          points: prepared.prepared.points,
          callIndex: prepared.prepared.callIndex,
          // Which ticket won. `secondFullHouse` refuses the ticket that took the
          // first Full House, so this is not decoration: lose it and a restart
          // makes the rule forget.
          ticketNo: prepared.prepared.ticketNo ?? null,
          ticketNos: prepared.prepared.ticketNos ?? null,
          exclusive: !room.config.multipleWinnersPerPattern,
        });
        if (!award.ok) {
          gate.discard();
          return {
            ok: false,
            code: award.code === "ALREADY_CLAIMED_BY_YOU" ? ErrorCodes.ALREADY_CLAIMED_BY_YOU : ErrorCodes.ALREADY_AWARDED,
            error:
              award.code === "ALREADY_CLAIMED_BY_YOU"
                ? "you already claimed that"
                : "the database already has a winner for that pattern",
            pattern: prepared.prepared.pattern,
          };
        }
        const committed = room.commitClaim(prepared);
        if (!committed.ok) {
          // the award is durable but the live room refused it: rebuild so both
          // sides tell the same story
          gate.discard();
          await rehydrate(room.roomId);
          return committed;
        }
        gate.flush();
        return committed;
      } catch (error) {
        return degrade(room.roomId, error, gate);
      }
    });
  }

  function mapRefusal(committed, room) {
    if (committed.code === "ROOM_NOT_FOUND") {
      return { ok: false, code: ErrorCodes.ROOM_NOT_FOUND, error: "your room no longer exists" };
    }
    if (committed.code === "DRAW_EXHAUSTED") {
      return failOf(ErrorCodes.DRAW_EXHAUSTED, "all 90 numbers have been called");
    }
    return failOf(
      committed.code === "INVALID_STATE" ? ErrorCodes.INVALID_STATE : committed.code,
      "the server would not accept that call",
      { state: room.state }
    );
  }

  function failOf(code, message, extra = {}) {
    return { ok: false, code, error: message, ...extra };
  }

  // ---------------------------------------------------------------- connections

  /** A socket dropped: engine bookkeeping, then the seat projection. */
  function detachSocket(socket) {
    const session = socket.data && socket.data.session;
    if (!session) return null;
    const room = registry.get(session.roomId);
    if (!room) return null;
    return room.detach(socket.id);
  }

  /**
   * Bring a room into this process before an operator acts on it.
   *
   * The control centre lists every open room in the database, but only rooms
   * that have been recovered into this process can be driven by the engine. The
   * Phase 5 dashboard answered 409 ROOM_NOT_LIVE for the gap, which made a room
   * that simply had not been recovered yet look uncontrollable.
   *
   * Rebuilding goes through the same path a client reconnect uses: load the
   * durable bundle, run the integrity assertion and, if anything disagrees,
   * freeze the room and report RECOVERY_REQUIRED. Nothing is invented, no draw is
   * regenerated, and the one-writer room queue is respected. A closed room is
   * never reopened - it is history.
   */
  async function ensureRoom({ roomId } = {}) {
    if (!roomId) return { ok: false, code: "BAD_PAYLOAD", error: "a room id is required" };
    const blocked = refuseFrozen(roomId);
    if (blocked) return blocked;
    const existing = registry.get(roomId);
    if (existing) return { ok: true, room: existing, recovered: false };
    if (!durable) return { ok: false, code: "ROOM_NOT_LIVE", error: "this room is not live in the server process" };

    let room;
    try {
      room = await runExclusive(roomId, () => rehydrate(roomId));
    } catch (error) {
      const reason = (error && error.message) || "the room could not be rebuilt";
      freeze(roomId, reason);
      await store.setRecoveryError({ roomId, error: reason }).catch(() => {});
      return { ok: false, code: "RECOVERY_REQUIRED", error: "this room could not be rebuilt safely: " + reason };
    }
    if (room) {
      log("room recovered for operator", roomId, room.state);
      return { ok: true, room, recovered: true };
    }
    const frozen = frozenReason(roomId);
    if (frozen) return { ok: false, code: "RECOVERY_REQUIRED", error: "this room needs an operator to clear its recovery error: " + frozen };
    return { ok: false, code: "ROOM_NOT_LIVE", error: "this room is closed; its history is still available" };
  }

  /** Retry a frozen room only after an operator has inspected its durable rows. */
  async function retryRecovery({ roomId } = {}) {
    if (!durable) return { ok: false, code: "ADMIN_UNAVAILABLE", error: "room recovery requires durable storage" };
    if (typeof roomId !== "string" || !roomId) return { ok: false, code: "BAD_PAYLOAD", error: "a room id is required" };
    return runExclusive(roomId, async () => {
      const bundle = await store.loadRoomBundle({ roomId });
      if (!bundle.room) return { ok: false, code: "ROOM_NOT_FOUND", error: "no such room" };
      if (bundle.room.closed_at) return { ok: false, code: "INVALID_STATE", error: "a closed room cannot be recovered" };
      const priorReason = frozenReason(roomId) || bundle.room.recovery_error;
      if (!priorReason) return { ok: false, code: "INVALID_STATE", error: "this room is not marked for recovery" };

      try {
        if (scheduler) scheduler.cancel(roomId);
        const stale = registry.get(roomId);
        if (stale) {
          registry.rooms.delete(roomId);
          stale.destroy();
        }
        // The prior note prevents rehydrate() from loading the room. Clear it
        // under the same room queue, then immediately rerun every integrity
        // check. Any failure below writes a fresh note and keeps the room frozen.
        await store.setRecoveryError({ roomId, error: null });
        const room = await rehydrate(roomId);
        if (!room) throw new IntegrityError("the room could not be rebuilt from its durable state", { roomId });
        frozen.delete(roomId);
        return { ok: true, room, recovered: true };
      } catch (error) {
        const reason = (error && error.message) || "unknown recovery failure";
        freeze(roomId, reason);
        await store.setRecoveryError({ roomId, error: reason }).catch(() => {});
        return { ok: false, code: "RECOVERY_REQUIRED", error: "recovery checks failed; the room remains frozen: " + reason };
      }
    });
  }

  function summary() {
    return {
      durable,
      frozen: [...frozen.entries()].map(([roomId, reason]) => ({ roomId, reason })),
      queues: chains.size,
      auditPending,
    };
  }

  return {
    durable,
    bindScheduler,
    bindRegistry,
    onAudit,
    createRoom,
    createManagedRoom,
    removeParticipant,
    joinRoom,
    resume,
    rotateSession,
    state,
    leave,
    closeRoom,
    selectTickets,
    start,
    callNext,
    handleTick,
    transition,
    setAutoCall,
    setPatterns,
    claim,
    detachSocket,
    rehydrate,
    ensureRoom,
    retryRecovery,
    freeze,
    frozenReason,
    refuseFrozen,
    forgetQueue,
    summary,
    runExclusive,
  };
}
