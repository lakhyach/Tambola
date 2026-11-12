# Complete Tambola product requirements

Status: evolving product specification. It combines the current codebase, the owner’s written platform goals, and visible behavior in [REFERENCE-VIDEO-ANALYSIS.md](REFERENCE-VIDEO-ANALYSIS.md). Third-party behaviors are references, not requirements unless the owner confirms them.

## Product principles

- Free-to-play, real-time, 90-ball Tambola. No entry fees, wagering, cash prizes, deposits, withdrawals, ticket sales or payment handling.
- The existing Node/PostgreSQL/Socket.IO application and single authoritative game engine remain the foundation. Regular, Bumper and future instances use the same engine.
- The server owns room membership, tickets, draw order, claims, awards, history, permissions and instance ownership. Browser state is a view, not authority.
- Tenant means an instance boundary for room activity, moderators, history, reports, configuration and future branding. Super Admin operations are the intentional platform-wide exception.
- The video’s ticket price and prize values are not carried into this product. Its logos, colors and artwork are not copied.
- **Owner direction, 11 November 2026:** target feature and workflow parity with the visible MakeTambola organizer/player experience, while keeping Ninety Club's own identity and excluding player entry fees, wagering, cash prizes, deposits, withdrawals and payout handling. Parity targets include scheduled games, numbered ticket inventory and booking, live ticket visibility/search, configurable prizes, automated/manual number calling and voice, live boards, winner results, organizer controls, and event posters/theme presentation. Only behavior directly observed or confirmed by the owner is an acceptance target; hidden third-party behavior must not be guessed.

## Product areas and current status

### Super Admin platform

**Existing/partial:** separate role-aware Owner/Super Admin authentication using the hardened account, MFA and session machinery. Super Admin-only global overview/history, health/settings, instance lifecycle, moderator account/grants, aggregate reports, platform counts, and backup status. Owner access is restricted to its own account security until an instance-scoped Owner/Admin grant model exists. `db:restore-check` validates the manifest SHA-256 before creating an isolated scratch database and writes a credential-free result sidecar. The overview now includes live readiness, migration state, lease, scheduler, frozen-room, pool and uptime signals from a bounded owner-only health projection. **Remaining:** target-host monitoring and alert configuration, complete review of broader operational workflows, and authenticated production-environment review.

Global platform operations must be visibly separate from instance operations. Only Super Admin can create/archive/restore instances, change identity/slug, configure security/platform settings, provision/recover moderators, or grant permissions. Instance detail must show lifecycle, rooms, games, players, moderators, reports, audit and health. Mutations are validated and audited. Backup controls never expose credentials or MFA keys.

### Regular and Bumper instances

**Existing:** Regular, Bumper and hidden Legacy records; room ownership persisted; same game engine. **Partial:** Super Admin can manage instance records/lifecycle. Owner/Admin instance assignments and the capability list remain unimplemented and require explicit persisted grants. **Proposed:** instance-specific public URL, branding/configuration, defaults, schedule/rooms, players, history, moderator assignments, reports, operational settings and audit context.

Paused/archived instances accept no new rooms or joins; already-running games can finish under the lifecycle policy. Legacy rooms remain mapped to Legacy and must not be silently reassigned. Cross-instance routes resolve instance and verify every related room/player identifier.

### Player experience

**Existing:** host share link/code, room join, waiting room, ticket preview/selection, live ticket marks, 1–90 board, call history, patterns/eligibility, claims/results, reconnect and chat. **Implemented slice:** instance landing page, scheduled-session discovery, quantity reservations, lookup/cancellation, and confirmed reservation assignment to a waiting room. Booking lookup uses a one-time secret; no phone/email/payment is collected. Real browser checks verify instance join isolation, authoritative game calls/claims/results, and durable booking allocation recovery. Live keyboard checks now cover claim activation and the win/final celebration modal’s focus trap, Escape/Enter dismissal and focus return. Broad gameplay and cross-instance behavior have real browser evidence; full screen-reader, broader keyboard, and physical-device coverage remain open.

**Player and host localization:** public session discovery, booking, room entry, waiting room, host setup, the host waiting room, shared public navigation and player game panels support English and Hindi, persist the visitor's selection locally, and format ticket/progress numbers with the selected language's digits. Pattern labels/hints, ticket-grid accessible names, claim/result panel copy, known API refusals, connection status and chat controls are localized. Session/booking dates use the device time zone with an explicit zone label. Chat quick-message content uses its own language selector. Remaining locale work includes unreviewed screen copy and broader accessibility validation.

Journey:

1. Open an instance public URL; see active public information, rules, upcoming sessions if scheduling is adopted, and clear join/booking choices. Hosts can enter setup from the hall page; room creation resolves the selected active public hall server-side.
2. Join a live room using a room code/link and a room-bound seat credential.
3. Preview/select server-generated tickets. A booking reserves a quantity (not pre-numbered grids) for a short hold; a confirmed reservation can be recovered with its one-time secret and assigned once to an attached waiting room. The selected quantity is locked and official grids remain generated by the game engine.
4. During play show the live number board, personal ticket marks from official calls, call history, enabled patterns/eligibility, and claim result/reason.
5. Show authoritative awards, winner and ticket attribution. Reconnect restores only the authorized seat and tickets.

### Admin and game operations

**Existing:** host caller console starts, calls, pauses/resumes, ends/resets, configures cadence and enabled patterns; Super Admin can inspect/manage rooms globally. **Implemented:** public hall pages offer instance-bound host room creation; the server only accepts active public slugs. Hosts can remove a non-host seat from the waiting room before play; the target session is revoked, the socket is removed from room broadcasts, and room audit history records the host actor. The permission-adaptive moderator workspace at `/moderator/bookings` exposes only operations allowed by explicit instance-scoped grants, including room creation/lifecycle, eligible player membership, booking read/cancellation, history, summaries and safe instance description updates. Authenticated browser review has verified moderator invitation/MFA and assigned-instance booking read/filter, plus cancellation denial without `bookings.manage`. Real host-to-player reservation, allocation, duplicate-replay refusal, and durable refresh/transport reconnect with identical tickets are browser-verified. **Remaining:** permanent bans and approval queues remain proposals that need identity and admission-policy decisions; broad screen-reader and manual gradient-contrast review remain open. A durable authenticated moderator browser pass now axe-scans no-grant, read-only room-detail and booking-read states at 390/1440 px with zero violations; automated coverage remains authoritative for tenant scope, grant enforcement and server-side assignment/count invariants. Authorized moderator cancellation is browser-verified with a retained isolated fixture.

The game engine remains the single source of truth. All eleven existing patterns remain unchanged: six original plus Star, Box, Early Seven, Second Full House and Half Sheet (the five optional patterns remain off by default). No new pattern is specified. The video’s cash-like prize amounts are out of scope. Game start locks ticket selection and pattern configuration under current rules.

### Agent/moderator experience

The video does not clearly show a separate agent dashboard or prove which actor books tickets. This is a proposal, not a video-derived fact.

**Existing:** separate moderator accounts, invitations, MFA, sessions, recovery, grants, revocation and room-scoped APIs. `players.manage` removes eligible room members; `reports.read` is instance-scoped; instance settings mutation is description-only. Ticket mutation is unsupported. **Implemented booking slice:** `/moderator/bookings` supports assigned-instance reservation search/detail and cancellation with explicit `bookings.read` / `bookings.manage` grants, plus scheduled-session availability and one-time room assignment with explicit `bookings.assign` and `room.read`. Assignment is transactionally scoped to an eligible waiting room in the same instance and does not alter reservation/player assignment or ticket grids. Current MFA, CSRF, session, tenant and audit checks apply. The new permission is not added to any existing grant automatically.

**Owner decision:** which moderators should receive explicit booking read/cancel grants. The new permissions are available but are never added to existing or newly provisioned grants automatically. No phone lookup or contact data is collected. A visible WhatsApp button does not authorize messaging.

## Ticket architecture decision

The video shows numbered availability and booking UI but does not establish the underlying data model, hold duration, cancellation, or payment semantics. Current tickets are generated per room/game and stored against a player seat.

| Option | Data model | Uniqueness / concurrency | Expiry, cancellation, reconnect | Audit / isolation / recovery |
|---|---|---|---|---|
| Existing server-generated selection | Ticket grid stored by room, game, player and ticket number at game start. | Existing relational constraints and transactional issue path keep tickets unique within a game/seat. | Seat reconnect restores its room data; no booking hold exists. | Existing history/recovery restores issued tickets; instance scope comes from room ownership. |
| Instance-scoped reservation/allocation (candidate) | Scheduled event under an instance, reservation ID, generated grid, status and expiry; later bind reservation to room/game/player or one-time booking credential. | Unique event/ticket allocation plus a transaction/row lock or atomic conditional update prevents two reservations claiming one ticket. | Pending reservation has a TTL; expiry releases atomically. Cancellation is allowed only before the cutoff/lock. Reconnect uses an authenticated seat or hashed random booking token. | Append-only reserve/confirm/cancel/expire/assign history. Every query includes instance/event. Recovery validates transitions and does not resurrect expired/released reservations. |
| Persistent pre-numbered inventory | Instance-level numbered pool, grid rows and allocation records. | Unique instance/ticket plus locked inventory row/atomic availability update prevents duplicate allocation. | Explicit reservation/cancel/expiry state machine; reconnect resolves by authenticated account or secret token. | More repair/audit complexity; all operations scope by instance. Restore validates pool/allocation consistency. |

**Implemented low-risk choice:** scheduled sessions reserve ticket quantity rather than exact numbered grids. Holds expire after a configurable period; the default is 10 minutes. A player supplies a display name (3–20 characters) and receives a random one-time booking reference and secret; only a hash of the secret is stored. A confirmed lookup can reveal the attached room code. Cancellation is allowed before assignment. The owner attaches a session to an eligible waiting room; the player proves possession of the booking secret to claim the seat. This avoids host/moderator impersonation. Claim is single-use and fixes the reserved count. The existing engine generates official grids and remains authoritative. No phone/email or payment is collected.

**Retention policy (owner instruction, 1 November 2026):** keep reservation and booking-audit records until the owner supplies a retention policy. Pending holds stop consuming capacity at expiry and are marked expired when a public or operator flow next observes them; records are not automatically deleted. Confirmed, assigned, cancelled, and expired rows and append-only audit events remain. This avoids inventing a legal/business period but means display names persist and storage grows until a later policy authorizes cleanup. Audit actor labels use generic reservation-owner labels rather than player names.

Session cancellation first marks elapsed holds `expired`, then cancels only remaining active, unassigned holds and confirmations. This keeps final state and audit history consistent even when expiry has not previously been observed by a player or moderator request.

On room recovery, every reservation assigned to that room must still match one durable member's player ID, room code, and locked ticket quantity, with the reservation remaining confirmed. Missing or inconsistent links freeze the room for operator review before it can be reactivated; recovery never silently restores a different ticket count.

## Booking decisions and remaining policy

1. Should hold duration and cancellation cutoff vary by instance/session?
2. Who can schedule sessions: Super Admin only, or selected moderators as well?
3. Which moderators should receive the explicit instance-scoped booking grants?
4. What retention duration should replace the current keep-until-owner-policy instruction?
5. Which report metrics and identifiable fields are approved?
6. What are the approved Regular/Bumper differences beyond the shared engine?

## Staged implementation roadmap

This roadmap is proposed; the current assignment does not start these later product stages.

### Stage 1 — Security closure and evidence

- Backend/database: preserve current tenant keys/constraints; add no booking schema. Add cross-identifier HTTP/socket and DB relationship tests; synthetic moderator restore drill.
- APIs/UI: no new product UI; verify Super Admin global paths and moderator permission semantics.
- Security: inventory routes, sockets, principals, audits, background/recovery and backup.
- Acceptance: Regular moderator cannot access Bumper/Legacy; owner retains global access; player/host room actions remain; revoked sessions/tickets fail. Synthetic restore preserves revocation and consumption states.
- Tests: serial suite, owner/moderator integration, sockets, Regular/Bumper/Legacy fixtures with tickets/calls/claims/awards, restore, gameplay/pattern regressions, lint/build/secret scan/audit and security review.

### Stage 2 — Complete Super Admin control center

- Backend/database: validated instance configuration, moderator lifecycle/grants, per-instance audit/report queries, health/backup status APIs.
- UI routes: instance overview/detail, configuration, moderator/grant management, audit/history/reports, health and backup status, using Obsidian Hall.
- Security: owner session/MFA/CSRF, explicit global-vs-instance scope, audited writes, no fake metrics.
- Acceptance: instance lifecycle changes are isolated; moderator suspend/recovery/grant revoke takes effect immediately; report counts match DB fixtures.
- Dependencies/tests: approve fields/lifecycle semantics; API validation, RBAC/CSRF, desktop/mobile browser flows and restore drill.

### Stage 3 — Moderator/agent management experience

- Backend/database: keep distinct moderator principal; add permissions only for approved real operations.
- UI routes: sign-in/MFA/recovery, assigned-instance list, room controls, player lookup/removal, scoped reports/activity.
- Security: MFA, CSRF, no public registration, immediate revocation, non-enumerating foreign IDs, secret-redacted audit.
- Acceptance: limited moderator sees only assigned data and allowed actions.
- Dependencies/tests: owner decision on agent role/player data; full permission matrix and desktop/mobile denial/allow flows.

### Stage 4 — Ticket availability/booking (core slice implemented; targeted browser flow verified)

- Backend/database: scheduled sessions and quantity-based reservations are implemented with capacity-safe holds, expiration, confirmation, cancellation, audit and one-time assignment to an attached waiting room. Existing game-engine generation supplies the actual grids.
- APIs/UI: public session discovery/reservation/lookup/cancellation, owner schedule/reservation management, and permission-gated moderator list/detail/cancellation are implemented. Explicit `bookings.read` and `bookings.manage` grants are available and never added to existing grants automatically.
- Security: tenant/event scope, unguessable hashed booking credential, PII minimization, rate limits, anti-enumeration and transaction-safe uniqueness.
- Acceptance: serial integration tests cover capacity contention, idempotent retries, expiry, cancellation, tenant isolation, one-time assignment, wrong/replayed credentials, locked quantity, room-start lifecycle, moderator grant boundaries and isolated booking backup/restore. Real browser checks cover player create/lookup/release, public lifecycle states, owner room/session attachment, confirmed host-to-player allocation, duplicate-replay refusal, and durable refresh/transport reconnect with exact ticket restoration at 390 px. An authenticated moderator browser reads and filters assigned-instance bookings, is refused cancellation without `bookings.manage`, and successfully cancels one eligible reservation with that explicit grant; the retained append-only audit attributes the action to the moderator. The moderator operations tabs have English/Hindi browser coverage, including mobile table labels. Owner retention instruction is to keep records until a policy is provided; no deletion job is authorized.

### Stage 5 — Instance-specific admin operations

- Backend/database: instance defaults, schedule and room lifecycle controls.
- UI: Regular/Bumper operations, live status and game history.
- Security: ownership from persisted room association and permission per operation.
- Acceptance/tests: both instances use the same engine with approved independent settings; side-by-side durable gameplay and recovery.

### Stage 6 — Player landing and instance-bound public experience

- Backend/UI: safe public instance directory and instance routes, game info, join and sharing.
- Security: omit private players, booking data, unpublished instances and platform totals.
- Acceptance/tests: instance identity survives join/reconnect; foreign IDs fail closed; deep links/CORS/cookies/mobile tested.
- Dependencies: approved slugs/domains and public content.

### Stage 7 — Runtime branding

- Backend/database/UI: validated per-instance branding schema, preview/editor and rendering.
- Security: asset type/size validation, contrast checks, no arbitrary HTML/scripts.
- Acceptance/tests: one instance’s branding cannot alter another; default Obsidian Hall remains; visual regression and upload tests.
- Dependencies: original owner-supplied brand assets and domain strategy.

### Stage 8 — Reports and analytics

- Backend/UI: approved instance aggregates, retention, date filters and export only if required.
- Security: every query/export scopes to instance and permission; no PII unless approved.
- Acceptance/tests: reconcile against synthetic fixtures; filter tampering cannot widen scope; performance and boundary-date tests.

### Stage 9 — Browser/mobile and deployment readiness

- Work: browser matrix, responsive/accessibility checks, synthetic restore, operational drills, external security review, dependency and secret scans.
- Acceptance: owner signs off evidence and recovery; deployment is not implied by this document.
- Dependencies: target host/domain/security configuration and separate deployment authorization.


#### Booking milestone verification refresh (1 November 2026)

- A fresh serial run against an isolated PostgreSQL 16 test database passed **653/653** across 20 suites, including booking concurrency/idempotency, confirmation, one-time room assignment and reserved-ticket count enforcement, moderator scope, and backup/restore. The only migration was applied to the disposable test database; the retained reservation schema and port 4000 were untouched.
- Memory-only and durable full-game journeys both passed. The durable journey dropped its own temporary schema after completion. Security probe passed 51/51; lint, both dependency audits, production build, secret scan, and diff check passed.
- Browser evidence has since advanced beyond this original milestone snapshot: separately authorized synthetic reservations verified public confirmation, assignment, duplicate-replay refusal and durable browser refresh/reconnect. The released reservation remains retained in `codex_book_ui_milestone_20261103`; assigned reservations and audit remain in `codex_booking_alloc_browser_20261101` and `codex_booking_reconnect_5336e95d`. Authenticated moderator read/filter, denial without `bookings.manage`, and successful authorized cancellation are verified. The cancellation fixture and audit remain in `codex_moderator_cancel_20261101`; see `TEST-REPORT.md`.

#### Responsive owner control-centre navigation (1 November 2026)

- At phone and tablet widths the owner sidebar collapses into a named menu control with `aria-expanded` and `aria-controls`. It opens all eleven destinations in a two-column touch menu, closes after navigation, and Escape closes it while restoring focus to the toggle. Desktop retains the persistent sidebar.
- Browser verification used the built client with a mocked owner session and read APIs; this confirms UI behavior only, not real owner authentication. No mutation endpoints were invoked. At 360, 390, 430, 768, 900, 901, 1024 and 1440 px, the layout had no horizontal overflow; there were no browser runtime errors. Screenshot: `.preflight/admin-nav-mobile-390.png`.
- Authenticated owner and moderator browser journeys now cover instance/reporting, themes, posters, branding, moderator lifecycle, booking list/detail/cancel and selected permission denials. Remaining: additional owner operational workflows, exhaustive permission combinations, and full screen-reader review.

#### Moderator permission-adaptive UI verification (1 November 2026)

- The built `/moderator/bookings` screen was browser-checked with synthetic mocked session and API responses. No booking record was created or changed.
- **PASS:** no grant shows no operations tabs; an account without enrolled MFA sees the MFA setup gate; `bookings.read` shows only Bookings and no Cancel action; adding `bookings.manage` renders Cancel only for an unassigned confirmed synthetic fixture. At 390 px, the page has no horizontal overflow; at 1440 px, the reader layout also has none. Browser runtime errors: 0. Screenshot: `.preflight/moderator-bookings-only-390.png`.
- This is client presentation coverage only. Integration tests remain the evidence for server-side authorization, current-grant checks, MFA enforcement, audit behavior and tenant isolation. Authenticated moderator browser journeys now cover invitation/MFA, assigned-instance operations, booking read, denial without `bookings.manage` and authorized cancellation; exhaustive permission combinations remain unverified.

#### Mobile moderator booking table (1 November 2026)

- The reservation table now switches to labelled, readable cards below 540 px. All six fields, including allocation and authorized actions, remain visible without horizontal scrolling; wide screens retain the semantic data table.
- Built-client browser verification confirms the 390 px card layout, all six labels, visible allocation, no page overflow at 390/1440 px, and no browser errors. Permission states were mocked; integration tests remain the authority for action rights. Screenshot: `.preflight/moderator-bookings-only-390.png`.

#### Booking milestone execution update (1 November 2026)

- Current full serial PostgreSQL 16 suite: **653/653 passed**, 20 suites, 0 skips. Memory-only suite: 589 passed and 42 expected PostgreSQL skips. Security probe: 51/51. Lint, build, root/client production dependency audits and secret scan pass. Verification used and removed a new disposable database container; it did not touch port 4000 or the retained reservation schema.
- The existing released test reservation is preserved under the owner's “keep records until I provide a policy” instruction. At the time of this snapshot, no second reservation had been submitted. A later separately authorized reservation and browser flow are recorded in the addendum below.
- A real Chromium browser then traversed the built public directory, Regular hall, session list, and booking form using mocked GET responses only. It verified availability, room-specific ticket choices, public omission of the room code, no page overflow at 390/1440 px, zero browser errors, and zero booking mutations. This does not substitute for the remaining authenticated assignment/allocation journey.
- The owner session/reservation tables were also reviewed with mocked owner and read APIs. Mobile clipping was found and corrected: both become six-field labelled cards at 390 px, showing allocation and actions without an inner scroller; desktop retains tables. Reservation detail and eligible owner action visibility passed. The test sent zero mutations and had no browser errors. This is UI evidence only; authenticated authorization and the actual booking lifecycle remain outstanding.
- A separate mocked cancellation interaction confirmed the browser prompt, intercepted the cancel request once, refreshed the row/history to cancelled, removed the action, and moved focus to the announced result. The mobile cancelled state has no overflow and the success notice remains visible. No persistent record changed; real server cancellation continues to be evidenced by integration tests.
- The public page also completed a mocked hold/confirm UI journey: ticket count stayed within the session limit, confirmation presented the private recovery code and instance-bound join path, and neither credential was persisted in browser storage. Two POSTs were intercepted with no database writes; no overflow occurred at 390/1440 px. The repeated free-play notice was consolidated into one complete disclaimer. This does not prove server behavior or assignment.

### Booking browser verification addendum (1 November 2026)

- Owner-approved real-browser passes completed host-room/session association, public reservation, credential-based allocation, locked ticket count, server-generated grids, replay refusal, and durable player refresh/transport reconnect with exact ticket restoration. The assignments and audit history remain retained in isolated schemas `codex_booking_alloc_browser_20261101` and `codex_booking_reconnect_5336e95d`. The latter browser pass retained one confirmed reservation, session, room and member row under the keep-until-policy instruction. Authenticated moderator browser checks verified assigned-instance list/filter, denial without `bookings.manage`, and successful cancellation with an explicit grant. The cancelled synthetic reservation and append-only audit remain in isolated schema `codex_moderator_cancel_20261101`. Mocked browser tests cover expired/cancelled/unavailable public views; moderator English/Hindi operations copy also has Chromium coverage. See `TEST-REPORT.md`.

### Platform-wide runtime branding status (1 November 2026)

The Super Admin branding surface is implemented and durably verified: owner-only save, strict asset/text/color/link validation, append-only audit, and sanitized public runtime identity/metadata. Deployment `VITE_*` settings remain the fallback until the owner saves platform branding; instance branding and active theme packages remain independently scoped. Verification details are in `TEST-REPORT.md`.

#### Build-time metadata and install-manifest follow-up (2 November 2026)

- The client title, description and social title now use the same shared defaults as runtime branding and can be configured for a build. The PWA manifest is served from the public branding endpoint; validated build-time fallback name/description, curated local icon and normalized accent are used only until an owner-saved platform identity exists, which takes precedence. The Super Admin asset pickers no longer show a stale hard-coded product name.
- Focused Vite metadata and branding/API tests pass **8/8**; client lint and custom-brand/default production builds pass. Static HTML attributes and fallback manifest URL values are escaped; invalid names, descriptions, icons and low-contrast colors fall back safely.

### Moderator booking workspace localization (1 November 2026)

- The moderator route now exposes the persisted English/Hindi selector and localizes sign-in/MFA, assigned-instance controls, permission navigation, booking filters/list/detail, room/player/history/report/settings operations, mobile table labels, statuses, audit events, known API errors, allocation labels, cancellation confirmation and date formatting. Locale tests pass 7/7; client lint and production build pass. A mocked Chromium pass checked all five operation tabs at 390 px, detailed room/player states, and overall 390/1440 px overflow. The user-authorized moderator cancellation is documented in the booking browser verification addendum and test report.
- Coverage is verified for the implemented English/Hindi moderator operations surfaces. Known API error codes are translated; unknown server detail is preserved in English and shown generically in Hindi. Mocked Chromium coverage passed on the operations tabs; this is not a full screen-reader or whole-application accessibility audit.

### Player waiting-room recovery and connection feedback (1 November 2026)

The player waiting room now displays live socket connectivity. A Chromium check against an isolated memory-only server verified refresh and transport reconnect restore the same player identity and exact ticket grids without adding a second seat; the UI remained within 390 px and had no uncaught browser errors. This verifies general player-seat recovery only. Durable booking-allocation refresh/reconnect remains a separate open acceptance item.

### Owner control-centre keyboard navigation (1 November 2026)

The existing owner skip link now moves keyboard focus to the main content landmark. Chromium verified it is the first keyboard stop on a fresh owner page and Enter focuses the main region. The responsive navigation suite also passes its menu keyboard behavior and eight viewport widths. This is a focused check, not a full screen-reader or console accessibility audit.

### Public entry narrow-screen browser verification (1 November 2026)

The built public directory, Regular hall, scheduled-session list and booking form render at 320, 360, 390, 768 and 1440 px in Chromium. The UI test used mocked public read responses on an ephemeral memory-only app and created no reservation. It found no page, main-content or internal card overflow, no browser errors and no mutations. This verifies layout only, not the live booking data contract or the remaining game/accessibility requirements; evidence and screenshots are in `TEST-REPORT.md`.

### Live player board narrow-device verification (1 November 2026)

A real in-memory host/player browser journey started the round and displayed the server's official first call. At 320, 360, 390, 568×320 landscape, 768 and 1440 px, the player screen had no horizontal overflow; the called-number board exposed 90 list items and one labelled current call. The check found a missing stylesheet on the shared language selector when used from a player route. Its styles now load with the component; Chromium measured foreground/background contrast at 12.97:1. The evidence is browser viewport emulation, not physical handset or full screen-reader coverage.

### Reviewed theme catalog expansion (1 November 2026)

The theme store now includes nine distinct, validated token packages covering all nine supported categories. Migration 018 adds six reviewed version 1 packages while preserving the active global theme and instance selections; no new theme is published, and the daily release schedule remains disabled by default. Focused theme tests pass 3/3. Migration 019 adds owner-scoped in-app daily release notifications with idempotent creation and audited acknowledgement. The latest full isolated PostgreSQL suite passes 660/660 through 019. Nine theme-specific original SVG motifs now accompany the real ticket and board in public and owner previews. Mocked Chromium verifies nine unique motifs, public modal preview, 390/1440 px layouts and zero runtime errors or mutations; authenticated Chromium also verifies the actual daily-release notice and durable acknowledgement at 390 px. Poster-grade illustration and wider visual/accessibility review remain future work.

## Recovery operator workflow status (1 November 2026)

A durable room frozen by recovery integrity checks can now be rechecked by an authenticated owner. The retry reruns recovery validation, writes an owner audit result, keeps ordinary room controls unavailable on failure and re-enables them on success. It does not repair corrupted rows; an operator must correct the underlying data first. Browser verification and the 665/665 serial PostgreSQL suite are recorded in `TEST-REPORT.md`. Additional corruption cases and full operational recovery review remain open.

### Booking-linked recovery verification update (2 November 2026)

Room hydration now has explicit regression coverage for all six reservation-to-seat invariants, alongside the durable freeze/retry/repair path. The latest complete serial PostgreSQL suite passed **666/666** through migration 021, including both backup/restore drills. A frozen room can be rechecked by an authenticated owner after a separately reviewed durable repair; the app does not alter booking facts to force recovery. Further non-booking lifecycle corruption cases and the broader product acceptance gates remain open.

### Reset recovery validation update (2 November 2026)

Cold recovery now preserves the new waiting-room ticket selection independently of prior-round stored ticket rows and refuses malformed historical awards before reopening. The final serial PostgreSQL suite passed **670/670**, including both backup/restore checks; see `TEST-REPORT.md`. Broader game/claim/award lifecycle corruption and the remaining platform acceptance gates remain open.

Recovery additionally cross-checks awards against the supported pattern registry, point values, stored call history, extant participant, owned ticket attribution, uniqueness, and ordinal continuity. The full PostgreSQL suite passed **672/672**; broader product acceptance remains in progress. The approved local moderator cancellation has not yet been executed because browser automation was unavailable in this turn.

The Super Admin overview now includes recent owner and moderator platform activity and current local backup/restore-check status, using the existing append-only audit records and credential-free backup summaries. The full PostgreSQL suite passed **673/673** with both backup/restore checks. Lint, build, audits, and secret scan passed. Browser-driven cancellation verification remains pending because the computer-use helper failed before exposing a window; retained reservation records remain unchanged.

Instance records now have an operational `roomDefaults` configuration managed by Super Admin. Supported defaults are bounded room capacity, ticket cap, auto-call interval and automatic calling. New rooms inherit those values from their persisted instance, and later updates leave existing rooms intact. Owner API changes are validated, CSRF-protected and audited. PostgreSQL verifies Regular/Bumper isolation and the persisted room behavior; full suite: **675/675**.

Read-only inspection of the two retained moderator-cancellation schemas confirms both reservations are already cancelled and have matching moderator success audit entries. No data was changed in this verification.

## Booking milestone closeout (2 November 2026)

The end-to-end booking implementation and verification for this milestone is complete: public discovery and reservation, private credential lookup, host/session association, one-time player allocation, server-enforced ticket counts and grids, duplicate refusal, expiry/cancellation states, moderator grants, tenant isolation, audit history, and durable refresh/reconnect are covered by integration tests and the recorded Chromium journeys. The authenticated moderator cancellation fixture is retained with hold.cancel history; the current browser continuation found it already cancelled, so it made no second write. Screenshot: .preflight/moderator-cancelled-reservation-390.png.

The final serial PostgreSQL suite passes **676/676** across 20 suites, no skips, through migration 021, including both backup/restore checks. Client lint/build, secret scan, root/client dependency audits and git diff --check pass. Reservation and audit rows remain retained until the owner supplies a policy. Broader product work remains outside this booking closeout: full assistive-technology and physical-device checks, manual gradient contrast review, expanded recovery/soak work, independent L3 review, and production-host configuration review.

### Accessibility evidence correction (2 November 2026)

A detailed capture of the 28-sample authenticated moderator axe run shows the only incomplete `color-contrast` result is a decorative `span[aria-hidden="true"]` containing only a non-text menu glyph. Axe explicitly states it cannot evaluate contrast for that content; it does not report a text-node or gradient finding. The harness asserts the finding remains limited to that one node. No color-contrast violations were reported. This evidence does not replace manual device or assistive-technology review.

### Recovery timestamp integrity update (2 November 2026)

Game recovery now checks that start/completion timestamps are valid and consistent with the persisted game state: running games have no completion time, completed games have one, and completion follows start. The focused recovery, persistence, booking-recovery and booking suites passed **31/31** with no skips. This closes timestamp consistency coverage; broader lifecycle, claim/award corruption, soak and full platform acceptance work remain open.

### Full-suite verification after recovery hardening (2 November 2026)

The complete serial PostgreSQL suite passes **678/678** across 20 suites with no skips, failures or todos on fresh disposable PostgreSQL 17.11 through migration 021. It includes exact booking/audit content verification after restore and game lifecycle timestamp corruption checks. The broader platform remains active: expanded recovery cases, screen-reader/physical-device review, external security assessment, soak/load and target-host configuration are still open.

### Claim-decision recovery integrity update (2 November 2026)

Durable recovery now reads current-game claim decisions in the same room snapshot. It rejects orphaned or duplicate `AWARDED` decisions, awards without exactly one matching awarded-claim row, participant references that do not exist, and claim call indexes outside the stored history. Rejected attempts remain intact, including unknown-pattern attempts that are legitimate refusals. Focused recovery/ticket-integrity checks passed **20/20**; durable persistence and optional-pattern recovery passed **39/39**; the complete serial PostgreSQL suite passed **681/681** across 20 suites with no failures/skips/todos through migration 021, including backup/restore. Broader lifecycle corruption, external security review, screen-reader/physical-device work, multi-hour soak, and target-host configuration remain open.

### Current-worktree verification note (2 November 2026)

The latest full serial PostgreSQL suite passed **694/694** across 20 suites through migration 021 with no skips or failures; the disposable database was removed. The encoded-NUL moderator path fix and safe path identifier validation are included. The latest two-hour durable heartbeat test did not pass (250 clients disconnected); its follow-up was interrupted after about 90 seconds and has no accepted result. Do not treat the long-soak gate as closed. Full assistive-technology/device, independent security and target-host gates remain open.


## 5 November 2026 — role separation status

The earlier shared Owner/Super Admin alias is superseded. Migration 029 stores an explicit account role; existing accounts default to Owner. Global platform endpoints require a separately provisioned Super Admin role plus confirmed MFA. owner:create never elevates. super-admin:create and the typed-confirmation super-admin:promote CLI paths are offline, transactional, session-revoking and audited. Owner can manage only its own credentials until instance-scoped Owner/Admin permissions are specified. See [NINETY-CLUB-ROLE-ARCHITECTURE.md](NINETY-CLUB-ROLE-ARCHITECTURE.md).

### Super Admin MFA enrollment gate (5 November 2026)

In production, a Super Admin that has not enrolled MFA can access only its own account security settings to finish enrollment. The same endpoint no longer discloses other account rows or platform origin/runtime/health/default/backup state during that limited session. A regression test and fresh installed-Chrome acceptance verify 403 `MFA_REQUIRED` for global APIs before enrollment, global access after an MFA challenge, and session denial after sign-out. The final local test suite passed **761/761**. This does not close full action-level acceptance or production deployment prerequisites.
