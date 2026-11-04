# Ninety Club role/action acceptance matrix

Updated 5 November 2026. Evidence-based ledger; route rendering is not equivalent to full action acceptance. There are 46 product route templates (development-only voice audition excluded).

## Coverage summary

| Role | Identity state | Route/page evidence | Actions exercised | Result |
|---|---|---|---|---|
| Owner | Disposable `audit.owner.20261105` in isolated schema; MFA enrolled | Authenticated Chrome rendered overview, settings and detail pages; session survived reload | Password sign-in, invalid password/MFA rejection, MFA enrollment, TOTP replay rejection, successful MFA sign-in, report filter | Authenticated sample passed; full admin action matrix incomplete |
| Admin | No separate Admin identity/policy found; shared owner UI/API | `/admin/*` protected pages rendered in authenticated owner Chrome | Same shared owner scope; report filters sampled | Separate Admin role cannot be accepted until semantics are defined |
| Super Admin | No distinct tier; shared `AdminRoot` and owner session | `/super-admin/*` protected pages rendered by owner Chrome | No distinct super-admin action/authorization exercised | Not an independent role in current source model |
| Moderator | Disposable `audit.mod.20261105`; active grant restricted to Regular instance | Actual Chrome invitation, MFA and sign-in; assigned tabs and scoped room list rendered | Invitation acceptance, MFA, assigned instance read, denied foreign instance and denied ungranted room creation; socket ticket issued | Sample passed; socket action and session revocation lifecycle not browser-tested |
| Host | Disposable host context | `/host`, room and game rendered | Room create, ticket generation, start, calls, end/reset | Sampled lifecycle passed |
| Player | Guest in separate Chrome context | `/player`, room and game rendered | Join, ticket, marks, valid Early Five claim/award, reload recovery | Sampled lifecycle passed |
| Public visitor | Unauthenticated | Public pages and fixtures rendered | Sampled navigation and content | Partial |

## Route template ledger

All 46 templates have an actual rendered-page observation. Protected routes were observed only after owner MFA authentication; route coverage does not mean all controls were exercised.

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
| 18 | Super Admin | `/super-admin/signin` | Shared sign-in page rendered |
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
| 33 | Super Admin alias | `/super-admin` | Rendered through shared owner UI |
| 34 | Super Admin alias | `/super-admin/instances` | Rendered |
| 35 | Super Admin alias | `/super-admin/instances/:instanceId` | Regular detail rendered |
| 36 | Super Admin alias | `/super-admin/reports` | Rendered |
| 37 | Super Admin alias | `/super-admin/moderators` | Rendered |
| 38 | Super Admin alias | `/super-admin/sessions` | Rendered; actions incomplete |
| 39 | Super Admin alias | `/super-admin/themes` | Rendered |
| 40 | Super Admin alias | `/super-admin/posters` | Rendered |
| 41 | Super Admin alias | `/super-admin/games` | Rendered |
| 42 | Super Admin alias | `/super-admin/games/:roomId` | JEEP2U5H detail rendered |
| 43 | Super Admin alias | `/super-admin/players` | Rendered |
| 44 | Super Admin alias | `/super-admin/history` | Rendered |
| 45 | Super Admin alias | `/super-admin/settings` | Rendered |
| 46 | Super Admin alias | `/super-admin/branding` | Rendered |

## Action-level status

- Route templates rendered: 46/46.
- Full meaningful action coverage: incomplete; selected actions only, no claim that every form, dialog, role boundary, responsive mode or accessibility behavior passed.
- Owner MFA and reload recovery accepted in actual Chrome. A report filter was applied.
- Moderator actual Chrome/backend integration: active invite, MFA, assigned Regular grant; four permitted tabs, Regular rooms request 200, foreign instance and ungranted room create denied as 404/NOT_FOUND; authenticated Socket.IO ticket endpoint returned 200. Actual Socket.IO operation and logout/revocation lifecycle not tested.
- Host/player accepted Early Five claim and award plus room end/reset in actual Chrome.
- Source review shows `/admin` and `/super-admin` share `ownerRoutes`, `AdminRoot`, owner session and API requirements. No distinct Admin/Super Admin identities or policies are implemented in reviewed source.
- Automated tests cover CSRF, rate limiting, owner sessions, moderator grant enforcement, host-only socket actions, forged/cross-room tokens, invalid and duplicate claims. They support but do not replace browser acceptance.
- Voice-provider playback, comprehensive responsive/device coverage, screen reader, full contrast combinations and the entire moderator session lifecycle remain untested.
