import test from "node:test";
import assert from "node:assert/strict";
import { localInput, toIso, validTimeZone } from "../client/src/admin/time-zone.js";

test("admin schedule input converts IST wall time to an exact instant and round trips", () => {
  const iso = toIso("2026-11-08T10:15", "Asia/Kolkata");
  assert.equal(iso, "2026-11-08T04:45:00.000Z");
  assert.equal(localInput(iso, "Asia/Kolkata"), "2026-11-08T10:15");
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
