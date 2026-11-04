# Ninety Club role architecture

Updated 5 November 2026. Policy is derived from `docs/COMPLETE-PRODUCT-REQUIREMENTS.md`: instance data is tenant-scoped; global platform operations are reserved for Super Admin; instance-specific Admin operations are a planned but not yet provisioned role. This implementation preserves that boundary and uses least privilege where no grant model exists.

## Implemented hierarchy and scope

| Role | Provisioning | Scope and allowed operations | Prohibited operations / limits |
|---|---|---|---|
| Super Admin | Separate account created by the offline `super-admin:create` CLI workflow, or explicitly promoted by `super-admin:promote <username>` with typed confirmation. Role changes revoke all sessions and are transactionally audited. | Platform-wide operations: instances and lifecycle, games/rooms, global reports/history, branding/themes/posters, booking administration, moderator/grant administration, health and backup status. Requires a live account session and confirmed MFA on every privileged API request; mutations also require CSRF, rate limits, validation and audit. | No account is automatically elevated. UI route names and client payloads cannot grant the role. No Socket.IO game privilege is derived from this role; platform work uses the authenticated API.
| Owner | Existing `owner:create` bootstrap creates role `owner`; existing accounts remain Owner after migration 029. Password/MFA maintenance is supported through the account settings and offline recovery CLI. | Own credentials, MFA enrollment, and own account/session status. No instance assignment model exists yet. | Cannot use platform APIs, list other accounts, inspect global health, operate booking or game data, manage Moderators, or see backup status. Cannot promote itself or create another role through HTTP.
| Admin | No provisioning/grant model yet. Product requirements describe instance-specific operations as proposed. | None until an explicit instance-scoped grant model and capabilities are approved and implemented. | `/admin` is not an identity. A route, username, or Owner account does not imply Admin access. No new Admin permissions are invented here.
| Moderator | Super Admin invitation with explicit `moderator_instance_grants`; no implicit grants. | Listed permissions within each explicitly granted instance; room actions additionally resolve the room's owning instance. MFA, live session, current grant and lifecycle are rechecked for HTTP and moderator Socket.IO operations. | Cannot access an ungranted instance/room, grant itself rights, or use Host/Player game-event namespaces. Foreign resource identifiers are masked.
| Host | Created through the room/game flow; room-bound host session. | Host lifecycle/call controls for its authorized room, enforced against server-side room session state. | Cannot operate another room or become Owner, Admin, Super Admin, Moderator, or Player by changing payloads.
| Player | Guest join flow; seat credential bound to one room and player. | Own seat/ticket state, marks and claim submission; eligibility and settlement are server-authoritative. | Cannot host, use operator/moderator APIs, submit a forged claim verdict, or cross room/seat boundaries.

## Tenant, instance and room boundaries

`game_instances` is the current tenant boundary. Moderator grants persist per moderator and instance. Room authorization resolves the room's instance and validates it against the active grant. Owner accounts currently have no instance assignment relation; consequently Owner receives only own-account access. Admin per-instance operations stay unavailable until a durable grant, action list, provisioning/revocation flow and audit policy are implemented.

## Server enforcement and escalation controls

- Owner session verification resolves the persisted role from the account row for every request; role is not copied from browser state or trusted from a header.
- Global admin, moderator-management, platform branding/theme/poster, health/backup, and booking APIs require `role=super_admin`. Privileged Super Admin APIs also require a confirmed MFA enrollment. Owner APIs return `403 FORBIDDEN` (or `MFA_REQUIRED`) and record denial events.
- In production, an un-enrolled Super Admin session can read only its own account/security settings to enroll MFA. It cannot read other account identities, platform origin/defaults/runtime/health/backup data, or any global API. The settings payload and UI remain self-only until MFA is enrolled; each platform API rechecks role and enrollment on every request.
- Owner settings disclose only the signed-in Owner, its own active-session count and its credential/MFA state. Global owners, health, invitation origin, platform defaults, and backup status are withheld from Owner accounts.
- `owner:create` always creates a non-elevated Owner. Super Admin creation/promotion exists only in the server-side CLI; no HTTP endpoint accepts roles. Promotion revokes active sessions within the same database transaction as the role change and writes an audit event.
- Migration 029 adds the explicit role column with existing accounts defaulted to `owner`; it never promotes existing records. Super Admin identity uses the same hardened password/MFA/session machinery but is a separate persisted account/role.
- Host, Player and Moderator tokens remain separate identity types. Socket.IO event authorization is server-side. Moderator sockets use one-time tickets, refuse host/player namespaces and recheck current MFA, session, instance, room and grants for each operation.

## Provisioning, revocation and audit

- Create a non-elevated Owner with the documented bootstrap CLI. Its public HTTP session cannot administer platform data.
- Create a new Super Admin using `node scripts/owner.js super-admin:create`, or promote an existing Owner with `node scripts/owner.js super-admin:promote <username>` and the exact interactive confirmation. Revoke that authority with `node scripts/owner.js super-admin:demote <username>` and its exact typed confirmation. Use an explicitly selected local/staging database; these commands do not imply production authorization. Role changes invalidate all active sessions; the next sign-in must complete MFA before platform operations. Role changes and bootstrap are audited transactionally; the last Super Admin cannot be demoted or removed.
- No separate Admin role is provisionable. Moderator grants are explicit allowlists and revocation/suspension invalidates sessions/socket tickets.
- Platform audit rows use `super_admin` for platform operations and `moderator`/`system` where applicable. Migration 028 permits Owner attribution for future instance-scoped Owner features and retains historical rows unchanged. Role bootstrap/promotion is recorded in the Owner audit ledger.

## Remaining product/security decision

The requirements identify Super Admin as global and propose instance-specific Admin operations, but do not define an Owner-to-instance ownership relation or the Admin capability list. This implementation therefore limits Owner to its own account and leaves Admin unprovisionable. Before enabling Admin or instance-scoped Owner access, define permitted operations, instance assignment, invitation/approval, revocation, MFA, audit and recovery policy. Do not grant these roles by default.

## Role revocation lifecycle update — 5 November 2026

Role changes and account removal now lock the account rows in a transaction, refuse to remove/demote the last Super Admin, revoke active sessions, and append an `admin_audit` event with from/to roles and revocation count. New bootstrap creates are also audited. The offline CLI has explicit `super-admin:demote <username>` with exact typed confirmation. Memory and PostgreSQL regression coverage verifies last-admin protection; PostgreSQL tests verify promotion/demotion audit rows and session revocation.

Production-mode Chrome on isolated schema `rolebrowser` verified a separate Super Admin role, required MFA challenge and platform reads, plus Owner denial and logout revocation. See the Chrome report for exact route and HTTP evidence. The implementation intentionally does not provision an `admin` role because product requirements do not define its instance-scoped capabilities or grant lifecycle.
