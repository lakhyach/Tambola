# Changelog

## Hostinger Compose shutdown and log bounds (2 November 2026)

- The Hostinger VPS stack now retains at most five 10 MB JSON log files per container and allows the app 60 seconds to drain Socket.IO and complete its orderly shutdown before Docker force-stops it.
- This closes the documented mismatch where the runbook required bounded logs and graceful shutdown but the included Compose stack did not configure them. No VPS or production service was changed.

## Booking expiry and session closure consistency (1 November 2026)

- Session cancellation now expires any elapsed, unobserved holds before cancelling remaining active reservations. Each hold keeps the correct final state and audit event regardless of which operation observes it first.
- Added a durable regression asserting an elapsed hold ends as `expired` with `hold.create` → `hold.expire`, while session cancellation proceeds. The focused booking suite passes **3/3**, including isolated backup/restore.

## Durable booking assignment recovery integrity (1 November 2026)

- Room hydration now cross-checks each assigned reservation against its durable room member, player identity, and locked ticket count. A mismatch freezes recovery before the room enters the live registry.
- A corruption regression verifies `RECOVERY_REQUIRED`, the recorded freeze reason, and no fabricated reservation audit event. The full serial PostgreSQL suite passed **665/665** through migration 021 on a fresh disposable PostgreSQL 17.11 container.

## Waiting-room host moderation (1 November 2026)

- Hosts can remove a non-host seat before starting a round. The server checks the connected host socket and WAITING state, revokes the seat credential, removes its socket from room broadcasts, preserves the seat/ticket history, and records the host seat ID in the audit detail. The removed browser clears its credential and returns to join. The control requires confirmation and is absent after play starts.
- Socket integration passed **1/1** for host-only authority, invalidation and post-start refusal. Durable Chromium verified retained `left_at`, revoked session, actor audit, responsive 390px roster and simultaneous Regular/Bumper game histories; browser errors: **0**. Client lint/build passed.
- Permanent bans, approval queues and removal during a live round remain outside this slice.

## Public hall host routing (1 November 2026)

- Public instance pages now offer “Host in this hall.” The host form loads active public halls, preselects the requested hall, and sends its slug with room creation. The server resolves that slug only to an active, public instance, so paused, archived, hidden or unknown halls cannot be selected by forging the socket payload.
- Isolated PostgreSQL integration and Chromium verification passed: Regular and Bumper rooms were created from their own hall pages, both games ran concurrently, and call histories remained independent (Regular: 2 calls, Bumper: 1). Browser errors: 0; disposable schema dropped.

## Durable game process-restart browser verification (1 November 2026)

- A live Chromium host/player journey created a durable game in a fresh isolated PostgreSQL schema, made one official call, then stopped and recreated the application on the same local port. Boot recovery restored the running room, exact call history, same player seat and exact server-issued ticket grids.
- Host and player browser sessions reauthenticated after reload with zero browser errors. The harness removed its disposable schema after the check. No reservation rows were created, and retained booking schemas and port 4000 were untouched.
- Repeatable check: `.preflight/tools/durable-game-process-restart-browser-check.mjs`.

## Host setup and waiting-room localization (1 November 2026)

- Added persistent English/Hindi copy and language selection to host room creation and the host waiting room. Shared public navigation follows the selection; ticket controls, ticket numbers, grid labels, optional prize names/descriptions and invite text are localized.
- A live in-memory Chromium host flow verified language switching, server-created waiting room, five optional prize labels, Devanagari ticket limits/points/row labels and localized accessible ticket labels, with no overflow at 390/1440 px in either language. Browser errors: 0. Client lint, locale tests (7/7), and production build pass.
- The post-change player-board regression also passes: authoritative first call, all 90 accessible board items, localized language-control contrast, six screen sizes from 320 px through desktop, and zero browser errors.
- Extracted the language preference store from the full locale dictionary so the entry chunk stays split at 209.23 KB minified / 69.38 KB gzip. Broader host copy review, caller accessibility and real-device review remain open.

## Expired reservation recovery in the booking page (1 November 2026)

- Looking up a hold after its expiry now clears the stale confirmation panel so the player sees the durable `expired` status returned by the server. Expired holds no longer leave an active confirm action visible.
- Chromium created one synthetic two-ticket hold in isolated schema `codex_booking_expired_hold_1793554705955`, then looked it up after expiry. The record remains expired with ordered `hold.create`/`hold.expire` audit after app shutdown; no confirm, join or cancel action remains, no browser storage contains its private credential, and browser errors were 0.
- Reservation `84497534-69f5-4d74-a3e9-be5ffdee3f45` and its audit rows are retained under the keep-until-policy instruction. Screenshot: `.preflight/booking-expired-hold-recovered-390.png`.

## Durable booking expiry and unavailability browser check (1 November 2026)

- Chromium exercised an expired booking window and a cancelled session against the live app backed by a fresh isolated PostgreSQL schema. Both return the same generic not-found UI, expose no ticket-hold action, and produce no booking API writes.
- The run used no reservation rows, recorded zero browser errors at 390×844, and removed its disposable schema. Screenshots: `.preflight/booking-window-expired-390.png` and `.preflight/booking-window-unavailable-390.png`.
- Durable expired-reservation lookup/recovery remains open; this check covers expired session windows and unavailable sessions.

## Player and booking error localization (1 November 2026)

- Routed player join, ticket selection, live game and host operation refusals through the shared English/Hindi formatter. Known public booking API error codes now map to translated messages; Hindi uses a generic translated fallback for future server codes, while English retains server detail.
- Public booking requests pass the active language to the error formatter. Locale tests pass **7/7**, client lint passes, and the production build succeeds.
- This closes localization of known API refusal messages in these journeys. Remaining language gaps in non-error screen copy and broader accessibility review are tracked separately.

## Scoped moderator booking assignment (1 November 2026)

- Added the explicit, instance-scoped `bookings.assign` permission for attaching an eligible scheduled session to one waiting room. It is separate from `bookings.manage`, requires `room.read`, remains ungranted by default, and cannot change reservations, player seats, or ticket grids.
- Added moderator availability/list and assignment endpoints with live MFA/session/grant checks, same-instance room eligibility, atomic uniqueness, and append-only reservation/platform audit. Super Admin can grant the capability explicitly.
- Migration 021 preserves the existing player `hold.assign` audit action alongside the new moderator `session.assign_room` action. The complete serial PostgreSQL suite passes **663/663** through migrations 001–021; focused PostgreSQL assignment and Super Admin grant tests pass **2/2**. Client lint/build and mocked authenticated Chromium permission checks pass.
- The separately approved retained cancellation fixture was reopened in authenticated Chromium at 390 px. It was already cancelled, so this resumed pass verified the persisted cancelled state and history read-only; no duplicate cancellation was submitted. Reservation and audit rows remain retained under the keep-until-policy.

## Player language coverage expanded (1 November 2026)

- Extended persistent English/Hindi selection across session discovery, booking, join, waiting-room and player live-game views. Added localized ticket controls, current-call/progress readout, board/history, pattern names/hints, claim/result panels and chat controls; Hindi number output uses Devanagari digits.
- At 390×844, a built-app browser smoke check verified language persistence, translated join validation/game headings/status/board/claim/chat labels, and no horizontal overflow. This used an idle synthetic game state; active-round result and chat behavior still need browser review.
- Full serial suite passes 651/651 across 20 suites; client lint/build, focused locale tests and secret scan pass. Vite warns that the 526.64 KB main chunk exceeds its advisory threshold.

## Public instance join isolation and narrow-screen footer (1 November 2026)

- Verified the built app in a real browser against a generated, migrated PostgreSQL schema: a Bumper-tagged URL cannot join a Regular room or create a player seat, while the matching Regular URL succeeds.
- Directory, Regular hall and denial pages measured no horizontal overflow at 360, 390, 768, 1024 and 1440 px; the public hall did not reveal the host room code. The 390 px denial screenshot exposed overlapping player connection/helper text, so the join-screen footer now stacks on narrow viewports and the recaptured page is readable.
- Client lint/build and secret scan pass; current serial suite remains 648/648 across 20 suites. The ephemeral app and test schema were stopped/dropped, leaving port 4000 and the retained booking schema untouched.

## Keyboard skip navigation across public pages (1 November 2026)

- Added a keyboard-visible “Skip to main content” link to the shared public header and focusable main-content targets to every header-backed public, host, player, moderator and poster route.
- Corrected the poster page landmark order so the site header is a sibling of `main`, including loading and error states.
- Client lint and production build pass. Authenticated browser review, broader accessibility checks and multi-viewport visual review remain open.

## Backup visibility and restore integrity (1 November 2026)

- Added owner-only read-only backup status to Settings. It summarizes recent local archives, manifest/size state, row/table counts and isolated restore-check results without returning paths, database names, credentials or MFA keys. The endpoint returns
o-store` and requires the existing owner session.
- `db:restore-check` now verifies each manifest SHA-256 before opening a database connection or creating its scratch database. It writes a credential-free `.restore-check.json` result sidecar; the Settings page reports that result and checksum state. Modified archives are refused before database access.
- Focused owner/backup/booking/restore suites pass; full suite passes 648/648 across 20 suites. Client lint/build, secret scan (325 files), and CRLF-aware diff check pass. No backup or restore was run against the existing application database.

## Responsive public navigation (1 November 2026)

- Reworked the shared public header into a responsive navigation landmark. On narrow screens, links move into an explicit Menu/Close control with `aria-expanded` and `aria-controls`, Escape closes the menu, link activation closes it, touch targets are at least 44 px, and focus indicators remain visible. Desktop keeps the same four navigation links in one row.
- Client lint and production build pass; full serial suite passes 645/645 across 20 suites. Authenticated owner browser review and a device-width visual pass remain open.

## Instance detail control center (1 November 2026)

- Added an owner-only durable instance overview API and detail pages under both Admin and Super Admin. It shows lifecycle/public visibility, database probe, per-instance room/game/participant/claim/award totals, recent rooms, active moderator grants and sessions, scoped audit, and a link to aggregate reports.
- Added recent game-round and player activity tables so the instance view exposes real tenant-scoped records as well as aggregate counts.
- All activity is scoped by persisted instance ownership. No private draw plan, reservation credentials, or contact details are returned. Tests verify foreign rooms and audit rows do not enter another instance's detail view.
- Full serial suite passes 645/645 across 20 suites; focused admin/instance suites pass 36/36; client lint/build, secret scan (323 files), and CRLF-aware diff check pass. Browser review of the authenticated owner page remains open.

## Platform footprint in the owner overview (1 November 2026)

- Added durable instance and moderator lifecycle counts to the owner dashboard, including active instance grants and unrevoked, unexpired moderator sessions. These are read-only database totals; memory mode does not show invented platform counts.
- Focused instance query test passes; full serial suite passes 645/645 across 20 suites. Client lint/build and secret scan pass.

## Instance identity controls and poster template rollback (1 November 2026)

- Added per-instance browser icon selection alongside the existing curated local logos. The runtime now applies and restores tab and Apple touch icons with instance branding.
- Added owner poster studio history and rollback: an earlier approved and published design can be restored as a new immutable version and publication, with prior releases and published posters retained.
- Focused poster and public instance suites pass (4/4), and the full serial suite passes (645/645 across 20 suites). Client lint/build and secret scan pass. Authenticated browser review remains open.

## Permission-adaptive moderator workspace (1 November 2026)

- Expanded the moderator console with grant-filtered room creation/lifecycle, player lookup and removal, room history, operational summaries and limited instance description settings. Backend authorization remains the authority for every action.
- Split moderator workspace and credential pages into lazy chunks; client lint/build and the full serial suite (645/645 across 20 suites) pass, and the main bundle is below 500 KB. Browser review and permission-combination UI checks remain open.

## Moderator invitation and recovery experience (1 November 2026)

- Added moderator invitation acceptance and recovery pages, with password confirmation, CSRF-protected submissions and URL-fragment tokens removed from the address bar after load.
- Added copyable moderator invitation acceptance links in owner access management and linked the sign-in screen to invitation and recovery flows. Sign-in and authenticator enrollment continue to use the existing moderator APIs and HttpOnly session cookie.
- Owner-issued invitation and recovery links use URL fragments so one-time secrets are not sent in HTTP request URLs. Client lint/build and focused moderator security/management API suites pass (3/3). Authenticated browser verification remains open.

## Final multi-instance verification and product specification (1 November 2026)

- Added owner-issued moderator account recovery with single-use hashed tokens, full session/socket-ticket revocation, MFA re-enrollment, and migration `010_moderator_recovery.sql`.
- Added scoped moderator settings, player removal, history and report operations; tightened the socket-room switching guard and made migration advisory locks schema-scoped.
- Added an isolated synthetic moderator backup/restore drill covering account/grant/session/recovery/audit state. The throwaway schema and database are removed after the check.
- Added the route/surface threat model, timestamped full-video observations and complete product requirements. The supplied Super777 routes remain unobservable because of TLS certificate name mismatches; the video publisher is a distinct domain.
- Final verification is recorded in [`TEST-REPORT.md`](TEST-REPORT.md). No deployment, commit or push was performed; independent L3 review and target-environment checks remain open.

## Moderator security milestone (31 October 2026)

- Added migration `009_moderator_auth.sql`, separate moderator password/invite/session/MFA/socket-ticket lifecycle, CSRF-protected moderator APIs, instance-scoped permission checks, and Super Admin moderator/grant management.
- Moderator sockets use a separate event namespace and re-check the live session, MFA, authoritative room instance, and current grant on every operation; they do not join gameplay broadcast rooms.
- Added [`server/MODERATOR-SECURITY.md`](server/MODERATOR-SECURITY.md) with permission behavior, API contracts, key backup, and current capability limits. This milestone is not production-ready and has not received an independent L3 review.

What changed in this product, and what is still open. Dates are the dates the work
was verified, not the dates a feature was first sketched. Entries describe
behaviour a player or an operator can actually notice; internal file moves are only
mentioned where they explain a boundary.

## Multi-instance foundation (31 October 2026)

### Added

- Migrations `006_game_instances.sql` and `007_room_instance_lock.sql` seed Regular Tambola, Bumper Tambola, and a hidden Legacy instance, and make room ownership durable. Existing rooms are assigned to Legacy because their original product identity cannot be proven; no game history is rewritten.
- Rooms now have a required database instance foreign key. Owner-created rooms can select an active instance; direct host-created rooms default to Regular. Paused/archived instances refuse new room creation and player joins, while current running rounds continue.
- `/api/admin/instances` provides owner-session and CSRF-protected list, create, and lifecycle operations. `/super-admin/instances` exposes the current owner control-centre UI for those operations.
- The database now has moderator identity/grant tables, allowed permission constraints, platform audit schema with mutation-blocking trigger, and platform settings storage; subsequent moderator milestones add authentication and enforcement, documented in `server/MODERATOR-SECURITY.md`.

### Verification status

- Migration and client lint/build passed in this work session. Existing test suite and focused instance integration test results are recorded in `TEST-REPORT.md`; this foundation does not close the complete multi-instance acceptance criteria.

Format is roughly [Keep a Changelog](https://keepachangelog.com/) with the
deliberate difference that each entry names the thing a reader would see, because
this file doubles as the handover note for a paid build.

## Five new winning patterns, opt-in (31 October 2026)

Base commit `093e58f`. This slice adds **Star, Second Full House, Early Seven,
Half Sheet and Box** as winning categories. None of the six approved rules or
their point values changed, no ambiguous name was switched on with a guessed
coordinate set, and every new pattern is **off by default** — a room only plays
for it if its host opts in before the round, so no existing game behaves
differently. Full definitions and evidence in
[`docs/NEW-WINNING-PATTERNS.md`](docs/NEW-WINNING-PATTERNS.md); the decision
record in [`docs/RULES-DECISIONS.md`](docs/RULES-DECISIONS.md) §0.

### Added

- **Server-authoritative predicates** (`server/game/patterns.js`) for the five,
  each `optional: true, enabledByDefault: false`, so `getPattern` still refuses a
  claim for a pattern the room never enabled (`UNKNOWN_PATTERN`). Ticket-cell
  geometry moved to one module (`server/game/pattern-geometry.js`) so the diagram
  and the evaluator cannot disagree.
- **Exact coordinates, machine-defined.** Star = corners + the middle row's 3rd
  filled number (well defined on every ticket, not Laddu); Box = the middle three
  columns (a variable 3–9 cells, distinct from Corners); Early Seven completion is
  pinned to the 7th hit so an 8th cannot un-earn or duplicate it; Second Full House
  is its own pattern key that excludes the ticket that won the first Full House
  (persisted via migration `005_award_ticket.sql`); Half Sheet is a seat-level rule
  across three tickets and names all three on the award.
- **A host prize picker in the waiting room** (`client/src/HostRoom.jsx`,
  `room:set-patterns`) and a **server-driven Winning Patterns panel** on the player
  board: each row shows the server's name, points, explanation, a real ticket-grid
  diagram, this seat's own eligibility, and — once settled — the winner and ticket
  attribution. All five render in the OBSIDIAN HALL identity with no local rule.
- **Tests:** a geometry suite plus five in-memory suites and 12 durable
  PostgreSQL tests covering qualify / near-miss / wrong-shape / multi-ticket /
  multi-player / simultaneous / duplicate / post-completion / reconnect /
  attribution / the 6-7-8 boundary / first-vs-second Full House, and cross-process
  atomic claim arbitration. Full suite 626 tests green.

### Fixed

- A host who resumed into a round that was already RUNNING, PAUSED or COMPLETED
  used to land back on the waiting room with a live "Start Game" button and
  editable prize toggles the server would only refuse. The waiting room now hands
  any non-WAITING round to the caller console.

## Phase 18 — the player's tickets and gameplay (31 October 2026)

Base commit `e5c6e99`. This slice changes what a PLAYER sees and can do: how
tickets are chosen and read, how a ticket marks itself, how claims name the ticket
that won, and what a phone actually shows. No winning rule changed, no ticket
format changed, nothing was deployed and no payment surface was added. Full
behaviour in [`docs/PLAYER-GAMEPLAY.md`](docs/PLAYER-GAMEPLAY.md); numbers in
[`TEST-REPORT.md`](TEST-REPORT.md) §11.

### Added

- **A real ticket experience** (`TicketRail`, `TambolaTicket`, `TicketCell`,
  `client/src/lib/ticketview.js`): the seat's tickets behind an ARIA tab rail
  (`tablist`/`tab`/`tabpanel`, roving tabindex, `Left/Right/Home/End`), one ticket
  at readable size, a `9/15` header, a per-row chip (`R1 3/5`) that turns gold the
  moment a line completes, a 3×9 ARIA grid whose every cell speaks its position
  and state, and the same component in the waiting room as in the round.
- **A picker that says where the ceiling is**: "4 of 4 selected · room maximum",
  a `+` that disables itself at the ceiling, every count as a real radio
  (`radiogroup`, arrow keys, `Home`/`End`), and the server's own refusal shown
  under the control when a host lowers the limit mid-wait.
- **Your result** (`YourResult.jsx`): after the round a seat sees its own points,
  its awards with the ticket number that won them, and the final standings —
  instead of a board that simply stops.
- **Ticket integrity on recovery** — `recovery.js` now runs the generator's own
  `validateTicket` over every persisted grid and refuses a room with a duplicate
  `(player, ticketNo)`; `integrityErrors()` does the same in memory. A hand-edited
  database row freezes the room (visible on `/healthz`) instead of being dealt.
- **Four new test files**: `ticket-integrity` (12), `ticket-properties` (20),
  `ticket-view` (18) and `ticket-play` (19) — generator invariants, a 20 000-ticket
  statistical sweep, persistence/recovery, the 1/2/3/max multi-ticket lifecycle,
  claim attribution, cross-room isolation and reconnect behaviour.

### Changed

- The waiting room previews **the tickets the seat will actually play**, not a
  decorative sample, and asks the server for the default count once on entry so
  the preview is real rather than empty.
- On a phone the ticket now sits directly under the count control and above the
  hall roster: the whole ticket, its tabs and its row chips fit in the first 844px
  of a 390px screen.
- Every touch target a player uses to play is 44px tall at every width — ticket
  tabs, count steppers, count radios and claim buttons — not only on phones.
- `--oh-text-faint` was raised from `#6b717e` to `#828997` after an automated
  audit measured 3.86:1 on the chip it painted. It is now 4.9:1 on a panel and
  5.4:1 on an inset chip.

### Fixed

- A refresh in the waiting room showed an empty preview area even though the seat
  held tickets (the server stores a count, not grids, until the round starts).
- The picker's live region kept repeating a confirmation sentence after a
  successful pick instead of announcing the new count.
- Claim buttons were 32px tall — under the 44px minimum — and ticket tabs were
  40px; both are now 44px.
- **GitHub CI was red on every run since the workflow was written** while all six
  local gates were green, because the suite ran before the environment it assumes
  existed:
pm test` ran before the client build (the smoke suite asks a live
  server for `client/dist`, and `/` answers 503 without it) and against a service
  database that had never been migrated (the backup suite dumps that database and
  asserts the manifest records its migration ledger, and an unmigrated database
  reports an empty one). `ci.yml` now migrates and builds before it tests, and

pm run verify` runs `lint → build → test → secret-scan` for the same reason.
  Both causes were reproduced against a scratch database before either line was
  changed; no assertion was relaxed and no test was skipped. Run 41202342043 is
  green — the first CI run this repository has ever passed.

### Verified


pm test` printed **516 tests / 516 pass / 0 fail** (18 suites);
pm run lint`
clean at `--max-warnings 0`; production build 132 modules, CSS 46.53 kB (gzip
9.75), JS 385.05 kB (gzip 116.07); `secret-scan` clean over 221 files;
`security-probe` **51 of 51**; `e2e` and `e2e:durable` each played a full game to
`COMPLETED` with valid, premature, invented and duplicate claims; the browser
harness held **78 of 78** checks with **0** console errors across 360, 390, 430,
768 and 1440 pixel viewports; the accessibility and call-cost audit held **35 of
35** (123 of 123 measurable text samples pass WCAG AA, 27/27 grid cells carry
direction, 0 long tasks, 4 tickets settle 9 ms at p95 against 14 ms for one);
and 12 durable calls wrote **2 rows each** with **0** ticket-row updates. GitHub
CI — red on every run since the workflow was written — is now green: run
41202342043 printed `tests 516 / pass 516 / fail 0`, both e2e games `COMPLETED`,
`RESTORE CHECK PASSED`, the backup artifact uploaded and the docker job up.

### Not done

Early Seven, Star, Middle Number, 1 2 3 / 143 and Pyramid are still not claimable:
no approved predicate exists for them. No physical phone was used — every mobile
figure is a Chromium viewport emulation, and the report says so where it matters.

## Phase 17 — the caller console (31 October 2026)

Base commit `108c6aa`. This slice changes what the HOST sees and how a host runs a
round. No winning rule changed, no player-facing screen was redesigned, nothing was
deployed and no payment surface was added. Full behaviour in
[`docs/CALLER-CONSOLE.md`](docs/CALLER-CONSOLE.md); numbers in
[`TEST-REPORT.md`](TEST-REPORT.md).

### Added

- **A dedicated caller console at `/host/game`** (`client/src/components/caller/`):
  the current number in the players' own ball, the previous number, a **sealed**
  next slot that carries only a count, the full 1–90 board, the whole call sheet
  with ordinals and NOW/PREV tags, the round's elapsed clock, the hall's roster
  (seated / capacity / connected / away / tickets / per-seat state) and the room
  chat. Three columns from 1180px, two from 820px, one scrolling column below
  760px with the draw bar pinned to the bottom edge.
- **`client/src/lib/caller.js`** — the console's whole view-model as pure
  functions: the action matrix, the sealed next-call preview, the call-sheet rows,
  the roster summary, the honest voice status, the hotkey map, the clock.
- **Keyboard**: `C` call, `P` pause/resume, `R` repeat — single keys, never chords,
  and never while the host is typing in chat or dragging a slider.
- **A voice panel per device**: English/Hindi, a listed voice, rate (0.75–1.5×),
  volume, chime, Voice on/off, **Repeat number**, a Retry after the engine stops,
  and a sentence for the case where this browser has no speech engine or no Hindi
  voice at all. Settings persist in `localStorage` and are clamped before use.
- **A round clock the server owns** — `startedAt`, `elapsedMs`, `endedAt` on every
  snapshot, advanced by one hook in the state machine, continuing across a process
  restart from `games.started_at`. The browser ticks locally only while `RUNNING`.
- **Three new test files** (39 tests) and a browser harness:
  `tests/caller-console.test.js`, `tests/caller-voice.test.js`,
  `tests/caller-realtime.test.js` (real sockets on an ephemeral port) and
  `.preflight/tools/p17-caller.mjs` (headless Chrome over CDP at 1440×900,
  820×1180, 390×844 and 360×740).
- **`docs/CALLER-CONSOLE.md`** — what every control may do, what it deliberately
  does not, and how each promise is verified.

### Changed

- **`client/src/components/HostControls.jsx` is deleted.** Its strip is fully
  superseded; there is now exactly one surface a host operates a room from.
- **A cadence change is visible room state**: `setAutoCall()` emits `game:state`,
  so players' read-outs no longer keep an old interval until the next call.
- **The interval control sends `{ intervalMs }` alone** — a pace change must not
  switch auto-calling off. While running, the next call is re-timed from now; while
  paused it applies on resume; an invalid value is refused and the pace is kept.
- **Speech settings widened**: `announce.js` now stores voice, rate and volume, and
  a saved voice is honoured only if the browser still lists it *and* it matches the
  spoken language, falling back with a sentence that says so.
- **The mobile console reserves room for its pinned bar**, so the draw controls and
  the voice panel are never hidden behind it at 390px or 360px.

### Fixed

- **A host who refreshes mid-round no longer wonders what happened**: the round is
  restored on the same route with its call sheet intact. Because the host socket
  dropped, the room pauses (an unreachable owner is not a gone owner) and the
  console says `PAUSED` until the host resumes — verified in the browser pass.
- **A second host tab cannot double-drive a room**: resuming the host session there
  moves live control, and the old tab receives `NOT_HOST` on every intent while
  still being able to read the room.
- **The console no longer promises a next call after the round ends** — the voice
  line and the sealed slot both read "round complete".
- **`utter` construction is guarded**: a browser that throws on

ew SpeechSynthesisUtterance` degrades to "failed" instead of breaking the
  announcement queue.

### Verified

-
pm test`: **447 of 447**, `skipped 0`, 12.6 s.
-
pm run verify`: tests + lint (0 warnings) + build + secret scan, all clean.
-
pm run security-probe`: **51 of 51**.
-
pm run e2e` and
pm run e2e:durable`: a full round to `COMPLETED` on both
  stacks, with valid and refused claims.
-
ode .preflight/tools/p17-caller.mjs`: console, 90 tiles, three manual calls,
  keyboard focus outlines, the `C` hotkey, pause (clock equal twice), resume,
  cadence change to 5s, the voice panel, tablet/390/360 layouts with no horizontal
  overflow, a reload during a live round, resume after it, and the two-click end of
  the round — **0 page errors**.

## Phase 16B — deployment readiness and free-infrastructure research (31 October 2026)

Base commit `0a4de55`. This slice adds no gameplay feature and changes no winning
rule: it makes the build deployable, proves it under durable load, and writes down
exactly which free infrastructure is genuinely free. Full evidence in
[`docs/PHASE-16B-REPORT.md`](docs/PHASE-16B-REPORT.md) and
[`TEST-REPORT.md`](TEST-REPORT.md).

### Added

- **
pm run env:check`** — the production environment gate. It reads the same
  environment the server reads and exits non-zero on a missing or unparseable
  `DATABASE_URL`, a default database password, a remote database without
  TLS verification, `ALLOW_MEMORY_ONLY=1`, a missing/non-https `PUBLIC_ORIGIN`,
  `TRUST_PROXY` off, insecure cookies, a malformed `OWNER_MFA_KEY`, or
  `DB_POOL_MAX` above the ceiling. It prints no values.
- **
pm run smoke`** — proves a running deployment instead of a build: `/livez`,
  `/readyz` (refusing a memory-mode server), `/healthz` (requiring current
  migrations), the SPA, a real Socket.IO handshake, and with `--full` one complete
  round in a room of its own.
- **`/healthz` now reports the calling clock and the pool**: `scheduler { armed,
  nextDueInMs, overdue, ticking }` and `pool { total, idle, waiting, max, errors }`.
  A stopped clock and an empty database finally look different from outside.
- **Continuous integration** (`.github/workflows/ci.yml`): a PostgreSQL service,
  the full suite, lint, build, secret scan, security probe, both end-to-end games,
  backup + restore check with the archive as an artifact, a self-test that the
  environment gate actually fails on an unsafe environment, and an image build
  whose `/livez` is curled.
- **Scheduled uptime probes** (`.github/workflows/uptime.yml`): every 20 minutes,
  open an issue when `/readyz` or `/healthz` is not 200, close it on recovery. With
  no `DEPLOY_URL` secret the job exits green and says so.
- **A database profiler in `scripts/loadtest.mjs`**: transaction duration
  percentiles, `pg_stat_activity` sampling, `pg_stat_database`, `pg_stat_wal` and
  `max_connections`, so a queue can be attributed to the pool or to the database.
- **Early Seven as a proposal** (`server/game/proposed-patterns.js`): an exact
  definition, six fixtures and a completion-ordinal contract, deliberately not
  registered, so no game can award it before a client approves the points value.
  Star, Middle Number, 143 and Pyramid remain unimplemented, each with the written
  blocker that stops them.
- **New papers**: `docs/FREE-INFRASTRUCTURE-RESEARCH.md` (every free-tier claim
  checked against the provider's own page), `docs/DEPLOYMENT-READINESS.md` (gate,
  smoke, rollback, pool sizing, approvals), `docs/CLIENT-SIGNOFF.md` (the eighteen
  decisions that need the client, on one page), and §10 of
  `docs/CLIENT-REQUIREMENTS.md`, which resolves all 38 inputs with the default that
  stands and its consequence.

### Changed

-
pm run env:check` loads `.env` exactly as
pm start` does, so the gate sees
  the configuration that will actually run.
-
odemon` moved from `dependencies` to `devDependencies`: it is a development
  runner, and the production image no longer installs it.
- `.env.example` documents `DB_POOL_MAX` and `DB_POOL_ACQUIRE_TIMEOUT_MS` and
  points at the gate and the smoke test.
- `server/RUNBOOK.md` §5 carries the Phase 16B measurement, including what the
  database reported while the connection pool was 42 deep.

### Fixed

- **The secret scanner caught the new environment-gate test.** Its fixture
  contained a fully-formed credential URL, which is exactly what the scanner is for.
  Fixed by interpolating the fake password instead of teaching the scanner to ignore
  the file: the shape stays flagged for everyone else.

### Security

- **L3 deep security review** run against the committed tree before the push, per the
  repository's pre-push gate: `{"layer":"l3","findings_count":0,"findings":[]}`. A
  clean review of one commit range is not a penetration test; the remaining gap is an
  independent review, recorded in `docs/GAP-REPORT.md`.
- `socket.io`, `ws`, `engine.io` and `socket.io-parser` updated within their
  majors to clear the reported denial-of-service advisories. Production dependency
  audit is now **0 vulnerabilities** at the repository root.
- The client's production audit still reports **2 moderate advisories in
  `react-router-dom` 6.x**, whose fix is the 7.x major. Not taken in this phase: the
  advisories concern SSR hydration and a `deserializeErrors` path this
  client-rendered app does not use. Recorded as an open item in
  `docs/GAP-REPORT.md`, not silently accepted.

## Unreleased — the client-ready build (30–31 October 2026)

Release notes for the whole of this build are in [`TEST-REPORT.md`](TEST-REPORT.md):
383 automated tests with none skipped, two complete games through the real engine
(one against live Postgres) with their exact winning sequences, a backup-and-restore
round trip, a secret scan of the shipped bundle, and the browser observations that
do and do not back each change.

### Added

- **Up to four tickets per seat.** A player picks 1–4 (the room's ceiling comes from
  the server), sees the exact sheets the server dealt before the round starts, and
  claims against a named ticket. New migration `004_multi_ticket.sql`.
- **Celebrations that can only come from the server.** A pattern win or the final
  result raises an overlay built from the verified `claim:result` / `game:completed`
  events, once per event, and a refresh does not replay the past.
- **Quick chat in English and Hindi**, on the same documented `chat:send` path as
  typed messages, so it inherits the same rate limit, room isolation and validation.
  The catalogue lives in `client/src/i18n/messages.js`; nothing is hard-coded in a
  component.
- **Spoken calls that follow the board instead of tripping over it.** The `VOICE`
  chip makes the browser read each official call aloud — one at a time, in call
  order, never overlapping, never cancelling an utterance mid-flight — in English
  or Hindi (`EN` / `हिं` number words), with the chime riding on its own utterance
  so sound and voice stay together. The voice may trail the board by at most two
  numbers and a lag dot says when it does; if the browser's speech engine stalls
  or Chrome's autoplay policy refuses, a watchdog releases the queue, the chip
  becomes a one-tap `RETRY`, and a reload never re-reads the history. Speech and
  chime are separate opt-ins that persist per device, and win sounds use the same
  chime switch — no new autoplay surface. `client/src/lib/announce-queue.js` and

umber-words.js`; browser evidence: seven scenarios with zero overlapping
  utterances, zero duplicates and order preserved (31 October, Phase B).
- **Chat keeps a short tail.** A seat that joins while the room is already talking
  asks `chat:history` and sees what it missed (last `CHAT_HISTORY = 24` messages,
  in memory only, never in a snapshot, never written to the database).
- **A client configuration layer** (`client/src/config.js` + documented `VITE_*`
  build vars): product name, tagline, logo, brand mark, accent colours, footer
  notice, legal links, default language, bilingual picker. Display only — gameplay
  rules and limits stay server-authoritative — and every switch is read by the UI.
- **A per-tab seat credential** (`client/src/lib/seatStore.js`, session storage with
  a device-level recovery copy), so several tabs in one browser are several players
  and a dropped connection re-claims its own seat rather than somebody else's.
- **Honest refusals.** `client/src/lib/refusals.js` turns the server's refusal codes
  into sentences a player can act on — the server's own reason when it has one
  ("Not this time - line incomplete", "no ticket number 4 belongs to you") and a
  plain sentence when it does not, rather than a toast that says `INVALID_STATE`.
- **Second-click confirmation for End game and Reset**, replacing native dialogs:
  the control re-labels, the panel says what is lost, and the arm clears on Cancel,
  on expiry, or as soon as the server reports a different state.
- **Scripts that make the product checkable:**
pm run e2e` and
pm run e2e:durable`
  (a full game to a COMPLETED state, including three claims that must never score),

pm run secret-scan` (shipped content *and* the built bundle),

pm run security-probe` (51 live checks of the HTTP and socket surface against
  two in-process instances),
  `scripts/loadtest.mjs` (the staged capacity run quoted in the runbook), and

pm run verify` to run test + lint + build + secret-scan as one gate.

### Changed

- **A seat that joins mid-round is now told it is watching.** The server has always
  locked ticket selection at the start, so a late joiner holds no tickets; the screen
  used to draw a fabricated empty grid headed `…'S TICKET 0/15 MARKED` next to claim
  buttons the server would refuse. It now says `Watching this round / You joined
  mid-game`, draws no ticket, and disables the claim controls with the reason.
- **A new tab is asked before it takes a remembered seat.** It used to resume the
  last seat written to the device silently, which made two tabs collapse into one
  player. It now offers that seat with its name and room code and waits.
- **The host's primary control follows the round.** `Start game` while the room is
  waiting — including the waiting state a Reset returns to, where there was
  previously no way to start again without leaving the screen — and `Call next`
  once numbers are being drawn.
- **State-bound wording.** The claim panel says `this round is finished` instead of
  promising `claims open while running` after the last call; the roster says
  `3 seated` before a round and `3 playing` during one.
- **Production logging and managed-database TLS** were corrected on the path to this
  build (see the 28 October commits below).

### Fixed

- **Response-surface fixes found by the live security probe.** An
  allow-listed `Origin` is now echoed as itself in `Access-Control-Allow-Origin`
  instead of the word `true` (the plain-HTTP allow-list silently worked for no
  browser); responses no longer advertise Express with `X-Powered-By`; `/livez`
  answers liveness only and no longer hands out uptime; and a request that
  declares a body and then stalls is answered `408 REQUEST_TIMEOUT` after
  `HTTP_REQUEST_TIMEOUT_MS` (default 30 s) instead of parking a parser socket —
  Node's own request timeout does not fire once a body has started.
- Backup scoping and `db:restore-check` diagnostics: the check now reports the
  ledger, table inventory, row counts and the call-log-vs-draw sequence instead of
  failing opaquely, and the dump is written outside the live data directory.
- A host tab visiting the player join page was bounced into a player lobby by the
  new seat logic; a host seat is never auto-resumed there.

## Phase 16 — release review and client papers (31 October 2026, `2063f0b`)

- **Pushed to GitHub.** `b62bdd9..2063f0b main -> main` on
  `github.com/lakhyach/Tambola`; the remote and local `main` both resolve to
  `2063f0b6ec217f74cdb6fcd3a29b14af9d7b54ad`. Nothing was deployed, no production
  database was connected to, and no provider account or paid resource was created.
- **Every gate re-run on the committed tree, not remembered:**
pm run verify`
  (383/383, lint, build, secret scan) exit 0,
pm run security-probe` 51/51,

pm run e2e` and
pm run e2e:durable` both COMPLETED,
pm run db:backup` plus
  `db:restore-check` PASSED (18 tables, 10 498 rows).
- **The market research was re-checked against the live sources** rather than
  trusted from the previous note: all four full sources re-read, every competitor
  claim still present. Three dimensions the first pass lacked — number-calling
  conventions, mobile gameplay conventions, administrative capability — are now
  sections 3a–3c of the benchmark, with §4a as the rules decision matrix.
- **The five deferred patterns are written down, not just deferred:**
  `docs/RULES-DECISIONS.md` states what each pattern means, what the market
  publishes about it, why the old marked-count check was wrong, how it would be
  validated, and whether it can change who wins. The engine is untouched.
- **Client-facing papers added:** the benchmark (`docs/MARKET-BENCHMARK.md`), the
  rules decisions, the inputs still needed (`docs/CLIENT-REQUIREMENTS.md`), the
  hosting architectures and their monthly cost (`docs/HOSTING-OPTIONS.md`) and the
  ranked gap report (`docs/GAP-REPORT.md`).

## 28 October 2026 — production hardening (`d54c98d` … `b62bdd9`)

- Server-authoritative engine with durable-before-authoritative writes, boot-time
  recovery of live rooms from the database, and a single-instance advisory lease
  that makes a second scheduler fail closed rather than double-call numbers.
- Owner control centre at `/admin`: accounts, MFA, audit trail, operator actions.
- Strict socket contract (`server/net/CONTRACT.md`) with payload validation, a
  deny list for the legacy events the old client used, per-player rate limits and
  room isolation.
- Docker image and `docker-compose.yml`, health endpoints (`/livez`, `/readyz`,
  `/healthz`), graceful drain on SIGTERM, `db:backup` / `db:restore-check`.
- Hosting guidance for Render / Fly.io / Railway and managed Postgres, including
  why serverless is the wrong shape for this app.
- Corrected the production logger shim and documented Supabase session-pooler TLS,
  including the private-CA problem with `verify-full`.

## Original game (2024)

The Tambola/Housie game itself, the client design and the pattern names come from
Sumeet Umbalkar's original project (MIT, see [`LICENSE`](LICENSE)), which this
repository continues. Several of its UI controls had no server rule behind them;
the ones that could not be honoured were removed rather than left clickable, and
are recorded in `DEFERRED_PATTERNS` in `server/game/patterns.js` with the reason.

---

## Still open, in plain terms

- **Browser verification of the five newest interface changes is done** (31 October,
  §4.2 of [`TEST-REPORT.md`](TEST-REPORT.md)): the `Start game` control a reset
  returns to the host's game screen, the second-click confirmation on End game and
  Reset including its 8-second self-expiry and its Cancel, the state-bound claim
  wording in all five states, `seated` / `playing` / `played` in the roster, and the
  chat history a mid-round joiner is shown. What still has no rendered-page evidence
  is a second browser engine, a screen reader, a physical handset and the deployed
  URL.
- **No production deployment has been verified.** The public URL was deliberately
  left untouched, so provider TLS, proxy headers and cookie flags remain post-deploy
  checks rather than confirmed facts. The hosting options and their cost are in
  [`docs/HOSTING-OPTIONS.md`](docs/HOSTING-OPTIONS.md); none has been purchased.
- **One browser engine tested** (Chromium). No Safari or Firefox run; no screen-reader
  pass; narrow-layout evidence comes from a 434 px Chrome window with its layout
  container pinned to 390 px, not from a handset on a network.
- **Single instance by design.** Horizontal scaling needs per-room ownership, which
  is a redesign, not a configuration.
- **Five patterns remain deferred** (Early Seven, Star, Middle Number, 1 2 3 / 143,
  Pyramid) — each needs a rules decision, and none has a button. What each one means
  and what it would take is in [`docs/RULES-DECISIONS.md`](docs/RULES-DECISIONS.md).
- **Rooms do not age out on their own.** A clean stop closes them durably; abandoned
  rooms are closed by the owner from the control centre.
- **Chat is unmoderated** beyond length and rate limits, and there are no player
  accounts — both are product boundaries, agreed, not unfinished work.
- `caniuse-lite` in the build toolchain reports outdated browser data; refreshing it
  (
px update-browserslist-db@latest`) is a maintenance chore, not a behaviour fix.

## Owner room recovery retry and narrow-screen detail fix (1 November 2026)

- Added an owner-authenticated, CSRF-protected and audited recovery retry for frozen durable rooms. It re-runs the existing integrity checks, keeps failed rooms frozen, and restores controls only when recovery succeeds. The owner must correct the underlying durable rows before retrying; the action does not repair or rewrite room data.
- Controller coverage confirms a repeated corrupt-state check remains frozen and a corrected ticket-count mismatch can recover without fabricating reservation history. Authenticated Chromium verified anonymous denial, successful recovery and owner audit at 390×844 and 1280×900 with zero browser errors.
- The browser check found a 7 px overflow in the owner room roster at 390 px. The roster now uses labelled mobile cards; the recheck has no overflow at either viewport. Client lint/build pass. Full serial PostgreSQL suite: **665/665**, 20 suites, no failures or skips, migrations 001–021, with both backup/restore checks passing on a fresh disposable PostgreSQL 17.11 container.

## Booking-linked recovery integrity matrix (2 November 2026)

- Added a table-driven recovery regression for all six persisted reservation/seat checks: room binding, assigned player presence, confirmed status, linked player, linked room, and locked ticket quantity. The existing durable test still verifies fail-closed freeze, no synthetic booking history, and recovery after the authoritative ticket count is repaired.
- Focused durable recovery tests passed **2/2**. The complete serial PostgreSQL suite passed **666/666**, 20 suites, 0 failures/skips/todos, through migrations 001–021. Backup and restore checks passed in the same fresh disposable PostgreSQL 17.11 database, which was removed afterward.

## Cold recovery after resetting a completed game (2 November 2026)

- Fixed hydration for the durable `COMPLETED → WAITING` reset path. The completed game's draw, calls, tickets and awards remain historical records and are validated, but are not restored into the new waiting-room projection. Recovery also rejects room/game round-status mismatches.
- Added a PostgreSQL restart regression that ends and resets a room, reconstructs it after a cold process restart with empty live-game state, preserves prior calls/tickets, resumes the host session, and starts the next round without replacing history. Focused persistence/recovery/ticket tests passed **41/41**.
- Full serial PostgreSQL suite passed **669/669**, 20 suites, 0 failures/skips/todos, through migrations 001–021, including both backup/restore checks on fresh disposable PostgreSQL 17.11. Client lint/build and secret scan passed; root and client dependency audits found **0 vulnerabilities**.

### Reset recovery verification refinement (2 November 2026)

- Previous-round awards are integrity-checked before the completed game's projection is omitted. Historical ticket validation uses the prior round's stored ticket rows, so a player's legitimate new waiting-room quantity does not rewrite or invalidate old round data.
- The reset recovery test now starts with a two-ticket player and changes their next-round selection to one before restart; after recovery the player has no old live grid, retains the new choice, resumes the same host seat, and starts game 2. A separate regression refuses a corrupt prior award instead of silently dropping it.
- Final full serial PostgreSQL result: **670/670**, 20 suites, no failures or skips, migrations 001–021, including both backup/restore checks. Build/lint, secret scan and dependency audits pass.

## Award recovery relationship checks (2 November 2026)

- Recovery now fails closed on awards with unknown patterns, mismatched point values, missing winners, calls outside stored history, ticket references the winner does not own, duplicate winners, or non-contiguous winner ordinals. Legacy nullable ticket attribution and ordinal fields remain accepted when absent.
- Added focused corruption regressions and corrected the durable standings fixture to record a call before inserting its award. Full serial PostgreSQL suite: **672/672**, 20 suites, no failures/skips/todos, migrations 001–021, including both backup/restore checks on disposable PostgreSQL 17.11.
- The CUA browser bridge could not initialize during this turn, so the previously authorized moderator cancellation click was not submitted. The retained local fixture and its audit rows were left untouched.

## Owner overview activity and backup signals (2 November 2026)

- The owner overview now includes an eight-item, read-only platform activity feed combining owner audit decisions and moderator platform actions, alongside runtime health and a concise backup/restore-check summary. The feed reports outcome, actor, instance/room context and time; the full audit remains available in History.
- Durable query regression covers both audit sources and failure results. Owner API tests pass **36/36** and the full serial PostgreSQL suite passes **673/673**, 20 suites, no failures/skips/todos, migrations 001–021. Lint, build, root/client dependency audits, secret scan and diff check pass. Verification used a fresh disposable PostgreSQL 17.11 container and removed it afterward.
- Retried Windows computer-use initialization twice after the prescribed wait; the helper fails to write kernel assets and does not expose app/window state. The previously authorized moderator cancellation action is still pending; its retained fixture and audit rows were not touched.

## Instance-scoped room defaults (2 November 2026)

- Super Admin can now configure defaults for newly created rooms in each instance: room capacity (2–500), per-seat ticket cap (1–12), auto-call interval (1–120 seconds), and auto-call on/off. The backend rejects unknown/out-of-range settings, preserves other instance configuration, audits the validated values, and applies the selected tenant's defaults only at room creation; existing rooms retain their saved configuration.
- Durable tests prove API validation/audit, old-room immutability, Bumper/Regular isolation, and correct application to new managed/public rooms. The full serial PostgreSQL suite passed **675/675** across 20 suites with both backup/restore checks; latest focused instance/API suite passed **3/3**, and the final audit-value assertion passed **1/1**. Lint, build, root/client dependency audits, secret scan and diff check passed. Disposable PostgreSQL 17.11 containers were removed.
- Read-only inspection of the retained moderator-cancellation schemas confirms both reservations already have `cancelled` status, each has one `hold.cancel` event, and each has a matching successful `moderator.booking.cancel` audit entry. No cancellation or retained-data mutation was performed in this turn; the previous “pending” note is superseded by this database evidence.

## Instance defaults owner-browser acceptance (2 November 2026)

- Authenticated Chromium verified independent Regular/Bumper defaults end to end through the owner UI, durable config and audit, reload, old-room immutability and correct new-room inheritance. At 390 px and 1440 px there was no horizontal overflow or browser error.
- The check used and removed a dedicated PostgreSQL 17.11 container and disposable schema. Retained booking schemas and port 4000 were untouched.

## Moderator tenant identifier matrix expanded (2 November 2026)

- Durable isolation coverage now crosses real foreign and unknown room, player, session and reservation IDs across mismatched instance paths, including all five moderator room actions and player removal. Denied operations leave foreign state and reservation audit unchanged; assigned-instance discovery returns only the granted tenant.
- Four focused moderator PostgreSQL test files passed **5/5** on disposable PostgreSQL 17.11. The container was removed; retained booking schemas and port 4000 were untouched. Exhaustive Cartesian fuzzing and independent external security review remain open.

## Live gameplay layout and brand identity checkpoint (3 November 2026)

- Reorganized caller and player gameplay composition around the supplied festival live-game reference, including host ticket/claim area and player tickets, board, history, patterns and results. Server-authoritative state and action callbacks remain the source of truth.
- Added original Tambola House SVG identity assets and centralized defaults for platform branding, game header, manifest and social fallback. Existing stored tenant branding is not rewritten.
- Client lint/build passed and 84 focused tests passed (2 DB-backed skips). No current-turn browser screenshots or full game lifecycle were available; visual approval remains pending. No real poster provider request was made because configuration is absent.

## 3 November 2026 — Live gameplay runtime and visual checkpoint

- Restored local API/UI using a disposable isolated PostgreSQL database and verified migrations through 026.
- Refined caller/player layout after live browser review and captured 20 host/player waiting/live full-page screenshots at 390, 430, 768, 1440 and 1920 px.
- Verified join/start/manual calls/player reload restoration, approved Early Five and Full House claims, celebration/award states and game completion. Durable engine E2E validated rejected/duplicate cases.
- Full serial suite: 723 passed; client lint/build and whitespace check passed.
- Real poster-provider execution remains unconfigured; overall redesign and full-platform visual/accessibility/performance review remain open. No production changes or release actions.
