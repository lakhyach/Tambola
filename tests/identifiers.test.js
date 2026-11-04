import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { isSafePathIdentifier, isUuid } from "../server/identifiers.js";

test("isUuid accepts canonical RFC UUIDs and rejects malformed UUID shapes", () => {
  assert.equal(isUuid(randomUUID()), true);
  assert.equal(isUuid("f47ac10b-58cc-4372-a567-0e02b2c3d479"), true);
  for (const value of [
    null,
    42,
    "a".repeat(36),
    "f47ac10b58cc4372a5670e02b2c3d479",
    "f47ac10b-58cc-4372-0567-0e02b2c3d479",
    "f47ac10b-58cc-0372-a567-0e02b2c3d479",
    "f47ac10b-58cc-4372-a567-0e02b2c3d47z",
  ]) {
    assert.equal(isUuid(value), false, `rejects ${String(value)}`);
  }
});

test("isSafePathIdentifier accepts bounded ASCII path IDs and rejects unsafe text", () => {
  for (const value of ["regular", "gi_0123456789abcdef01234567", "player-12", "f47ac10b-58cc-4372-a567-0e02b2c3d479"]) {
    assert.equal(isSafePathIdentifier(value), true, `accepts ${value}`);
  }
  for (const value of [null, 42, "", "a".repeat(81), "２", "room\u200bcode", "regular/rooms", "regular\u0000room"]) {
    assert.equal(isSafePathIdentifier(value), false, `rejects ${String(value)}`);
  }
});
