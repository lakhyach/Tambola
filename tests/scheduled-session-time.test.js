import test from "node:test";
import assert from "node:assert/strict";
import { localInput, toIso } from "../client/src/admin/time-zone.js";
import { parseScheduleInstant, validateSessionSchedule } from "../server/bookings/schedule-time.js";
import { HAS_DB, openDurableSchema } from "./pattern-harness.js";
import { createBookingService } from "../server/bookings/service.js";

test("server and browser agree on Asia/Calcutta and Asia/Kolkata instants across midnight", () => {
  const times = ["2026-11-07T23:30", "2026-11-08T00:05", "2026-11-08T00:15"];
  for (const zone of ["Asia/Calcutta", "Asia/Kolkata"]) {
    for (const wallTime of times) {
      assert.equal(parseScheduleInstant(wallTime, zone)?.toISOString(), toIso(wallTime, zone));
    }
  }
  assert.equal(parseScheduleInstant(times[0], "Asia/Kolkata").toISOString(), "2026-11-07T18:00:00.000Z");
});

test("schedule ordering rejects equality and reversed times with field-specific errors", () => {
  const timeZone = "UTC";
  const base = { timeZone, bookingOpensAt: "2026-11-08T18:00", bookingClosesAt: "2026-11-08T19:00", startsAt: "2026-11-08T20:00" };
  assert.equal(validateSessionSchedule(base).error, undefined);
  assert.equal(validateSessionSchedule({ ...base, bookingOpensAt: base.bookingClosesAt }).error, "BOOKING_OPENS_NOT_BEFORE_CLOSES");
  assert.equal(validateSessionSchedule({ ...base, bookingOpensAt: "2026-11-08T19:30" }).error, "BOOKING_OPENS_NOT_BEFORE_CLOSES");
  assert.equal(validateSessionSchedule({ ...base, bookingClosesAt: base.startsAt }).error, "BOOKING_CLOSES_NOT_BEFORE_START");
  assert.equal(validateSessionSchedule({ ...base, bookingClosesAt: "2026-11-08T20:01" }).error, "BOOKING_CLOSES_NOT_BEFORE_START");
});

test("authoritative booking service rejects invalid schedules before opening a transaction", async () => {
  let transactions = 0;
  const service = createBookingService({ db: { async withTransaction() { transactions += 1; } } });
  const valid = { instanceId: "regular", actor: "synthetic-owner", title: "Invalid schedule probe", capacity: 2, timeZone: "Asia/Kolkata", startsAt: "2026-11-08T20:00", bookingOpensAt: "2026-11-08T18:00", bookingClosesAt: "2026-11-08T20:00" };
  assert.equal((await service.createSession(valid)).error, "BOOKING_CLOSES_NOT_BEFORE_START");
  assert.equal((await service.createSession({ ...valid, bookingOpensAt: "2026-11-08T20:10", bookingClosesAt: "2026-11-08T20:05", startsAt: "2026-11-08T21:00" })).error, "BOOKING_OPENS_NOT_BEFORE_CLOSES");
  assert.equal((await service.createSession({ ...valid, bookingOpensAt: "2026-11-08T18:00", bookingClosesAt: "2026-11-08T19:00", startsAt: "2026-02-30T20:00" })).error, "INVALID_SCHEDULE_TIME");
  assert.equal((await service.createSession({ ...valid, timeZone: "Invalid/Zone" })).error, "INVALID_TIME_ZONE");
  assert.equal(transactions, 0);
});

test("server rejects malformed wall times and zones but accepts exact offset instants", () => {
  assert.equal(parseScheduleInstant("2026-02-30T10:00", "Asia/Kolkata"), null);
  assert.equal(parseScheduleInstant("2026-11-08T25:00", "Asia/Kolkata"), null);
  assert.equal(parseScheduleInstant("2026-11-08", "Asia/Kolkata"), null);
  assert.equal(parseScheduleInstant("2026-11-08T10:15", "Invalid/Zone"), null);
  assert.equal(parseScheduleInstant("2026-11-08T10:15+05:30", "Asia/Kolkata")?.toISOString(), "2026-11-08T04:45:00.000Z");
  assert.equal(parseScheduleInstant("2026-02-30T10:15Z", "UTC"), null);
});

test("server and browser reject DST gaps and choose the earlier repeated wall time", () => {
  const gap = "2026-03-08T02:30";
  assert.equal(parseScheduleInstant(gap, "America/New_York"), null);
  assert.equal(toIso(gap, "America/New_York"), null);
  const repeated = "2026-11-01T01:30";
  assert.equal(parseScheduleInstant(repeated, "America/New_York")?.toISOString(), "2026-11-01T05:30:00.000Z");
  assert.equal(parseScheduleInstant(repeated, "America/New_York")?.toISOString(), toIso(repeated, "America/New_York"));
});

test("Regular and Bumper scheduled sessions persist browser wall times as exact instants and publish generated inventory", { skip: !HAS_DB, timeout: 60000 }, async () => {
  const env = await openDurableSchema({ prefix: "session_time" });
  const service = createBookingService({ db: env.db });
  try {
    for (const instanceId of ["regular", "bumper"]) {
      const timeZone = "Asia/Calcutta";
      const opens = localInput(new Date(Date.now() - 60_000), timeZone);
      const closes = localInput(new Date(Date.now() + 24 * 60 * 60_000), timeZone);
      const starts = localInput(new Date(Date.now() + 48 * 60 * 60_000), timeZone);
      const created = await service.createSession({
        instanceId, actor: "synthetic-schedule-test", title: `${instanceId} timezone schedule`,
        startsAt: starts, bookingOpensAt: opens, bookingClosesAt: closes,
        capacity: 2, inventoryMode: "numbered", timeZone,
      });
      assert.ok(created.session, JSON.stringify(created));
      const row = (await env.db.query("SELECT starts_at,booking_opens_at,booking_closes_at,time_zone,schedule_order_legacy FROM game_sessions WHERE session_id=$1", [created.session.sessionId])).rows[0];
      assert.equal(row.starts_at.toISOString(), toIso(starts, timeZone));
      assert.equal(row.booking_opens_at.toISOString(), toIso(opens, timeZone));
      assert.equal(row.booking_closes_at.toISOString(), toIso(closes, timeZone));
      assert.equal(row.time_zone, timeZone);
      assert.equal(row.schedule_order_legacy, false);
      await assert.rejects(
        env.db.query("UPDATE game_sessions SET booking_closes_at=starts_at WHERE session_id=$1", [created.session.sessionId]),
        /game_sessions_strict_schedule_order/,
      );

      const generated = await service.generateInventory({
        instanceId, sessionId: created.session.sessionId, requestedCount: 2,
        actor: { type: "admin", label: "Synthetic schedule owner" },
        idempotencyKey: `tz-sched-${instanceId}-01`,
      });
      assert.equal(generated.status, "ready", JSON.stringify(generated));
      const published = await service.updateSession({ instanceId, sessionId: created.session.sessionId, actor: "synthetic-schedule-test", patch: { status: "open" } });
      assert.equal(published.session.status, "open", JSON.stringify(published));
      const listed = await service.getPublicSession(created.session.sessionId);
      assert.equal(listed.sessionId, created.session.sessionId);
      assert.equal(listed.timeZone, timeZone);
      const retry = await service.generateInventory({
        instanceId, sessionId: created.session.sessionId, requestedCount: 2,
        actor: { type: "admin", label: "Synthetic schedule owner" },
        idempotencyKey: `tz-sched-${instanceId}-01`,
      });
      assert.equal(retry.idempotent, true);
    }
  } finally {
    await env.close();
  }
});
