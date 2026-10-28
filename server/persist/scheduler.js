/**
 * Per-room calling clock.
 *
 * One timer per room, in this process, whose due time lives in the database.
 * Three properties matter and this file exists to keep them:
 *
 *  1. Isolation. A room's timer only ever touches its own room id, and it is
 *     cancelled the moment the room pauses, ends or closes.
 *  2. No double tick. Firing does not call a number; it first asks the database
 *     to hand over this room's scheduled tick (a conditional UPDATE on
 *     room_schedule). Zero rows means somebody else already consumed it, so
 *     nothing is called.
 *  3. No replay after a restart. Recovery reads next_due_at: if it is still in
 *     the future the room continues on that exact deadline; if it has passed,
 *     the missed ticks are dropped and the clock is re-armed one interval from
 *     now. A process restarting is not a reason to call six extra numbers.
 *
 * The engine's own internal timer is switched off in this mode (its
 * `externalScheduler` flag), so a room never has two clocks.
 */

export function createCallScheduler({
  store,
  registry,
  onTick,
  log = () => {},
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (timer) => clearTimeout(timer),
  unref = false,
  /**
   * Authority gate: may this process still issue calls?
   *
   * The scheduler is the only writer that acts without a request behind it, so
   * it must be the first thing to stop when this process stops being the
   * instance that owns the database (lost advisory lock, lost lease row, or a
   * shutdown in progress). A stale clock calling a number on a room another
   * process now owns is the one failure mode a timer can cause that the
   * database cannot undo.
   */
  canTick = null,
} = {}) {
  if (typeof onTick !== "function") throw new Error("createCallScheduler() needs an onTick handler");

  /** roomId -> { timer, epoch, nextDueAt, intervalMs } */
  const armed = new Map();
  let epoch = 0;
  let gate = typeof canTick === "function" ? canTick : null;
  let suspended = false;

  /** Replace the authority check (index.js installs the lease gate). */
  function setCanTick(fn) {
    gate = typeof fn === "function" ? fn : null;
    if (!authorised()) stopAll();
  }

  function authorised() {
    if (suspended) return false;
    if (!gate) return true;
    try {
      return gate() !== false;
    } catch {
      // an authority check that throws is not an authority to spend
      return false;
    }
  }

  function delayFor(nextDueAt) {
    const due = nextDueAt instanceof Date ? nextDueAt.getTime() : Date.parse(nextDueAt || "");
    if (!Number.isFinite(due)) return null;
    return Math.max(0, due - now());
  }

  function cancel(roomId) {
    const entry = armed.get(roomId);
    if (!entry) return false;
    armed.delete(roomId);
    if (entry.timer) clearTimer(entry.timer);
    return true;
  }

  /**
   * Schedule the next call for this room. `nextDueAt` is absolute so the timer
   * and the database row always agree on when the tick belongs to.
   */
  function arm(room, { nextDueAt, intervalMs } = {}) {
    const roomId = room.roomId;
    cancel(roomId);
    if (!authorised()) {
      log("scheduler not armed, no authority", roomId);
      return null;
    }
    const interval = Number(intervalMs ?? room.config.callIntervalMs);
    if (!Number.isFinite(interval) || interval < 500) {
      log("scheduler not armed, interval out of range", roomId, interval);
      return null;
    }

    let due = nextDueAt ?? new Date(now() + interval);
    let delay = delayFor(due);
    if (delay === null) {
      due = new Date(now() + interval);
      delay = interval;
    }
    if (delay < 0) delay = 0;

    const myEpoch = ++epoch;
    const entry = { timer: null, epoch: myEpoch, nextDueAt: due, intervalMs: interval };
    armed.set(roomId, entry);
    entry.timer = setTimer(() => fire(roomId, myEpoch), delay);
    if (unref && entry.timer && typeof entry.timer.unref === "function") entry.timer.unref();
    return { roomId, delay, nextDueAt: due, intervalMs: interval };
  }

  async function fire(roomId, myEpoch) {
    const entry = armed.get(roomId);
    if (!entry || entry.epoch !== myEpoch) return; // superseded by a re-arm
    armed.delete(roomId);
    if (!authorised()) {
      // This process no longer owns the game. Drop the tick: the room's
      // durable schedule still holds the deadline, so the instance that does
      // own it will call the number, exactly once.
      log("scheduler tick dropped, no authority", roomId);
      return;
    }
    try {
      const room = registry.get(roomId);
      if (!room) return;
      await onTick(room, entry);
    } catch (error) {
      log("scheduler tick failed", roomId, error && error.message);
    }
  }

  /** Called by the controller after a tick, with what the database decided. */
  async function rearmFromRow(room) {
    const row = await store.loadSchedule({ roomId: room.roomId });
    if (!row || !row.auto_call || room.state !== "RUNNING") return cancel(room.roomId);
    const interval = row.interval_ms;
    // a row whose deadline already slipped means ticks were missed while this
    // process was down or busy: start a fresh interval instead of catching up
    const delay = delayFor(row.next_due_at);
    const nextDueAt = delay === null || delay <= 0 ? new Date(now() + interval) : row.next_due_at;
    return arm(room, { nextDueAt, intervalMs: interval });
  }

  /**
   * Recovery hook: honour the stored deadline, drop whatever was missed.
   * A paused room, a closed room or a room without auto-call stays disarmed.
   */
  async function recover(room, schedule) {
    if (!schedule) return null;
    if (!schedule.auto_call || room.state !== "RUNNING") {
      cancel(room.roomId);
      return null;
    }
    const interval = schedule.interval_ms;
    const delay = delayFor(schedule.next_due_at);
    const nextDueAt = delay === null || delay <= 0 ? new Date(now() + interval) : schedule.next_due_at;
    if (nextDueAt !== schedule.next_due_at) {
      // persist the corrected deadline so a second restart behaves the same way
      await store.setScheduleFlags({ roomId: room.roomId, nextDueAt });
      log("missed ticks dropped, clock re-armed", room.roomId, interval + "ms");
    }
    return arm(room, { nextDueAt, intervalMs: interval });
  }

  function stopAll() {
    for (const roomId of [...armed.keys()]) cancel(roomId);
  }

  return {
    arm,
    cancel,
    recover,
    rearmFromRow,
    stopAll,
    setCanTick,
    authorised,
    isArmed: (roomId) => armed.has(roomId),
    armed: () => [...armed.entries()].map(([roomId, entry]) => ({
      roomId,
      nextDueAt: entry.nextDueAt,
      intervalMs: entry.intervalMs,
    })),
    count: () => armed.size,
  };
}
