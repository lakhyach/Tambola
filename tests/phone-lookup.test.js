import test from "node:test";
import assert from "node:assert/strict";
import { hashPhoneForSession, normalizePhoneNumber, parsePhoneLookupKey } from "../server/bookings/phone-lookup.js";

test("phone lookup accepts a strict country-code number and hashes it per session", () => {
  const key = parsePhoneLookupKey("a".repeat(64));
  assert.equal(normalizePhoneNumber(" +91 98765-43210 "), "+919876543210");
  assert.equal(normalizePhoneNumber("9876543210"), null);
  assert.notEqual(hashPhoneForSession(key, "session-a", "+919876543210"), hashPhoneForSession(key, "session-b", "+919876543210"));
  assert.equal(hashPhoneForSession(key, "session-a", "+91 98765 43210"), hashPhoneForSession(key, "session-a", "+919876543210"));
});

test("phone lookup key must be exactly 32 bytes", () => {
  assert.equal(parsePhoneLookupKey("a".repeat(62)), null);
  assert.equal(parsePhoneLookupKey("not-a-secret"), null);
  assert.equal(parsePhoneLookupKey(undefined), null);
});
