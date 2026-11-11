import test from "node:test";
import assert from "node:assert/strict";
import { localInput, toIso, validTimeZone, validateSchedule } from "../client/src/admin/time-zone.js";

test("admin schedule input converts IST wall time to an exact instant and round trips", () => {
  const iso = toIso("2026-11-08T10:15", "Asia/Kolkata");
  assert.equal(iso, "2026-11-08T04:45:00.000Z");
  assert.equal(localInput(iso, "Asia/Kolkata"), "2026-11-08T10:15");
});

test("India timezone aliases and midnight boundaries resolve to the same instants", () => {
  const times = ["2026-11-07T23:30", "2026-11-08T00:05", "2026-11-08T00:15"];
  for (const time of times) assert.equal(toIso(time, "Asia/Calcutta"), toIso(time, "Asia/Kolkata"));
  assert.deepEqual(times.map((time) => toIso(time, "Asia/Kolkata")), [
    "2026-11-07T18:00:00.000Z", "2026-11-07T18:35:00.000Z", "2026-11-07T18:45:00.000Z",
  ]);
});

test("admin schedule timezone conversion preserves instants when changing display zone", () => {
  const instant = toIso("2026-11-08T10:15", "Asia/Kolkata");
  const londonWallTime = localInput(instant, "Europe/London");
  assert.equal(toIso(londonWallTime, "Europe/London"), instant);
});

test("nonexistent daylight-saving wall times and invalid zones are rejected", () => {
  assert.equal(toIso("2026-03-08T02:30", "America/New_York"), null);
  assert.equal(validTimeZone("Asia/Kolkata"), true);
  assert.equal(validTimeZone("Not/AZone"), false);
});

test("ambiguous daylight-saving times choose the earlier instant consistently", () => {
  assert.equal(toIso("2026-11-01T01:30", "America/New_York"), "2026-11-01T05:30:00.000Z");
});

test("schedule form validation marks the fields that violate strict chronological order", () => {
  const base = { timeZone: "Asia/Calcutta", bookingOpensAt: "2026-11-07T20:00", bookingClosesAt: "2026-11-07T20:30", startsAt: "2026-11-07T21:00" };
  assert.equal(validateSchedule(base).valid, true);
  const opensLate = validateSchedule({ ...base, bookingOpensAt: "2026-11-07T20:35" });
  assert.equal(opensLate.errors.bookingOpensAt, "Booking must open before it closes.");
  const closesAtStart = validateSchedule({ ...base, bookingClosesAt: base.startsAt });
  assert.equal(closesAtStart.errors.bookingClosesAt, "Booking must close before the game starts.");
  assert.equal(closesAtStart.errors.startsAt, "Choose a game start later than booking closing.");
});
