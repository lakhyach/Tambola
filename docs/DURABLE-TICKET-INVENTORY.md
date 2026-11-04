# Durable numbered ticket inventory

New sessions may opt into `inventoryMode: "numbered"`. Existing sessions remain explicitly `legacy` and keep the count-based ticket path. A numbered session cannot be opened until its complete inventory is generated.

## Lifecycle

1. An authorized Admin/Host creates a session with the desired capacity, chooses numbered inventory, and calls `POST /api/admin/instances/:instanceId/sessions/:sessionId/inventory` with `requestedCount` and a stable `idempotencyKey`.
2. Generation validates every 3×9 grid and fingerprint before inserting the complete batch transactionally. Serials are `TKT-0001` through the requested quantity; ticket IDs, serial ordinals, grids and fingerprints are immutable. The ready state is only published after the exact quantity is present.
3. `GET /api/public/sessions/:sessionId/tickets?page=…&pageSize=…` returns persisted grids and availability. The Admin inventory route supports status/search/page filtering. Public responses do not expose reservation IDs.
4. Numbered reservations must submit exact ticket IDs. Reservation and allocation commit atomically. Database uniqueness prevents a concurrent hold from allocating the same ticket. Expiry and cancellation release active allocation rows once and append ticket events.
5. A confirmed booking can join only its attached waiting room. The server validates allocation IDs and assigns their persisted grids to the engine seat. On game start, each game-ticket row is constrained to the exact confirmed reservation and inventory grid. The event ledger records `issued`.
6. Recovery verifies the active allocation count and exact ticket IDs, serials and grids. It fails closed on mismatches and restores the stored ticket data. Reset waiting-room recovery restores the assigned catalog grids instead of minting replacements.

## Persistence

- Migration 023 adds session inventory mode/state, generation batches, immutable session tickets, per-reservation allocations, and append-only inventory events.
- Migration 024 links issued game tickets to the exact session, reservation and ticket. Composite foreign keys, a partial unique index and a trigger enforce room, player, confirmed reservation, active allocation and grid agreement.
- No existing rows are deleted or rewritten. Pre-existing sessions remain count-only legacy sessions.

## Capacity model

Ticket selection is limited by the shared room budget, not by a per-player setting. A room may allocate up to the 10,000-ticket session budget plus one baseline ticket for each seated player (including the host); a seat's `maxTickets` is the remaining room allowance after other seats' allocations. This keeps a single player from being arbitrarily capped while retaining a bounded in-memory room and keeping booked tickets within the existing session capacity. Session capacity remains 1–10,000 tickets total, and reservations cannot exceed the remaining session capacity.

Migration 027 removes the historical per-player upper checks from `room_members` and `ticket_reservations`. It has been applied and verified by the persistence suite in randomized disposable schemas; it has not been applied to the public schema. Apply it through the normal migration runner before deploying the ticket-count behavior. Existing public migration state was not modified in this work.

## Focused verification

`tests/ticket-inventory.test.js` covers atomic generation, idempotent retry, 200-grid catalog paging, concurrent duplicate allocation, 10,000-ticket persistence, rollback on generation failure, booking APIs and a 200-ticket booking → player assignment → game start → completion → process recovery flow. The lifecycle test reads all eight 25-ticket pages, books `TKT-0200`, verifies 199 other tickets remain available, checks the assigned player's name, and compares the exact ID, serial and grid in the issued game row and recovered room. `tests/ticket-inventory-engine.test.js` covers locked inventory identity and legacy compatibility. `tests/persistence.test.js` remains the focused durable persistence regression.

These tests use randomized disposable PostgreSQL schemas. The current frontend has no component-test harness. Client lint/build and route integration are covered, but a dedicated browser screenshot audit of Admin generation and player catalog/booking remains separate from the database acceptance test.

## Ticket catalog visual integration update (3 November 2026)

- Admin session inventory now displays each paged persisted ticket as a serial/status/assignment header and its actual stored `grid` immediately; it no longer requires an individual preview action. It retains server-side search/status filters and pagination.
- Public booking likewise displays each returned real grid in its catalog card. The per-ticket Preview action and separate preview panel are removed; Select/Selected uses the same stable server ticket ID and reservation flow.
- Current-turn real browser coverage against disposable PostgreSQL generated and rendered 200 tickets for a public booking catalog and 200 for an authenticated Bumper Admin inventory. Full-page evidence at 390/430/768/1440/1920 px is under `.preflight/festival-design-qa/`. Grid and serial are rendered together; browser check asserts `TKT-0001` appears as the actual ticket title, not `Ticket NaN`.
- This UI change does not alter ticket generation, the request key, serial ordering, constraints, booking allocation, game issue, or recovery semantics. The UI run used randomized disposable schema(s) and dropped them; no reservation or test game was retained. It is not a 300-ticket UI run.
