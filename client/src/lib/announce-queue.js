/**
 * SPOKEN-CALL ANNOUNCEMENT QUEUE — the voice half of "one number, spoken once,
 * in order".
 *
 * The defect this replaces: every arriving call used to cancel the speech
 * engine and start again, so on a fast interval (or a host clicking "Call
 * next" repeatedly) each number's announcement was cut off mid-word and the
 * voice could never keep the display. Announcing straight from the snapshot's
 * `lastCall` made it worse — two calls landing while one state fetch was in
 * flight meant the FIRST number was never announced at all, and out-of-order
 * fetch responses could announce numbers backwards.
 *
 * The rule set here, in priority order:
 *   1. Every officially-called number is announced exactly once, in call
 *      order. Feed with (number, seq) pairs; an older seq never speaks.
 *   2. Utterances NEVER overlap: the next one starts only after the engine
 *      reports the previous one finished (end/error/watchdog, whichever first,
 *      guaranteed to settle exactly once per utterance).
 *   3. A slow voice may lag the board by at most `pendingCap` waiting numbers.
 *      When the queue is full the OLDEST unspoken number is dropped — a player
 *      misses one quiet announcement rather than the voice sliding permanently
 *      behind the game. With the one being spoken, the longest honest lag is
 *      `pendingCap + 1` calls behind the newest call. Drops are reported
 *      through the "drop" event so a test (or the UI) can see the lag.
 *   4. A broken engine cannot freeze anything: every utterance carries a
 *      watchdog (`estimateMs x 2.5 + 2500`, always finite). If Chrome swallows
 *      the end event — a known bug — the queue advances anyway. Two failures
 *      in a row mark the engine dead, drain the queue, and stop spending
 *      utterances until the user re-enables speech.
 *   5. `mute()` stops the current utterance and empties the queue; `reset()`
 *      forgets seen numbers between rounds without touching the server.
 *
 * Architecture: this queue is pure presentation. The server's draw, clock and
 * awards are entirely authoritative; nothing here can alter game state, a
 * player's speech speed (or a dead speech engine) can never block the room's
 * scheduler or another player's experience, and every device announces for
 * itself — there is no designated announcer whose browser would gate the game.
 */

export const DEFAULT_ANNOUNCE_OPTIONS = Object.freeze({
  /** unspoken numbers allowed to wait behind the current utterance */
  pendingCap: 2,
  /** minimum plausible seconds for one short phrase, at rate 1 */
  minSpeakMs: 900,
  /** extra ms per character of the spoken phrase */
  perCharMs: 55,
  /** watchdog margin multiplier over the estimate before forcing advance */
  watchdogFactor: 2.5,
  /** absolute watchdog ceiling — the safe maximum wait, never infinite */
  watchdogMaxMs: 9000,
  /** breath between announcements */
  gapMs: 140,
  /** consecutive utterance failures before declaring the engine dead */
  maxFailures: 2,
  /** remembered seq numbers, so a long game cannot grow this unbounded */
  seenLimit: 256,
});

/**
 * @param {object} deps injected so tests run this on a fake clock with a fake
 *   speech engine, and the browser wiring can stay a thin adapter.
 * @param {(fn:number, ms:number)=>any} deps.setTimeout
 * @param {(t:any)=>void} deps.clearTimeout
 * @param {()=>number} deps.now
 * @param {(text:string, meta:{number:number, lang:string})=>{promise:Promise<{reason:string}>}|null} deps.speak
 *   Starts one utterance. MUST NOT overlap with a previous unfinished one —
 *   this module only ever calls it after the previous promise settled.
 *   Returning null means "no engine available right now".
 * @param {()=>string} [deps.language] current speech language, "en" | "hi"
 * @param {(n:number, lang:string)=>string} deps.toWords spoken form of a number
 * @param {(n:number)=>void} [deps.onStart] fired when an utterance starts (chime)
 * @param {(name:string, payload:object)=>void} [deps.emitEvent] timestamped
 *   observation hook: enqueue / start / end / drop / stall / dead
 * @param {object} [deps.options] overrides over DEFAULT_ANNOUNCE_OPTIONS
 */
export function createAnnounceQueue(deps = {}) {
  const {
    setTimeout: setT = (fn, ms) => setTimeout(fn, ms),
    clearTimeout: clearT = (t) => clearTimeout(t),
    now = () => Date.now(),
    speak,
    language = () => "en",
    toWords = (n) => String(n),
    onStart = null,
    emitEvent = null,
    options,
  } = deps;
  const opt = { ...DEFAULT_ANNOUNCE_OPTIONS, ...(options || {}) };

  const queue = []; // [{ number, seq }]
  // Official call indices are strictly increasing (1,2,3…), so a single
  // high-water mark is the replay guard: anything at or below it is stale.
  // Seeding it with the current calledCount is what makes a reconnect silent.
  let highWater = 0;
  let current = null; // { number, seq, settled }
  let watchdog = null;
  let gapTimer = null;
  let failures = 0;
  let dead = false;
  let enabled = false;
  let listeners = new Set();

  function fire(name, payload) {
    if (!emitEvent) return;
    try {
      emitEvent(name, { ...payload, t: now() });
    } catch {
      /* an observer must never break the announcement loop */
    }
  }
  function notify() {
    for (const fn of listeners) {
      try {
        fn(pendingCount());
      } catch {
        /* same: listeners are best-effort */
      }
    }
  }

  /** How many numbers are waiting (not counting the one being spoken). */
  function pendingCount() {
    return queue.length;
  }

  function estimateMs(text) {
    return Math.min(opt.watchdogMaxMs, Math.round((opt.minSpeakMs + text.length * opt.perCharMs) * opt.watchdogFactor) + 2500);
  }

  function settleCurrent(reason) {
    if (!current) return;
    const done = current;
    current = null;
    if (watchdog) {
      clearT(watchdog);
      watchdog = null;
    }
    if (reason === "natural" || reason === "end") failures = 0;
    fire("end", { number: done.number, seq: done.seq, reason });
    notify();
    if (enabled && !dead) {
      // If calls are already waiting, chain straight into the next one: a
      // breath here lets another call arrive during the silence, which is what
      // pushed the voice an extra number behind on a fast cadence. The gap is
      // only a breath between bursts, never a chance to fall further behind.
      if (queue.length) pump();
      else {
        gapTimer = setT(() => {
          gapTimer = null;
          pump();
        }, opt.gapMs);
      }
    }
  }

  function pump() {
    if (current || !enabled || dead) return;
    if (typeof speak !== "function") return;
    const item = queue.shift();
    if (!item) return;
    const lang = language();
    const text = toWords(item.number, lang);
    let handle = null;
    try {
      handle = speak(text, { number: item.number, lang });
    } catch {
      handle = null;
    }
    if (!handle || typeof handle.promise?.then !== "function") {
      // no engine right now: this number is forfeited (not queued forever),
      // counted as a failure so repeated absence declares the engine dead.
      failures += 1;
      fire("drop", { number: item.number, seq: item.seq, why: "no-engine" });
      notify();
      if (failures >= opt.maxFailures) declareDead();
      return;
    }
    current = { number: item.number, seq: item.seq };
    fire("start", { number: item.number, seq: item.seq, text });
    notify();
    if (onStart) {
      try {
        onStart(item.number);
      } catch {
        /* the chime failing must not stop the voice */
      }
    }
    handle.promise
      .then(({ reason } = { reason: "natural" }) => {
        if (reason === "failed") {
          failures += 1;
          if (failures >= opt.maxFailures) {
            // stop spending utterances on an engine that only errors; the
            // current one still settles so any observer sees it end.
            dead = true;
            drain();
            fire("dead", { number: item.number, seq: item.seq });
          }
        }
        settleCurrent(reason);
      })
      .catch(() => settleCurrent("error"));
    watchdog = setT(() => {
      watchdog = null;
      // The engine never reported this utterance (a real Chrome bug class).
      // Free the queue: the promise is disowned, its later resolution matches
      // no `current` and settles nothing twice.
      if (!current) return;
      const c = current;
      current = null;
      fire("stall", { number: c.number, seq: c.seq });
      try {
        handle.kill?.();
      } catch {
        /* engine already gone */
      }
      notify();
      if (enabled && !dead) {
        gapTimer = setT(() => {
          gapTimer = null;
          pump();
        }, opt.gapMs);
      }
    }, estimateMs(text));
  }

  function declareDead() {
    dead = true;
    drain();
    fire("dead", {});
    notify();
  }

  function drain() {
    queue.length = 0;
    notify();
  }

  /**
   * Accept one official call. `seq` is the server's own call index (strictly
   * increasing within a round): anything at or below the high-water mark is a
   * replay or stale catch-up and is ignored, which makes reconnect silent — a
   * reloaded page seeds the mark with `markSeen` instead of enqueueing history.
   */
  function enqueue(number, seq) {
    if (!Number.isInteger(number) || number < 1 || number > 90) return false;
    if (!Number.isInteger(seq)) return false;
    if (seq <= highWater) return false; // replay / stale catch-up
    highWater = seq;
    if (dead) return false;
    if (!enabled) {
      // A muted player's skipped calls stay skipped when they unmute: the
      // voice announces what is happening NOW, not a backlog of silences.
      return false;
    }
    // A backlog beyond the cap means the voice cannot sustain this calling
    // speed. Drop the OLDEST unspoken number so what IS spoken stays in order.
    while (queue.length >= opt.pendingCap) {
      const stale = queue.shift();
      fire("drop", { number: stale.number, seq: stale.seq, why: "backlog" });
    }
    queue.push({ number, seq });
    fire("enqueue", { number, seq, pending: queue.length });
    notify();
    pump();
    return true;
  }

  /** Seed the replay guard (e.g. with the current call index on page load). */
  function markSeen(seq) {
    if (Number.isInteger(seq) && seq > highWater) highWater = seq;
  }

  function setEnabled(on) {
    const next = Boolean(on);
    if (next === enabled) {
      // "on" is not always a no-op: when the engine died mid-round the switch
      // is still on, so an explicit enable (the user tapping the chip again)
      // is the retry. Without this the only way back was mute-then-unmute.
      if (next && dead) {
        dead = false;
        failures = 0;
        pump();
      }
      return enabled;
    }
    enabled = next;
    if (!enabled) {
      stop();
    } else {
      // re-enabling revives a dead engine attempt (the user acted, so the
      // browser may now have voices it lacked before)
      if (dead) {
        dead = false;
        failures = 0;
      }
      pump();
    }
    return enabled;
  }

  /** Stop the current utterance, empty the queue. Keeps the seen guard. */
  function stop() {
    drain();
    if (gapTimer) {
      clearT(gapTimer);
      gapTimer = null;
    }
    if (current) {
      const c = current;
      current = null;
      if (watchdog) {
        clearT(watchdog);
        watchdog = null;
      }
      fire("end", { number: c.number, seq: c.seq, reason: "stopped" });
      notify();
    }
  }

  /** Forget everything including the replay guard — new round. */
  function reset() {
    stop();
    highWater = 0;
    failures = 0;
  }

  function pending() {
    return queue.map((q) => q.number);
  }

  return {
    enqueue,
    markSeen,
    setEnabled,
    stop,
    reset,
    speakNow: () => current?.number ?? null,
    pending,
    pendingCount,
    isDead: () => dead,
    isEnabled: () => enabled,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    options: opt,
  };
}
