import test from "node:test";
import assert from "node:assert/strict";
import { createScheduledStartScheduler } from "../server/persist/scheduled-start-scheduler.js";

test("scheduled worker prevents overlapping local passes", async () => {
  let releaseClaim;
  let claims = 0;
  let starts = 0;
  const store = {
    async claimDueScheduledStart({ claimToken }) {
      claims += 1;
      if (claims === 1) await new Promise((resolve) => { releaseClaim = resolve; });
      return claims === 1 ? { claimed: true, sessionId: "s1", claimToken } : { claimed: false };
    },
    async releaseScheduledStartClaim() { throw new Error("unexpected release"); },
  };
  const worker = createScheduledStartScheduler({ store, controller: { async startScheduled() { starts += 1; return { ok: true }; } } });
  worker.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(worker.isRunning(), true);
  assert.deepEqual(await worker.runOnce(), { skipped: true });
  releaseClaim();
  await new Promise((resolve) => setImmediate(resolve));
  worker.stop();
  assert.equal(starts, 1);
});

test("scheduled worker does not start after losing its instance authority during a claim", async () => {
  let mayRun = true;
  let starts = 0;
  const store = {
    async claimDueScheduledStart({ claimToken }) {
      mayRun = false;
      return { claimed: true, sessionId: "s1", claimToken };
    },
    async releaseScheduledStartClaim() { throw new Error("stale worker must leave the lease to expire"); },
  };
  const worker = createScheduledStartScheduler({ store, controller: { async startScheduled() { starts += 1; return { ok: true }; } }, canRun: () => mayRun });
  worker.start();
  await new Promise((resolve) => setImmediate(resolve));
  worker.stop();
  assert.equal(starts, 0);
});

test("scheduled worker releases a no-player claim for a bounded retry", async () => {
  let released;
  let finishRelease;
  const didRelease = new Promise((resolve) => { finishRelease = resolve; });
  const store = {
    async claimDueScheduledStart({ claimToken }) { return { claimed: true, sessionId: "s1", claimToken, attempts: 1 }; },
    async releaseScheduledStartClaim(input) { released = input; finishRelease(); return { state: "waiting" }; },
  };
  const worker = createScheduledStartScheduler({
    store, controller: { async startScheduled() { return { ok: false, code: "NO_PLAYERS" }; } }, retryMs: 2500, log: () => {},
  });
  worker.start();
  await didRelease;
  worker.stop();
  assert.equal(released.retry, true);
  assert.equal(released.errorCode, "NO_PLAYERS");
  assert.equal(released.retryMs, 2500);
});
