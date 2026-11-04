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
