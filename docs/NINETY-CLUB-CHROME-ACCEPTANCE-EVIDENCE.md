# Ninety Club actual Chrome acceptance evidence

Updated 5 November 2026. Evidence is from the production-built local app and disposable PostgreSQL schema. The installed Chrome browser was driven through temporary Playwright automation because the supported Computer Use bridge repeatedly failed screenshot/window-state operations. No project dependency was added.

## Environment boundary

- App container ninety-audit-app-20261105, loopback port 127.0.0.1:4000, image ninety-club-audit:2026-11-05.
- DB container ninety-audit-pg-20261105, loopback 127.0.0.1:55463, disposable database codex and isolated schema chromeacceptance.
- Migrations through 027; /readyz ready, durable true, lease held, zero pool errors.
- No .env values in test commands; no Supabase, production or real-money use.
- Separate Chrome contexts for host/player. No account credentials entered.

## Real Chrome winning claim

Room JEEP2U5H, game 1, Regular Tambola. Host Chrome Audit Host; player Chrome Audit Player. Server generated ticket 1. With auto-call off, the host made 20 manual calls through the visible UI. Five player ticket values were called (49, 61, 64, 73, 8). The Early Five action became eligible and was submitted through the actual Chrome Claim button.

The player saw approved Early Five and +20 points; the host saw the same winner/award. Both award boards showed the result. Reload restored the seat, calls, marks and award. No JavaScript or console errors were recorded in either context.

Read-only DB evidence after settlement:
- One claim in JEEP2U5H/game 1: earlyFive, AWARDED, complete, 20 points, call index 20.
- One matching award for Chrome Audit Player: 20 points, call index 20, ticket 1.

Screenshots:
- chrome-evidence/mission-2026-11-05-player-claim-settled.png
- chrome-evidence/mission-2026-11-05-host-claim-settled.png
- chrome-evidence/mission-2026-11-05-player-award-board.png
- chrome-evidence/mission-2026-11-05-host-award-board.png
- chrome-evidence/mission-2026-11-05-room-reset.png
- chrome-evidence/mission-2026-11-05-player-early-five-6-of-15.png

The 6-of-15 filename is misleading: that screenshot was captured after another call arrived. A separate live state check showed five marked values and an enabled Early Five control before clicking. The screenshot alone is not proof of exact five-mark eligibility.

## End and reset lifecycle

Host ended the round using its two-step UI confirmation. Host saw Completed, standings, and the Early Five winner. Host then confirmed Reset room; room returned to WAITING, game number 1, with zero calls in the current state. History retained one claim and one award row.

## Scope limits

Earlier screenshots document public routes, host/player gameplay, keyboard focus, settings dialog and zoom/reflow. Route list/status is in NINETY-CLUB-ROLE-ACTION-ACCEPTANCE-MATRIX.md.

Not verified in Chrome: authenticated Owner/Admin/Super Admin, authenticated moderator on this backend, second duplicate or forged-invalid claim request, all prize patterns, screen reader, all contrast combinations, physical mobile devices, or voice-provider playback. Automated tests are supporting evidence, not a replacement for those browser flows.

Two exploratory games overshot Early Five because browser polling lagged manual/automatic draw cadence. Those attempts are not counted as app failures. The later manual-call run completed the valid UI claim.

## Owner setup checkpoint

The owner CLI was verified but not executed. The npm script uses Node's .env loader, so the safe user command bypasses it: docker exec -it ninety-audit-app-20261105 node scripts/owner.js create. The current app container has explicit isolated DB settings for database codex/schema chromeacceptance; the DB container is only published to 127.0.0.1:55463. No owner exists. The CLI runs migrations and then prompts for a username and hidden password. The password must be entered by the user at the local prompt. Do not send it in chat. After success, sign in at http://127.0.0.1:4000/admin/signin.

## Owner and moderator current Chrome acceptance (5 November)

Owner was provisioned through the supported CLI in the dedicated loopback-only `chromeacceptance` schema. Actual Chrome completed MFA enrollment and authentication, validated invalid password and invalid/replayed MFA rejection, visited all 28 protected route templates across the two URL aliases, retained the session on reload, and applied the Admin report filter. No credentials or MFA seed are preserved in this evidence.

A synthetic moderator invite with only Regular `instance.read`, `room.read`, `bookings.read`, and `bookings.assign` grants was accepted in actual Chrome. The moderator enrolled MFA and saw its assigned instance/tabs. The Regular rooms read succeeded; foreign-instance read and ungranted room creation were denied with 404/NOT_FOUND. The one-time Socket.IO ticket endpoint returned success. An actual socket event, moderator session rotation/revocation, and comprehensive action coverage remain untested.

Route template page rendering: 46/46. This is not full acceptance of every action or error state. The source shares the same Owner component/session for `/admin` and `/super-admin`; separate Admin/Super Admin policy remains undefined. See the role/action matrix for route-level evidence and limits.

## Role alias remediation (5 November)

After the prior 46-route Owner acceptance, the `/super-admin/*` alias was removed from the Owner route tree and replaced with a fail-closed page explaining that no separately provisioned Super Admin identity exists. This remediation has not yet been counted as a Chrome acceptance until the updated build is checked in Chrome. Existing authenticated Owner route evidence remains valid for `/admin/*` only.

The actual Chrome smoke rendered /super-admin/settings after the alias removal; it showed the accessible fail-closed message with no page errors. Other Super Admin URLs were not individually rechecked after the shared wildcard was installed. Earlier screenshots of Super Admin pages record the old shared Owner UI and are historical only, not acceptance evidence for the current build.

## Final role correction evidence (5 November)

Updated actual Chrome route sample: `/super-admin/settings` now shows “Super Admin access is unavailable”; the owner route tree is not mounted under that path. Chrome also loaded `/admin/signin` after navigation. No page exceptions were observed. Screenshot: `chrome-evidence/mission-2026-11-05-super-admin-unavailable.png`. Other Super Admin routes were not individually revisited after replacing the shared wildcard, so do not count them as individually accepted.

Production image `ninety-club-audit:2026-11-05-roles` rebuilt and ran with `NODE_ENV=production` against isolated schema `roleauditfinal` on the loopback-only PostgreSQL container. `/readyz` became ready; schema migration version 028 was confirmed; the temporary app container was stopped and removed. This verifies local container/migration behavior only.

## Latest role-separated Chrome evidence — 5 November 2026

A fresh production-mode Docker image was started on loopback port 4004 with isolated PostgreSQL schema `rolebrowser`, migrated through 029. Disposable Owner and Super Admin accounts were provisioned through the supported CLI. Generated passwords and the MFA key/seed remained process-local and are not included in reports or screenshots.

Using installed Google Chrome with separate browser contexts:

- Owner signed in at `/admin/signin`, saw its `/admin/settings` page and recovered the session on reload. Its own settings API returned 200; platform overview and instance APIs returned 403. `/super-admin/settings` displayed the role denial.
- Super Admin signed in at `/super-admin/signin`, completed the required TOTP challenge, and accessed overview/instances APIs (200). Session payload reported `role=super_admin`, `mfa.required=true`, and `mfa.state=enrolled`. Sign-out redirected to sign-in; a subsequent overview request returned 401.
- No uncaught page errors or unexpected console errors occurred. Three console entries were expected 401/403 denial responses.

This verifies role separation, MFA challenge, representative protected reads, reload and sign-out revocation on the isolated local profile. It does not verify all platform mutations, the Admin role (not implemented), every one of the 46 route templates under the corrected policy, or full role/action coverage.

### Final mission re-verification — 5 November 2026

The role-separation Chrome run above remains the latest authenticated browser evidence. A full automated regression rerun then passed **761/761** tests (20 suites, zero skips) against the same dedicated loopback-only PostgreSQL container. The database-backed backup/restore test was run with PostgreSQL tooling explicitly directed into that container. Client lint/build, **51/51** security probes, a post-build secret scan over **685 files**, and full root/client dependency audits (zero vulnerabilities) passed. The production-mode browser container is healthy and its `/readyz` endpoint reports ready; schema migration 029 was verified.

This checkpoint did not exercise live Moderator Socket.IO actions or revocation/reconnect in Chrome, open-browser invalidation after an Owner role change, negative/forged/concurrent claim submissions through game UI, all Super Admin mutation forms, or manual screen-reader/physical-device/voice-provider acceptance. These remain partial or untested, not passed by the automated suite.

Evidence files:

- `chrome-evidence/mission-2026-11-05-role-split-acceptance.json`
- `chrome-evidence/mission-2026-11-05-owner-role-denial.png`
- `chrome-evidence/mission-2026-11-05-super-admin-role-accepted.png`

The original screenshots that show Owner pages beneath `/super-admin/*` are historical and do not demonstrate the current role gate. Previous game, moderator and public-page evidence remains scoped to the roles and actions stated at capture time.

### MFA-before-data boundary check — 5 November 2026

After the initial production Chrome run exposed that an un-enrolled Super Admin could receive platform settings while opening the MFA enrollment screen, the settings endpoint and UI were tightened. A fresh build now limits that session to its own account row, MFA enrollment, password/session controls and sign-out; origin, other accounts, runtime, health, defaults and backups stay hidden until enrollment. A fresh Google Chrome session verified the self-only settings response, no Platform origin/Health sections in the page, and `403 MFA_REQUIRED` for global overview. The enrolled Super Admin then completed the TOTP challenge and received platform overview/instance reads (200); sign-out returned 401. Machine-readable evidence: `chrome-evidence/mission-2026-11-05-role-split-acceptance.json`; pending-enrollment screenshot: `chrome-evidence/mission-2026-11-05-super-admin-awaiting-mfa.png`.

The final local suite after this correction passed **761/761** across 20 suites. This closes the specific pre-enrollment settings disclosure; full platform action acceptance, moderator live socket UI flows, adversarial browser claim submissions, and manual assistive-technology/device checks remain open.
