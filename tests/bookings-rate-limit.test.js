import test from "node:test";
import assert from "node:assert/strict";
import { createPublicRequestBudget } from "../server/bookings/routes.js";

test("booking request budget is a bounded request quota, not an auth failure counter", () => {
  let time = 1_000;
  const budget = createPublicRequestBudget({ now: () => time, windowMs: 60_000, maxRequests: 3, maxKeys: 2 });
  const call = (ip) => {
    let status = 200; let retryAfter = null; let proceeded = false;
    const res = {
      setHeader(name, value) { if (name === "Retry-After") retryAfter = value; },
      status(value) { status = value; return this; },
      json() { return this; },
    };
    budget({ ip }, res, () => { proceeded = true; });
    return { status, retryAfter, proceeded };
  };
  assert.equal(call("203.0.113.1").proceeded, true);
  assert.equal(call("203.0.113.1").proceeded, true);
  assert.equal(call("203.0.113.1").proceeded, true);
  const limited = call("203.0.113.1");
  assert.equal(limited.status, 429);
  assert.equal(limited.retryAfter, "60");
  assert.equal(limited.proceeded, false);
  assert.equal(call("203.0.113.2").proceeded, true);
  assert.equal(call("203.0.113.3").proceeded, true, "bucket storage stays bounded when new source addresses arrive");
  time += 60_001;
  assert.equal(call("203.0.113.1").proceeded, true, "a quota resets at the next window");
});
