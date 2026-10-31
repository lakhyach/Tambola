/**
 * PHASE 17 — THE CALLER CONSOLE (view-model + the engine read-outs it renders).
 *
 * Two things are pinned here.
 *
 * 1. Every value the console displays is DERIVED, never invented: the calling
 *    interval is clamped to the range the server accepts, the clock advances
 *    only while the round is running, the "next number" slot is a sealed count
 *    with no number in it, and each control is enabled only when the server's
 *    state says it would be allowed.
 *
 * 2. The engine read-outs those derivations rely on (`elapsedMs`, `startedAt`,
 *    `gameNumber`, `maxPlayers`, the cadence in `game:set-autocall`) behave the
 *    way the console assumes: the round clock stops when the round is paused or
 *    over, survives pause/resume without losing time, and an interval change
 *    re-times the NEXT call without ever drawing twice.
 *
 * Run with: npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  CALLER_KEYS,
  INTERVAL_MAX_MS,
  INTERVAL_MIN_MS,
  INTERVAL_PRESETS,
  callRows,
  callerActions,
  clampInterval,
  elapsedAt,
  formatClock,
  hotkeyCommand,
  intervalLabel,
  intervalPayload,
  isTypingTarget,
  nextCallHint,
  nextCallPreview,
  recentCalls,
  roomSummary,
  voiceStatus,
} from "../client/src/lib/caller.js";
import { makeRoom, callThrough } from "./helpers.js";

// ------------------------------------------------------- the calling interval

test("every interval the console offers is one the server accepts", () => {
  assert.ok(INTERVAL_PRESETS.length >= 5, "a caller needs a real choice of pace");
  for (const ms of INTERVAL_PRESETS) {
    assert.equal(clampInterval(ms), ms, "preset outside the server's range: " + ms);
    assert.ok(ms >= INTERVAL_MIN_MS && ms <= INTERVAL_MAX_MS);
  }
  assert.deepEqual([...INTERVAL_PRESETS].sort((a, b) => a - b), [...INTERVAL_PRESETS], "presets read left to right");
  assert.equal(new Set(INTERVAL_PRESETS).size, INTERVAL_PRESETS.length, "no duplicate pace");
});

test("an unsafe cadence is refused before it is ever sent", () => {
  assert.equal(clampInterval(INTERVAL_MIN_MS - 1), null, "below the server minimum");
  assert.equal(clampInterval(INTERVAL_MAX_MS + 1), null, "above the server maximum");
  assert.equal(clampInterval(Number.NaN), null);
  assert.equal(clampInterval(undefined), null);
  assert.equal(clampInterval(null), null);
  assert.equal(clampInterval("eight seconds"), null);
  assert.equal(clampInterval("8000"), 8000, "a numeric string is still a number of milliseconds");
  assert.equal(clampInterval(8000.4), 8000, "fractions are rounded to whole milliseconds");
});

test("changing the cadence never flips the auto-call switch", () => {
  const payload = intervalPayload(5000);
  assert.deepEqual(payload, { intervalMs: 5000 });
  assert.deepEqual(Object.keys(payload), ["intervalMs"], "no `enabled` key: a pace change must not stop the loop");
  assert.equal(intervalPayload(1), null, "an invalid pace sends nothing at all");
  assert.equal(intervalLabel(8000), "8s");
  assert.equal(intervalLabel(2500), "2.5s");
  assert.equal(intervalLabel(0), "—", "an unknown cadence is said, not guessed");
});

// ---------------------------------------------------------------- round clock

test("the round clock reads MM:SS and rolls over to H:MM:SS", () => {
  assert.equal(formatClock(0), "00:00");
  assert.equal(formatClock(9_000), "00:09");
  assert.equal(formatClock(61_000), "01:01");
  assert.equal(formatClock(3_661_000), "1:01:01");
  assert.equal(formatClock(-5000), "00:00", "a clock never runs backwards");
  assert.equal(formatClock(undefined), "00:00");
});

test("the displayed clock ticks only while the server says the round is running", () => {
  const base = { elapsedMs: 12_000, receivedAt: 1_000_000 };
  assert.equal(elapsedAt({ ...base, state: "RUNNING", now: 1_004_000 }), 16_000, "running: local tick from the anchor");
  assert.equal(elapsedAt({ ...base, state: "PAUSED", now: 1_004_000 }), 12_000, "paused: frozen at the server value");
  assert.equal(elapsedAt({ ...base, state: "COMPLETED", now: 1_004_000 }), 12_000, "over: frozen");
  assert.equal(elapsedAt({ ...base, state: "WAITING", now: 1_004_000 }), 12_000, "not started: whatever the server holds");
  assert.equal(
    elapsedAt({ state: "RUNNING", elapsedMs: 0, receivedAt: 0, now: 5000 }),
    5000,
    "an unanchored snapshot starts from its own value"
  );
  assert.equal(
    elapsedAt({ state: "RUNNING", elapsedMs: 900, receivedAt: 2000, now: 1000 }),
    900,
    "a clock that appears to go backwards is not counted"
  );
});

// ------------------------------------------------------------- control gating

test("before the round starts only a start is offered", () => {
  const waiting = callerActions({ state: "WAITING", seated: 2, connected: true });
  assert.equal(waiting.start.enabled, true);
  for (const action of ["call", "pause", "resume", "end", "reset", "autocall"]) {
    assert.equal(waiting[action].enabled, false, action + " must not be offered before the start");
    assert.ok(waiting[action].reason.length > 0, action + " has to say why not");
  }
  assert.equal(waiting.interval.enabled, true, "the pace can be chosen before the round opens");
  assert.equal(callerActions({ state: "WAITING", seated: 0 }).start.enabled, false, "nobody to call for");
  assert.equal(callerActions({ state: "WAITING", seated: 1, connected: false }).start.enabled, false, "offline");
});

test("a running round offers call, pause and end — never a second start", () => {
  const running = callerActions({ state: "RUNNING", seated: 3, remaining: 60 });
  assert.equal(running.call.enabled, true);
  assert.equal(running.pause.enabled, true);
  assert.equal(running.end.enabled, true);
  assert.equal(running.start.enabled, false);
  assert.equal(running.resume.enabled, false);
  assert.equal(running.reset.enabled, false, "a reset is only offered once the round is over");
  assert.match(running.start.reason, /already open/);
});

test("a paused round offers resume, not a call", () => {
  const paused = callerActions({ state: "PAUSED", seated: 3, remaining: 40 });
  assert.equal(paused.resume.enabled, true);
  assert.equal(paused.call.enabled, false);
  assert.match(paused.call.reason, /paused/);
  assert.equal(paused.pause.enabled, false);
  assert.equal(paused.end.enabled, true, "a paused round can still be ended");
  assert.equal(paused.interval.enabled, true, "the pace can be changed while paused");
});

test("a finished round offers only a reset", () => {
  const finished = callerActions({ state: "COMPLETED", seated: 3, remaining: 0 });
  assert.equal(finished.reset.enabled, true);
  for (const action of ["start", "call", "pause", "resume", "end", "autocall", "interval"]) {
    assert.equal(finished[action].enabled, false, action + " must not be offered after the round");
    assert.ok(finished[action].reason.length > 0);
  }
});

test("no control fires while a request is in flight or the bag is empty", () => {
  assert.equal(callerActions({ state: "RUNNING", remaining: 10, busy: true }).call.enabled, false);
  assert.equal(callerActions({ state: "RUNNING", remaining: 10, busy: true }).pause.enabled, false);
  const drained = callerActions({ state: "RUNNING", remaining: 0 });
  assert.equal(drained.call.enabled, false);
  assert.match(drained.call.reason, /90/);
});

// ---------------------------------------------------------------- next number

test("the next-number slot is sealed: it carries a count, never a number", () => {
  for (const state of ["WAITING", "RUNNING", "PAUSED", "COMPLETED"]) {
    for (const remaining of [null, 0, 1, 37, 90]) {
      const preview = nextCallPreview({ remaining, state });
      assert.equal(preview.sealed, true);
      assert.deepEqual(Object.keys(preview).sort(), ["label", "remaining", "sealed"], state + "/" + remaining);
      assert.equal("number" in preview, false, "a preview must never name the next draw");
      assert.equal("value" in preview, false);
    }
  }
  assert.equal(nextCallPreview({ remaining: 0 }).label, "All 90 called");
  assert.equal(nextCallPreview({ state: "COMPLETED" }).label, "Round complete");
});

test("the hint under the call button describes what happens next, not what will be drawn", () => {
  assert.match(nextCallHint({ state: "WAITING" }), /first number/);
  assert.match(nextCallHint({ state: "PAUSED" }), /stopped/);
  assert.match(nextCallHint({ state: "COMPLETED" }), /results stay available/);
  assert.match(nextCallHint({ state: "RUNNING", autoCall: true, callIntervalMs: 5000 }), /every 5s/);
  assert.match(nextCallHint({ state: "RUNNING", autoCall: false }), /Manual/);
  assert.match(nextCallHint({ state: "RUNNING", autoCall: true, callIntervalMs: 5000, remaining: 0 }), /All 90/);
});

// ------------------------------------------------------------------ the hall

test("the hall readout counts seats, presence, tickets and capacity", () => {
  const players = [
    { id: "a", name: "Asha", connected: true, isHost: true, tickets: 2, points: 10 },
    { id: "b", name: "Ravi", connected: true, isHost: false, tickets: 3, points: 20 },
    { id: "c", name: "Neha", connected: false, isHost: false, tickets: 1, points: 0 },
  ];
  assert.deepEqual(roomSummary({ players, maxPlayers: 20 }), {
    seated: 3,
    connected: 2,
    away: 1,
    tickets: 6,
    capacity: 20,
    seatsLeft: 17,
  });
  assert.deepEqual(roomSummary({ players: [], maxPlayers: null }), {
    seated: 0,
    connected: 0,
    away: 0,
    tickets: 0,
    capacity: null,
    seatsLeft: null,
  });
  assert.equal(roomSummary().seated, 0, "a missing roster is empty, not a crash");
  assert.equal(roomSummary({ players: [{ connected: true }] }).tickets, 0, "a seat without tickets is zero, not NaN");
});

test("the call sheet keeps the server's order and numbers its rows", () => {
  const called = [42, 7, 90];
  assert.deepEqual(callRows(called), [
    { ordinal: 3, number: 90 },
    { ordinal: 2, number: 7 },
    { ordinal: 1, number: 42 },
  ]);
  assert.deepEqual(callRows([]), []);
  assert.deepEqual(callRows(undefined), []);
  assert.deepEqual(recentCalls(called), { last: 90, previous: 7 });
  assert.deepEqual(recentCalls([5]), { last: 5, previous: null });
  assert.deepEqual(recentCalls([]), { last: null, previous: null });
});

// ------------------------------------------------------------------- the voice

test("the voice line is honest about every way speech can be unavailable", () => {
  assert.equal(voiceStatus({ engine: false }).tone, "off");
  assert.match(voiceStatus({ engine: false }).detail, /cannot speak/);
  assert.equal(voiceStatus({ dead: true }).tone, "danger");
  assert.equal(voiceStatus({ speech: false }).tone, "muted");
  assert.equal(voiceStatus({ speech: true, speaking: 12 }).tone, "ok");
  assert.match(voiceStatus({ speech: true, speaking: 12 }).label, /12/);
  assert.equal(voiceStatus({ speech: true, pending: 2 }).tone, "warn");
  assert.match(voiceStatus({ speech: true, pending: 2 }).detail, /catching up/);
  assert.equal(voiceStatus({ speech: true, voices: 0, lang: "hi" }).tone, "warn");
  assert.match(voiceStatus({ speech: true, voices: 0, lang: "hi" }).label, /Hindi/);
  assert.equal(voiceStatus({ speech: true, voices: 3 }).tone, "ok");
  assert.match(voiceStatus({ speech: true, voices: 3, lang: "hi" }).detail, /Hindi/);

  // A finished round has no next call, so the console must not promise one —
  // and the sealed slot stops pretending a number is still on its way.
  const finished = voiceStatus({ speech: true, voices: 3, state: "COMPLETED" });
  assert.equal(finished.tone, "ok");
  assert.match(finished.detail, /No more numbers/);
  assert.doesNotMatch(finished.detail, /next call/i);
  assert.equal(voiceStatus({ speech: false, state: "COMPLETED" }).tone, "muted", "a muted device is still muted");
  assert.equal(nextCallPreview({ remaining: 84, state: "COMPLETED" }).label, "Round complete");
});

// ------------------------------------------------------------------ keyboard

test("single keys drive the console, and only outside a text field", () => {
  assert.deepEqual(CALLER_KEYS, { c: "call", p: "pause", r: "repeat" });
  assert.equal(hotkeyCommand({ key: "c", target: { tagName: "BODY" } }), "call");
  assert.equal(hotkeyCommand({ key: "P", target: { tagName: "BUTTON" } }), "pause");
  assert.equal(hotkeyCommand({ key: "r", target: documentLike() }), "repeat");
  assert.equal(hotkeyCommand({ key: "x", target: { tagName: "BODY" } }), null, "an unowned key is left to the browser");
  assert.equal(hotkeyCommand({ key: "Enter", target: { tagName: "BODY" } }), null, "no chords, no named keys");
  assert.equal(hotkeyCommand({ key: "c", ctrlKey: true, target: { tagName: "BODY" } }), null, "modifiers are the browser's");
  assert.equal(hotkeyCommand({ key: "c", metaKey: true, target: { tagName: "BODY" } }), null);
  assert.equal(hotkeyCommand({ key: "c", altKey: true, target: { tagName: "BODY" } }), null);
  for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
    assert.equal(hotkeyCommand({ key: "c", target: { tagName } }), null, "never while typing in " + tagName);
  }
  assert.equal(hotkeyCommand({ key: "c", target: { isContentEditable: true } }), null);
  assert.equal(isTypingTarget({ tagName: "DIV" }), false);
  assert.equal(isTypingTarget(null), false);
  assert.equal(hotkeyCommand(null), null);
});

function documentLike() {
  return { tagName: "DIV", isContentEditable: false };
}

// ------------------------------------------------- the engine behind the console

test("the snapshot carries the console's read-outs and still reveals no future draw", () => {
  const h = makeRoom();
  const host = h.host();
  h.player("Asha", "sock-asha");
  assert.equal(h.room.start({ socketId: host.socketId }).ok, true);
  h.advance(3000);

  const view = h.room.stateView();
  assert.equal(view.elapsedMs, 3000);
  assert.equal(typeof view.startedAt, "number");
  // The database owns the round number (persist/controller.js increments it on
  // start), so an in-memory room reports 0 and the console renders "—".
  assert.equal(typeof view.gameNumber, "number");
  assert.equal(view.maxPlayers, 100);

  // the keys a console could use to predict the next call must not exist
  for (const forbidden of ["draw", "next", "nextNumber", "remainingDraw", "order"]) {
    assert.equal(forbidden in view, false, "a snapshot must not carry " + forbidden);
  }
  assert.equal("draw" in h.room.publicSnapshot(), false);
});

test("a paused round's clock stops, resumes where it stopped, and freezes at the end", () => {
  const h = makeRoom();
  const host = h.host();
  h.player("Asha", "sock-asha");
  assert.equal(h.room.start({ socketId: host.socketId }).ok, true);

  h.advance(5000);
  assert.equal(h.room.stateView().elapsedMs, 5000);

  assert.equal(h.room.pause({ socketId: host.socketId }).ok, true);
  const frozen = h.room.stateView().elapsedMs;
  assert.equal(frozen, 5000);
  h.advance(4000);
  assert.equal(h.room.stateView().elapsedMs, frozen, "a paused round does not count time");

  assert.equal(h.room.resumeGame({ socketId: host.socketId }).ok, true);
  h.advance(2000);
  assert.equal(h.room.stateView().elapsedMs, frozen + 2000, "paused time is not added when the round resumes");

  assert.equal(h.room.end({ socketId: host.socketId }).ok, true);
  const atEnd = h.room.stateView().elapsedMs;
  h.advance(6000);
  assert.equal(h.room.stateView().elapsedMs, atEnd, "a finished round's clock is frozen");

  assert.equal(h.room.reset({ socketId: host.socketId }).ok, true);
  const fresh = h.room.stateView();
  assert.equal(fresh.elapsedMs, 0, "a new round starts at zero");
  assert.equal(fresh.startedAt, null);
});

test("a losing host socket cannot move the clock: only the host's states change it", () => {
  const h = makeRoom();
  const host = h.host();
  h.player("Asha", "sock-asha");
  h.room.start({ socketId: host.socketId });
  h.advance(1000);

  const refused = h.room.pause({ socketId: "sock-asha" });
  assert.equal(refused.ok, false, "a player cannot pause");
  assert.equal(h.room.stateView().state, "RUNNING");
  h.advance(1000);
  assert.equal(h.room.stateView().elapsedMs, 2000, "the clock kept running because nothing paused it");
});

test("changing the cadence mid-round re-times the next call and never draws twice", () => {
  const h = makeRoom({ config: { autoCall: true, callIntervalMs: 10000 } });
  const host = h.host();
  h.player("Asha", "sock-asha");
  assert.equal(h.room.start({ socketId: host.socketId }).ok, true);
  assert.equal(h.timers.size, 1, "one scheduled call while the round runs");

  h.advance(4000);
  const changed = h.room.setAutoCall({ socketId: host.socketId, intervalMs: 3000 });
  assert.equal(changed.ok, true);
  assert.equal(changed.autoCall, true, "a cadence change must not switch auto-call off");
  assert.equal(changed.callIntervalMs, 3000);
  assert.equal(h.timers.size, 1, "still exactly one scheduled call");
  assert.equal(h.room.calledNumbers.length, 0, "re-timing a clock is not a draw");

  h.advance(3000);
  assert.equal(h.room.calledNumbers.length, 1, "the next call follows the NEW cadence");
  assert.equal(h.timers.size, 1, "and the one after that is already scheduled");
});

test("a cadence change while paused applies on resume, and the server refuses a wild one", () => {
  const h = makeRoom({ config: { autoCall: true, callIntervalMs: 10000 } });
  const host = h.host();
  h.player("Asha", "sock-asha");
  h.room.start({ socketId: host.socketId });
  h.room.pause({ socketId: host.socketId });
  assert.equal(h.timers.size, 0, "a paused round has no timer");

  assert.equal(h.room.setAutoCall({ socketId: host.socketId, intervalMs: 5000 }).ok, true);
  assert.equal(h.timers.size, 0, "changing the pace does not restart a paused round");

  h.room.resumeGame({ socketId: host.socketId });
  assert.equal(h.timers.size, 1, "resuming schedules from the new cadence");
  h.advance(5000);
  assert.equal(h.room.calledNumbers.length, 1);

  for (const bad of [0, 499, 120001, 1.5, "5000"]) {
    const refused = h.room.setAutoCall({ socketId: host.socketId, intervalMs: bad });
    assert.equal(refused.ok, false, "the engine refuses intervalMs " + bad);
    assert.equal(h.room.config.callIntervalMs, 5000, "and keeps the cadence it had");
  }
  const byPlayer = h.room.setAutoCall({ socketId: "sock-asha", intervalMs: 5000 });
  assert.equal(byPlayer.ok, false, "a player cannot change the calling cadence");
});

test("rapid call intents produce distinct numbers in sequence — never a repeat", () => {
  const h = makeRoom();
  const host = h.host();
  h.player("Asha", "sock-asha");
  h.room.start({ socketId: host.socketId });
  const calls = callThrough(h.room, host.socketId, 30);
  assert.equal(calls.length, 30);
  assert.equal(new Set(calls).size, 30, "no number is ever called twice in one round");
  for (let i = 1; i <= 30; i++) {
    assert.equal(h.room.calledNumbers[i - 1], calls[i - 1], "the history is the order the console shows");
  }
  assert.equal(h.room.stateView().calledCount, 30);
  assert.equal(h.room.stateView().remaining, 60);
});
