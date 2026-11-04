# Moderator authentication and instance authorization

Moderators are a separate principal from players, hosts, and Super Admins. There is no public registration. A Super Admin provisions an account at `POST /api/admin/moderators`; the API returns a one-time invite token. Deliver that token through an approved private channel. The moderator accepts it at `POST /api/moderator/invite/accept` and chooses a password of at least 12 characters. The token is stored as SHA-256 only, expires after 72 hours, and is single-use.

Passwords use the same scrypt implementation as owner accounts. Moderator sessions store only SHA-256 token digests, use an HttpOnly, SameSite=Strict cookie, slide to a 12-hour idle expiry, and have a 7-day absolute expiry. Production cookies are Secure. Every request reloads account status from PostgreSQL. POST requests use a double-submit CSRF token. Sign-in uses shared durable username+IP and IP throttles; MFA challenges expire in five minutes, allow five attempts, bind to the originating IP hash, and are single-use. TOTP secrets are encrypted with the configured owner MFA key. If that key is unavailable, enrollment fails closed and grants cannot be used until MFA is enrolled.

Moderators sign in at `/api/moderator/signin`; enrolled accounts complete `/signin/mfa`. First sign-in is followed by `/security/mfa/enroll` and `/security/mfa/confirm`. Sign out revokes the server session. Rotation is available at `/session/rotate`. Super Admin suspension revokes sessions in the same transaction; account state is checked on every request and socket event. A grant update or revocation is re-read from the database for each operation, so it applies immediately to existing sessions and sockets.

## Permission matrix

| Permission | Effect |
|---|---|
| `instance.read` | Defined; current assigned-instance response is permission-filtered at assignment level. |
| `instance.settings.update` | Update only the instance description (maximum 500 characters); identity, ownership, security and lifecycle fields are not writable. |
| `room.create` | Create a room in an active assigned instance. |
| `room.read` | List rooms and read room status/detail. Detail omits members, tickets, and history unless their separate permissions are granted. |
| `room.start` | Start an eligible room in an active assigned instance. |
| `room.pause` | Pause or resume an eligible room. |
| `room.end` | End an eligible room. |
| `room.reset` | Reset an eligible room through the existing controller lifecycle. |
| `players.read` | Read the instance player directory and room member details. |
| `players.manage` | Remove a member from an eligible non-completed/non-closed room through the controller; membership and history rows are retained. |
| `tickets.manage` | Controls whether ticket details are included in room detail. Ticket mutation is unsupported: tickets are generated/selected server-side per game and there is no justified moderator inventory operation; no mutation endpoint exists. |
| `bookings.read` | Read scheduled reservations for the granted instance, including display name, status, count, allocation state and reservation activity. Booking secrets are never returned. Room codes are included only when `room.read` is also granted. |
| `bookings.manage` | Cancel an unassigned held/confirmed reservation in the granted instance. Assigned reservations cannot be cancelled or re-assigned by a moderator. Does not grant room lifecycle, scheduling, room attachment, player impersonation, or ticket mutation. |
| `bookings.assign` | Read scheduled-session availability and attach an unassigned session to one eligible waiting room in the granted instance. Requires `room.read` as well as `bookings.assign`; assignment is atomic, audited, and cannot be moved by a moderator afterward. It does not grant cancellation, scheduling, player assignment, or ticket mutation. |
| `history.read` | Read room/game history and history sections of room detail. |
| `reports.read` | Read instance-scoped operational summary aggregates. |

Unknown permissions and duplicate permission entries are rejected. Provisioning defaults to no grant. A grant binds one moderator to one instance. Room authorization resolves `rooms.game_instance_id` from PostgreSQL, checks current account and grant, and then checks lifecycle constraints. Client-supplied role, permission, instance and room ownership claims are ignored. Cross-instance room identifiers receive a non-enumerating not-found response.

Migration `013_booking_moderator_ops.sql` added read/cancel permissions without changing existing grants. Migration `020_moderator_booking_assignment.sql` adds the separate assignment permission without altering stored permission arrays or granting it to existing moderators. Migration `021_preserve_booking_audit_assignment.sql` preserves both the established player `hold.assign` event and moderator `session.assign_room` event in the immutable audit constraint. Super Admin must explicitly add each permission to an instance grant. Every booking request rechecks the active account, unexpired session, enrolled MFA and current grant. Read, assignment and cancellation actions are append-only audited.

## API contract

Owner-only endpoints under `/api/admin/moderators`:

- `GET /` and `GET /:moderatorId`: account state, assignments, active sessions, and recent audit activity.
- `POST /`: provision an invitation; optional initial instance grant must be an explicit permission list.
- `PATCH /:moderatorId/profile`: update username.
- `PATCH /:moderatorId/status`: suspend/reactivate; suspension revokes active sessions atomically.
- `POST /:moderatorId/sessions/revoke`: revoke every active session.
- `PUT /:moderatorId/grants/:instanceId`: replace that instance's explicit permission set (empty is valid).
- `DELETE /:moderatorId/grants/:instanceId`: revoke an active grant.

Moderator endpoints under `/api/moderator` include session status, invite acceptance, recovery completion, sign-in/out, MFA enrollment/confirmation, session rotation, socket-ticket issue, assigned instance and room listing, safe description update, room detail, player list/detail/removal, history, instance report summary, room creation, room start/pause/resume/end/reset, instance booking list/detail and unassigned reservation cancellation. `GET /instances/:instanceId/bookings/sessions` requires `bookings.assign`; `PUT /instances/:instanceId/bookings/sessions/:sessionId/room` requires current `bookings.assign` and `room.read`. The server verifies session and room ownership, lifecycle, ticket limit and one-session-per-room uniqueness in one transaction. Booking endpoints require a live moderator session, enrolled MFA, and the current permission. The socket ticket is single-use and expires in 90 seconds.

## Socket contract

Moderators connect through the existing Socket.IO endpoint using `auth.moderatorTicket` obtained from `/api/moderator/socket-ticket`. They do not join gameplay rooms and cannot invoke player/host events. Separate acknowledged event names are `moderator:room:start`, `pause`, `resume`, `end`, and `reset`, each with `{ roomId }`. Every event revalidates active session, MFA state, room-to-instance relation, current grant, and permission. Unauthorized commands return `{ ok:false, code, error }`; no gameplay room broadcast is delivered to moderator sockets.

## Audit, recovery, and limitations

Provisioning, profile/status changes, session revocation, grants, invite acceptance, recovery outcomes, sign-in outcomes, MFA events, and successful moderator room operations are recorded in append-only `platform_audit`. Audit payloads omit passwords, raw tokens, cookies, MFA codes, and TOTP secrets. The database trigger rejects ordinary UPDATE/DELETE attempts. Moderator tables are included in standard PostgreSQL backup/restore; the MFA key must be backed up separately. A restored database with a different or missing key cannot decrypt enrolled TOTP secrets.

Recovery is owner-initiated through the Super Admin moderator recovery endpoint. The account is suspended, all sessions and socket tickets are revoked, and a random 30-minute single-use token is returned once for out-of-band delivery. Only its SHA-256 digest is persisted. Completing recovery changes the password, clears the prior authenticator, consumes the token, reactivates the account and requires MFA re-enrollment before privileged access. There is no verified email or self-service lost-authenticator channel; the owner must deliver the token privately and must recover a lost owner account through the documented offline owner procedure. WebAuthn and recovery codes remain future work.

`/moderator/bookings` provides the MFA-protected operations workspace for room lifecycle, player lookup/removal, bookings, scheduled-session assignment, history, instance summaries, and the description field. Its tabs follow the selected instance grant; the server still rechecks every permission and room-to-instance relation. Only the player can consume a confirmed reservation using its one-time secret, which prevents moderators from impersonating a player. Ticket mutation remains unsupported because grids are generated by the game engine. Existing player and host workflows derive authority from server-side room-bound sessions. Super Admin routes remain globally scoped by design. The manual review and its coverage limits are recorded in `docs/SECURITY-THREAT-MODEL.md`; it is not an independent L3 review or production approval.

## Super Admin moderator management UI (1 November 2026)

The owner can manage moderators at `/admin/moderators` or `/super-admin/moderators`: provision with no implicit access, choose explicit instance permissions, inspect account/MFA/session/grant/activity state, edit or revoke grants, suspend/reactivate, revoke sessions, and issue one-time recovery. Tokens are held only in transient page state. Existing backend routes retain audit, owner session, MFA, CSRF, and transaction semantics. Invitation acceptance, credential recovery, moderator sign-in/MFA, and the permission-adaptive operations workspace are implemented. Authenticated browser acceptance of these surfaces remains open.
