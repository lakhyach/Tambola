import test from "node:test";
import assert from "node:assert/strict";
import {
  bookingCallerText, bookingClaimNote, bookingCopy, bookingPatternName, bookingRefusalText,
  bookingStatus, formatBookingDate, formatBookingNumber, localizeBookingDigits,
  moderatorActor, moderatorErrorText, moderatorEvent, moderatorMembershipStatus,
  moderatorRole, moderatorRoomStatus, resolveBookingLanguage,
} from "../client/src/i18n/booking-locale.js";

test("legacy UI language preferences resolve to English everywhere", () => {
  assert.equal(resolveBookingLanguage("hi"), "en");
  assert.equal(resolveBookingLanguage("fr"), "en");
  for (const key of ["reserveTickets", "playerJoinTitle", "nameTooShort", "masterBoard", "numberCurrent", "stateRUNNING", "roomChat", "modWorkspace"]) {
    assert.equal(bookingCopy("hi", key), bookingCopy("en", key), key);
  }
  assert.equal(bookingPatternName("hi", "fullHouse", "Full House"), "Full House");
  assert.equal(bookingClaimNote("hi", "claims open when the round starts"), bookingCopy("en", "claimsOpenWhenStarts"));
  assert.equal(bookingCopy("en", "ticketsOpen", { count: "12" }), "12 tickets open");
});

test("moderator, booking and refusal helpers retain English copy", () => {
  assert.equal(moderatorRoomStatus("hi", "RUNNING"), moderatorRoomStatus("en", "RUNNING"));
  assert.equal(moderatorRole("hi", "host"), moderatorRole("en", "host"));
  assert.equal(moderatorMembershipStatus("hi", "active"), moderatorMembershipStatus("en", "active"));
  assert.equal(moderatorEvent("hi", "hold.assign"), moderatorEvent("en", "hold.assign"));
  assert.equal(moderatorActor("hi", "moderator"), moderatorActor("en", "moderator"));
  assert.equal(moderatorErrorText("hi", { code: "CSRF_FAILED", message: "details" }), moderatorErrorText("en", { code: "CSRF_FAILED", message: "details" }));
  assert.equal(moderatorErrorText("hi", { code: "FUTURE_ERROR", message: "private detail" }), "private detail");
  for (const result of [
    { code: "RATE_LIMITED", error: "too many events" },
    { code: "TICKET_LIMIT", max: 3 },
    { code: "INVALID_STATE", reason: "line incomplete" },
    { code: "CLAIM_TOO_LATE", reason: "early five window of 20 calls already passed" },
    { code: "FUTURE_CODE", error: "use a supported room setting" },
    { code: "ROOM_NOT_FOUND", error: "room missing" },
    { code: "BOOKING_REQUIRED" },
  ]) assert.equal(bookingRefusalText("hi", result), bookingRefusalText("en", result));
});

test("number/date formatting stays English while voice language remains separate", () => {
  assert.equal(bookingStatus("hi", "confirmed"), bookingStatus("en", "confirmed"));
  assert.equal(formatBookingNumber(12345, "en"), "12,345");
  assert.equal(formatBookingNumber(12345, "hi"), "12,345");
  const dateEn = formatBookingDate("2026-11-01T10:00:00.000Z", "en");
  const dateLegacyHindi = formatBookingDate("2026-11-01T10:00:00.000Z", "hi");
  assert.equal(dateLegacyHindi, dateEn);
  assert.match(dateEn, /2026/);
  assert.match(dateEn, /\b(?:GMT|UTC|[A-Z]{2,5}|[+-]\d{1,2}:\d{2})\b/);
  assert.equal(formatBookingDate("not-a-date", "hi"), bookingCopy("en", "timeUnknown"));
  assert.equal(bookingCallerText("hi", "Voice ready"), "Voice ready");
  assert.equal(localizeBookingDigits("hi", "00:45 · 1.25×"), "00:45 · 1.25×");
});
