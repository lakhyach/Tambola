# Ninety Club role/action acceptance matrix

Updated 5 November 2026. Evidence-based ledger; route rendering is not equivalent to full action acceptance. There are 46 product route templates (development-only voice audition excluded).

## Coverage summary

| Role | Identity state | Route/page evidence | Actions exercised | Result |
|---|---|---|---|---|
| Owner | Disposable `audit.owner.20261105` in isolated schema; MFA enrolled | Authenticated Chrome rendered overview, settings and detail pages; session survived reload | Password sign-in, invalid password/MFA rejection, MFA enrollment, TOTP replay rejection, successful MFA sign-in, report filter | Authenticated sample passed; full admin action matrix incomplete |
| Admin | No separate Admin identity/policy found; shared owner UI/API | `/admin/*` protected pages rendered in authenticated owner Chrome | Same shared owner scope; report filters sampled | Separate Admin role cannot be accepted until semantics are defined |
| Super Admin | Not provisioned; no separate identity or policy | `/super-admin/settings` actual Chrome shows fail-closed unavailable page | No privileged action available | Disabled pending approved policy and separate server-side identity |
| Moderator | Disposable `audit.mod.20261105`; active grant restricted to Regular instance | Actual Chrome invitation, MFA and sign-in; assigned tabs and scoped room list rendered | Invitation acceptance, MFA, assigned instance read, denied foreign instance and denied ungranted room creation; socket ticket issued | Sample passed; socket action and session revocation lifecycle not browser-tested |
| Host | Disposable host context | `/host`, room and game rendered | Room create, ticket generation, start, calls, end/reset | Sampled lifecycle passed |
| Player | Guest in separate Chrome context | `/player`, room and game rendered | Join, ticket, marks, valid Early Five claim/award, reload recovery | Sampled lifecycle passed |
| Public visitor | Unauthenticated | Public pages and fixtures rendered | Sampled navigation and content | Partial |

## Route template ledger

The previous audit rendered all 46 templates under the then-shared UI. After fail-closed remediation, `/super-admin/*` no longer renders Owner pages. Actual Chrome sampled `/super-admin/settings` and confirmed the unavailable page; other Super Admin aliases share the same wildcard matcher and were not individually revisited.

| # | Role | Route template | Evidence/status |
|---:|---|---|---|
| 1 | Public | `/` | Rendered; navigation sampled |
| 2 | Public | `/games` | Rendered; navigation sampled |
| 3 | Public | `/themes` | Rendered |
| 4 | Public | `/poster/:posterId` | Rendered; synthetic published fixture |
| 5 | Public | `/games/:slug` | Rendered; Regular and Bumper |
| 6 | Public | `/games/:slug/sessions` | Rendered; list/empty state |
| 7 | Public | `/sessions/:sessionId` | Rendered; synthetic booking fixture |
| 8 | Player | `/player` | Rendered; entry/join sampled |
| 9 | Player | `/player/room` | Rendered; ticket assignment sampled |
| 10 | Player | `/player/game` | Rendered; claim/award/recovery sampled |
| 11 | Host | `/host` | Rendered; room creation sampled |
| 12 | Host | `/host/room` | Rendered; ticket/start sampled |
| 13 | Host | `/host/game` | Rendered; calls/end/reset sampled |
| 14 | Moderator | `/moderator/bookings` | Authenticated moderator UI rendered; assigned scope sampled |
| 15 | Moderator | `/moderator/accept` | Actual invite acceptance completed |
| 16 | Moderator | `/moderator/recovery` | Route rendered; recovery flow not exercised |
| 17 | Owner | `/admin/signin` | Sign-in, failures and MFA completion tested |
| 18 | Super Admin | `/super-admin/signin` | Fail-closed unavailable state (wildcard route; not individually revisited) |
| 19 | Owner/Admin | `/admin` | Authenticated owner overview rendered |
| 20 | Owner/Admin | `/admin/instances` | Rendered |
| 21 | Owner/Admin | `/admin/instances/:instanceId` | Regular detail rendered |
| 22 | Owner/Admin | `/admin/reports` | Rendered; Apply filters sampled |
| 23 | Owner/Admin | `/admin/moderators` | Rendered; moderator workflow sampled |
| 24 | Owner/Admin | `/admin/sessions` | Rendered; actions incomplete |
| 25 | Owner/Admin | `/admin/themes` | Rendered; actions incomplete |
| 26 | Owner/Admin | `/admin/posters` | Rendered; actions incomplete |
| 27 | Owner/Admin | `/admin/games` | Rendered |
| 28 | Owner/Admin | `/admin/games/:roomId` | JEEP2U5H detail rendered |
| 29 | Owner/Admin | `/admin/players` | Rendered; actions incomplete |
| 30 | Owner/Admin | `/admin/history` | Rendered; actions incomplete |
| 31 | Owner/Admin | `/admin/settings` | Rendered; local origin/backup warnings visible |
| 32 | Owner/Admin | `/admin/branding` | Rendered; actions incomplete |
| 33 | Super Admin | `/super-admin` | Fail-closed unavailable state (wildcard route; not individually revisited) |
| 34 | Super Admin | `/super-admin/instances` | Fail-closed unavailable state (wildcard route; not individually revisited) |
| 35 | Super Admin | `/super-admin/instances/:instanceId` | Fail-closed unavailable state (wildcard route; not individually revisited) |
| 36 | Super Admin | `/super-admin/reports` | Fail-closed unavailable state (wildcard route; not individually revisited) |
| 37 | Super Admin | `/super-admin/moderators` | Fail-closed unavailable state (wildcard route; not individually revisited) |
| 38 | Super Admin | `/super-admin/sessions` | Fail-closed unavailable state (wildcard route; not individually revisited) |
| 39 | Super Admin | `/super-admin/themes` | Fail-closed unavailable state (wildcard route; not individually revisited) |
| 40 | Super Admin | `/super-admin/posters` | Fail-closed unavailable state (wildcard route; not individually revisited) |
| 41 | Super Admin | `/super-admin/games` | Fail-closed unavailable state (wildcard route; not individually revisited) |
| 42 | Super Admin | `/super-admin/games/:roomId` | Fail-closed unavailable state (wildcard route; not individually revisited) |
| 43 | Super Admin | `/super-admin/players` | Fail-closed unavailable state (wildcard route; not individually revisited) |
| 44 | Super Admin | `/super-admin/history` | Fail-closed unavailable state (wildcard route; not individually revisited) |
| 45 | Super Admin | `/super-admin/settings` | Actual Chrome: fail-closed unavailable state |
| 46 | Super Admin | `/super-admin/branding` | Fail-closed unavailable state (wildcard route; not individually revisited) |

## Action-level status

- Previous pre-remediation route rendering: 46/46. Current page coverage: 31 regular role/public/game routes and 1 Super Admin fail-closed sample; 14 remaining Super Admin paths rely on the shared wildcard route but were not individually revisited.
- Full meaningful action coverage: incomplete; selected actions only, no claim that every form, dialog, role boundary, responsive mode or accessibility behavior passed.
- Owner MFA and reload recovery accepted in actual Chrome. A report filter was applied.
- Moderator actual Chrome/backend integration: active invite, MFA, assigned Regular grant; four permitted tabs, Regular rooms request 200, foreign instance and ungranted room create denied as 404/NOT_FOUND; authenticated Socket.IO ticket endpoint returned 200. Actual Socket.IO operation and logout/revocation lifecycle not tested.
- Host/player accepted Early Five claim and award plus room end/reset in actual Chrome.
- Source review shows `/admin` and `/super-admin` share `ownerRoutes`, `AdminRoot`, owner session and API requirements. No distinct Admin/Super Admin identities or policies are implemented in reviewed source.
- Automated tests cover CSRF, rate limiting, owner sessions, moderator grant enforcement, host-only socket actions, forged/cross-room tokens, invalid and duplicate claims. They support but do not replace browser acceptance.
- Voice-provider playback, comprehensive responsive/device coverage, screen reader, full contrast combinations and the entire moderator session lifecycle remain untested.

## Role architecture hardening update (5 November)

`/super-admin/*` now renders an unavailable state and no longer mounts shared Owner routes. This is fail-closed until a distinct Super Admin model and policy exists. Server owner APIs remain guarded by Owner session checks and do not accept a URL role or client role payload. The actor identity for new Owner-originated platform/booking actions is recorded as `owner`; migration 028 adds the matching audit constraint and preserves all old rows. See `NINETY-CLUB-ROLE-ARCHITECTURE.md`.

## Verification after role correction (5 November)

- Full Node suite: 759/759 passed across 20 suites after migration 028 and the Owner actor-role assertion were added.
- Current page acceptance after correction: Chrome visited `/super-admin/settings` and observed the fail-closed page; `/admin/signin` still rendered. Previous Chrome evidence for `/admin/*` stays valid. Old screenshots showing Owner pages under `/super-admin/*` depict the pre-remediation alias and are historical only.
- Moderator Socket.IO lifecycle remains covered by server integration tests (`tests/moderator.test.js`), including one-time/expired ticket refusal, forbidden game events, foreign-room denial, grant revocation during an active socket, and audit records. This does not claim that the same socket scenarios were executed through browser UI.
- Current production-mode image startup/readiness passed against a fresh disposable schema at migration 028.

## Latest role-separated acceptance — 5 November 2026 (supersedes previous role conclusions)

The earlier 46/46 page-render pass used the old shared Owner/Super Admin authorization state. It remains historical route evidence and is not a claim that the new role policy has 46/46 Chrome action coverage.

| Role | Current verified state | Actual Chrome evidence | Outstanding |
|---|---|---|---|
| Owner | Persisted `owner`; existing identities default to this role after migration 029 | On the isolated production-mode `rolebrowser` schema, signed in at `/admin/signin`, opened Owner settings, reloaded successfully, received 403 for `/api/admin/overview` and `/api/admin/instances`, and saw the Super Admin route denial | No instance-scoped Owner/Admin grant model; full settings action and session lifecycle coverage remains partial |
| Super Admin | Separate persisted role; bootstrap/promote/demote are offline CLI only; role changes revoke sessions and are audited | Signed in at `/super-admin/signin`; required MFA challenge accepted; `/api/admin/overview` and `/api/admin/instances` returned 200; sign-out made overview return 401 | Not every platform action was exercised in Chrome; deployment MFA key and production deployment remain unverified |
| Admin | No identity or permission model provisioned | No Admin session exists | Product requirements leave its instance capabilities/grant policy undefined; keep unavailable |
| Moderator | Existing explicit per-instance grant and MFA model | Earlier invite/MFA/instance-denial browser evidence remains; role-split changes add server enforcement to platform APIs | Actual browser Socket.IO operation and full revocation/reconnect browser lifecycle remain open; server integration tests cover socket tickets, grant revocation and forbidden events |
| Host / Player | Room/seat-bound game credentials | Existing Chrome claim/award/reload/end/reset evidence remains valid; host/player credentials are not admin role credentials | Invalid/duplicate/forged claim scenarios remain automated-test evidence, not actual Chrome adversarial acceptance |

Actual Chrome role evidence and screenshots are in `chrome-evidence/mission-2026-11-05-role-split-acceptance.json`, `mission-2026-11-05-owner-role-denial.png`, and `mission-2026-11-05-super-admin-role-accepted.png`.

The tested database was disposable PostgreSQL schema `rolebrowser`; it was migrated through 029. No external database was contacted. The full Node suite passed **761/761** (20 suites). Client lint/build, 51/51 security probes, secret scan (681 files), root/client dependency audits (zero vulnerabilities), Docker build, and production-mode container readiness passed. Complete action coverage is still partial; route rendering, API responses and automated tests are not substituted for manual action coverage.

## Final mission checkpoint — 5 November 2026

Final re-run against the dedicated loopback-only PostgreSQL container completed **761/761 tests, 20 suites, zero skips**. The backup/restore integration test used `PG_CONTAINER=ninety-audit-pg-20261105`; its temporary database and scratch artifacts were cleaned by the test. Client lint/build passed, the security probe passed **51/51**, the post-build secret scan inspected **685 files**, and full root/client dependency audits reported zero vulnerabilities. `git diff --check` passed with the repository's CRLF-aware setting. The production-mode acceptance container remains healthy and `/readyz` reports ready; the role browser schema is isolated and at migration 029.

No new role/action Chrome paths were exercised in this continuation. In particular, the Moderator live Socket.IO event and revoke/disconnect/reconnect sequence, role-change session invalidation in an already-open browser, adversarial claim submissions through browser UI, every corrected Super Admin mutation, and full accessible-device/media acceptance are still open. The earlier 46/46 route count is historical page rendering under a prior shared role model, not current action coverage. Production readiness remains **FAIL**.
