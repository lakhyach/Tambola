# Admin-Controlled Game Operations

This guide describes the controls present in this repository at the time of writing. A control is not evidence that a complete workflow is available; gaps are called out explicitly. Do not use this guide as evidence that production was tested or changed.

## Current owner workflow

1. Sign in at `/admin/signin` with the existing owner account and MFA, if enrolled. The sign-in screen links back to `/`.
2. Open **Scheduled sessions** at `/admin/sessions` and choose the active game instance. The instance determines the game family (for example Regular or Bumper).
3. Create a session draft with its title, scheduled start (`datetime-local`), IANA timezone, booking-open and booking-close instants, capacity, selected supported winning patterns and point rewards, and the per-session auto-start opt-in. Leave **Waiting room code** blank to have the owner-only server workflow create a room and return its generated code, or enter an existing waiting room code from the same instance.
4. Submit **Create and generate tickets**. The owner-only `POST /api/admin/instances/:instanceId/sessions` route creates the room, host seat, room schedule, linked session, session audit, and session-specific pattern configuration on the same PostgreSQL transaction connection. It returns the generated room code after commit. Room-code primary-key collisions are retried inside savepoints; other database failures roll the transaction back. The live room is published to the process registry only after commit. The browser then supplies an idempotency key to the inventory endpoint; the server generates and persists the official numbered inventory. The UI reports completion only when the server confirms the requested count.
5. Open **Inventory** to browse persisted tickets, actual grids and assignment/booking status using search, filters and pagination. The inventory endpoint is owner-protected.
6. Publish the draft when ready. The public schedule is based on published sessions and persisted availability. The public booking endpoint allocates tickets transactionally; it does not trust the browser’s availability display as authority.
7. Use **Posters** at `/admin/posters` to select a real scheduled session, compose its artwork and publish a poster. The poster date, time, timezone, title and join URL now come from the selected session; edit the session under Scheduled sessions if its schedule needs to change.
8. Share the displayed room code only with intended players; the booking join path requires a confirmed reservation and private booking token. Players see their persisted tickets when they enter the waiting room. The waiting room shows a server-time-adjusted countdown for a linked published session and keeps waiting for an authoritative server or host start.
9. Use the owner game pages for calls, claims and awards. Claims are evaluated against the linked room's synchronized session pattern config and the server's called history; review persisted winner/claim records after play.
10. The booking pane subscribes with a short-lived, single-use owner-issued Socket.IO ticket. Change events carry only instance/session IDs; the dashboard refreshes the authenticated reservation and ticket APIs for the actual player-ticket mapping. A 20-second reconciliation refresh recovers event loss and hold expiry while the pane is open.

## Policy and remaining boundaries

- Production forcibly disables public Socket.IO `room:create`, even if the legacy `allowPublicHosting` opt-in is set. That switch remains a non-production demo/test convenience. Owner creation stays behind owner sign-in and CSRF protection. The existing moderator `room.create` flow remains available only when the moderator has that instance permission, and the moderator booking assignment path still requires its assigned permissions.
- A generated room and its session are created atomically in one database transaction. Failure-injection tests cover room insert, session insert, room association, pattern persistence, commit failure, and room-code collision retry. A network response can still be lost after commit; check **Scheduled sessions** and **Games** before retrying. The migration does not change prior checksums.
- Session rules/rewards are persisted in `game_sessions.winning_patterns` (migration 034); NULL preserves the existing linked room rules for legacy sessions. Before a session starts, owner edits synchronize the durable and in-memory room pattern map. The existing server rule definitions, claim exclusivity, and award persistence remain authoritative.
- Booking change notifications cover hold creation, confirmation, cancellation, and player assignment. Expiration and any missed event are reconciled by authenticated API refresh while the admin page is open; no database polling worker or external queue is introduced.
- The waiting-room route exposes the countdown for a public linked session and never starts a game client-side. Once the game starts, the player is moved to `/player/game`; that in-game view does not continue showing a countdown.
- No room, booking, player, ticket or winner was created in production. No production migration, image, deployment or remote configuration was inspected or changed.
- No real booking, room, player, or winner is created for this guide. A production QA run requires an isolated environment and consenting test accounts.

## Poster workflow details

The composition library, desktop/mobile preview and public poster use `PosterArt`. Library choices update the main preview. When a scheduled session is selected, its persisted start instant and IANA timezone are authoritative; date/time are shown read-only in the poster form. Artwork generation, when configured, produces background art only; editable event facts remain rendered as text by the application.

## Verification matrix

| Test ID | Scenario | Expected result | Actual result | Status | Evidence |
|---|---|---|---|---|---|
| OPS-01 | Owner-authorized session API creates a draft | Missing auth/CSRF is rejected; authorized creation persists a private draft | Passed in the isolated PostgreSQL full suite | PASS | `tests/bookings.test.js` |
| OPS-02 | Generate a configured numbered inventory | Server persists the full requested count; same-key retry is idempotent | Passed atomic generation, full inventory and retry integration tests in isolated PostgreSQL | PASS | `tests/ticket-inventory.test.js`; `tests/ticket-generation-scale.test.js` |
| OPS-03 | Concurrently reserve one ticket twice | At most one active allocation succeeds | Passed concurrent reservation/allocation integration tests in isolated PostgreSQL | PASS | `tests/ticket-inventory.test.js` |
| OPS-04 | Public schedule countdown | Uses published session start and server time, refreshes without drift | Existing landing component inspected; browser test not executed in this task | BLOCKED | `client/src/App.jsx` |
| OPS-04B | Player waiting-room countdown | Uses persisted start, timezone, server timestamp; refresh/reconnect recover; client never starts the game | Isolated PostgreSQL API test passes; real-browser QA remains blocked | PASS (API) | `client/src/PlayerRoom.jsx`, public room-session API |
| OPS-05 | Admin booking monitor after a booking | Authorized push event triggers refetch; reconnect, expiration and missed events reconcile from APIs | Isolated booking/socket integration tests pass; browser QA remains blocked | PASS (API) | `server/bookings/realtime.js`, `server/net/socket.js`, `client/src/admin/AdminSessions.jsx` |
| OPS-06 | Create a room from owner session and bind it to a session | Owner request generates a unique room code; every durable write is in one transaction; collision retries preserve existing room | PostgreSQL failure-injection, collision, concurrency, and instance-isolation tests pass | PASS (API) | `server/bookings/routes.js`, `server/bookings/service.js`, `server/persist/controller.js`, `tests/managed-session-atomicity.test.js` |
| OPS-07 | Per-session pattern configuration and claim verification | Session selection/rewards persist; linked room state updates; claim engine rejects disabled/unsupported rules | Isolated persistence/isolation tests pass; full suite passes | PASS (API) | Migration 034, `server/bookings/service.js`, `server/persist/controller.js`, `server/game/patterns.js` |
| OPS-08 | Composition library preview matches selected live poster | Same renderer and selected event facts are used | Implemented in this local change; automated/browser verification pending | BLOCKED | `client/src/admin/AdminPosters.jsx` |
| OPS-09 | Poster schedule equals selected session schedule | Displayed date/time/timezone are derived from persisted session | Implemented in this local change; automated/browser verification pending | BLOCKED | `client/src/admin/AdminPosters.jsx` |
| OPS-10 | Owner sign-in return link alignment | Link is centered below the form at desktop and mobile widths | CSS corrected locally; browser verification pending | BLOCKED | `client/src/admin/signin.css` |
| OPS-11 | Local production-profile environment checks | Required names consumed; values never exposed | Secret-safe `env-check --production` returned NOT READY: `PUBLIC_ORIGIN` unset, `TRUST_PROXY` not enabled, and local `NODE_ENV` is not production | FAIL | Local `.env` only; production container configuration was not inspected |
| OPS-12 | Real-browser visual QA | Check sign-in and poster desktop/mobile layouts | BLOCKED: supported computer-use runtime failed during initialization and after reset with the same kernel-assets path error; no UI state was changed | BLOCKED | Browser-control runtime error observed twice |

## Release gate

The full serial PostgreSQL suite and focused migration, atomicity, client, and security checks pass locally. Real-browser QA remains blocked by the Codex browser-control kernel-assets error; no Playwright runtime or authorized isolated browser account was available. The waiting-room countdown stops when the player is moved into `/player/game`. The local production-profile environment check is not ready, and production configuration is not verifiable. Migration 034 is local and was applied only to disposable PostgreSQL schemas for verification. No production deployment, migration, booking, game, or player operation is authorized by this document.
