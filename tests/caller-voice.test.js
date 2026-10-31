/**
 * PHASE 17 — THE CALLER'S VOICE, AND THE "SAY THAT AGAIN" CONTROL.
 *
 * Phase 15's queue already guarantees one utterance at a time in call order.
 * Phase 17 adds three caller-facing things on top, and each one has a way to go
 * wrong that must be pinned here:
 *
 *   • a chosen voice, rate and volume — clamped so the engine never receives a
 *     value it will silently ignore, and never persisted as something the user
 *     cannot undo;
 *   • `replay(n)` — the ONLY path that says a number twice. It must refuse to
 *     stutter over the utterance already in flight, must clear whatever was
 *     waiting (a repeat is "say THAT now", not "join the back of the queue"),
 *     and must leave the official-call de-dupe untouched;
 *   • a slower rate — the watchdog has to scale with it, or a slow voice is
 *     killed mid-sentence for being slow.
 *
 * Run with: npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createAnnounceQueue } from "../client/src/lib/announce-queue.js";
import { speakWord } from "../client/src/lib/number-words.js";
import {
  RATE_MAX,
  RATE_MIN,
  clampRate,
  clampVolume,
  getAnnounceSettings,
  repeatAnnouncement,
  setAnnounceSetting,
  voiceSupport,
} from "../client/src/lib/announce.js";

// ---------------------------------------------------------------- fake clock

function makeClock() {
  let t = 0;
  let id = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimeout: (fn, ms) => {
      const key = ++id;
      timers.set(key, { at: t + Math.max(0, ms), fn });
      return key;
    },
    clearTimeout: (key) => timers.delete(key),
    async advance(ms) {
      const target = t + ms;
      for (let guard = 0; guard < 100000; guard++) {
        let next = null;
        for (const [key, timer] of timers) {
          if (timer.at <= target && (next === null || timer.at < next.timer.at)) next = { key, timer };
        }
        if (!next) break;
        timers.delete(next.key);
        t = Math.max(t, next.timer.at);
        next.timer.fn();
        await Promise.resolve();
        await Promise.resolve();
      }
      t = target;
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

/** A speech engine that takes `speakMs` per utterance, or stalls forever. */
function makeEngine(clock, behaviour = {}) {
  const state = { speakMs: 600, stall: false, unavailable: false, ...behaviour };
  const log = { started: [], ended: [], maxConcurrency: 0 };
  let live = 0;
  function speak(text, meta) {
    if (state.unavailable) return null;
    live += 1;
    log.maxConcurrency = Math.max(log.maxConcurrency, live);
    log.started.push({ number: meta.number, text, lang: meta.lang, t: clock.now() });
    const utt = { killed: false };
    const promise = state.stall
      ? new Promise(() => {})
      : new Promise((resolve) => {
          clock.setTimeout(() => {
            if (utt.killed) return;
            live -= 1;
            log.ended.push({ number: meta.number, t: clock.now() });
            resolve({ reason: "natural" });
          }, state.speakMs);
        });
    return {
      promise,
      kill: () => {
        utt.killed = true;
        live -= 1;
        log.ended.push({ number: meta.number, t: clock.now(), reason: "killed" });
      },
    };
  }
  return { speak, log, state };
}

function harness(behaviour = {}, options = {}, rate = 1) {
  const clock = makeClock();
  const engine = makeEngine(clock, behaviour);
  const events = [];
  const queue = createAnnounceQueue({
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    now: clock.now,
    speak: engine.speak,
    language: () => behaviour.language || "en",
    rate: () => rate,
    toWords: (n, lang) => speakWord(n, lang),
    emitEvent: (name, payload) => events.push({ name, ...payload }),
    options,
  });
  queue.setEnabled(true);
  return { clock, engine, queue, events };
}

// --------------------------------------------------------------- the settings

test("speech rate and volume are clamped to what the engine can honour", () => {
  assert.equal(clampRate(1), 1);
  assert.equal(clampRate(RATE_MIN - 1), RATE_MIN, "a crawled voice is still audible");
  assert.equal(clampRate(RATE_MAX + 5), RATE_MAX, "a chipmunk voice is not offered");
  assert.equal(clampRate("1.25"), 1.25);
  assert.equal(clampRate("fast"), 1, "nonsense falls back to the default pace");
  assert.equal(clampRate(undefined), 1);
  assert.equal(clampVolume(0.5), 0.5);
  assert.equal(clampVolume(-1), 0);
  assert.equal(clampVolume(9), 1);
  assert.equal(clampVolume(Number.NaN), 1);
});

test("the console's settings round-trip through the announce layer, clamped", () => {
  setAnnounceSetting("rate", 9);
  setAnnounceSetting("volume", 4);
  setAnnounceSetting("voiceURI", "some-voice-uri");
  const saved = getAnnounceSettings();
  assert.equal(saved.rate, RATE_MAX, "persisted rate is clamped, not the raw 9");
  assert.equal(saved.volume, 1);
  assert.equal(saved.voiceURI, "some-voice-uri");

  setAnnounceSetting("voiceURI", "");
  assert.equal(getAnnounceSettings().voiceURI, null, "clearing the choice returns to the browser default");
  setAnnounceSetting("voiceURI", null);
  assert.equal(getAnnounceSettings().voiceURI, null);

  setAnnounceSetting("rate", 1);
  setAnnounceSetting("volume", 1);
  // Never leaves the layer set to a value the UI cannot show again.
  assert.equal(getAnnounceSettings().rate, 1);
  assert.equal(getAnnounceSettings().volume, 1);
});

test("this environment has no speech engine, and says so instead of pretending", () => {
  // node has no `window`, which is exactly the "engine missing" case a locked
  // down browser presents. The console must be able to say it plainly.
  const support = voiceSupport("hi");
  assert.equal(support.engine, false);
  assert.equal(support.voices, 0);
  assert.equal(support.lang, "hi");
  assert.equal(repeatAnnouncement(42), false, "no engine means the repeat is refused, not queued forever");
  assert.equal(repeatAnnouncement(0), false, "out of range is never spoken");
});

// ------------------------------------------------------------------ the repeat

test("the repeat refuses to stutter over the number already being spoken", async () => {
  const { clock, queue, engine } = harness();
  queue.enqueue(7, 1);
  await clock.advance(0);
  assert.deepEqual(engine.log.started.map((s) => s.number), [7]);

  assert.equal(queue.replay(7), false, "the same number is still in the air");
  await clock.advance(2000);

  assert.equal(queue.replay(7), true, "once it has finished, repeating it is allowed");
  await clock.advance(0);
  assert.deepEqual(engine.log.started.map((s) => s.number), [7, 7], "the one path that speaks a number twice");
  assert.equal(engine.log.maxConcurrency, 1, "and never at the same time");
});

test("a repeat jumps the queue and drops whatever was waiting behind it", async () => {
  const { clock, queue, engine } = harness();
  queue.enqueue(10, 1);
  await clock.advance(0); // 10 speaking
  queue.enqueue(11, 2);
  queue.enqueue(12, 3);
  assert.equal(queue.pendingCount(), 2);

  assert.equal(queue.replay(10) === false, true, "10 is still speaking, so this is refused");
  assert.equal(queue.replay(50), true, "a repeat of an earlier number is accepted");
  assert.equal(queue.pendingCount(), 0, "the backlog is cleared: a repeat is not a request to queue up");
  await clock.advance(3000);
  const spoken = engine.log.started.map((s) => s.number);
  assert.equal(spoken.includes(11), false, "11 never spoke late");
  assert.equal(spoken.includes(12), false, "12 never spoke late");
  assert.deepEqual(spoken, [10, 50]);
});

test("a repeat does not disturb the official-call de-dupe", async () => {
  const { clock, queue, engine } = harness();
  queue.enqueue(7, 1);
  await clock.advance(1000);
  assert.equal(queue.replay(7), true);
  await clock.advance(1000);

  assert.equal(queue.enqueue(7, 1), false, "the official call is still deduped by its index");
  assert.equal(queue.enqueue(8, 2), true, "the next real call announces normally");
  await clock.advance(2000);
  assert.equal(engine.log.started.filter((s) => s.number === 7).length, 2, "one official, one repeat");
  assert.equal(engine.log.started.filter((s) => s.number === 8).length, 1);
});

test("a muted or dead voice refuses a repeat instead of queuing it for later", async () => {
  const { clock, queue } = harness({}, { maxFailures: 1 });
  queue.enqueue(9, 1);
  await clock.advance(0);
  queue.setEnabled(false);
  assert.equal(queue.replay(9), false, "muted");

  queue.setEnabled(true);
  await clock.advance(2000);
  assert.equal(queue.replay(9), true, "unmuted, it can be repeated");
  await clock.advance(2000);

  // engine disappears -> the queue declares itself dead -> repeats stop
  const dead = harness({}, { maxFailures: 1 });
  dead.engine.state.unavailable = true;
  dead.queue.enqueue(20, 1);
  await dead.clock.advance(0);
  assert.equal(dead.queue.isDead(), true);
  assert.equal(dead.queue.replay(20), false, "a dead engine is not asked again");
});

// ------------------------------------------------------------ pacing the voice

/** How long until the watchdog rescues a stalled utterance, at a given rate. */
async function stallAtRate(rate) {
  const { clock, queue, events } = harness({ stall: true }, {}, rate);
  queue.enqueue(5, 1);
  await clock.advance(9500);
  const stall = events.find((e) => e.name === "stall");
  assert.ok(stall, "the watchdog fired at rate " + rate);
  return stall.t;
}

test("a slower speech rate gets a proportionally longer watchdog, not a mid-sentence kill", async () => {
  const fast = await stallAtRate(1);
  const slow = await stallAtRate(0.5);
  assert.ok(fast > 0);
  assert.ok(slow > fast + 1000, "a half-speed voice must be allowed to finish: " + slow + " vs " + fast);
  assert.ok(slow < 9500, "and the wait is still bounded by the watchdog ceiling");
});

test("the queue reports what it is saying, so the console and the voice agree", async () => {
  const { clock, queue, engine } = harness();
  assert.equal(queue.speakNow(), null);
  queue.enqueue(23, 1);
  await clock.advance(0);
  assert.equal(queue.speakNow(), 23, "the console's voice line names the number being spoken");
  await clock.advance(1000);
  assert.equal(queue.speakNow(), null);
  assert.deepEqual(engine.log.started.map((s) => s.number), [23]);
});
