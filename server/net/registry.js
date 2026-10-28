/**
 * Live room registry.
 *
 * Deliberately a Map, not a plain object: the original build keyed rooms in an
 * object literal, so identifiers like "__proto__" or "toString" behaved
 * unpredictably. Room codes are server-generated and unambiguous, and the
 * registry is the only place that maps a code to a live game.
 *
 * Phase 3: this is no longer the whole story. The registry holds the rooms that
 * are live *in this process*; the database holds the rooms that exist. A boot
 * therefore starts by rebuilding rooms from durable state (persist/recovery.js)
 * through restore(), and a room that cannot be rebuilt is frozen rather than
 * invented. Without a database this file behaves exactly as it did in Phase 2.
 */

import { TambolaRoom, newRoomId } from "../game/engine.js";
import { createDispatchHub } from "./dispatch.js";

export function createRoomRegistry({
  io,
  config,
  log = () => {},
  dispatch,
  onAudit,
  onHostGone,
  externalScheduler = false,
  keepHostSeat = false,
} = {}) {
  const rooms = new Map();
  const hub = dispatch || createDispatchHub({ io, log });

  function build(roomId, { hydrate, overrides } = {}) {
    return new TambolaRoom({
      roomId,
      // every engine emission goes through the room's gate, which lets the
      // persistence layer hold it back until the write is committed
      emit: (event, payload) => hub.for(roomId).emit(event, payload),
      emitTo: (socketId, event, payload) => hub.for(roomId).emitTo(socketId, event, payload),
      config: { ...(config || {}), ...(overrides || {}) },
      // In memory-only mode a room dies when its host participant is removed
      // for good - a plain socket drop (browser refresh) must not kill
      // everybody's game. With a database the runtime takes over here: the
      // room is paused and stays in the registry, because a game that real
      // players are watching is not this host's property to lose.
      onHostGone: onHostGone
        ? (playerId, reason) => onHostGone(roomId, playerId, reason)
        : () => close(roomId, "the host left the game"),
      onAudit: onAudit ? (entry) => onAudit(roomId, entry) : undefined,
      externalScheduler,
      keepHostSeat,
      hydrate,
    });
  }

  function create(overrides = {}) {
    let roomId = newRoomId();
    while (rooms.has(roomId)) roomId = newRoomId();
    const room = build(roomId, { overrides });
    rooms.set(roomId, room);
    log("room created", roomId);
    return room;
  }

  /** Put a room back exactly as the database described it. */
  function restore({ roomId, hydrate, overrides } = {}) {
    if (!roomId) throw new Error("restore() needs a room id");
    if (rooms.has(roomId)) return rooms.get(roomId);
    const room = build(roomId, { hydrate, overrides });
    rooms.set(roomId, room);
    log("room restored", roomId, room.state, "game", room.gameNumber);
    return room;
  }

  function get(roomId) {
    return rooms.get(roomId) || null;
  }

  /**
   * Take the room out of play. With a database the caller has already marked
   * the row closed, so nothing is destroyed - only this process forgets it.
   */
  function close(roomId, reason = "room closed") {
    const room = rooms.get(roomId);
    if (!room) return false;
    rooms.delete(roomId);
    if (io) {
      io.to(roomId).emit("room:closed", { roomId, reason });
      io.in(roomId).socketsLeave(roomId);
    }
    hub.remove(roomId);
    room.destroy();
    log("room closed", roomId, reason);
    return true;
  }

  /** Flag a dropped connection inside its room. The room itself survives. */
  function detachSocket(socket) {
    const session = socket.data && socket.data.session;
    if (!session) return null;
    const room = rooms.get(session.roomId);
    if (!room) return null;
    return room.detach(socket.id);
  }

  /**
   * Sockets that are connected to this server right now and belong to one room,
   * with the session each of them proved. Recovery uses this to re-attach live
   * connections after a rebuild: the database says who *was* seated, the socket
   * table says who is actually here.
   */
  async function ioSocketsFor(roomId) {
    if (!io || typeof io.in !== "function") return [];
    const sockets = await io.in(roomId).fetchSockets();
    const entries = [];
    for (const socket of sockets) {
      entries.push({ socketId: socket.id, session: socket.data && socket.data.session });
    }
    return entries;
  }

  function list() {
    return [...rooms.values()].map((room) => ({
      roomId: room.roomId,
      state: room.state,
      players: room.players.size,
      called: room.cursor,
      gameNumber: room.gameNumber,
    }));
  }

  function all() {
    return [...rooms.values()];
  }

  /** Only used by an in-memory shutdown; durable rooms are closed, not lost. */
  function destroyAll() {
    for (const roomId of [...rooms.keys()]) close(roomId, "server shutting down");
  }

  return {
    create,
    restore,
    get,
    close,
    detachSocket,
    ioSocketsFor,
    list,
    all,
    destroyAll,
    size: () => rooms.size,
    rooms,
    hub,
    dispatchFor: (roomId) => hub.for(roomId),
  };
}
