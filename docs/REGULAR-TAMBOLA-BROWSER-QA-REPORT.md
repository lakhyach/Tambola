# Ninety Club — Regular Tambola Isolated Browser QA

**Assessment: RELEASE CANDIDATE WITH BLOCKERS**  
**Branch / HEAD:** `codex/regular-tambola-autostart` / `5241c05044ec1012623bb540dc61151a9272cfc7`  
**Production deployment:** Not performed. No commit or push was made.

## Environment and safety

- Automated browser runtime: locally installed Google Chrome, controlled by project-local Playwright. This is a real Chrome browser runtime, but the run was automated and headless; it is not Codex's connected interactive Chrome session.
- Application and database: local application bound to loopback and an isolated PostgreSQL 17 instance. Each browser run used a random disposable database schema, applied migrations into that schema, seeded a synthetic owner, and dropped the schema at shutdown. The harness rejects non-loopback database URLs and any port/database other than the dedicated local PostgreSQL test endpoint.
- Test identities: synthetic `QA Owner` and `QA Player 1` through `QA Player 5`. These are automated technical identities, not consenting human participants. No production accounts, customer data, money, rewards, or external messages were used.
- No production image or migration was created or deployed. Migration 034 was tested only in disposable local schemas. Production configuration could not be verified in this task. ZANCTA and shared Traefik were not accessed or changed.

## Browser test results

| Test | Expected | Observed | Result |
| --- | --- | --- | --- |
| `landing page renders in desktop and mobile viewports` | Public home and empty-state announcement render; mobile has no horizontal overflow or page errors. | Heading, Play Now and “Let the Good Times Roll!” appeared; desktop and 390px mobile checks passed, with no page errors. | PASS |
| `owner sign-in page exposes its form without internal recovery instructions` | Username/password/sign-in form works visually; internal reset commands are absent; mobile fits. | Form appeared at desktop and mobile widths; `owner:reset` / `owner:mfa-reset` instructions were absent; no overflow or page errors. No production sign-in was attempted. | PASS |
| `QA owner publishes a 200-ticket Regular session; five isolated player browsers book and enter` | Owner-only workflow creates and publishes actual session/inventory; five independent browsers reserve distinct tickets and join the correct waiting room; admin and player views recover/update. | Synthetic owner authenticated in the isolated app, selected Regular Tambola, and created/published a 200-ticket session with an automatically created room, Asia/Kolkata schedule, booking window, auto-start opt-in and persisted patterns. Public session API returned the published session. Five contexts reserved `TKT-0001`–`TKT-0005` (all unique); all five joined the associated room, each saw its own one-ticket grid and Top Line pattern, and the scheduled IST countdown. Admin inventory updated to 5 confirmed of 200 without refresh, then remained correct after reload. | PASS |
| Poster studio path (within third test) | Selected session supplies authoritative facts; composition updates preview; desktop/mobile preview is usable. | Studio loaded the selected session's title, schedule/timezone, 195 of 200 available tickets and configured pattern facts. Selecting another approved composition changed the SVG preview. Desktop/mobile previews rendered with no horizontal overflow, broken images, or page errors. | PASS |

The initial poster assertion exposed a test setup race: the studio retained an auto-selected session while the instance's session list was loading. The test now clears that selection before choosing the intended Regular session. The API context returned HTTP 200 and the corrected end-to-end test passed. No application workaround or database seeding shortcut was used.

## Screenshots captured

Actual screenshots from the passing local Chrome run:

- `artifacts/browser-qa/landing-desktop.png`
- `artifacts/browser-qa/landing-mobile.png`
- `artifacts/browser-qa/admin-signin-desktop.png`
- `artifacts/browser-qa/admin-signin-mobile.png`
- `artifacts/browser-qa/published-session-desktop.png`
- `artifacts/browser-qa/published-session-mobile.png`
- `artifacts/browser-qa/player-scheduled-countdown.png`
- `artifacts/browser-qa/poster-studio-desktop.png`
- `artifacts/browser-qa/poster-studio-mobile.png`

The poster image provider was not configured in this isolated environment. No background generation was attempted, and no generated art is represented as evidence. The composition preview uses the application's actual approved SVG renderer.

## Countdown and lifecycle audit

The actual `/player/game` screen did not previously show the scheduled session countdown. It now fetches the published public session from the existing public session endpoint, refreshes on socket reconnection, periodically, and when the tab becomes visible. The displayed countdown is aligned using the endpoint's server-time value; it is informational only and cannot start a game. The browser confirmed the scheduled instant and `Asia/Kolkata` label, and refresh/navigation retained the countdown.

The page renders the session's waiting state and actual ticket grid/patterns. Navigating from the room to `/player/game` retained the schedule/countdown. No browser test refreshed the game route or waited for the scheduled instant, so browser evidence does **not** prove refresh recovery, transition at the schedule boundary, exactly-once execution in browser, or caller startup after transition. Those server-side behaviors are covered by the isolated automated suite's scheduled-start tests (including Bumper and Regular durable claims, duplicate invocations/instance workers, not-early behavior, manual host restrictions, cancellation, and lease/retry paths). Browser QA did not test actual number calls, marking after calls, valid or invalid claims, duplicate claims, winner persistence/dashboard updates, pause/resume/end, or settlement. These remain lifecycle acceptance gaps.

The waiting room countdown and game-page countdown use the published session schedule. Delayed, paused, cancelled, completed, and failed states are represented from actual public session state where present; this run only observed the future scheduled/waiting case. The schedule was set about 20 minutes ahead to avoid triggering a live game or caller during QA.

## Regression, security, and migration checks

- Isolated PostgreSQL 17 full suite: **818 tests, 818 passed, 0 failed, 0 skipped; 20 suites**. Run through WSL with native PostgreSQL tools, including the booking backup/restore integration. A separate Windows invocation could not run that test because its helper expected Docker Desktop; the WSL PostgreSQL 17 run completed the same suite successfully.
- Client lint: PASS.
- Vite production build: PASS.
- Security probe: **51/51 PASS**.
- Secret scan: PASS; 740 files inspected, including built client output; no credential values or credential-shaped shipped text detected.
- Root, production-only, and client dependency audits: **0 vulnerabilities** each.
- `git -c core.whitespace=cr-at-eol diff --check`: PASS. Plain `git diff --check` flags the repository's existing CRLF line endings; CRLF-aware check is clean.
- Migration 034 (`034_session_winning_patterns.sql`) applied and tested in disposable schemas; migration rollback/recovery paths were exercised by the PostgreSQL suite. SHA-256: `0DACFCECD27ED794D2923D7751890E977027B491C1D3E1C9BB3AC279764456CD`. It adds nullable per-session `winning_patterns` JSONB with an object-type constraint; `NULL` preserves legacy behavior. No production schema was changed.

The full automated suite covers owner-only session creation, public creation denial, atomic room/session setup, session pattern isolation, booking concurrency and recovery, real-time inventory updates, and durable scheduled-start paths. Browser evidence independently confirms the owner UI, publication, real ticket reservation flow, player association, and admin update/reload.

## Human acceptance and remaining blockers

- Five-person consenting human acceptance: **not performed**. Synthetic accounts must not be treated as participant acceptance.
- Scheduled start at its actual instant and the complete live gameplay/winner/settlement lifecycle: **not verified in browser**.
- Production deployment configuration and current production health/image: **not verified**.
- Poster background provider generation: **not configured or tested**.
- Sign-in return-link centering was not measured as a separate visual assertion.

## Phase 2 public schedule and multiplayer admission — 7 November 2026

### Reproduction and result

Ran against a disposable PG 17.11 schema and real local Chromium. A newly created standalone room returned `publicScheduleCount: 0`; it has no scheduled-session record. Draft sessions remained absent. After owner publication and inventory generation, Regular and Bumper sessions were returned by their public endpoints with `status=open` and `bookingStatus=open`. A published future session was returned with `bookingStatus=not_open`. Closed-window and cancelled listing rules were additionally asserted by database service tests.

Representative response facts from the run (synthetic records):

```json
{
  "standaloneRoom": { "seated": 1, "publicScheduleCount": 0 },
  "draft": { "status": "draft", "publicCount": 0 },
  "regularPublished": { "status": "open", "bookingStatus": "open", "capacity": 2, "available": 2, "instanceSlug": "regular" },
  "bumperPublished": { "status": "open", "bookingStatus": "open", "capacity": 2, "available": 2, "instanceSlug": "bumper" },
  "futurePublished": { "bookingStatus": "not_open" },
  "bookedJoinBeforeStart": { "ok": true, "state": "WAITING" },
  "bookedJoinAfterStart": { "ok": true }
}
```

A confirmed synthetic booking entered the linked room before start. Under the old lifecycle, the host start cancelled the confirmed unassigned reservation and post-start joining was rejected; migration 036 now retains it and the server admits that booked participant into the active round. A numbered ticket regression additionally verifies that the exact selected ticket ID and grid are present in the live game row and restore after a new server process reconnect. The exact customer message “Room is full” was not observed. The actual engine `ROOM_FULL` guard remains capacity-based; the customer's room and 250-seat roster were not accessible.

### Full browser workflow

Isolated owner workflow passed **4/4 Playwright checks**: landing responsive render, owner sign-in render, phase-2 schedule/admission lifecycle, and owner publication plus five separate synthetic player contexts booking distinct tickets from a generated 200-ticket Regular catalog. The run also checked the Bumper listing and future `not_open` state. Browser workflow used only its random disposable schema and retained no persistent application records.

Current-run files:

- `artifacts/phase2-repro/landing-desktop-current.png`
- `artifacts/phase2-repro/landing-mobile-current.png`
- `artifacts/phase2-repro/published-session-desktop-current.png`
- `artifacts/phase2-repro/published-session-mobile-current.png`
- `artifacts/phase2-repro/screenshots/admin-sessions-desktop.png`
- `artifacts/phase2-repro/screenshots/admin-sessions-mobile.png`

### Verification limits

No 250-concurrent-seat load test, actual game-call delivery to late joiners, or direct access to room `SKGLEDXV` was completed. Full serial tests finished at 825/827; only the two Docker-dependent backup/restore checks failed because this machine's Docker Desktop Linux engine is unavailable. Production configuration remains NOT VERIFIABLE. No production booking/database was accessed.

These gaps keep the status at **RELEASE CANDIDATE WITH BLOCKERS**. The local implementation is ready for human review, but this report is not production approval. Work remains uncommitted on the existing branch at the HEAD above. The pre-existing untracked `&&` entry was not opened, changed, deleted, or staged.

## Ticket serial continuity addendum (7 November 2026)

- Rebuilt the current client and reran the focused isolated browser workflow against a random schema on local PostgreSQL 17. It generated 200 tickets, held/confirmed five distinct issued tickets in separate player contexts, and joined each booked seat to its assigned room.
- The new assertions verify each waiting room shows the same issued serial selected in the public catalog, lists it in the locked assignment summary, and omits the room-wide ticket-count picker. Result: **1/1 workflow passed**. Current screenshot: `artifacts/browser-qa/player-ticket-serial-mobile.png` (390 px).
- Initial runs were useful defect findings: the old browser spec used stale Admin form labels, then served the preexisting dist bundle. After updating the selectors and rebuilding, the source behavior passed. No persistent reservation data remains because the harness drops its random schema.
- Focused engine/view tests: 39/39 passed; client lint and build passed. No full suite was run. Durable database claim attribution after process recovery, wider responsive matrix, full Admin route visual audit, and production configuration remain unverified.
