import test from "node:test";
import assert from "node:assert/strict";
import { createBookingRealtime } from "../server/bookings/realtime.js";

test("booking subscriptions are instance-scoped, short-lived, and consumed once", () => {
  let clock = 1000;
  const realtime = createBookingRealtime({ now: () => clock, ttlMs: 30 });
  assert.equal(realtime.issue({ instanceId: "bad instance", ownerSessionId: "owner-session" }), null);
  const ticket = realtime.issue({ instanceId: "regular", ownerSessionId: "owner-session" });
  assert.match(ticket, /^[a-f0-9]{64}$/);
  assert.deepEqual(realtime.consume(ticket), { instanceId: "regular", ownerSessionId: "owner-session" });
  assert.equal(realtime.consume(ticket), null);

  const expired = realtime.issue({ instanceId: "bumper", ownerSessionId: "another-session" });
  clock += 30;
  assert.equal(realtime.consume(expired), null);
  assert.equal(realtime.room("bumper"), "admin-bookings:bumper");
});
