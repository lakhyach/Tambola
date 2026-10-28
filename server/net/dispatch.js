/**
 * Per-room broadcast gate.
 *
 * The engine emits synchronously the moment its state changes, but with a
 * database an emission is a promise to the players that the change is already
 * durable. This gate is what keeps that promise: while a room write is in
 * flight the engine's events are buffered here, and the persistence layer
 * decides whether they are released (commit succeeded) or destroyed (commit
 * failed, nothing was ever announced).
 *
 * Not a queue of game state - the snapshot is always re-read from the engine -
 * only a hold on the wire, so a client can never see a number that the
 * database does not have.
 */

export function createDispatchHub({ io, log = () => {} } = {}) {
  const gates = new Map();

  function forRoom(roomId) {
    let gate = gates.get(roomId);
    if (gate) return gate;

    let suspended = false;
    let buffered = [];

    const send = (socketId, event, payload) => {
      if (!io) return;
      if (socketId === null) io.to(roomId).emit(event, payload);
      else io.to(socketId).emit(event, payload);
    };

    gate = {
      roomId,
      get suspended() {
        return suspended;
      },
      get buffered() {
        return buffered.length;
      },
      /** engine events are held instead of reaching the wire */
      suspend() {
        suspended = true;
        buffered = [];
      },
      /** release everything the write earned, in the order it was emitted */
      flush() {
        const pending = buffered;
        buffered = [];
        suspended = false;
        for (const frame of pending) send(frame.socketId, frame.event, frame.payload);
        return pending.length;
      },
      /** the write failed: these events were never authoritative */
      discard() {
        const dropped = buffered.length;
        buffered = [];
        suspended = false;
        if (dropped) log("dropped uncommitted broadcasts", roomId, dropped);
        return dropped;
      },
      emit(event, payload) {
        gate.emitTo(null, event, payload);
      },
      emitTo(socketId, event, payload) {
        if (!suspended) return send(socketId, event, payload);
        if (buffered.length > 2000) {
          log("broadcast buffer overflow, dropping", roomId);
          buffered.shift();
        }
        buffered.push({ socketId, event, payload });
      },
      /** a room that is closing must not keep a gate around */
      close() {
        suspended = false;
        buffered = [];
      },
    };
    gates.set(roomId, gate);
    return gate;
  }

  return {
    for: forRoom,
    has: (roomId) => gates.has(roomId),
    remove(roomId) {
      const gate = gates.get(roomId);
      if (gate) gate.close();
      gates.delete(roomId);
    },
    /** direct wire access for things that are not engine output */
    to(roomId, event, payload) {
      if (io) io.to(roomId).emit(event, payload);
    },
  };
}
