# MakeTambola workflow parity roadmap

**Owner direction:** 11 November 2026  
**Scope:** Match visible MakeTambola organizer/player workflows using Ninety Club's own code, brand and assets. Exclude player entry fees, wagering, cash prizes, deposits, withdrawals and payout handling.

This roadmap treats visible UI and observed interactions as evidence. It does not assume hidden storage, payment or authorization behavior. The competitor's public pages are marketing material and its demo is a separate, limited sample.

## Rechecked reference evidence

- [MakeTambola homepage](https://maketambola.com/) advertises custom-named game websites, shareable links, up to 2,400 tickets, multiple prizes, sound and automatic posters. Its site also advertises an organizer dashboard and ticket generator.
- The [linked public demo](https://demo.maketambola.com/) visibly includes a live called-number board, winner list, ticket search by TNO/name/phone, host chat/call links, a WhatsApp group link, an agent list, available-ticket browsing, booking by name, and Random/Half-sheet/Full-sheet choices. That demo displayed a 40-ticket limit. The homepage's 2,400-ticket claim and the demo's 40-ticket limit are not reconciled by the public evidence.
- The [pricing page](https://maketambola.com/payment) lists ₹4,600 for a month and ₹28,800 for a year (₹2,400/month equivalent), with checkout links hosted on Razorpay. Public checkout terms and the complete billing lifecycle were not verified.
- The existing timestamped [reference-video analysis](REFERENCE-VIDEO-ANALYSIS.md) covers the 8:57 walkthrough, including prize setup, booking form, poster, cadence controls, themes, live board and settings. Screens shown in a video do not prove persistence or backend semantics.

## Feature comparison

| Workflow | Ninety Club status in this checkout | Parity work |
|---|---|---|
| Organizer game setup and shareable rooms | Public instance halls, scheduled sessions, room creation and share paths exist. | Complete any missing host setup and branded instance flows after a fresh authenticated browser walkthrough. |
| Ticket generation and booking | Server-generated inventory now groups each six-ticket strip, where possible, with a full-sheet union of 1–90. Public self-booking offers Random/Half-sheet/Full-sheet. Super Admin can create an organizer-assisted reservation from inventory. | Database migration 038 and DB-backed concurrent booking acceptance remain pending. UI supports at most 12 tickets per reservation, matching the inventory selection API. |
| Ticket lookup during play | Player game screen has a rate-limited exact TNO/name finder, scoped to the current live room and confirmed tickets; it returns at most six grids and no reservation recovery credentials. An optional phone finder now stores a session-scoped keyed digest only; searches use POST bodies, and results reveal neither phone nor booking details. | Migration 040 and a dedicated 32-byte `PHONE_LOOKUP_KEY` are required to enable phone capture/search. Verify the feature against the isolated DB and live-room acceptance suite before enabling it. |
| Host and agent contact | Super Admin can opt in public host phone/WhatsApp/email and up to ten agent name/phone entries in the instance branding settings. Published session pages show call, WhatsApp and email actions only for supplied contacts. | Contacts are public to anyone with the game link. Confirm the host/agent consent and retention policy before publishing real numbers. WhatsApp remains an explicit user-initiated external link. |
| Live calling, automation and voice | Server-authoritative 1–90 calls, manual/automatic operation, pause/resume, EN/HI speech and live player updates exist. | Verify the full schedule-to-completion flow in isolated real-browser acceptance, including voice timing, reconnect and every enabled pattern. |
| Prizes and winners | Eleven server-authoritative patterns, claims, award attribution, history and results exist. | Compare each public result tile and ticket attribution with the reference; keep undefined third-party prize rules out until written. |
| Posters and visual themes | Poster studio, public poster sharing, ticket themes, runtime brand controls, and retry-safe automatic poster publication when a session opens exist locally. Generated posters use a reviewed template and verified session facts. | Migration 039 and database-backed idempotency/publication verification remain pending. Review organizer mobile/desktop workflows against the visible tasks, keeping original Ninety Club artwork and identity. |
| Organizer monthly plans | Not implemented; current product brief excludes payment handling. | Treat service subscription billing separately from player stakes/prizes. The researched pricing is a competitor reference, not an adopted Ninety Club price. |

## Implementation sequence

1. **Correctness and recovery:** keep session creation and inventory generation safe to retry; fix booking state changes that fail to refresh the live organizer view. Current code adds session-create idempotency and fixes the operator-cancel refresh lookup. Migration 037 and database-backed verification remain pending.
2. **Booking parity:** standard sheet semantics are six tickets with all numbers 1–90 once; Half-sheet is positions 1–3 or 4–6. The first implementation is present locally, with one-time organizer-issued recovery credentials and no phone requirement.
3. **Live ticket finder:** the first implementation is on the live player screen, exact-match only, room scoped, rate limited and without private booking credentials.
4. **Organizer contacts:** instance-scoped host and agent contacts are opt in, validated and rendered as explicit user-initiated links.
5. **Acceptance:** run the full host/player journey in an isolated database and browser at desktop/mobile sizes, then reconcile results, ticket identity, audio, reconnect and scheduling. Do not use production bookings or accounts as test fixtures.
6. **SaaS billing, if adopted:** define Ninety Club pricing, subscription limits, cancellation/refunds and provider before adding checkout. Do not connect player entry fees or prize payouts.

## Release boundary

The current code changes are local. Migrations 037 and 038 have not been applied, database-backed coverage has not been run because the configured connection is a remote Supabase pooler, and nothing has been deployed. Client lint/build, server syntax checks, the ticket generator suite, and branding/instance tests passed locally. Full organizer/player browser acceptance and isolated PostgreSQL verification remain release gates.
