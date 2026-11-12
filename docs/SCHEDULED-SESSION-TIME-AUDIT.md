# Scheduled session booking-time audit and fix

**Date:** 7 November 2026  
**Scope:** `/super-admin/sessions` date/time conversion, authoritative validation, persistence, publication, booking availability, and scheduled start.  
**Status:** Code and non-database verification complete; PostgreSQL/browser acceptance is blocked by unavailable local tooling. No production data or configuration was used.

## Root cause

The example values are themselves out of order: booking opens at November 7, 2026 8:33 PM, while booking closes at 8:30 PM. The old form converted each `datetime-local` value in the browser and stopped with one generic banner; it did not mark either field or explain the schedule order.

There was also a real backend/database mismatch: service validation used `opens < closes && closes <= starts`, and migration 011 encoded `booking_closes_at <= starts_at`. Equality was accepted even though the interface described close as occurring *before* start. The browser converted local values to UTC before sending, leaving the server to validate instants without receiving the entered local wall times. Date parsing used JavaScript `Date`, which can normalize malformed calendar dates.

The exact screenshot’s immediate error is the user-entered opening/closing order. The generic feedback and equality acceptance were independent defects in the implementation.

## Implemented changes

- The form now sends each entered `datetime-local` wall time and the selected IANA zone. It does not rewrite the schedule to repair an invalid order.
- Shared client/server conversion resolves local wall times to exact instants, rejects malformed values and DST gaps, and chooses the earlier instant for repeated fall-back times. Explicit-offset ISO instants remain accepted for existing API callers.
- `Asia/Calcutta` and `Asia/Kolkata` resolve through the runtime IANA database to the same instants. Date-boundary conversions use the calendar date in the selected event zone.
- Server validation is authoritative and enforces `booking_opens_at < booking_closes_at < starts_at`. API errors distinguish invalid time values, invalid timezone, opening-after-close, and closing-at/after-start; the route returns these as client validation errors rather than HTTP 500.
- The form shows per-field accessible errors, highlights invalid inputs, displays a timezone-labelled schedule summary, and disables Create/Save while ordering or parsing is invalid. The default schedule starts tomorrow, opens five minutes from now, and closes ten minutes before start.
- Migration `035_strict_scheduled_session_order.sql` adds database enforcement for newly created/edited schedules without editing migrations 033/034 or rewriting existing rows. Existing rows receive a legacy marker; edits to their schedule must validate strictly and clear the marker. Status/title-only updates preserve historical rows.

## Pipeline traced

1. `AdminSessions.jsx` holds local form strings and an IANA zone. `time-zone.js` validates the same chronological ordering for immediate feedback and provides the display conversion.
2. `api.createSession` / `api.updateSession` submit the wall-clock strings and timezone.
3. The `/api/admin/instances/:instanceId/sessions` route remains owner-authenticated. `service.createSession` parses and validates before opening its transaction. When requested, room creation and the session row are committed within that same transaction.
4. A numbered session response is a draft. The UI then calls the inventory endpoint with a separate idempotency key. Ticket generation is transactional and retryable, but is a subsequent operation; if generation is interrupted, the draft remains and the same generation key can recover the result.
5. Publishing changes status to `open` only after inventory is ready and the future booking/start conditions pass. Public listing and booking eligibility compare persisted `timestamptz` values with database `now()`; display uses the saved `time_zone`.
6. The scheduled-start store claims only enabled, published sessions whose persisted `starts_at <= clock_timestamp()`. The worker polls every second and validates its lease before starting. It will not start early; actual start can be later than the configured instant by polling/processing latency, so this is not a hard real-time guarantee.

Session creation itself does not currently have an idempotency key. The form disables duplicate submission while its request is pending, and inventory generation is idempotent. A client retry after an ambiguous lost create response could still create a second session; this remains an explicit gap.

## Verification

- Focused timezone/form/service/scheduler tests: **14 passed, 0 failed, 1 PostgreSQL test skipped** (15 total).
- Final serialized suite: **804 tests; 721 passed, 0 failed, 83 skipped**. `DATABASE_URL` and restore URL were removed from the test process so no configured/local/production-style database could be contacted. Skips include PostgreSQL integration/migration tests.
- Client ESLint: passed. Vite production build: passed (210 modules).
- Security probe: **51/51 passed** against two in-memory servers.
- Secret scan: passed; no values were emitted.
- Full root and client dependency audits: **0 advisories** across production and development dependency trees.
- `git -c core.whitespace=cr-at-eol diff --check`: passed.
- PostgreSQL 17 integration and migration execution: **not run**. Docker Desktop's Linux engine was unavailable; no local PostgreSQL service or `psql` executable was present. No configured database URL was used.
- Browser screenshots: **not captured**. Playwright package is present but its Chromium executable is missing, and no supported browser-control session was available.

## Environment / release status

The production-policy environment checker was run against local `.env` without displaying values. It reported local `PUBLIC_ORIGIN` and `TRUST_PROXY` missing, with the expected non-production `NODE_ENV` warning. This evaluates only local configuration against production policy; it does not reveal or verify deployment configuration. Production configuration is **NOT VERIFIABLE** from this workspace.

No migration was applied, no production data was read or changed, and nothing was deployed, pushed, or committed. Migration 035 must be exercised against disposable PostgreSQL before release. Browser review, PostgreSQL atomicity/inventory/publication/booking-window integration, scheduler timing under PostgreSQL, and session-create idempotency remain release gaps.

## Creating a valid session in the admin panel

For the November 8, 2026 example, select the Bumper Tambola instance and `Asia/Kolkata` (or `Asia/Calcutta`), then enter:

| Field | Local date/time |
|---|---|
| Booking opens | November 8, 2026 — 6:00 PM IST |
| Booking closes | November 8, 2026 — 7:50 PM IST |
| Game starts | November 8, 2026 — 8:00 PM IST |

Create the draft, wait for its numbered ticket inventory to report ready, then publish it from the Sessions list. Link a valid waiting room before enabling automatic start. All three times must remain strictly ordered after selecting the timezone.

## Implementation follow-up (11 November 2026)

- Migration `037_session_create_idempotency.sql` records an optional per-instance session-create key and a fingerprint of the submitted session details. A retry with the same key and same details returns the original session; reusing the key with changed details returns a conflict. Existing sessions and older callers without a key remain compatible.
- The Admin Sessions form keeps the create key while an ambiguous request is retried, then clears it after the original session is returned. Numbered inventory generation continues to use its separate idempotency key.
- Owner-side reservation cancellation now looks up the live refresh target by the route's reservation ID. A focused regression assertion covers the persisted cancellation response and emitted inventory-refresh event.
- This follow-up has not been run against PostgreSQL. The configured connection is a remote Supabase pooler, so migration execution and database-backed tests were deliberately not run. Apply and verify migration 037 only in an isolated database before release; production deployment remains untouched.
