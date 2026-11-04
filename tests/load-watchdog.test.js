import test from "node:test";
import assert from "node:assert/strict";
import { createLoadWatchdog } from "../client/src/lib/load-watchdog.js";

function fakeTimers() {
  let nextId = 0;
  const callbacks = new Map();
  return {
    callbacks,
    setTimeout(callback) {
      const id = ++nextId;
      callbacks.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      callbacks.delete(id);
    },
  };
}

test("a successful load clears its watchdog and cannot later report a timeout", () => {
  const timers = fakeTimers();
  let timeoutCount = 0;
  const watchdog = createLoadWatchdog(() => timeoutCount++, 10000, timers);

  assert.equal(watchdog.settle(), true);
  assert.equal(watchdog.settle(), false);
  assert.equal(timers.callbacks.size, 0);
  assert.equal(timeoutCount, 0);
});

test("a stalled load reports exactly one timeout", () => {
  const timers = fakeTimers();
  let timeoutCount = 0;
  createLoadWatchdog(() => timeoutCount++, 10000, timers);

  const [timeout] = timers.callbacks.values();
  timeout();
  timeout();
  assert.equal(timeoutCount, 1);
});

test("cleanup cancels an unsettled watchdog", () => {
  const timers = fakeTimers();
  let timeoutCount = 0;
  const watchdog = createLoadWatchdog(() => timeoutCount++, 10000, timers);

  watchdog.dispose();
  for (const timeout of timers.callbacks.values()) timeout();
  assert.equal(timeoutCount, 0);
});
