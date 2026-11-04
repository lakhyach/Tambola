# Ninety Club frontend route audit

Date: 3 November 2026. This is a source-level route inventory and implementation checklist. It is not a screenshot-based visual audit; browser capture failed in this session and is recorded as a blocker below.

## Route inventory

| Surface | Routes | Current source-level result |
|---|---|---|
| Landing | `/` | Existing festival landing with session directory, theme collage, ticket sample, live-game entry, and winning-pattern section. All 11 server-supported pattern cards now use shared display data. |
| Game directory | `/games` | Existing public hall/session directory; booking remains a separate session flow. |
| Public theme library | `/themes` | Existing reviewed-theme gallery is now read-only; it no longer applies a visitor-selected theme or opens an interactive switcher. Host navigation can still reach it outside player routes. |
| Published poster | `/poster/:posterId` | Existing published poster/share view remains. Public PNG/SVG export controls were removed; export remains in Admin Poster Studio. |
| Hall detail/session list | `/games/:slug`, `/games/:slug/sessions` | Existing public instance details and session list retained. |
| Reservation | `/sessions/:sessionId` | Existing server-backed catalog and reservation flow retained; action label now says “Book Ticket” in English and Hindi. |
| Player entry, waiting room, live game | `/player`, `/player/room`, `/player/game` | Existing route hierarchy retained. Theme navigation is absent from player entry/waiting/game views; live-game theme/poster controls are not exposed. |
| Host entry, waiting room, caller | `/host`, `/host/room`, `/host/game` | Existing route hierarchy retained. New Host rooms enable all supported pattern IDs through the existing room configuration event before the waiting view; configuration failure is surfaced for review. |
| Moderator | `/moderator/bookings`, `/moderator/accept`, `/moderator/recovery` | Existing scoped booking operations and credential/recovery screens retained. No new API or permissions were added. |
| Owner Admin | `/admin/signin`, `/admin`, `/admin/instances`, `/admin/instances/:instanceId`, `/admin/reports`, `/admin/moderators`, `/admin/sessions`, `/admin/themes`, `/admin/posters`, `/admin/games`, `/admin/games/:roomId`, `/admin/players`, `/admin/history`, `/admin/settings`, `/admin/branding` | Existing control routes retained. Room creation now presents the shared 11-pattern catalog, diagrams and descriptions, all selected by default. Theme and Poster Studio controls remain on Admin routes. |
| Super Admin | `/super-admin/signin`, `/super-admin`, `/super-admin/instances`, `/super-admin/instances/:instanceId`, `/super-admin/reports`, `/super-admin/moderators`, `/super-admin/sessions`, `/super-admin/themes`, `/super-admin/posters`, `/super-admin/games`, `/super-admin/games/:roomId`, `/super-admin/players`, `/super-admin/history`, `/super-admin/settings`, `/super-admin/branding` | Same existing route components mounted under the separate Super Admin base path. |

## Cross-route checks made in source

- Theme art preview layers were traced to the generated banner motifs in `client/src/admin/theme-art.js` and the `.fest-theme-card__art::before` rule in `client/src/landing-festival.css`; those overlays were removed while retaining original festival images.
- Platform defaults and runtime metadata normalize the old platform brand to Ninety Club. Tenant-provided brand names remain supported. The social-card wordmark was updated in place. Protected logo/favicon assets remain unchanged and still contain the original embedded wordmark.
- The public theme gallery is display-only. Player navigation suppresses the Themes link under `/player` and its nested routes. Admin theme management/preview remains in owner-gated routes.
- Public poster viewing and sharing remain available by published link, while poster rendering/export controls stay in the owner-gated studio.
- Pattern labels, descriptions, server example ticket and cell mapping are shared between Landing and Admin room creation. Player/caller patterns continue to come from server snapshots; the server catalog remains authoritative.
- Public booking keeps its existing server-issued inventory, reservation callbacks, status and serial rendering; only the CTA copy changed.

## Verification status

- Client lint: pass. Production build: pass. Selected existing tests: 272 pass, 0 fail.
- Server-file SHA-256 comparison: 81/81 unchanged relative to the baseline captured during this task. The worktree contained pre-existing server edits when this task began; this task made no server changes.
- Browser verification: blocked. Both in-app CUA and desktop browser bridges failed before returning browser state. No new screenshots were captured, and prior-turn screenshots are not treated as evidence for these changes.
- Genuine 3D asset: blocked. No numbered model meeting the download/license constraints was available. Three.js/R3F/Drei were not installed, and the existing live number display remains unchanged.

**Audit result: blocked pending current-turn browser verification and a compliant numbered 3D asset.**

## 4 November 2026 — database and acceptance continuation

The database compatibility assessment is recorded in [`NINETY-CLUB-DATABASE-COMPATIBILITY-REPORT.md`](NINETY-CLUB-DATABASE-COMPATIBILITY-REPORT.md). Summary: the active ignored `.env` still points to local PostgreSQL 16 at `127.0.0.1:55432/tambola`; its value matches the redacted URI in the request. The tracked `.env.example` is a template using port 5432. Since `.env` is ignored and has no Git history, an earlier local value cannot be reconstructed. A read-only query to the active database succeeded; no Supabase endpoint or credentials were configured, and no remote migrations were attempted.

| Acceptance area | Verified in this continuation | Not verified / evidence |
|---|---|---|
| Route inventory | Existing source inventory documents 45 route templates. | 0 routes opened/verified in Chrome during this continuation. |
| Actual rendered UI | None. | Computer Use still fails during kernel bootstrap after reset/retry; no screenshots. |
| Confirmed UI/functional defects | None established from rendered UI. | No issue register entries with screenshots; source-only suspicions were not promoted to defects. |
| Role sessions | None. | Super Admin, Admin, Host, Moderator, and Player flows remain untested in Chrome. |
| Live gameplay | None. | No acceptance accounts/game, ticket play, winning claims, settlement, or result audit performed. |
| Local database | PostgreSQL 16.14 at the configured local target answered a read-only query. | Backend API was not listening on port 4000. |
| Automated database/regression tests | Previous complete suite: 736 passed, 0 failed, 0 skipped; DB-backed tests used isolated schemas. | This is not a live Supabase connectivity/migration test or browser acceptance. |
| Supabase | Static review found PostgreSQL compatibility with direct/session connections. | No project URI/credentials; remote connectivity, migration, limits, and performance remain unverified. |

The supported browser runtime error remains `failed to write kernel assets: The system cannot find the path specified. (os error 3)`. Chrome is present, but the integration cannot expose a window. No alternate automation was used. **Overall acceptance remains FAIL / blocked** pending real Chrome inspection, authenticated role/gameplay verification, screenshot evidence, and the approved Supabase staging proof.


## 4 November 2026 — Supabase acceptance continuation

The latest configured `.env` points to a Supabase shared session-pooler route on port 5432. The endpoint completed a verified TLS handshake when the repository's Supabase CA was supplied, then rejected authentication with PostgreSQL `28P01`. No password, full connection URL, project reference, or credential was recorded. `npm run env:check` fails because the URL omits `sslmode`; the normal backend pool also does not explicitly configure a CA or TLS verification. No application startup, migrations, database tests, lease/heartbeat writes, or game operations were attempted.

Remote database identity, schema/table contents, migration tracking, pool behavior, advisory locks, heartbeat, and staging status are **not verified**. Local `NODE_ENV=development` does not establish the Supabase project's environment. The repository test suite was withheld because its default command loads this remote URL and tests can create isolated schemas. The earlier 736/0/0 result is historical only.

Computer Use recovery was retried using the documented `@oai/sky` initialization after a kernel reset; it again failed before exposing a window with `failed to write kernel assets: The system cannot find the path specified. (os error 3)`. No substitute automation was used. There are no new screenshots or authenticated role/gameplay results.

**Acceptance remains FAIL / blocked.** Resolve the rejected Supabase login and configure verified TLS explicitly, then establish that the project is dedicated non-production staging before any migration-on-boot server, schema-creating test, heartbeat, or gameplay test. The current database report contains the detailed evidence and safety limits.



## 4 November 2026 follow-up — local TLS configuration

The existing ignored `.env` `DATABASE_URL` now specifies `sslmode=verify-full` and the repository CA file path. Credentials and other environment assignments were preserved. The environment check now has 0 errors (7 OK, 3 unrelated warnings), and the targeted environment-check tests pass (11/11).

The authenticated connection attempt using this exact URL still receives PostgreSQL `28P01`; the Supabase Dashboard could not be opened through the supported Computer Use integration, so the credential mismatch, intended project identity, and staging status remain unresolved. No backend startup, migrations, DB tests, heartbeat writes, or gameplay tests were run. Computer Use still fails before exposing a window; there are no new Chrome screenshots or role/gameplay verification results.



## 4 November 2026 follow-up — Supabase authentication and Computer Use

A fresh process loaded the current `.env` URL and connected successfully to the Supabase session pooler over port 5432. Read-only identity checks verified PostgreSQL 17.11, database `postgres`, schema `public`, verified encrypted client TLS, and a migration tracker at versions 001–003. Those checksums match local migrations. Versions 004–027 are pending. Catalog statistics indicate existing activity; the database is initialized and not empty. Since the Supabase Dashboard could not be opened, the intended project and dedicated staging status remain unknown. No migration, server startup, acceptance schema, lease/heartbeat operation, or game test was run.

Chrome is installed and running (version 156.0.8078.80; one visible window), and the local temporary directory exists. Supported `@oai/sky` initialization and `cua.getState()` both fail before exposing browser state with the kernel-assets path error. The host-owned asset path/logs are not available through the supported diagnostics, so there is no safe local repair identified. No tabs were inspected, no screenshots were captured, and no alternate automation was used.

A safe future recovery sequence is: initialize a fresh supported Node Repl using the documented `@oai/sky` import; on an initialization failure, perform one documented kernel reset and retry once; if the same kernel-assets error recurs, stop and escalate the host integration failure. Once initialized, select Chrome and its window only from returned `sky.list_apps()` / `sky.list_windows()` data, then capture a fresh state before each inspection or action. Do not infer windows or fall back to another automation framework.

**Acceptance remains FAIL / blocked.** Database reads are verified, but staging identity and real-Chrome inspection are prerequisites still unmet. Zero routes were inspected in Chrome in this continuation; roles, gameplay, voice playback, screenshots, and full regression remain untested.



## 4 November 2026 — latest real Chrome acceptance attempt

Both supported Computer Use entry points again failed during kernel asset setup before returning any app, window, or browser tab. Chrome is running and the local TEMP, TMP, Local AppData, and user-profile directories exist. The exact failing asset path is not exposed. See `docs/COMPUTER-USE-RECOVERY.md` for the diagnostic record and host escalation procedure.

Client lint passed. The client production build passed with the existing warning for the deferred `ThreeBallRenderer` chunk (639.43 kB). No source files were changed or application defects inferred from the build warning. Real Chrome routes inspected: 0 of 45. Screenshots: 0. Roles, gameplay, voice playback, and staging database acceptance remain blocked. No Supabase writes were made.



### Blocker register

| ID | Severity | Area | Reproduction/evidence | Root cause status | Fix and regression status |
|---|---|---|---|---|---|
| CU-001 | Blocker | Real Chrome Computer Use | Documented `@oai/sky` initialization and `cua.getState()` each return the kernel-assets Windows path error before browser state. | Internal destination path is not exposed by the supported host. | No safe local repair identified; host must expose bootstrap log/path. Browser proof and screenshot remain pending. |
| DB-001 | Blocker | Staging acceptance | Read-only Supabase query shows 3 applied of 27 migrations and catalog estimates of existing activity; Dashboard cannot be inspected. | Project purpose and production/staging identity unknown. | No writes performed. Confirm dedicated staging in Dashboard before migrations or acceptance tests. |

No rendered UI defect can be entered with screenshot or reproduction evidence because no route was accessible through the supported Chrome integration.


## 4 November 2026 — isolated local browser continuation

The supported in-app browser became available during the Ninety Club end-to-end audit. This continuation supersedes the earlier browser-blocker statements only for the routes and checks listed here; it does not change the Supabase/staging status above. All authenticated checks used the disposable local PostgreSQL database/schema. No configured Supabase connection or remote write was made.

- Owner sign-in and durable dashboard worked. Visited `/admin/instances`, `/admin/reports`, `/admin/moderators`, `/admin/sessions`, `/admin/themes`, `/admin/posters`, `/admin/games`, `/admin/players`, `/admin/history`, `/admin/settings`, and `/admin/branding`. Sign-out returned to sign-in and direct `/admin` navigation stayed gated.
- Public booking journey: created/published a local session; reserved and confirmed one server-issued ticket; reloaded and recovered it using its booking reference and private code; attached a waiting room; then joined from the public booking page. The player reached the seated view with the server-locked ticket.
- The session edit initially failed because the admin PATCH included `timeZone`, which the route did not accept. The route allowlist and regression test were fixed; the same edit then saved successfully and the booking join completed.
- Captured the landing page, public session list, and moderator management UI at 390×844. The moderator account, grant, and activity tables originally overlapped. Responsive mobile-card rows and field labels were added and the refreshed screenshot showed separated, legible rows.
- A local moderator invitation was issued with read-only instance/room/booking scopes and booking assignment for the `regular` instance. The user reported accepting it, but a direct local database check still showed status `invited` and the browser remained on the acceptance form. Therefore moderator sign-in and page journeys were not verified; backend role-focused integration tests passed 43/43.

Follow-up checks: `tests/bookings.test.js` 3/3; role-focused PostgreSQL suite 43/43; client lint and production build passed. The build retains the `ThreeBallRenderer` chunk-size warning. These are representative local-browser checks, not exhaustive route or accessibility certification. Supabase identity/staging, Super Admin browser journeys, real-device audio, and deployed behavior remain outstanding.


## 4 November 2026 — expanded isolated browser verification

The latest source was freshly checked in disposable PostgreSQL schemas. An authenticated owner route harness opened all 12 owner sections at 390 and 1440 CSS pixels: 24 samples, zero axe violations, no unnamed controls, no horizontal overflow and no browser errors. Dynamic instance, room, player and booking detail routes were also opened with synthetic records and captured at 360, 390, 768, 1024 and 1440 px: 20 captures, no overflow or browser errors. The earlier five-width `/super-admin` path sweep uses the same `AdminRoot` and owner session as `/admin`; those URLs are route aliases, not proof of a separate Super Admin identity tier.

A fresh durable moderator browser fixture completed invitation acceptance, MFA enrollment and sign-in, password change/session replacement, least-privilege room and booking reads, and explicit permission expansion to player/history/report/settings tabs. A booking-manage request without the `bookings.manage` grant returned non-enumerating `NOT_FOUND`; it created no reservation. Seven viewport widths from 360 to 1440 px fit without overflow, and the isolated schema was dropped after the run. Across 28 axe/viewport samples there were zero actual violations and zero unnamed controls. Axe marked contrast unresolved on all 28 samples: 277 nodes had gradient or pseudo-element backgrounds or were decorative non-text content. Contrast is therefore not certified. The acceptance screen and scoped workspace are verified using generated synthetic credentials in this disposable browser fixture; the separate earlier hand-created `audit.mod` invitation did not persist acceptance and its schema has since been removed.

The local browser harness previously failed an assertion that allowed only one decorative contrast-incomplete node. That assertion was over-specific for the current gradient surfaces. It now rejects actual axe violations and unexpected incomplete causes while reporting known contrast limitations explicitly. The updated harness passed on rerun. Results: `.preflight/owner-live-nav-results.json`, `.preflight/admin-dynamic-detail-visual-results.json`, and `.preflight/moderator-a11y-results.json`.

The independent 250-client two-hour durable soak had conflicting historical evidence (one pass and one end-of-run disconnection failure). The fresh supervised run lasted 7,203.1 seconds and printed the exact staged RESULT: PASS; child exit artifact is 0, the outer runner exited 0, and container teardown succeeded. The status JSON retained wrapperExitCode: null and labeled the run failed because the supervisor did not capture that intermediate process code. Its completed load metrics are recorded in the autonomous audit report; fix the status-capture behavior before treating the supervisor JSON alone as authoritative on a future run.




## 4 November 2026 — moderator assignment browser addendum

The isolated local moderator browser fixture was extended and rerun. After invitation acceptance, MFA, password change, and initial read-only checks, the owner explicitly added bookings.assign for the synthetic moderator on the regular instance alongside room.read and bookings.read. The moderator selected the synthetic waiting room and assigned a synthetic draft booking session through the UI. The persisted game_sessions.room_code matched that room; ticket_reservation_audit recorded session.assign_room with moderator actor identity; the session had zero reservations. The isolated schema was dropped. Seven widths (360–1440 px) had no horizontal overflow; 30 axe viewport/state samples had zero violations and browser errors. Axe contrast remains inconclusive on 342 nodes because of gradients, pseudo-elements and decorative non-text content. This closes the fresh browser assignment gap; it does not certify screen-reader behavior or external deployment.


The durable soak runner initially wrote a null wrapper exit code after the full two-hour run even though its child exit artifact was 0 and the log contained the exact pass marker. The process capture now waits explicitly and refreshes before reading the exit code. A fresh supervised 60-second, 250-client check verified child exit 0, wrapper exit 0, the pass marker, and successful container cleanup. The original two-hour status artifact remains unchanged and records its null-code reporting failure.


## 4 November 2026 — user's real Chrome acceptance attempt

The supported `@oai/sky` runtime initialized and returned the user's running Chrome window. A fresh screenshot and accessibility tree showed the existing Codex conversation. That tab was preserved; a new tab was opened and the loopback Ninety Club URL was entered. Submitting the URL stopped Computer Use because its Windows policy layer could not determine the current browser URL with sufficient confidence. No Ninety Club route was loaded, no route screenshot was captured, and no app-level defect can be inferred from this attempt. The stop instruction was followed; Playwright/CDP was not substituted for real Chrome acceptance.

The local app itself started against a new disposable PostgreSQL 17.11 instance, schema `chromeacceptance`; all 27 migrations were current and `/readyz` returned ready. The frontend dev server responded HTTP 200. Route-by-route acceptance in the user's browser remains **blocked (0 routes, 0 app screenshots in this attempt)**. Existing prior Playwright-based and in-app isolated browser results remain valid only for their separately described scope.

Accessibility: previous isolated axe runs had zero actual violations and zero unnamed controls in sampled states, but unresolved contrast nodes remain; no screen-reader session was completed in this attempt. Responsive route checks and moderator/owner flows are detailed above and in the autonomous report; they do not substitute for the requested fresh desktop Chrome route sweep. Physical-device audio remains untested. No route-specific visual finding was added without a screenshot/reproduction.


## 4 November 2026 — real Chrome homepage and host room

The user's actual Chrome rendered `/` and `/host` in a 768×1024 viewport. The homepage exposed the major navigation and all eleven winning-pattern summaries. The host form showed a selected Regular Tambola hall, a labeled name field, a Create Room button and connected status. Submitting a synthetic local host created a durable room and opened `/host/room?instance=regular`; the room view showed its code, invite actions, a 1 of 10,001 ticket picker, all eleven pattern descriptions, the host seat, and Start Game. Screenshot-backed states were observed directly from Chrome, and the backend log corroborated room creation. No visible defect was established in these states.

A separate Incognito Chrome window was opened for an independent player. Entering `/player` and submitting the URL again triggered the Computer Use host's URL-confidence stop before a fresh page state was available. The player route was not counted as accepted. No further Computer Use actions were issued during that turn. Thus the current real-Chrome route coverage is `/`, `/host`, and `/host/room`; player join/game, remaining routes, authenticated roles, and a complete route-by-route screenshot set are still open.

A read-only query to the dedicated local database verified the created room persisted as `WAITING` in instance `regular` with one room member. This validates the host write path; it does not verify a player seat or ticket assignment.

## 4 November 2026 — real Chrome continuation

Actual Chrome screenshots and accessibility trees were captured for `/`, `/games`, `/themes`, `/games/regular`, `/games/regular/sessions`, `/host`, `/host/room?instance=regular`, `/host/game`, `/player`, `/player/room`, and `/player/game`. Landing, public hall/theme/session states, host room creation, independent Incognito player join, synchronized caller/player gameplay, pause/resume, automatic ticket marking and reload recovery were visually confirmed. The room ran to 13/90 calls; premature win claims remained disabled. This is sampled route acceptance, not all 45 route templates. See the autonomous audit continuation for route outcomes and evidence boundaries.

At the 758 px Chrome screenshot width the player gameplay retained the caller, board, progress and ticket in a two-column layout; the one-cell called mark remained distinguishable. The caller's GLB assets had responded HTTP 200, but the browser's WebGL renderer fell back to the visible “3D ball unavailable” text while the official number remained prominent. This does not by itself establish a source defect. A quick-chat tap showed no visible message and needs a focused retest before a defect can be concluded. Contrast and screen-reader verification remain open.

Local `/readyz` remained healthy with migrations 001–027 current, a held lease, one live room and zero pool errors; Vite returned HTTP 200. No source/test changes were made. Configured Supabase, public infrastructure and the 256-entry worktree were left untouched.

### Corrected route count and actual Chrome matrix

The current production route declarations contain 46 product templates, excluding the development-only voice audition route; the previous source inventory's “45” count was low by one. Eleven templates passed in actual Chrome (`/`, `/games`, `/themes`, `/games/regular`, `/games/regular/sessions`, `/host`, `/host/room`, `/host/game`, `/player`, `/player/room`, `/player/game`). The remaining 35 templates—including poster/booking detail routes and all moderator, Admin and Super Admin paths—were not tested in actual Chrome in this continuation. See the route-by-route matrix in the autonomous audit report. Existing isolated-browser evidence remains separate.

Actual Chrome later rendered `/admin/signin` and `/super-admin/signin`; both expose the same shared owner sign-in page and report that no owner account is configured in the disposable service. Direct navigation to `/admin/instances` redirected to `/admin/signin`. This verifies the unauthenticated gate only. No credentials were created, entered or submitted; authenticated owner/admin pages remain covered only by the separate isolated-browser evidence. Chrome keyboard focus sampling was inconclusive.

Actual Chrome opened all three moderator routes: `/moderator/bookings` (secure sign-in form), `/moderator/accept` (no invitation token state), and `/moderator/recovery` (no recovery token state). No credentials were entered. This is route/rendering coverage only; authenticated moderator operations are covered by the separate isolated-browser evidence.

The current `chromeacceptance` schema has no `audit.mod` row (read-only exact-username lookup); its invitation screen had no token. The prior synthetic moderator fixture was a separate disposable schema already removed. Authenticated moderator access is therefore not established in this current real-Chrome backend pair despite the user's earlier report of accepting the invitation.

Actual Chrome rendered a temporary published booking detail, its session list, and a published poster page. Poster details initially ended mid-word because the SVG renderer sliced copy without a marker. The renderer now truncates at a word boundary and appends an ellipsis; `tests/poster-art-text.test.js` passes 3/3, client lint and production build pass, and the updated poster was visually confirmed in Chrome. The disposable session/poster/publication rows were deleted after the check. The ThreeBallRenderer chunk warning remains at 639.62 kB (162.26 kB gzip).
#### Route matrix update after public fixture checks

The 11/46 result above is superseded by the later detail-route continuation: actual Chrome passed 19/46 templates, including `/sessions/:sessionId` and `/poster/:posterId` with temporary local records, the moderator unauthenticated screens, and owner sign-in/guard screens. 27/46 templates remain unaccepted in the actual Chrome session. The autonomous audit contains the full matrix and per-route scope. The poster copy defect was fixed and verified as described above.

After the poster copy repair, the full backend suite passed **744/744, 0 failed, 0 skipped** in 20 suites using an explicit URL to the disposable local PostgreSQL container; client lint/build passed as well. The build still reports the ThreeBallRenderer chunk warning.

The second hall slug (`/games/bumper`, `/games/bumper/sessions`) was also checked in actual Chrome: the detail showed its Bumper Tambola identity and host/session actions, and the empty session state offered a bumper-specific room-code route.

The Bumper hall-specific actions were verified: host route preselects Bumper Tambola, and join route opens `/player?instance=bumper` with the matching heading. On that player-entry screen, keyboard focus visibly advanced name → room code → booking disclosure → Join Room with a visible focus ring. No join was submitted. This is a route-specific keyboard spot check, not a full accessibility certification.

Chrome also confirmed that unauthenticated `/admin` and `/super-admin` requests redirect to their matching sign-in paths. This verifies the root guards only; the owner account remains unconfigured and authenticated overview/sections were not opened in real Chrome.

## Latest browser status — 4 November 2026

The earlier browser-blocker notes above are historical and superseded for the specific routes in the autonomous audit's real Chrome matrix. Actual Chrome is reachable using the supported `@oai/sky` runtime. Corrected real-Chrome coverage is 18/46 rendered page templates and 28/46 guard-only protected templates; authenticated owner pages remain gated because the disposable local server has no owner account. The most recent actual-Chrome screenshot is saved in `docs/chrome-evidence/01-owner-signin.png`. See the autonomous audit's latest Chrome recovery addendum for the screenshot-backed observation and live readiness check.

## 4 November 2026 — subsequent Chrome continuation

An actual-Chrome player-game capture exposed a reproducible WebGL failure-state layering defect: an empty but mounted renderer canvas covered the authoritative number. Hiding that canvas only under `data-ball-state="error"` restored the number. The focused regression in `tests/current-number-reveal.test.js` passes 1/1, client lint passes, and actual Chrome shows 74 in the ball after hot reload. Evidence: `docs/chrome-evidence/04-player-number-webgl-fallback.png`.

The 25 Admin/Super Admin route templates then awaiting a real-Chrome path observation were opened directly; each redirected to the corresponding sign-in URL in the absence of an owner session. This verifies their unauthenticated guards only. Authenticated page content and interactions remain unaccepted. Evidence of the final guard state is `docs/chrome-evidence/05-super-admin-guard.png`. Route path/guard observations cover all 46 templates. The corrected matrix records **18/46 rendered-state passes** and **28 guard-only protected templates**. Local owner creation and user-entered sign-in remain prerequisites for protected screen acceptance.

The actual-Chrome `/player` entry page was freshly inspected at 758×950. Its accessibility tree exposes named name/room-code fields and a named Join Room button; the form fits the captured viewport. Screenshot: `docs/chrome-evidence/06-player-entry-keyboard.png`. The browser was left without submitted credentials or a room join. This is a sampled viewport check, not a physical mobile-device or screen-reader certification.

## Player chat reload continuation — 4 November 2026

A real local Chrome reload reproduced an empty chat panel despite the room still running. The history request raced the player's asynchronous `session:resume` and was rejected before room attachment. The player screen now signals successful resume to `GameChat`, which reloads the in-memory history then. A second reload in the Incognito player tab restored `Chrome acceptance check` along with the existing room, ticket and award state. Client lint and build pass; the known ThreeBallRenderer chunk-size warning remains. This verifies in-process reload recovery only; chat is intentionally in-memory and is not durable across server restarts.

## Actual Chrome end and reset continuation — 4 November 2026

The local host ended disposable room `XYHFC86A`; the separate Incognito player reached `Completed` and retained the award, score and chat. The host then reset the room. The player showed the reset `Waiting` state after reloading and resuming. Added a realtime regression asserting a separately seated client receives `game:state: WAITING` on reset; `node --test tests/realtime.test.js` passes 31/31. The round is now back in a fresh waiting state.

The current serial backend suite was rerun against explicit disposable loopback PostgreSQL settings after adding the reset broadcast assertion: **745/745 passed, 0 failed, 0 skipped**. Supabase was not used.

## Trusted-proxy port binding — 4 November 2026

`deploy/free-start.ps1` formerly published its app port on all interfaces while trusting forwarded client-IP headers from the proxy. It now binds to `127.0.0.1`, matching the same-host Quick Tunnel upstream and preventing direct access that could spoof forwarded IPs. Config regression checks cover that mapping and private database ingress in Hostinger Compose; both pass, as does PowerShell parsing. The full backend suite passes 747/747. The strict production env gate still correctly reports missing deployment-specific `PUBLIC_ORIGIN`, `TRUST_PROXY=1`, and production `NODE_ENV`.

## 4 November 2026 — Chrome multiplayer synchronization follow-up

The apparent host/player call-count mismatch was checked again using distinct regular and Incognito Chrome windows. After activating the exact Incognito player window, the screenshot and accessibility text agreed with the host at call 71 (4/90); the player ticket and board remained present. An earlier screenshot call showed the host visual alongside the player accessibility tree, and activating the player window corrected the capture. The mismatch did not persist and no app defect was confirmed. A separate two-client probe against the durable local server received both game-state and official-number pushes and read back RUNNING/one call from the player's authoritative snapshot. The realtime suite passes 31/31, including new assertions for resumed socket room membership and delivery of a subsequent number call.

The user still needs to complete the disposable local owner setup before authenticated owner pages can be exercised in Chrome. Supabase and production infrastructure remain untouched; the production environment gate is still pending deployment-specific settings.

The complete backend suite was rerun after extending the realtime regression: **747/747 passed, 0 failed, 0 skipped across 20 suites**, targeting the disposable loopback PostgreSQL schema. Branch and HEAD are unchanged; the worktree still has 262 modified/untracked entries, all preserved. The local durable probe left synthetic room `XDECJBHM` in that disposable schema. No Supabase or deployment action occurred.

## 4 November 2026 — MFA branding and production gate follow-up

New MFA enrollment now uses the Ninety Club issuer in the owner and moderator flows; `.env.example` and `deploy/free-start.ps1` match, and the environment checker flags explicit legacy branding. I changed only the matching cosmetic `MFA_ISSUER` line in the ignored local `.env`, preserving every other line; this did not connect to the configured database or affect MFA secrets/codes. The deployment script's multiword environment argument passes PowerShell parsing and has regression coverage.

Focused tests passed 61/61 with no skips; full disposable-PostgreSQL suite passed 748/748 across 20 suites. The strict production gate remains NOT READY (7 OK, 1 warning, 2 errors): local shell `NODE_ENV`, deployment `PUBLIC_ORIGIN` and trusted proxy configuration still need deployment context. Dockerfile and Hostinger Compose already set production mode/trust proxy, while Compose requires the HTTPS origin. Actual Chrome responsive resizing did not produce a trustworthy 390 px sample and is not counted as accepted. The local owner account is still absent; authenticated owner pages remain gated.

## 4 November 2026 — external-target command incident

A final owner-status check mistakenly ran `npm run owner:list` without explicit local overrides. A local-only check showed `.env` points to a non-loopback database; I did not print its URL or hostname. The owner CLI runs migrations before listing, so the command may have attempted or applied pending migrations if it connected. The process ended, but its result was not captured. I cannot claim the target was Supabase or that no migration ran. No further commands used `.env` for database operations. This leaves external database state unverified and is disclosed here; no credential was exposed.

## 4 November 2026 — current Chrome and local owner state

Freshly reselected regular-host and Incognito-player Chrome screenshots agree on room `XYHFC86A`, round 2, call 71 and 4 calls. A direct read-only query to the explicit local `chromeacceptance` schema confirms zero owner accounts; readiness is healthy and migrations are current through 027. Authenticated owner-page acceptance remains pending user-run setup and sign-in.

### Actual Chrome 400% zoom reflow spot check — 4 November 2026

The Incognito player was inspected at 400% Chrome zoom (a narrow CSS-viewport approximation, not a physical/mobile device or reliable 390 px device-emulation run). The caller art, Recent Calls, ticket and Master Board stack vertically. Ticket columns and the ten-column Master Board fit the captured page width; no horizontal page scrollbar was visible. The large caller art takes substantial vertical space, requiring several page-length scrolls to reach ticket and board content. Claimed Prizes was visible near the bottom; the chat panel was not separately surfaced in this inspection. No chat was sent. Zoom was restored to 100%. See the autonomous audit for limitations and exact scope.

### Live game accessibility semantics and backend health — 4 November 2026

Actual Chrome's `/player/game` accessibility tree exposes room controls, chat label/history/input and disabled Send state, live call status, Recent Calls, called-number list, ticket metadata, winning-pattern descriptions, disabled claims and empty prizes. This is one browser semantics sample, not screen-reader or full keyboard certification. The backend's correct local health port is 4000; `/livez`, `/readyz` and `/healthz` returned 200 JSON there. Port 5173 is Vite and returns SPA fallback HTML for those paths. `/readyz` reported durable mode, current migrations, held lease, active scheduler and zero pool errors. Production deployment remains a separate gate.

### Durable recovery and backup regression — 4 November 2026

Five focused database suites passed **43/43** against the disposable loopback PostgreSQL container after explicitly setting its actual `PG_CONTAINER` name. They cover simulated process recovery, migrations, lease, ticket and booking persistence, and isolated backup/restore. An initial run failed only because the test helper defaulted to a nonexistent container name; the corrected local-container run passed. The live acceptance API remained ready. This does not verify production backup infrastructure or a kill/restart of the live Chrome server.

### API/WebSocket proxy check and deployment branding fix — 4 November 2026

The local Vite-to-backend `/api` proxy returned the halls JSON and the `/socket.io` path returned a valid Engine.IO handshake advertising WebSocket upgrade; the live Chrome game displayed CONNECTED. The Render manifest's legacy MFA issuer was corrected to Ninety Club and protected by a focused config test. The deployment config suite passes 3/3. No external deployment was made.

### Render Blueprint input hardening — 4 November 2026

The Render Blueprint now requires an operator-supplied `PUBLIC_ORIGIN` through `sync: false` instead of syncing a `REPLACE-ME` URL. Comments reflect Render's initial-creation versus existing-service behavior. Regression coverage verifies this alongside the current MFA issuer; deployment config tests pass 4/4. No Render service was changed.

### Cross-client chat delivery — 4 November 2026

The host and Incognito player accessibility trees both show room `XYHFC86A`, call 71 and 4/90. Opening the host's collapsed Live chat disclosure exposed the same player-authored `Chrome acceptance check` message present in the player. No additional message was sent.

### Owner CLI read-only behavior and database runbook — 4 November 2026

`owner:list` now lists without applying migrations and reports an uninitialized owner schema without creating tables. A disposable local integration test verifies both that no migration occurs and that listing works after initialization; result **1/1 passed**. The deployment runbook now describes all 27 migrations and no longer claims the unconfirmed external database is empty. The external target remains untouched and unverified.

The deployment and owner CLI regressions pass together **5/5** against loopback PostgreSQL; client lint passes. The CLI test cleans up its temporary schema.

### Abrupt durable process restart — 4 November 2026

A new child-process integration test kills the durable game server without graceful shutdown, then boots a second process against the same temporary schema. The running room and its call history recover, host and player credentials resume, and a subsequent official call reaches the player snapshot. The explicit loopback PostgreSQL run passed **1/1**; temporary processes and schema were cleaned up. Host failure and production failover remain unverified.

### Final regression/build/browser recheck — 4 November 2026

The full backend suite passed **752/752 across 20 suites**, client lint passed, and the client Vite production build completed. Vite still warns that the Three renderer chunk is 639.62 kB minified. Although the first computer-use wrapper failed to initialize, `@oai/sky` through `node_repl` successfully captured regular Chrome host and Incognito player windows. Both expose the same room `XYHFC86A`, round 2, current number 71 and 4/90 calls; the player's accessibility tree exposes the previously approved chat message. This was a read-only synchronization check. The existing 14 saved screenshots under `docs/chrome-evidence/` remain available; authenticated owner-route acceptance remains pending the user's local owner setup.

The final secret scan passed. Git remains on `main` at `6341f621f47e16b35ce5e2f27144f7854d6d5fec` with 271 modified/untracked entries preserved. No commit, push, reset, stash, cleanup or deployment was performed.

### Current local readiness — 4 November 2026

The explicit loopback `chromeacceptance.owner_accounts` count remains zero. Backend `/readyz` is healthy and durable, migrations through 027 current, lease held, scheduler ticking, three rooms live, zero frozen rooms and zero pool errors. The 3D renderer is already dynamically loaded; its chunk is 639.62 kB minified (162.25 kB gzip). Reducing the raw chunk below Vite's advisory threshold would require a substantial renderer/asset change; merely raising the threshold would hide the warning, so the existing feature and warning are retained for a deliberate optimization decision.

## 4 November 2026 — live 3D ball transition regression

A fresh actual-Chrome host/player test advanced room `XYHFC86A` from 5/90 (90) to 6/90 (9). Both clients synchronized the official number and called board. Both 3D ball renders remained at `Loading 3D ball…` for over 13 seconds without reload. Loader isolation plus a visible DOM-number fallback was attempted; lint, production build and a loader-unit regression test passed, but the live browser defect persisted. Do not treat this attempted change as a completed repair. Dynamic ball rendering remains open; the regular and Incognito windows remain on the affected live game state. No additional gameplay action was taken after the failed verification.


Follow-up diagnosis after the transition recheck: the player was reloaded while call 9 remained current, then observed for an additional 11 seconds. The page recovered its seat, chat history, official call state, and automatic ticket mark, but no clear 3D model render was observed. Direct loopback HEAD requests for `ball-09.glb`, `ball-90.glb`, and all three Draco decoder files returned HTTP 200. Both GLBs have valid GLB v2 headers, declared byte lengths matching the file lengths, and chunk bounds ending exactly at EOF. This rules out missing files and basic container truncation, but does not prove the Draco payloads decode successfully. The actual decoder root cause and working fix remain open.

## Actual Chrome public-route refresh — 5 November 2026

The supported `@oai/sky` runtime reselected the current Incognito Chrome window and captured `/games`, `/games/bumper`, `/games/bumper/sessions`, and `/host`. The hall directory showed both Regular and Bumper entries. Bumper details exposed its hall-specific host/join/session links and server-run gameplay summary. Its session page showed the empty-booking state and a valid room-code fallback. The host form showed a labeled hall selector defaulting to Regular Tambola, labeled name input, Create Room action and CONNECTED status. No room or booking was created. Each rendered route was accompanied by an actual Chrome screenshot displayed through the supported capture integration. These paths were already included in the 18 accepted rendered route templates; the total remains 18/46 because this was a refreshed observation, not a new template acceptance.

The `/host` accessibility tree included the visible hall selector as a combo box named `GAME HALL`; an earlier snapshot that omitted it was stale and was not a confirmed application defect. The separate Incognito live-game tab was left unchanged. Authenticated owner pages still require the user's pending local owner setup. The 3D live-transition repair and its Chrome verification are documented in the autonomous audit.

## 5 November 2026 — production bundle size and regression update

The renderer chunk advisory was resolved through a real dependency split: `three.core.js` is now emitted as a separate lazy chunk. `ThreeBallRenderer` is 422.23 kB minified (105.79 kB gzip) and `three-core` is 222.19 kB (58.80 kB gzip); the production build succeeds without the previous >500 kB warning. `tests/client-bundle-policy.test.js` passed 1/1, client lint passed, and the full backend suite passed **757/757 across 20 suites** against the explicit disposable loopback database. The production server returned HTTP 200 for both new hashed chunks, the SPA, public halls API and Socket.IO polling handshake.

Computer Use stopped a follow-up production bundle browser visit because its Windows URL-confidence policy could not validate the current browser URL; no further app input was attempted. The new split therefore has build and local HTTP delivery evidence, but still needs actual-Chrome runtime confirmation. The strict production environment check currently reports NOT READY in this local process context: deployment `DATABASE_URL`, HTTPS `PUBLIC_ORIGIN`, `TRUST_PROXY=1`, and `OWNER_MFA_KEY` are absent, and `NODE_ENV` is not production. No external database or deployment was accessed.

### Production-bundle Chrome runtime follow-up — 5 November 2026

The Incognito actual Chrome tab rendered the production build at `127.0.0.1:4000`. After the stopped local server was restarted using explicit loopback PostgreSQL settings, its host page connected and exposed the hall selector. A synthetic `Bundle Audit Player` joined existing room `XYHFC86A` while round 2 was live and correctly entered spectator mode without tickets. The separate regular Chrome host and Incognito production client both showed three players and call 75 at 9/90. The backend logged HTTP 200 for `three-core-mMZXNjve.js`, `ThreeBallRenderer-vbXmZ7gS.js`, `ball-75.glb` and the Draco decoder assets. The host then made one local test call (29); both clients reached 10/90 and the production-bundle screenshot showed the new purple 3D ball without a reload. This closes the split-bundle runtime check in actual Chrome. The room retains the synthetic spectator seat in the disposable local schema.

The earlier URL-confidence stop was followed by a read-only state check that showed navigation had succeeded; the local server, rather than the production bundle, had since stopped. Restarting it restored `/readyz` and Socket.IO. Strict deployment configuration and authenticated owner screens remain unverified pending deployment values and the user's local owner setup. Supabase was not accessed.

### Current-checkout verification after production build — 5 November 2026

Re-ran the complete Node suite directly with `node --test "tests/*.test.js"` and explicit loopback-only `DATABASE_URL`, `DB_SCHEMA=chromeacceptance`, and local container name; bypassed `.env`. Result: **757/757 passed across 20 suites**, zero skipped. `npm run lint --prefix client` passed. `npm run build --prefix client` passed, with `ThreeBallRenderer` at 422.23 kB minified and `three-core` at 222.19 kB; no Vite chunk-size advisory was emitted.

After that build, actual Incognito Chrome reloaded the production server's `/player/game`. It reconnected to room `XYHFC86A`, recovered the running round at call 29 (10/90), and rendered the purple 3D ball. The host Chrome `/host/game` view still showed the same room, 3 players and call 29 at 10/90. Backend logs confirm HTTP 200 for the new `three-core` and renderer chunks; the ball GLB and Draco decoder were served from cache with 304. The server remains ready, durable, migrations current through 027, lease held, and pool errors 0.

The `chromeacceptance.owner_accounts` count is still 0, so authenticated Admin/Super Admin acceptance remains gated on the user's local owner setup and sign-in. The synthetic spectator remains in the disposable room. No Supabase or external infrastructure was used. Branch `main`, HEAD `6341f621f47e16b35ce5e2f27144f7854d6d5fec`; worktree remains at 276 modified/untracked entries, preserved.

### Actual-Chrome keyboard and strict environment-gate follow-up — 5 November 2026

A fresh Incognito Chrome keyboard-only traversal of player game controls showed visible focus indicators on Settings, volume toggle and slider, voice language, speech speed, How to Play and Fullscreen. The accessibility tree exposes names for the settings controls, chat input and claim buttons. This is a focused sample; full-page keyboard traversal, screen-reader use and contrast across gradient/artwork-backed content remain unverified.

Ran `node scripts/env-check.mjs --production` without loading `.env` and without connecting to a database. It correctly returned NOT READY: `NODE_ENV` is not production; `DATABASE_URL`, HTTPS `PUBLIC_ORIGIN`, `TRUST_PROXY=1`, and `OWNER_MFA_KEY` are absent (2 checks OK, 1 warning, 4 errors). These values require an explicitly selected deployment and secrets; none were invented or changed. A read-only query against loopback `chromeacceptance` still finds zero owner accounts, so authenticated owner route acceptance remains pending user-run local setup.

### Player settings modal keyboard acceptance — 5 November 2026

In actual Incognito Chrome, opened the player audio settings dialog and inspected its accessibility tree. The dialog is named “Your audio settings”; close, voice, chime, speech-rate, callout, caller-personality, festival-style, volume and voice-preview controls are exposed with labels or descriptions. Pressing Escape dismissed the dialog and returned visible keyboard focus to the Settings button. No preferences were changed and no voice preview was played. This supplements the keyboard focus sample; it does not establish complete screen-reader or contrast acceptance.

### Generic Docker ingress hardening — 5 November 2026

Deployment review found that the generic `docker-compose.yml` published `4000:4000` on all host interfaces while defaulting to `TRUST_PROXY=1`. A direct client could bypass the intended TLS proxy and forge trusted forwarding headers. Changed Compose and the standalone `docker run` examples to publish only on `127.0.0.1`; clarified that this stack expects a same-host TLS proxy (or a proxy container on the Compose network), while managed platforms should use their service integration. Added regression assertions to `tests/deployment-config.test.js` for the generic Compose mapping and both documented Docker examples.

Also documented that the bundled Compose password must use URL-safe characters because Compose inserts it directly into the PostgreSQL URI; `openssl rand -hex 32` generates a strong value compatible with that URI form. This avoids a startup failure from unescaped URI-special password characters. `docker compose -f docker-compose.yml config --quiet` succeeded with dummy local-only values and resolved the app binding to host IP `127.0.0.1`, target/published port 4000. Focused deployment config tests passed **6/6**. Full suite passed **759/759 across 20 suites**, zero skipped, using the explicit disposable loopback DB and bypassing `.env`. Secret scan passed (666 files inspected, including built assets). No image was built, no container was started, and no external database or hosting service was used.

### Actual-Chrome narrow-layout check — 5 November 2026

Resized the Incognito player layout by increasing Chrome zoom to 200% (approximately 379 CSS px from the 758 px window capture) while inspecting the production game. At this narrow effective width, the caller and number remain visible; the 1–90 board reflows to a single column section and all ten number columns remain within the viewport; Room Chat categories wrap, quick-message buttons remain visible, and the message input/Send controls fit; winning-pattern cards render one per row. No clipped application content or horizontal page overflow was visible in the captured states. The page remained vertically scrollable. Browser zoom was restored to 100% and the page returned to its top position. This is a zoom/reflow approximation, not DevTools device emulation or physical-device acceptance; the synthetic spectator has no ticket, so ticket-grid narrow-width behavior is not newly verified here.

### Actual-Chrome claim acceptance attempt — 5 November 2026

Inspected the host ticket in actual Chrome: its Early Five claim was still disabled at 1/15 marked. Attempted to enable server auto-call for a local claim check, but the supported Computer Use runtime returned `window changed; call get_window_state before using this window` both before and after reselecting the Chrome window and capturing a fresh state. No further UI input was issued after the one recovery retry. A read-only query against the explicit loopback `chromeacceptance` schema confirms room `XYHFC86A`, game 2 remains RUNNING with 10 draw rows and zero claim rows; the attempted UI action did not alter gameplay. Live Chrome claim acceptance therefore remains incomplete. Automated in-memory and PostgreSQL claim/pattern suites remain the verified evidence for claim rules.

### Chrome helper retry status — 5 November 2026

On a fresh continuation, reselected the open host Chrome window and observed `/host/game` at 10/90. A screenshot-coordinate action returned `unknown screenshotId screenshot-0`; after reselecting the window and capturing a new state, an accessibility-index action returned `window changed; call get_window_state before using this window`. Stopped UI input after that recovery retry. Read-only verification in `chromeacceptance` confirms `XYHFC86A` remains at 10 draw rows and zero claim rows, and `owner_accounts` remains empty. `/readyz` is healthy, migrations current, lease held and pool errors 0. No external target was contacted.

### Route-matrix count correction — 5 November 2026

The earlier `21/46 rendered, 25 guard-only` summary does not match the route table. Recounting the current `client/src/main.jsx` product routes against the actual-Chrome matrix gives 46 templates: 18 matrix rows with accepted rendered page states and 28 protected Admin/Super Admin rows with guard-only observations. The route table lists each of those 46 rows. The corrected content-acceptance result is **18/46 rendered templates, 28/46 guard-only templates**; authenticated protected content is not accepted. This count supersedes older `21/46` and `25 remaining` summary wording.

## 5 November 2026 — current continuation: real Chrome claim and round lifecycle

This section supersedes earlier same-day statements that a live Chrome claim had not completed. Those statements remain as historical chronology.

A fresh production-built local app ran against the disposable PostgreSQL 17 container ninety-audit-pg-20261105, database codex, schema chromeacceptance, loopback only. The app container ninety-audit-app-20261105 served loopback port 4000. No .env values were loaded by test commands; no Supabase or production target was contacted.

In actual Chrome (installed Chrome channel under temporary Playwright automation), separate host and player contexts created and joined room JEEP2U5H. The host started game 1 with generated tickets, auto-call was disabled, and the host manually drew 20 numbers through the visible UI. The player's ticket acquired five called marks; the player submitted Early Five using the enabled in-game Claim button. The player received the approved result and +20 points; the host received the matching winner/award state. Screenshots show claimant result, host result, and both award boards. Reloading the player restored game state and award. Neither browser recorded a JavaScript or console error.

Read-only database evidence after settlement showed one AWARDED Early Five claim (complete, 20 points, call index 20) and one matching award for Chrome Audit Player, ticket 1. Duplicate-claim prevention was observed in the client UI (completed Early Five disappears and remaining claims are disabled); a second duplicate or forged invalid claim was not submitted through Chrome. Invalid/competing claim behavior remains covered by automated tests, not this browser session.

The host ended the round through the UI and saw completed results/standings. It then reset the room through the UI. Both actions were two-step confirmations. The room returned to WAITING, game number 1, with no active call shown in the waiting-state UI. The database retains 20 historical draw rows plus the completed game's one claim and one award. Reset screenshot: chrome-evidence/mission-2026-11-05-room-reset.png. Claim screenshots: mission-2026-11-05-player-early-five-6-of-15.png, mission-2026-11-05-player-claim-settled.png, mission-2026-11-05-host-claim-settled.png, mission-2026-11-05-player-award-board.png, and mission-2026-11-05-host-award-board.png.

The isolated schema still has zero owner accounts. The user previously indicated owner setup remains to be performed. No owner password was handled by the agent. Authenticated Owner/Admin/Super Admin acceptance therefore remains blocked. Moderator harness evidence came from a separate disposable schema and is not current authenticated Chrome evidence.

Current page count remains 18/46 rendered templates and 28/46 guard-only protected templates. The full route/action ledger is in NINETY-CLUB-ROLE-ACTION-ACCEPTANCE-MATRIX.md; complete role-by-role acceptance is not done.

The current production image built and started locally; /readyz reported a ready durable service, migrations current through 027, lease held and zero pool errors. Strict production environment validation rejected the local-only profile (HTTP origin, no TLS DB configuration, no trusted-proxy setting); this is not a production configuration pass. See NINETY-CLUB-PRODUCTION-READINESS-GAPS.md.

Latest available full Node suite evidence for this checkout is 759/759 passing, zero failed/skipped across 20 suites, run directly with explicit loopback database settings while bypassing .env. Earlier counts remain as historical results.


## 5 November 2026 — authenticated-role mission checkpoint

The owner-provisioning command was reviewed before execution. The supplied npm script invokes Node with --env-file-if-exists=.env, so it was deliberately not used for the operator step. The safe direct command is:
docker exec -it ninety-audit-app-20261105 node scripts/owner.js create

Sanitized container checks confirm the running app is on the dedicated Docker network with the disposable PostgreSQL container; app DB identity is database codex/schema chromeacceptance, with DB container internal address 172.17.0.3 and host publication only at 127.0.0.1:55463. The isolated owner_accounts count remains zero. No OWNER_USERNAME or OWNER_PASSWORD is preloaded; OWNER_MFA_KEY is configured. The script's create path runs the migration runner before owner insert, refuses a second owner, prompts for username, and asks for password through a hidden interactive prompt. The direct Node invocation inherits the already-verified container environment and does not parse .env. No provisioning was run because the password must be entered by the user privately; no credential was generated, requested in chat, or handled by the agent.

Source review confirms client /admin and /super-admin route trees are the same ownerRoutes mounted under AdminRoot. AdminGate is a navigation convenience; API security is server-side and requires a verified owner session. Server admin routes use requireOwner and mutations require double-submit CSRF. The reviewed implementation does not establish separate Admin and Super Admin accounts, roles, or authorization tiers. Therefore Admin and Super Admin acceptance cannot honestly be reported as separate role sessions unless product policy/code first establishes those roles.

Existing automated coverage includes owner login throttling, CSRF rejection, anonymous and host/player denial, owner session handling, moderator grant scoping, host-only socket event refusal, cross-room seat token isolation, duplicate claims, and invalid claim behavior. These are code/test results, not actual-Chrome authenticated role acceptance. Actual owner provisioning and browser-authenticated acceptance await the user's interactive local step.
