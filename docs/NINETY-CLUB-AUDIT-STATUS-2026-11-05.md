# Ninety Club audit status — 5 November 2026

## Executive result

**CONDITIONAL PASS for the local checks listed below; the complete end-to-end audit is not finished, and Ninety Club is not certified production-ready.** The audit covered source code, a disposable local PostgreSQL database, automated integration/load tests, local Chrome routes, and isolated role harnesses. It did not validate a production deployment or the unconfirmed Supabase target.

The most important incomplete items are authenticated owner/Admin acceptance in actual Chrome, authenticated moderator acceptance in the current Chrome/database pair, a successful live Chrome claim, the production environment/secrets, and deployed HTTPS/WSS behavior. Actual-Chrome route counts are corrected below.

## Scope and route acceptance

The current `client/src/main.jsx` has **46 product route templates** when the development-only voice audition route is excluded. The actual-Chrome matrix supports:

- **18/46 rendered page states:** `/`, `/games`, `/themes`, `/poster/:posterId`, `/games/:slug`, `/games/:slug/sessions`, `/sessions/:sessionId`, `/player`, `/player/room`, `/player/game`, `/host`, `/host/room`, `/host/game`, `/moderator/bookings`, `/moderator/accept`, `/moderator/recovery`, `/admin/signin`, and `/super-admin/signin`.
- **28/46 guard-only results:** the protected Admin and Super Admin route templates redirected to owner sign-in. Their authenticated content and operations were not accepted in actual Chrome.
- All 46 route templates have a documented page or guard observation. The earlier `21/46 rendered, 25 guard-only` summary was inconsistent with the matrix and has been corrected in the detailed audit files. The route table itself counts 18 rendered-state rows and 28 guard-only rows.

Public and gameplay Chrome evidence includes the Regular and Bumper halls, public booking/session and poster detail fixtures, host room creation, an independent Incognito player, player seat/reload recovery, synchronized host/player calls, pause/resume, called-number marking, the 3D ball, and room end/reset states. The production-built client loaded the split Three.js/core chunks and Draco assets in Chrome and rendered call 29 after the host advanced the room.

The current disposable Chrome room is `XYHFC86A`, game 2. Its last read-only database check showed 10 calls and zero claims. A synthetic `Bundle Audit Player` joined mid-round and is a spectator with no ticket. A live Early Five claim was not completed in Chrome: the host had only 1/15 ticket numbers marked, and the browser helper failed before auto-call could be enabled. No game change occurred during that attempt.

## Role acceptance

| Role | Evidence | Current limit |
| --- | --- | --- |
| Public visitor | Actual Chrome rendered landing, halls, theme, poster, session and booking views. Synthetic booking/poster fixtures were removed after their checks. | Representative states and interactions, not every data/error state. |
| Host | Actual Chrome created and controlled a local room; synchronized calls, pause/resume, end/reset and ticket marking were observed. | No successful actual-Chrome prize claim. |
| Player | Incognito joined as a guest; Chrome observed live calls, ticket marking, reconnect/reload and the 3D number. A 200% zoom reflow sample fit board, chat and pattern cards. | Latest synthetic player was a no-ticket spectator; no physical mobile device or device emulation. |
| Moderator | Actual Chrome rendered sign-in, invite-without-token, and recovery-without-token pages. A separate disposable browser/database harness accepted a synthetic invitation, enrolled MFA, signed in, changed its password, checked granted tabs, confirmed an ungranted booking-manage request was denied, and performed an explicitly granted session assignment. | The isolated schema was removed. No authenticated moderator session exists in the current `chromeacceptance` Chrome/backend pair. |
| Owner/Admin | Actual Chrome rendered owner sign-in and verified unauthenticated route guards. Separate isolated owner-browser harnesses opened 12 Admin sections at 390 and 1440 px and dynamic detail routes at five widths. | Current local `owner_accounts` count is zero. Authenticated Admin/Super Admin content and actions remain unaccepted in actual Chrome. The `/super-admin` tree shares `AdminRoot`; a separate authorization tier was not established. |

## Game, API, database, and security results

- The full Node suite most recently passed **759/759 tests**, 0 failed and 0 skipped, across 20 suites. It ran directly with explicit loopback PostgreSQL settings and bypassed `.env`.
- Client lint and the Vite production build passed. The ThreeBallRenderer chunk is 422.23 kB minified; the separate `three-core` chunk is 222.19 kB. The prior >500 kB warning is gone.
- `security-probe`: **51/51**. Secret scan: **666 files inspected**, no credential leakage found. Fresh root/client `npm audit` scans previously reported zero vulnerabilities.
- Automated memory and PostgreSQL-backed gameplay suites cover all eleven supported patterns, claims, claim windows, competing/rejected claims, reconnect and recovery. The tests establish server-side behavior but do not substitute for a successful real-Chrome prize claim.
- Durable tests used disposable local PostgreSQL 17.11 and current migrations **001–027**. Backup/restore, transaction rollback/uncertain-commit handling, room recovery, lease and migration behavior passed in the isolated environment.
- Synthetic load covered 250 clients. The two-hour durable stage reported 250 connected clients, zero unexpected disconnects, 750/750 call acknowledgements, 50/50 reconnects, no call-stream mismatches or DB transaction failures; call-ack p95 58.8 ms, join p95 149.1 ms, fan-out p95 59.0 ms, RSS peak 150.5 MB. A runner status-capture defect was fixed and a supervised follow-up verified clean exit and teardown.
- Local `/readyz` last returned ready: durable database, migrations current, lease held, zero pool errors. Chat history is in-memory and is not durable across a backend restart.

## Repairs made

The audit repaired database pool idle-timeout configuration; transaction retry/uncertain commit handling; backup snapshot consistency; test isolation assumptions; security-probe assertions; missing Docker runtime callout modules; Admin session timezone updates; moderator mobile table layout; accessibility-harness assumptions for gradient contrast; durable-soak exit capture; poster text truncation; Three.js chunk splitting; and generic Docker trusted-proxy ingress.

The generic `docker-compose.yml` and documented standalone Docker invocation now bind the app port to `127.0.0.1`, avoiding direct public access that could bypass a trusted TLS proxy. The bundled Compose instructions specify a URL-safe password (`openssl rand -hex 32`) because the password is interpolated into a PostgreSQL URL. Compose config parsing resolved port 4000 to host loopback; deployment config tests passed **6/6**.

## Accessibility and responsive results

- Separate owner/moderator axe harness runs reported zero actual violations in the sampled screens. Contrast remained inconclusive for gradient/pseudo-element/decorative backgrounds (latest moderator sample: 342 nodes), so contrast is not certified across the rendered application.
- Actual Chrome keyboard checks showed visible focus on player entry fields and game settings controls; the audio settings dialog exposed labeled controls and closed on Escape with focus returning to Settings.
- A 200% Chrome zoom sample (about 379 CSS px from the 758 px window capture) showed the 1–90 board fitting, chat controls fitting, and winning-pattern cards stacking without visible horizontal clipping. This is a zoom/reflow approximation, not device emulation.
- No screen-reader session or physical-device test was completed. The available app inventory exposed no Narrator, NVDA, or JAWS window.

## Production blockers

1. **Owner setup for local authenticated Chrome acceptance:** the isolated `chromeacceptance` schema has zero owner accounts. The user must run `owner:create` with the explicit loopback database/schema and enter the password at the local CLI prompt, then sign in at `/admin/signin`. Authenticated owner pages cannot be tested until then.
2. **Computer Use claim action:** the supported Chrome helper has repeatedly returned `unknown screenshotId screenshot-0` and `window changed; call get_window_state before using this window`, including after reselecting Chrome and taking a fresh state. The most recent failure happened before gameplay changed; read-only DB evidence stayed at 10 calls/0 claims. Live Chrome claim acceptance remains incomplete.
3. **Production environment values:** the strict environment checker returned **NOT READY** without loading `.env`: `DATABASE_URL`, HTTPS `PUBLIC_ORIGIN`, `TRUST_PROXY=1`, and `OWNER_MFA_KEY` are absent; `NODE_ENV` is not production. These values must be set in an explicitly selected deployment context. No production secrets were invented or copied into source.
4. **Unconfirmed database identity/state:** the configured Supabase project has not been confirmed as safe staging, so no deliberate migration, seed, reset, or gameplay operation was run against it. An earlier `owner:list` command was mistakenly issued without loopback overrides; it may have contacted a non-loopback database and could have applied migrations. The exact target and result were not captured, so that external state remains unverified and must be checked by an authorized operator before production use.
5. **No deployed-host validation:** no DNS, hosting account, public origin, TLS certificate, HTTPS/WSS, proxy, deployed CORS/cookie, external health check, or production traffic test has been performed. The production image had passed an earlier local Docker smoke test; a new Docker image was not built after the final client chunk split and deployment-config edits.
6. **Database provider-specific validation:** local PostgreSQL verifies schema and application behavior only. Supabase session-pooler identity, TLS/CA verification, migration state, limits, backup/restore and performance remain unverified.
7. **Accessibility and product-policy approval:** complete screen-reader/physical-device testing, all contrast combinations, production voice-provider/device playback, and approval of optional prize rules remain open.

## Final state and links

Overall status is **CONDITIONAL PASS / INCOMPLETE**, not “production-ready.” The current goal is blocked on the local owner setup and the supported Chrome helper’s repeated input failures; external production values and target confirmation are separate operator prerequisites.

Branch `main`, HEAD `6341f621f47e16b35ce5e2f27144f7854d6d5fec`; **278 modified or untracked entries** remain in the worktree. No reset, cleanup, stash, discard, commit, push, deployment, DNS change, or external database mutation was performed by this audit. Existing user changes were preserved.

Detailed evidence and chronology:

- [Autonomous audit and route matrix](NINETY-CLUB-AUTONOMOUS-AUDIT-2026-11-04.md)
- [Frontend and actual-Chrome audit](NINETY-CLUB-FRONTEND-AUDIT.md)
- [Chrome screenshots](chrome-evidence/)

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

## 5 November 2026 — final authenticated continuation and regression

This section supersedes earlier checkpoint statements that owner creation required user action, that authenticated pages were guard-only, and that a live claim had not completed.

- Provisioned disposable `audit.owner.20261105` through the supported owner workflow in isolated schema `chromeacceptance`, without `.env`; generated credentials remained in process memory and are not recorded.
- Actual installed Chrome completed sign-in, MFA enrollment, rejected invalid/replayed challenges, accepted a fresh MFA challenge, visited owner-protected routes, retained session through reload, and applied a report filter.
- An isolated synthetic moderator invite was accepted in actual Chrome, MFA enrolled, and the granted Regular instance scope exercised. Foreign-instance and ungranted room-creation requests returned masked 404/NOT_FOUND. The one-time socket ticket endpoint returned 200; no socket action was sent.
- All 46 route templates now have actual intended page-render evidence (including 28 authenticated `/admin` and `/super-admin` paths/details). Route rendering is not full control/action acceptance. `/admin` and `/super-admin` share the owner authorization model; no independent Admin or Super Admin role is present in reviewed source.
- Earlier actual Chrome gameplay claim evidence stands: valid Early Five settled for 20 points in host and player views, survived reload, and room end/reset succeeded.
- Full Node suite after dependency cleanup: 759/759 passed, 20 suites. Client lint/build passed; security probes 51/51; secret scan passed across 675 files; root and client dependency audits reported zero vulnerabilities.
- Docker production image rebuilt. A fresh production-mode container on loopback with an isolated `finalbuild` schema became ready; the temporary container was stopped and removed. This does not validate deployment secrets, HTTPS, hosting or provider behavior.
- Strict workstation environment validation remains NOT READY for actual deployment because deployment-specific database URL, HTTPS origin, trusted proxy and MFA key must be supplied by the operator. The earlier unconfirmed Supabase `owner:list` ambiguity remains unresolved and must be investigated read-only by an authorized operator.

The detailed role ledger and project hygiene findings are in `NINETY-CLUB-ROLE-ACTION-ACCEPTANCE-MATRIX.md` and `NINETY-CLUB-PROJECT-CLEANUP-REPORT.md`. Production decision remains FAIL pending the external and action-coverage blockers above.

## Role architecture and audit attribution hardening (5 November)

The formerly shared `/super-admin` alias is now fail-closed in the client; it no longer mounts the Owner route tree. Existing `/admin` routes remain protected by server-side verified Owner sessions. No Super Admin or Admin identity is provisioned, and no existing Owner was elevated. New Owner-originated platform and booking audit rows use role `owner`; additive migration 028 permits that value while preserving historical `super_admin` entries. Updated Chrome smoke, migration and regression checks are pending in this continuation, so this source change is not yet represented as tested.

## Final verification after role correction (5 November)

Role architecture and audit attribution are documented in `NINETY-CLUB-ROLE-ARCHITECTURE.md`. The frontend no longer exposes Owner pages under `/super-admin/*`; actual Chrome verified the fail-closed page at `/super-admin/settings` and Owner sign-in at `/admin/signin`. New Owner platform/booking audit events are labeled `owner`; old `super_admin` entries remain untouched. The new migration 028 was applied in a fresh disposable schema.

Post-change checks: full Node suite **759/759 passed** across 20 suites (including Owner audit attribution and all existing Moderator socket/session tests); client lint passed; Vite production build passed; security probes **51/51**; secret scan passed (679 files); root/client npm audits reported zero vulnerabilities. The rebuilt production-mode image became ready with schema migration 028. Chrome page sample had no page exceptions.

Not completed: all individual Admin actions, a separately provisioned Super Admin, actual browser UI for all moderator socket/session adversarial scenarios, real-Chrome duplicate/forged claim submissions, full accessibility/screen-reader, physical devices and voice-provider playback. Automated socket/game/session tests are supporting evidence, not browser acceptance. Production decision remains FAIL pending the role-policy/external deployment blockers recorded in the readiness report.

## Latest role/security continuation — 5 November 2026

**Decision remains: FAIL — CONFIRMED PRODUCTION BLOCKERS REMAIN.** Role separation is now implemented locally and representative Owner/Super Admin behavior was accepted in installed Chrome against an isolated production-mode container.

Current evidence:

- Migration 029 gives existing owner accounts the non-elevated `owner` role by default. Super Admin is a separate persisted role. No existing account is implicitly promoted.
- `/api/admin/*` platform-wide reads/mutations require the persisted Super Admin role; production privileged APIs require configured and enrolled MFA. Owner can read/manage only its own account/security settings. Owner platform calls return 403 and record authorization denials.
- `super-admin:create`, `super-admin:promote`, and `super-admin:demote` are offline CLI workflows. Promotion/demotion revokes every existing Owner session and writes an audit event in the same transaction. The last Super Admin cannot be demoted or removed.
- Actual installed Chrome validated Owner settings/reload and platform denials; Super Admin required MFA, authorized overview/instance reads, and sign-out revocation. Evidence is linked in the role matrix and Chrome evidence report.
- Post-change regression: **761/761** Node tests, 20 suites; client lint and production build pass; security probes **51/51**; secret scan **681 files** pass; root/client `npm audit` show zero vulnerabilities. Fresh Docker image build and production-mode readiness passed on isolated schema `rolebrowser`, migration 029.

Remaining local/application acceptance gaps: no defined instance-scoped Admin policy; not every privileged form/action was exercised in Chrome; Moderator Socket.IO operations and revoke/reconnect lifecycle were not exercised through Chrome (server integration tests cover key controls); invalid/duplicate/forged/concurrent claims remain automated rather than browser-submitted adversarial cases; complete assistive-technology, contrast, responsive physical-device and external voice playback checks remain open. Prior 46/46 route rendering belongs to the earlier shared role model and is not full current role/action acceptance.

External release blockers remain unchanged: the earlier `owner:list` may have targeted the unconfirmed Supabase endpoint, production project/database identity and migration history are unverified, and no authorized production origin, proxy topology, TLS/WSS/CORS/cookie behavior or deployed readiness was supplied. Do not reconnect to Supabase or deploy. Use the read-only operator handoff below, updated to compare migrations 001–029.

### Pre-enrollment settings boundary correction — 5 November 2026

A focused security review found that the MFA-enrollment session of a newly created Super Admin could read the shared settings payload before enrollment. The endpoint/UI now return/show only that account's identity, own sessions, password and MFA enrollment controls until confirmed MFA is present. Global owners, origin, runtime, health, defaults and backup data remain inaccessible; every privileged endpoint continues to require role and MFA. The fix is covered by a production-mode API regression test and fresh installed-Chrome acceptance. Full suite after the fix: **761/761**; production Docker readiness was rechecked on migration 029. Other action-level and external blockers in the readiness report remain open.

### Final local verification checkpoint — 5 November 2026

The complete suite was rerun against the dedicated role-acceptance PostgreSQL container using loopback only: **761/761 tests passed across 20 suites, zero skips**. The database backup/restore fixture directed `pg_dump`/`pg_restore` into that same disposable container and cleaned its temporary database. Client lint and production build passed; security probes were **51/51**; the post-build secret scan inspected **685 files**; full root and client dependency audits reported zero vulnerabilities. The production-mode acceptance app is healthy and `/readyz` reports ready; the isolated browser schema is at migration 029. Actual Chrome evidence remains the Owner denial/settings and Super Admin MFA/read/sign-out flows listed in the Chrome report.

No further action-level browser coverage was added during this final regression pass. Moderator live socket/revocation UI, browser-adversarial claims, every privileged mutation, complete assistive-technology/device/media checks and the unimplemented Admin role remain blockers to a complete acceptance claim. Production readiness remains **FAIL**.
