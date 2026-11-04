# Platform-owner architecture investigation

Date: 31 October 2026
Repository checkpoint reported by the request: Phase 18, `093e58fd8644d854beb56cfb98c1bc07105924b3`
Investigation scope: repository and history audit, public reference research, platform-owner architecture and staged implementation plan. No Phase 19 work, deployment, account changes, database changes, or test runs were performed.

## 1. Findings at a glance

The project is a functioning free-to-play, one-deployment Tambola platform with a server-authoritative engine, durable PostgreSQL persistence, a host caller console, multi-ticket player experience, and a separate owner control centre. It already has several of the foundations a platform Super Admin needs: owner login, optional TOTP MFA, signed sessions, CSRF checks, throttling, audit records, room management, health information, and backup/restore tooling.

It is not yet the requested multi-game-instance platform. “Room” currently means one game-night room. There is no durable parent object for Regular and Bumper instances, no moderator principal or instance grant, no dynamic instance branding, and no instance-scoped configuration/history/inventory API. The existing single-instance process lease is a safety invariant for one running application process and must remain intact unless the runtime/scheduler is deliberately redesigned.

The reference domain could not be safely inspected: the public fetch tool failed on all six supplied HTTPS URLs, and the browser reported `ERR_CERT_COMMON_NAME_INVALID` at the reference root. Plain HTTP returned a LiteSpeed 404 at `/`. No certificate warning was bypassed and no login or private endpoint was attempted. The supplied video was partly observable in YouTube: sampled frames show a game-settings form, ticket availability, and a booking dialog. That video evidence does not establish behavior of any of the six live routes.

The working tree contains user changes that predate this report. They include implementations, migration 005, and tests for the five requested optional patterns. They are not in the reported Phase 18 commit and were not tested during this investigation. They have been preserved.

## 2. Repository and history audit

### 2.1 Git state

- Branch: `main`.
- `HEAD`: `093e58fd8644d854beb56cfb98c1bc07105924b3`, matching the reported Phase 18 checkpoint and `origin/main` at audit time.
- Remote: `https://github.com/lakhyach/Tambola.git`.
- The available history contains 14 commits, from initial deployment hardening through Phases 15, 16, 16B, 17, and 18. The latest sequence is `e5c6e99` (Phase 17 report), `672e153` (Phase 18 player work), `d04f347` (CI ordering fix), and `093e58f` (Phase 18 report).
- Existing unstaged/ untracked work was present before this audit:
  - modified: `server/game/engine.js`, `server/game/patterns.js`, `server/game/proposed-patterns.js`, `server/net/socket.js`, `server/net/validate.js`, `server/persist/controller.js`, `server/persist/recovery.js`, `server/persist/store.js`, and related pattern tests/helpers;
  - untracked: migration `005_award_ticket.sql`, `pattern-geometry.js`, and pattern test files/harness for Star, Second Full House, Early Seven, Half Sheet, and Box.
- No `.env` values were read or copied into this report. No files in the existing dirty set were edited.

### 2.2 Phase documentation reviewed

Reviewed `TEST-REPORT.md` (including the complete Phase 18 section), `CHANGELOG.md`, `docs/GAP-REPORT.md`, `docs/PHASE-16B-REPORT.md`, `docs/MARKET-BENCHMARK.md`, `docs/RULES-DECISIONS.md`, `docs/CLIENT-REQUIREMENTS.md`, `docs/CLIENT-SIGNOFF.md`, `docs/DEPLOYMENT-READINESS.md`, `docs/FREE-INFRASTRUCTURE-RESEARCH.md`, `docs/HOSTING-OPTIONS.md`, `docs/CALLER-CONSOLE.md`, `docs/PLAYER-GAMEPLAY.md`, `server/ADMIN.md`, `server/DATABASE.md`, `server/RUNBOOK.md`, `server/net/CONTRACT.md`, `README.md`, and `TEST-REPORT.md`.

The Phase 18 report records 516 passing tests, browser and durable E2E evidence, an earlier failing CI run followed by a passing run on `d04f347`, and explicit limits around physical devices, real audio, screen readers, long soak, and public deployment. Those are recorded claims from the report; this investigation did not rerun them.

## 3. Dependency and architecture map

| Layer | Current implementation | Reuse for owner platform |
|---|---|---|
| Browser client | React 18, Vite, Tailwind; client routes in `client/src/main.jsx`; static SPA served by Express | Extend current route tree and visual system. Add `/games/*`, `/super-admin/*`, and `/moderator` as presentation routes only; never use route hiding as authorization. |
| Realtime transport | Socket.IO; strict ack/event contract in `server/net/CONTRACT.md`; `registry.js`, `socket.js`, `validate.js`, `dispatch.js` | Keep the contract, validation, event budgets, room-scoped emissions, and session-derived identity. Add moderator commands only through a server authorization layer. |
| Game rules | `server/game/engine.js`, `ticket.js`, `patterns.js`; server owns draws, ticket grids, marks, claims, awards, and state transitions | Preserve as the authoritative engine. Attach each room to a durable game instance; do not fork a separate engine for Regular and Bumper. |
| Persistence | PostgreSQL migrations 001–004 in tracked history; store/controller/recovery/scheduler modules; durable writes precede broadcasts; one writer per room | Add instance identifiers and grants with additive migrations, then ensure every read/write is scoped by instance. Preserve append-only game history and recovery validation. |
| Platform admin | `/admin` React tree; `/api/admin`; separate `owner_accounts`/`owner_sessions`, TOTP enrollment, CSRF/session protections, throttling, audit | Evolve the existing owner into the Super Admin identity; keep bootstrap/recovery on the server. Add explicit server-side roles, grants, and audited moderator lifecycle actions. |
| Operations | Health probes, lease heartbeat, structured logs, backup and restore-check, CI | Reuse all of it. Add per-instance operational summaries while keeping platform health global and avoiding leakage of secrets/session data. |
| Branding | Build-time identity and `VITE_*` theme config | Add DB-backed, validated platform and per-instance branding after the instance model; allow only supported fields and safe asset references. |

Current URL families are `/`, `/host`, `/host/room`, `/host/game`, `/player`, `/player/room`, `/player/game`, and `/admin` with sign-in, games, players, history, and settings. The current `/admin/games` list concerns rooms, not independent product/game instances.

Current core tables include `rooms`, `room_members`, `games`, `tickets`, `draw_calls`, `claims`, `awards`, host/player `sessions`, owner accounts/sessions, admin audit, rate-limit/MFA challenge support, and scheduler state. `rooms.room_code` is the principal identity today; `rooms.config` contains room-level settings. That is not an instance boundary.

### Reusable and documented capabilities

- Server-generated 90-ball draw plan; each official draw is persisted before broadcast.
- Legal 3×9 ticket generator, persisted server tickets, multi-ticket seats, recovery integrity checks.
- Server-side pattern evaluation, exclusive award arbitration, call-window checks, and history.
- Room-scoped sessions, host authorization, reconnect/recovery, and scheduler pause behavior.
- Caller console with current/previous number, full board/history, pace controls, pause/resume/end/reset, EN/HI device voice, and host controls.
- Player ticket preview, ticket rail, derived marking, live claim refusal reasons, reconnect, chat history de-duplication, and results.
- Owner MFA support, secure cookie/session handling, CSRF protection, request and socket validation/throttling, audit logging, health probes, backup and restore checks.

## 4. Reference research and evidence matrix

Evidence labels follow the request: **Verified** means seen directly; **Partially observed** means some public material was seen but not enough to prove full behavior; **Not observable** means no usable public view was obtained; **Inferred** means a conclusion from indirect evidence and not a claim about observed functionality.

### 4.1 Six supplied routes

| Route | Status | Evidence / limitation |
|---|---|---|
| `https://super777tambola.com/` | Not observable | Public fetch returned an internal access error. Browser navigation failed with a certificate name mismatch. |
| `https://super777tambola.com/admin` | Not observable | Public fetch returned an internal access error. No authentication was attempted. |
| `https://super777tambola.com/agent` | Not observable | Public fetch returned an internal access error. No authentication was attempted. |
| `https://super777tambola.com/bumper` | Not observable | Public fetch returned an internal access error. |
| `https://super777tambola.com/bumper/admin` | Not observable | Public fetch returned an internal access error. No authentication was attempted. |
| `https://super777tambola.com/bumper/agent` | Not observable | Public fetch returned an internal access error. No authentication was attempted. |

The browser must not be instructed to proceed through the certificate warning. The HTTP root returned a LiteSpeed `404 Not Found`; this does not verify the HTTPS routes. No route content, login state, or authenticated feature is claimed as observed.

### 4.2 Video evidence

The public YouTube page title is “Latest TAMBOLA update | how to make own own TAMBOLA website | new admin panel”. The page identifies the publisher as MAKE TAMBOLA and describes a tutorial for maketambola.com. The browser reported an 8:57 video and Hindi auto-dub captions. Captions were unavailable at first while an ad played; captions then appeared during video playback. A few segments were sampled, not the full 8:57 runtime.

| Sample | Status | Direct observation |
|---|---|---|
| Around 0:02 | Partially observed | A “Game Settings” screen with date/time, total ticket quantity (screen showed 600 and an “unlimited” label nearby), ticket price (screen showed 200), booking status set to OPEN, and a Save game control. |
| Around 0:48 | Partially observed | A ticket availability view with a countdown-like timer, “Check Available Tickets”, and a displayed available count of 585. |
| Around 1:03 | Partially observed | A “New Booking” dialog with customer name and phone fields, a booking control, and a grid of numbered ticket choices. |
| Around 1:22 | Partially observed | A “Jackpot Tambola” banner in the demonstration UI. This does not establish a separate Bumper instance or its rules. |

These frames show that the demonstrated product has ticket availability and a booking flow; they do not verify that buttons work, identify whether screens map to `/admin` or `/agent`, establish the exact ticket/prize rules, or prove separation between Regular and Bumper. The displayed ticket-price value is third-party video content and is explicitly outside this project’s free-to-play scope.

### 4.3 Requested feature groups and evidence status

| Feature group | Status | What can be said honestly |
|---|---|---|
| Player landing/game information/search/join/number board/ticket/calls/voice/winners/status/reconnect | Not observable on the live reference | The video samples above are insufficient to describe the public player journey. Do not copy or claim a reference feature from them. |
| Admin configuration, limits, booking, start/call speed, prize UI, ticket generation/shuffle/reset, organizer/agent/ticket management, statistics/history/posters | Not observable on the live reference; partially observed in the video | Only the fields and controls visible in §4.2 are verified. Whether each persists or is functional is unknown. |
| Agent dashboard, inventory, assignments, lookup, booking | Not observable on the live reference; partially observed in the video | The booking dialog is visible, but its user/role, permissions, and server behavior are not. |
| Regular/Bumper separation | Not observable | Separate URL paths are supplied by the user; they do not prove independent inventory, history, config, or authorization. |
| Authentication and protected access | Not observable | No login was attempted; no private data or credentials were accessed. |
| Reference site route semantics inferred from URL names | Inferred only | `/admin`, `/agent`, and `/bumper/*` suggest role/product sections, but actual meaning and permission boundaries remain unverified. |

To finish the live-route comparison, the owner can provide a corrected public URL/certificate or screenshots/video captures of the six public pages. If detailed behavior beyond the sampled video segments is needed, provide the video file or timestamped screenshots; no feature should be filled in from guesswork.

## 5. Architecture assessment: owner and game instances

### Current boundary

There is one platform process and one PostgreSQL database. A PostgreSQL advisory lease intentionally prevents a second server process using the same database. Rooms are separate game-night entities and room scoping is strong, but there is no `game_instance_id` on a room or parent record to represent Regular/Bumper as configurable products. The existing owner can create/manage rooms and inspect room/player/history, but there is no moderator account or grant model. Player/host credentials are distinct from owner identity. Branding is build-time, not owner-editable at runtime.

### Proposed domain model (design only)

1. `game_instances`: stable ID/slug, display name, lifecycle (`active`, `paused`, `archived`), validated instance config, branding config, created/updated metadata, and optional public slug. Seed Regular and Bumper as ordinary rows so additional instances do not require duplicate apps.
2. `rooms`: add a required `game_instance_id`; retain unique room codes and current room/game/ticket/call/award history. All game operations resolve the instance through the room record.
3. Moderator identity and grants: represent moderators separately from player seats; add explicit, revocable instance grants and narrowly named permissions. The Super Admin role remains a platform-wide root role bootstrapped out of band. Never let a moderator create/upgrade an account or change global security.
4. Branding: a constrained schema for platform and instance display name, logo/icon asset reference, theme palette, and invitation image config. Validate URLs/asset references and colors server-side; retain a safe default brand. No reference-provider assets.
5. URL resolution: `/games` lists active shareable instances; `/games/:slug` describes an instance; `/games/:slug/play` joins a room for that instance; `/super-admin/*` is the root control plane; `/moderator` exposes only assigned scopes. Keep older routes available during a migration window or redirect them explicitly after backward-compatibility review.

This model keeps Regular and Bumper independent in configuration, room history, moderator authorization, and inventories while reusing one tested engine and code path. Tickets remain allocated per room/game round; the instance owns the policy and inventory scope. If the desired meaning is a persistent pool of pre-numbered tickets shared across games, that conflicts with the current server-minted Tambola grids and needs a separate product decision.

### Lifecycle semantics to settle during approved design

- **Pause instance** should stop new joins/room creation. It must not silently freeze an already-running game; active games either finish or a separately authorized room pause occurs.
- **Archive** should hide new public entry and preserve all history. It should not delete rooms, tickets, calls, awards, players, or audit rows.
- **Restore** should re-enable the same instance ID/slug and preserve previous history; slug reuse must be prevented or explicitly redirected.
- **Instance configuration** is snapshotted into each room/game when created or started; later branding/config edits must not rewrite historical outcomes.

## 6. Super Admin and moderator permission model

| Capability | Super Admin | Assigned moderator | Host | Player |
|---|---:|---:|---:|---:|
| Create/edit/pause/archive/restore an instance | Yes | No | No | No |
| Global settings, branding, security, backup status | Yes | No | No | No |
| Create/revoke moderator and grant instance permissions | Yes | No | No | No |
| Read platform-wide health, history, audit, security events | Yes | No | No | No |
| Read assigned instance/room status and eligible winners | Yes | Per grant | Current room only | Own seat/results only |
| Change allowed instance/game settings | Yes | Only explicit settings grant | Room-level host options only | No |
| Start/pause/end/call or reset a room | Yes, audited | Only explicit operation grant | Existing host authorization | No |
| Manage players in assigned rooms | Yes | Only explicit player-management grant | Not currently supported | No |
| See unrelated instance or global player/session data | Yes, as needed | No | No | No |
| Create another Super Admin / modify global security | Yes only via controlled recovery/bootstrap policy | No | No | No |
| Delete audit records or bypass engine | No UI/API permission; audit is append-only | No | No | No |

Every privileged endpoint, controller operation, and Socket.IO action must check the authenticated principal, role, instance grant, and target room’s `game_instance_id` server-side. A route guard in React is only navigation UX. Revocation must be checked against current server-side grants, not a long-lived JWT claim, so it takes effect on the next request/event. Audit actor, instance, room, action, and safe metadata; never record passwords, MFA codes, cookies, raw session tokens, or secrets.

## 7. Security plan and current gaps

### Reuse

- Existing owner password hashing, signed server sessions, session rotation/revocation, TOTP support, MFA challenge records, CSRF checks, login throttling, secure-cookie policy, audit utilities, input validation, CSP/security headers, socket event budgets, and fail-closed persistence/recovery.
- Existing PostgreSQL transaction boundary, per-room serialized writes, one-instance lease, backup manifest, restore-check, health probes, and security probe harness.

### Gaps to close for the requested platform

- Make MFA mandatory for the Super Admin and require moderator MFA before privileged grants become usable; current owner MFA enrollment is optional and password-only sign-in remains possible until enrolled.
- Add role and per-instance grants, immediate revocation, immutable bootstrap/recovery rules for the Super Admin, and no public staff registration.
- Add durable instance isolation to all list/detail/update/history/room create/join/socket code paths. Audit logs and backups must include instance attribution while remaining platform-visible only to the Super Admin.
- Add CSRF-protected Super Admin mutations, session rotation on privilege changes, login throttling shared across instances, and endpoint-by-endpoint unauthorized/other-instance tests.
- Add data retention/export policy and privacy/terms/support content as a pre-public-launch requirement (existing gap report says those legal/product pages are absent).
- Keep the project’s free-to-play boundary enforced in schema/API/UI: no deposits, wagering wallets, stakes, purchases-to-stakes, withdrawals, payment workarounds, or commissions based on gambling stakes. The reference video’s ticket-price UI is not a design requirement for this project.

### Security verification required after an approved implementation

Automate anonymous, player, host, unassigned moderator, assigned moderator, revoked moderator, and Super Admin cases for every privileged HTTP route and socket event. Include cross-instance ID substitution, stale sessions after revoke, CSRF, MFA-required login/enrollment, rate-limit behavior, audit immutability, and backup/restore of instance grants. Run existing full suite and security probe plus new DB-backed isolation tests. A test plan is not evidence of passing tests; report only commands actually run.

## 8. Winning patterns review of current working tree

The committed Phase 18 report and tracked source describe six shipped patterns and list several others as deferred. The existing uncommitted working tree now registers the five requested patterns as optional and off by default, with a shared geometry module and migration 005 to persist winning-ticket attribution. Definitions currently in that work are:

| Pattern | Working-tree definition | Static-review concerns / approval |
|---|---|---|
| Early Seven | Any 7 of one ticket’s 15 numbers; completion ordinal is the seventh hit; proposed points 25 | Exact predicate is clear. Points/default exposure remain product decisions. |
| Star | Four outermost numbered cells of top/bottom rows plus the middle row’s third filled number; proposed 25 | This is corners plus a row-position-based centre number, not necessarily literal column 5. Approve exact diagram and name. |
| Second Full House | After a first Full House award, another ticket may claim all 15; the first winning ticket is excluded; proposed 15 | Current engine only accepts claims while `RUNNING`; round still ends by existing lifecycle. Decide whether the game must remain open for this prize and how ties/near-simultaneous claims are ordered. |
| Half Sheet | A seat with at least 3 tickets wins when each of 3 tickets has at least 2 called numbers; completion is the third ticket’s second-hit ordinal; proposed 20 | This is a seat-scoped interpretation for independently dealt tickets, not a universally settled meaning. Approve exact semantics and attribution. |
| Box | All numbered cells in the ticket’s middle three columns; proposed 25 | Other uses of “Box” exist. Approve the column diagram and distinction from Corners. |

Migration 005 adds nullable `ticket_no` and `ticket_nos` to award history to preserve attribution through recovery. The working code also adds pattern catalog/diagram payloads and eligibility state, configuration only before round start, and new durable award metadata. These changes are not in `HEAD`; added tests exist but were not executed here. This is a static inspection only, not a claim that these patterns pass tests or have been approved. `server/game/patterns.js` and `server/game/proposed-patterns.js` cite `docs/NEW-WINNING-PATTERNS.md`, but that file is missing in the working tree, so the evidence/approval record is incomplete.

Before merging or extending this work, review the entire dirty diff together, supply the missing rule paper, obtain explicit approval of definitions/points/defaults/game-completion behavior, run the focused tests plus full in-memory and durable suites, and confirm the migration/recovery path against both fresh and previously migrated databases. Do not reset, stage, or overwrite the user's existing changes during the platform-owner work.

## 9. Implementation breakdown (not started)

This work is separate from the paused roadmap. The sequence below is a proposal for approval, not authorization to begin Phase 19.

1. **Scope and decisions:** confirm the Super Admin identity bootstrap policy, moderator permissions, guest/account policy, instance pause/archive semantics, branding fields/assets, legacy route migration, data retention, and whether tickets mean per-round generated grids or a persistent inventory. Record decisions before schema changes.
2. **Instance data layer:** additive migration for `game_instances`, room-instance ownership, instance config/branding, moderator grants, explicit role constraints, and indexed foreign keys. Preserve current room history and recovery; include rollback/backup planning without destructive rewrites.
3. **Server authorization and API:** instance CRUD/lifecycle endpoints; assigned-moderator routes; instance-scoped room creation, listing, player join, history and player management; central authorization helpers used by both HTTP and socket operations. Keep all engine mutations on existing controller paths.
4. **Super Admin and moderator UI:** dedicated sign-in-protected control plane, instance dashboard and share URL copy, moderator grant/revoke, per-instance configuration/branding, system health/history/audit/backup views. A hidden route is never accepted as an access control.
5. **Player routing and branding:** `/games/:slug` and `/games/:slug/play`, safe dynamic branding, mobile responsive layouts, and compatible legacy route handling. Do not change the current ticket/caller engine contract without a demonstrated requirement.
6. **Security and durable tests:** migration/recovery, RBAC matrix, revocation, CSRF/MFA, all privileged route and socket denials, cross-instance isolation, player join/ticket/reconnect, audit, backup/restore, and existing gameplay regressions.
7. **Release evidence:** update API/architecture docs, README, CHANGELOG, TEST-REPORT, security report, reference feature matrix, and a staged rollout/rollback plan. Do not deploy, purchase, activate paid services, commit, or push without a later explicit instruction.

### Approval gate

No implementation beyond this investigation is included. Before proceeding, the owner should approve the scope and decisions in steps 1–2, and either provide screenshots/a corrected public certificate for the reference routes or accept the “not observable” evidence state above. Phase 19 and later roadmap phases remain paused.

## 10. Verification record

- Repository status, branch, remote, HEAD, recent history, file inventory, phase documents, current route tree, database migrations, admin APIs, socket contract, and dirty diffs were inspected.
- Public fetch attempts were made for all six supplied reference URLs; all failed to return page content. Browser navigation to the HTTPS root failed on the certificate name mismatch. HTTP `/` returned LiteSpeed 404.
- The supplied YouTube video was opened in a public browser and sampled at several positions. Captions appeared after playback began; the full runtime was not watched.
- No tests, builds, database migrations, destructive operations, code implementation, commit, push, deployment, or payment actions were performed.
