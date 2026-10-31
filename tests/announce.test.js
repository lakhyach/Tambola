/**
 * PHASE B — number-call VOICE SYNCHRONIZATION.
 *
 * These tests drive the announcement queue (client/src/lib/announce-queue.js)
 * with an injected fake clock and a fake speech engine, so the timing behaviour
 * the client reported — "numbers display faster than the voice can speak them"
 * — is proven fixed deterministically, with recorded timestamps for every
 * enqueue / start / end, rather than by eye.
 *
 * Run with: npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createAnnounceQueue, DEFAULT_ANNOUNCE_OPTIONS } from "../client/src/lib/announce-queue.js";
import { englishWords, hindiWords, speakWord } from "../client/src/lib/number-words.js";

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
    // advance to `ms` from now, firing due timers in time order
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

// ----------------------------------------------------------- fake speech engine

/**
 * A speech engine whose utterance takes `speakMs` to finish, unless it is set
 * to stall (never report end) or to be unavailable (return null). Records every
 * start and end with timestamps so tests can assert order and non-overlap.
 */
function makeEngine(behaviour = {}) {
  const log = { started: [], ended: [], concurrent: 0, maxConcurrency: 0 };
  let live = 0;
  const state = { stall: false, unavailable: false, speakMs: 600, ...behaviour };
  const clock = state.clock;

  function speak(text, meta) {
    if (state.unavailable) return null;
    live += 1;
    log.concurrent = live;
    log.maxConcurrency = Math.max(log.maxConcurrency, live);
    log.started.push({ number: meta.number, text, lang: meta.lang, t: clock.now() });
    const utt = { number: meta.number, killed: false };
    const promise = state.stall
      ? new Promise(() => {}) // never settles: the watchdog must rescue it
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

function harness(behaviour = {}, options = {}) {
  const clock = makeClock();
  const engine = makeEngine({ ...behaviour, clock });
  const events = [];
  const queue = createAnnounceQueue({
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    now: clock.now,
    speak: engine.speak,
    language: behaviour.language || (() => "en"),
    toWords: (n, lang) => speakWord(n, lang),
    emitEvent: (name, payload) => events.push({ name, ...payload }),
    options,
  });
  queue.setEnabled(true);
  return { clock, engine, queue, events };
}

// ------------------------------------------------------------------- tests

test("an announcement speaks one number fully before the next starts (no overlap)", async () => {
  const { clock, queue, engine } = harness({}, { gapMs: 140 });
  queue.enqueue(7, 1);
  await clock.advance(0); // pump runs, utterance #1 starts
  queue.enqueue(8, 2); // arrives while #1 is still speaking
  assert.deepEqual(engine.log.started.map((s) => s.number), [7], "#2 must wait, not overlap");
  await clock.advance(600); // #1 finishes
  await clock.advance(200); // gap + #2 starts
  assert.deepEqual(engine.log.started.map((s) => s.number), [7, 8]);
  assert.equal(engine.log.maxConcurrency, 1, "never two utterances at once");
});

test("at a normal pace every number is announced in order, each exactly once", async () => {
  const { clock, queue, engine } = harness();
  // feed one call per interval (default cap 2, speak ~600ms, gap 140ms): a
  // realistic cadence where the voice fully keeps up, so nothing is dropped.
  for (let i = 1; i <= 6; i++) {
    queue.enqueue(i * 10, i);
    await clock.advance(1000); // comfortably longer than one utterance + gap
  }
  await clock.advance(3000); // let the last one finish
  assert.deepEqual(engine.log.started.map((s) => s.number), [10, 20, 30, 40, 50, 60]);
  assert.equal(engine.log.maxConcurrency, 1);
  const seqs = engine.log.started.map((s) => s.number);
  assert.equal(new Set(seqs).size, seqs.length, "no number announced twice");
});

test("a replayed or lower call index is ignored (reconnect must not replay history)", async () => {
  const { clock, queue, engine } = harness();
  queue.enqueue(50, 10);
  await clock.advance(0);
  // same number re-delivered, and an older one from a stale buffer:
  assert.equal(queue.enqueue(50, 10), false, "same seq twice is refused");
  assert.equal(queue.enqueue(30, 8), false, "a lower seq is stale");
  await clock.advance(2000);
  assert.deepEqual(engine.log.started.map((s) => s.number), [50], "only the fresh call spoke");
});

test("seeding the guard with the current index makes a reload silent", async () => {
  const { clock, queue, engine } = harness();
  queue.markSeen(45); // reconnect at call 45
  assert.equal(queue.enqueue(12, 30), false, "a number from the past is dropped silently");
  assert.equal(queue.enqueue(77, 46), true, "the next fresh call is accepted");
  await clock.advance(1500);
  assert.deepEqual(engine.log.started.map((s) => s.number), [77]);
});

test("when the voice cannot keep the pace, the OLDEST unspoken number drops and order holds", async () => {
  // cap 2 pending; flood faster than one utterance completes
  const { clock, queue, engine, events } = harness({}, { pendingCap: 2, gapMs: 0 });
  // start #1 speaking
  queue.enqueue(1, 1);
  await clock.advance(0);
  // now pile up while #1 still speaks; only 2 may wait
  for (let i = 2; i <= 6; i++) queue.enqueue(i, i);
  const drops = events.filter((e) => e.name === "drop");
  assert.ok(drops.length >= 1, "some numbers had to be forfeited");
  assert.equal(queue.pendingCount() <= 2, true, "never more than the cap waiting");
  await clock.advance(60000);
  const spoken = engine.log.started.map((s) => s.number);
  // what IS spoken must be in ascending order regardless of drops
  const ascending = spoken.every((n, i) => i === 0 || n > spoken[i - 1]);
  assert.equal(ascending, true, "spoken numbers stay in call order: " + spoken.join(","));
  assert.ok(spoken.includes(1), "the number already speaking is never yanked");
});

test("a stalled engine (end event swallowed) is rescued by the watchdog, not frozen", async () => {
  const { clock, queue, engine, events } = harness({ stall: true });
  queue.enqueue(23, 1);
  await clock.advance(0);
  assert.deepEqual(engine.log.started.map((s) => s.number), [23], "utterance started");
  assert.equal(queue.pendingCount(), 0);
  queue.enqueue(24, 2); // waiting behind the stuck utterance
  const wait = queue.options.watchdogMaxMs + queue.options.gapMs + 1000;
  await clock.advance(wait);
  const stall = events.find((e) => e.name === "stall");
  assert.ok(stall, "watchdog fired a stall for the stuck number");
  assert.deepEqual(engine.log.started.map((s) => s.number), [23, 24], "the queue advanced past the stall");
});

test("a temporarily unavailable engine forfeits numbers, then declares itself dead", async () => {
  const { clock, queue, engine, events } = harness({}, { maxFailures: 2 });
  engine.state.unavailable = true;
  assert.equal(queue.enqueue(5, 1), true, "accepted into queue even if engine is down");
  await clock.advance(0); // pump tries, engine returns null -> drop #1
  queue.enqueue(6, 2);
  await clock.advance(0); // second failure -> dead
  assert.equal(queue.isDead(), true, "two no-engine attempts mark it dead");
  assert.ok(events.find((e) => e.name === "dead"), "death reported");
  // engine comes back: user re-enables (setEnabled revives)
  engine.state.unavailable = false;
  queue.setEnabled(false);
  queue.setEnabled(true);
  assert.equal(queue.isDead(), false, "re-enabling attempts a fresh engine");
  queue.enqueue(9, 3);
  await clock.advance(1500);
  assert.equal(engine.log.started.some((s) => s.number === 9), true, "speech works again");
});

test("a dead engine is revived by an explicit enable, without muting first", async () => {
  const { clock, queue, engine } = harness({}, { maxFailures: 2 });
  engine.state.unavailable = true;
  queue.enqueue(11, 1);
  await clock.advance(0); // no-engine drop #1
  queue.enqueue(12, 2);
  await clock.advance(0); // no-engine drop #2 -> dead
  assert.equal(queue.isDead(), true, "engine died while the switch stayed on");
  assert.equal(queue.isEnabled(), true, "death does not flip the switch");
  engine.state.unavailable = false;
  queue.setEnabled(true); // RETRY: same value, explicit user action
  assert.equal(queue.isDead(), false, "an explicit enable revives the engine");
  queue.enqueue(13, 3);
  await clock.advance(1500);
  assert.equal(engine.log.started.some((s) => s.number === 13), true, "speech works again");
});

test("pause stops the current announcement and drains the queue; resume continues fresh", async () => {
  const { clock, queue, engine } = harness();
  queue.enqueue(31, 1);
  queue.enqueue(32, 2);
  await clock.advance(0); // 31 speaking, 32 waiting
  assert.equal(queue.pendingCount(), 1);
  queue.stop(); // host paused the game mid-announcement
  assert.equal(queue.pendingCount(), 0, "the waiting number is dropped on pause");
  queue.enqueue(33, 3); // resume, a new call
  await clock.advance(1500);
  assert.equal(engine.log.started.some((s) => s.number === 32), false, "the paused number never spoke late");
  assert.equal(engine.log.started.some((s) => s.number === 33), true, "the resumed call speaks");
});

test("muting speech skips calls and they stay skipped when unmuted", async () => {
  const { clock, queue, engine } = harness();
  queue.setEnabled(false); // player mutes
  assert.equal(queue.enqueue(40, 1), false);
  assert.equal(queue.enqueue(41, 2), false);
  queue.setEnabled(true); // unmutes mid-round
  await clock.advance(0);
  assert.equal(engine.log.started.length, 0, "muted calls are never announced after unmuting");
  queue.enqueue(42, 3); // a call after unmuting
  await clock.advance(1500);
  assert.deepEqual(engine.log.started.map((s) => s.number), [42]);
});

test("hindi announcements use devanagari number words for the same call", async () => {
  let lang = "hi";
  const { clock, queue, engine } = harness({ language: () => lang });
  queue.enqueue(15, 1);
  await clock.advance(0);
  assert.equal(engine.log.started[0].lang, "hi");
  assert.equal(engine.log.started[0].text, hindiWords(15));
  lang = "en";
  queue.enqueue(15, 2);
  await clock.advance(1500);
  assert.equal(engine.log.started[1].text, englishWords(15));
});

// ------------------------------------------------------ number word coverage

test("every number 1-90 has an English and a Hindi spoken form", () => {
  for (let n = 1; n <= 90; n++) {
    assert.equal(typeof englishWords(n), "string", `english ${n}`);
    assert.ok(englishWords(n).length > 0);
    assert.equal(typeof hindiWords(n), "string", `hindi ${n}`);
    assert.ok(hindiWords(n).length > 0);
  }
});

test("the confusable pairs get distinct words", () => {
  assert.notEqual(englishWords(15), englishWords(50));
  assert.notEqual(englishWords(16), englishWords(60));
  assert.notEqual(hindiWords(15), hindiWords(50));
  assert.notEqual(hindiWords(16), hindiWords(60));
  assert.equal(hindiWords(90), "नब्बे");
});

test("speakWord never throws and falls back to digits out of range", () => {
  assert.equal(speakWord(7, "en"), "seven");
  assert.equal(speakWord(7, "hi"), hindiWords(7));
  assert.equal(speakWord(200, "en"), "200", "out of Tambola range -> digits");
  assert.equal(speakWord(null, "en"), "null");
});

test("defaults are sane and finite (safe maximum wait exists)", () => {
  assert.ok(Number.isFinite(DEFAULT_ANNOUNCE_OPTIONS.pendingCap));
  assert.ok(DEFAULT_ANNOUNCE_OPTIONS.watchdogMaxMs > 0);
  const { clock, queue } = harness();
  assert.equal(queue.isEnabled(), true);
});
