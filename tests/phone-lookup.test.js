import test from "node:test";
import assert from "node:assert/strict";
import { hashPhoneForSession, normalizePhoneNumber, parsePhoneLookupKey } from "../server/bookings/phone-lookup.js";
import { createBookingService } from "../server/bookings/service.js";

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

test("public session listing works when privacy-safe phone lookup is enabled", async () => {
  const db = { async query() { return { rows: [] }; } };
  const service = createBookingService({ db, phoneLookupKey: "a".repeat(64) });
  assert.deepEqual(await service.listPublicSessions("regular"), []);
});

test("live ticket finder hashes a normalized phone for the session query", async () => {
  const sessionId = "session-test";
  const sessionRow = {
    session_id: sessionId,
    slug: "regular",
    display_name: "Regular Tambola",
    status: "open",
    instance_status: "active",
    public_visible: true,
    starts_at: new Date(Date.now() + 60_000),
    booking_opens_at: new Date(Date.now() - 60_000),
    booking_closes_at: new Date(Date.now() + 30_000),
    ticket_capacity: 6,
    available: 6,
  };
  let lookupValues;
  const db = {
    async query(sql, values = []) {
      if (sql.includes("SELECT session_id FROM game_sessions")) return { rows: [{ session_id: sessionId }] };
      if (sql.includes("SELECT s.*,i.slug")) return { rows: [sessionRow] };
      if (sql.includes("SELECT t.serial,t.grid")) { lookupValues = values; return { rows: [] }; }
      throw new Error(`Unexpected query in phone finder test: ${sql}`);
    },
  };
  const key = "a".repeat(64);
  const service = createBookingService({ db, phoneLookupKey: key });
  await service.findPublicTicketsForRoom("ABCD2345", " +91 98765-43210 ");
  assert.equal(lookupValues[3], hashPhoneForSession(parsePhoneLookupKey(key), sessionId, "+919876543210"));
});
