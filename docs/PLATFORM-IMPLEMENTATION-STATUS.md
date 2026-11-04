# Platform implementation status

Date: 1 November 2026
Base: `6341f621f47e16b35ce5e2f27144f7854d6d5fec` on `main`
Implementation state: moderator authentication and scoped operational APIs added; complete isolation criteria and independent security review remain open.

## Platform implementation refresh (1 November 2026)

The current product includes the public Regular/Bumper instance paths, shared authoritative game engine, owner control plane, explicit moderator RBAC, booking reservation/allocation, reviewed theme and poster catalogs, per-instance identity, runtime platform branding, and English/Hindi player and caller journeys. The current build remains an active implementation with meaningful verification gaps; this summary does not imply launch readiness.

### Verification refresh (1 November 2026)

- The full serial PostgreSQL suite passes **663/663** with migrations through 021; the memory-only suite passes **597**, with 44 database-only skips. Root/client audits report 0 vulnerabilities; lint, production build, secret scan and CRLF-aware diff check pass.
- Migration 020 introduces `bookings.assign`; migration 021 preserves both `hold.assign` and `session.assign_room` audit actions. The full serial suite now covers migrations 001–021. Focused assignment checks pass **2/2**, authenticated assignment UI permission checks pass, and an authenticated read-only recheck of the retained cancellation fixture passes.
- Public directory, hall, sessions, booking, owner/admin, moderator, theme, poster, gameplay, and booking allocation/reconnect workflows have real or explicitly mocked browser evidence as detailed in `TEST-REPORT.md`. Moderator English/Hindi operations localization and an authorized durable cancellation are now browser-verified.
- Live-game keyboard coverage now verifies Enter claim activation, modal focus trapping, Escape/Enter dismissal and focus return. This is a focused check; physical-device, broad screen-reader/keyboard, long-soak, exhaustive identifier-fuzz and independent L3 review are still open.
- Retained booking fixtures remain in isolated schemas under the owner's keep-until-policy instruction. No production deployment, purchase, DNS change, secret rotation, commit or push occurred.

- **Runtime platform branding:** owner-managed `/admin/branding` backed by `platform_settings.branding`; curated local assets, strict text/color/HTTPS validation, public read API, audited owner mutation, active theme/instance palette precedence. Durable owner-browser verification passed; the 390 px landing overflow found during that review was fixed. Full results are in `TEST-REPORT.md`.
- **Brand metadata continuity:** the Vite build, page title/social metadata, owner asset pickers and public install manifest now follow configured branding; owner-saved platform branding remains authoritative over build fallbacks. Focused metadata/API tests and custom-brand/default builds pass.
- **Booking browser:** owner created a Regular room/session; a player reserved three tickets, received a server-generated allocation and was refused a duplicate replay. Durable refresh/reconnect restores the same player and grids. Authenticated moderator list/detail, denial without `bookings.manage`, and authorized cancellation are verified in separate retained fixtures.
- **Current safe gates:** 663 full PostgreSQL tests pass through migration 021; memory-only suite has 597 passing tests and 44 database-dependent skips; security probe 51/51; root/client audits, lint/build/secret scan pass. These do not replace physical-device testing, a long soak or independent security review.
- **No production action:** no deployment, purchase, DNS modification, production secret change, commit or push was made.

## Decision record

- Reuse the existing engine, persistence controller, owner identity, CSRF/session protections, process lease, and room lifecycle.
- Create durable IDs `regular` and `bumper` for the first two products. Instances remain ordinary rows; application logic does not assume there are exactly two.
- Migrate historical rooms to hidden archived `legacy`. The old data does not identify which product created each room, so assigning them to Regular or Bumper would be invented history.
- New direct host rooms default to Regular. Super Admin room creation selects any active instance. The room foreign key is permanent; a database trigger blocks reassignment after game start.
- Pausing/archiving blocks new rooms and player joins. Existing running games continue. Archiving retains records and restoring reactivates the same ID and slug.
- Keep free-to-play rules and server-issued per-round tickets. No payment or persistent shared ticket pool is added.

## Current implementation map

| Area | Current state |
|---|---|
| Schema | Migrations 006–010 create instances, room ownership, moderator/grant/session/invite/MFA/socket-ticket/recovery tables, platform audit/settings tables, ownership protection, and a Legacy insert default. |
| Owner API | `/api/admin/instances` and `/api/admin/moderators` support instance and moderator management behind existing owner auth, mutation throttling, and CSRF. Public active directory reads exist at `/api/admin/public/instances`. |
| Owner UI | `/super-admin/instances` and legacy `/admin/instances` can create, pause, archive, restore, and inspect persisted counts. |
| Room creation | Owner UI selects an active instance; ordinary host creation uses Regular. Paused/archived instance join and create requests fail closed. |
| Game engine | Existing single engine and persistence controller remain in use. Five optional winning patterns are preserved. |
| Moderator identity | Separate scrypt passwords, one-time hashed invites, hashed server sessions, TOTP, CSRF and durable rate limits. |
| Moderator authorization | Explicit instance grants checked against current database account, grant, room ownership and lifecycle for moderator HTTP routes and socket events. |
| Moderator operations | Scoped room/player/history/settings/report/booking APIs; safe settings allowlist, auditable player removal and owner-mediated recovery. Permission-adaptive `/moderator/bookings` workspace provides room/player/history/report/settings and booking views; explicit grants, MFA and audit remain required. No ticket mutation API. |

## Task tracker

### Completed and verified

- [x] Reconciled HEAD, branch, remote, working-tree state and current optional-pattern commit.
- [x] Applied the additive migrations to the local PostgreSQL database; added corresponding throwaway-schema coverage.
- [x] Seeded Regular, Bumper and Legacy idempotently.
- [x] Added required room ownership and legacy-compatible insert behavior.
- [x] Enforced pause/archive join/create restrictions and protected active room ownership.
- [x] Added the first owner instance-management API and UI.
- [x] Ran serial test suite, both gameplay E2E paths, security probe, lint, build, secret scan, dependency audits and restore checks (results in `TEST-REPORT.md`).

### Implemented in security milestone

- [x] Moderator invitation acceptance, sign-in/out, MFA, sessions, suspension and revocation.
- [x] Super Admin moderator list/detail/provision/profile/status/session/grant endpoints.
- [x] Instance-scoped room, player and history reads plus room operations and moderator Socket.IO namespace.
- [x] Grant revocation applies to the next HTTP/socket operation; moderator sockets receive no gameplay broadcasts.
- [x] Regular/Bumper/Legacy recovery and foreign room/player checks; synthetic moderator backup/restore drill with consumed/revoked records.
- [x] Scoped settings, player removal, history and reports; per-operation permission and instance checks.
- [x] Security details and permissions documented in `server/MODERATOR-SECURITY.md`.

### In progress / incomplete

- [ ] Complete exhaustive Cartesian identifier fuzzing for all applicable endpoints; direct moderator lookup routes for tickets, games, claims, awards and player/host sessions do not currently exist.
- [x] Moderator booking/operations UI, English/Hindi localization, MFA, invitation/recovery paths, and authenticated booking cancellation are browser-verified.
- [x] Database-backed platform and instance branding, safe curated asset references, runtime theme resolution and published poster snapshots.
- [x] Public `/games`, `/games/:slug`, and instance-bound player join/reconnect contracts; real browser checks cover matching and foreign-instance joins.
- [ ] WebAuthn/recovery codes, additional owner password-management workflows, broad identifier-fuzzing, and further operational dashboards.
- [ ] Platform-wide dashboard metrics, recent activity, backup state and global security views based on actual data.
- [ ] Browser/mobile verification of the new product surface and independent L3 review; deployment settings and MFA encryption key escrow must be checked on the target host.
- [ ] Update remaining operations, API and moderator/security documentation after those features are implemented.

## Security and release statement

The moderator API and core multi-instance isolation are implemented and covered by automated tests, but the exhaustive Cartesian identifier campaign and independent L3 review are not complete. Moderator and player-facing UIs are present and have scoped browser evidence, while broad screen-reader/physical-device testing, long soak and target-host confirmation remain open. The public directory returns only active, public instance identity fields; room codes are not exposed as a public directory. The control centre remains under active implementation and this work is not production-ready. No deployment, push, or external service action was performed.

## Super Admin health visibility (2 November 2026)

The owner overview and owner-only `/api/admin/health` now surface a bounded projection of readiness, migrations, database, lease, draining, room recovery, scheduler, pool and uptime signals. Authenticated Chromium verified the health section at 390/1440 px with zero axe violations, no overflow or unnamed controls, and no browser errors. The full serial PostgreSQL suite passes 677/677 with both backup/restore checks. Production-host alert delivery, thresholds and provider/account compatibility remain unverified; do not treat this local dashboard as external monitoring.

## Verification update — recovery integrity (2 November 2026)

The latest full serial PostgreSQL suite passes **666/666**, 20 suites, 0 failures/skips/todos, through migrations 001–021, including both backup/restore checks. This supersedes the earlier 663/663 line above. A new six-case table-driven regression covers reservation-to-seat recovery links; the durable regression verifies fail-closed freeze, preserved booking history, and successful recheck only after an authoritative repair. The run used and removed a fresh PostgreSQL 17.11 container. The wider platform remains in progress; this check does not close other lifecycle-corruption, broad security, accessibility, target-host or soak gates.

## Verification update — post-reset recovery (2 November 2026)

The latest serial PostgreSQL run passes **669/669**, 20 suites, no failures/skips/todos, migrations 001–021, including backup/restore. Recovery now handles a cold restart after `COMPLETED → WAITING` by validating the prior game as retained history and hydrating a clean waiting projection; room/game lifecycle mismatches fail closed. The fresh PostgreSQL 17.11 container was removed. Client lint/build, secret scan and root/client dependency audits pass. Broader claim/award corruption checks and the platform acceptance gaps above remain open.

### Final reset-recovery verification refinement (2 November 2026)

After adding a two-to-one waiting-room ticket-selection scenario and corrupt prior-award refusal, the latest full serial PostgreSQL suite passes **670/670** across 20 suites, with no failures/skips/todos. Both backup/restore checks ran. Client lint/build, secret scan and root/client dependency audits pass. This supersedes the 669/669 result above; the active platform and remaining release gaps are unchanged.

### Award recovery relationship validation (2 November 2026)

Recovery now verifies persisted award patterns, scores, winners, call indexes, ticket ownership, and ordinal continuity while retaining support for legacy nullable attribution. Fresh disposable PostgreSQL verification passed **672/672** across 20 suites and both backup/restore checks. The local moderator cancellation browser action remains pending because the CUA bridge could not initialize; no retained booking or audit rows were changed.

### Owner overview activity and backup status (2 November 2026)

The owner dashboard now exposes recent audit activity from both owner and moderator platform logs, plus a bounded backup summary showing whether the newest manifest and restore check are valid. Full PostgreSQL verification passes **673/673** with both restore drills; client lint/build, audits and secret scan pass. The broader product remains in progress. The separate approved moderator cancellation was not submitted because Windows browser automation failed during initialization; the retained local fixture remains unchanged.

### Independent room defaults per instance (2 November 2026)

Instance configuration now persists owner-managed defaults for maximum room seats, ticket limit, auto-call interval and automatic calling. Room creation reads the durable owner instance and applies those values before room state is persisted. Validation is strict and changes are audited; a previous room remains unchanged after an instance default update. Disposable PostgreSQL tests prove the API, isolation and inheritance behavior. The full suite passes **675/675**, with final focused durable verification passing. Product and launch scope remains in progress.

### Recovery and booking retention verification (2 November 2026)

The isolated booking backup test now inspects the restored reservation and ordered audit contents field-for-field, then removes its scratch database and schema. Recovery also rejects invalid or contradictory game start/completion timestamps before hydrating a room. The combined focused recovery/persistence/booking run passed **31/31**, with no skips; no scratch schema or restore database remained. The broad suite was not rerun in this focused change.

The complete serial PostgreSQL regression was rerun on fresh disposable PostgreSQL 17.11 through migration 021 after recovery and booking-restore hardening: **678/678 passed**, 20 suites, no failures/skips/todos. The disposable container was removed and the retained booking container on 55437 remains untouched.

### Schema-scoped lease and migration documentation reconciliation (2 November 2026)

The operational docs now match the actual schema-derived advisory lease and schema-scoped migration ledger; the current checked-in chain ends at 021. A new real-database test proves separate deployment schemas can hold independent leases in one PostgreSQL database while duplicate same-schema ownership is refused. The full serial suite passes **679/679**, 20 suites, without failures/skips/todos on disposable PostgreSQL 17.11. The disposable container was removed; retained booking data was untouched.

## Current-worktree verification correction (2 November 2026)

The newer full serial suite supersedes the older 663/663 result above: `npm test` passed **694/694** on a fresh disposable PostgreSQL 17.11 database migrated through 021, 20 suites, no failures or skips, in **11,116.6 ms**. The expanded moderator identifier isolation test passed **1/1**. Lint/build, security probe **51/51** and secret scan **401 files** pass. Root/client audits were last recorded at zero vulnerabilities earlier the same day, not rerun in this latest closeout.

The most recent two-hour load attempt failed its heartbeat gate (250 client disconnects, child/wrapper exit 1); Windows Modern Standby overlapped the run. A guarded rerun ended at approximately 90 seconds with its local runner session, and the isolated task container exited 255 and was removed. There is no accepted long-soak pass and no soak currently running. Festival redesign remains queued. Full screen-reader/device checks, manual contrast, independent L3 review and target-host validation remain open.
