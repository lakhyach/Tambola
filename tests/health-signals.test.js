/**
 * Operational signals on /healthz: the calling clock and the database pool.
 *
 * A room whose timer has quietly stopped, or a pool that is permanently at its
 * ceiling, both look "up" to a plain TCP check. These are the two facts an
 * operator needs to see before players complain.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createHealth } from "../server/observability/health.js";

const okDb = {
  healthCheck: async () => true,
  query: async () => ({ rows: [] }),
};

test("the scheduler is reported with an overdue verdict", async () => {
  const health = createHealth({
    durable: true,
    db: okDb,
    lease: () => ({ held: true }),
    scheduler: () => ({ armed: 3, nextDueInMs: 4200, overdue: false, ticking: true }),
  });
  const ready = await health.readiness();
  assert.deepEqual(ready.scheduler, { armed: 3, nextDueInMs: 4200, overdue: false, ticking: true });

  const stalled = createHealth({
    durable: true,
    db: okDb,
    lease: () => ({ held: true }),
    scheduler: () => ({ armed: 1, nextDueInMs: 0, overdue: true, ticking: false }),
  });
  const report = await stalled.report();
  assert.equal(report.scheduler.overdue, true);
  assert.equal(report.scheduler.ticking, false);
  assert.equal(
    report.reasons.includes("scheduler_overdue"),
    false,
    "an overdue tick is visible but is not a readiness reason: only a lost lease or a drain takes the process out of rotation"
  );
});

test("pool occupancy and connection errors are visible", async () => {
  const health = createHealth({
    durable: true,
    db: okDb,
    lease: () => ({ held: true }),
    pool: () => ({ total: 8, idle: 0, waiting: 4, max: 8, errors: 2 }),
  });
  const report = await health.report();
  assert.deepEqual(report.pool, { total: 8, idle: 0, waiting: 4, max: 8, errors: 2 });
});

test("memory mode reports no pool and no scheduler unless one is wired", async () => {
  const health = createHealth({ durable: false, db: null, production: false, memoryAllowed: true });
  const ready = await health.readiness();
  assert.equal(ready.scheduler, null);
  assert.equal(ready.pool, undefined, "memory mode has no pool field at all");
});

test("the new signals never carry a connection string", async () => {
  const health = createHealth({
    durable: true,
    db: okDb,
    lease: () => ({ held: true }),
    scheduler: () => ({ armed: 0, nextDueInMs: null, overdue: false, ticking: true }),
    pool: () => ({ total: 1, idle: 1, waiting: 0, max: 8, errors: 0 }),
  });
  const text = JSON.stringify(await health.report());
  assert.equal(text.includes("postgres://"), false);
  assert.equal(text.includes("password"), false);
});
