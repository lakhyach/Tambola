# Durable persistence and recovery

This is the storage contract for the Tambola server. The in-memory engine
(`server/game/engine.js`) decides the rules; this document explains how those
rules are made to **survive a process restart** and how the process is put back
together from the database. The three pillars are the same ones the engine has
always had: the server is authoritative, one room's state never leaks into
another's, and nothing is announced that is not already committed.

---

## 1. Why PostgreSQL

Phase 3 needs durable, transactional, multi-writer-safe storage for live games.
PostgreSQL was chosen because:

- **Transactions and row locks are the point.** Calling a number and awarding an
  exclusive pattern are check-then-act races once more than one request can be
in flight. Postgres gives `SELECT ... FOR UPDATE`, advisory locks, conditional
  `UPDATE` and unique-violation handling directly, instead of an application
  re-implementing them on top of a key/value store.
- **Uniqueness as a correctness guarantee.** "One ticket per seat per round",
  "one number per call position", "one winner per exclusive pattern" are all
  expressed as database constraints, so they hold even under a bug or a replay
  (see the schema below).
- **Real relational shape.** Rooms → members → tickets → games → calls → claims →
  awards is a graph with foreign keys and history. A document store would either
  duplicate that graph or lose the joins that make recovery auditable.
- **Deployment fit.** The intended production target offers managed Postgres, and
  the driver is the plain `pg` package already used here - no ORM, no new
  framework, consistent with "preserve the existing architecture".

The whole database is reached through **one file**, [`db/pool.js`](db/pool.js).
`persist/` and `net/` never import `pg`; they use the `query` / `withTransaction`
interface returned by `createPool()`. That keeps the storage engine modular and
swappable and keeps it out of the game engine and the Socket.IO transport.

---

## 2. Migrations

- Files live in [`db/migrations/`](db/migrations) and are named `NNN_label.sql`.
- [`db/migrate.js`](db/migrate.js) applies each file **exactly once**, in its own
  transaction, and records `version`, `name` and a **SHA-256 checksum** in
  `schema_migrations`.
- Re-running `migrate` is a no-op for applied versions. Editing a file that was
  already applied aborts with `MIGRATION_DRIFT` rather than silently diverging.
- A PostgreSQL advisory lock keyed by schema serialises migration runners using
  the same schema, while independent schemas (including parallel test schemas)
  can migrate concurrently. This retains same-schema safety without forcing
  unrelated test fixtures to queue behind one global lock.
- The SQL never qualifies table names; the connection pins `search_path` to the
  configured schema (`DB_SCHEMA`, default `public`). The identical SQL therefore
  runs in production `public` and in a throwaway test schema.

Run manually:

```
node --env-file-if-exists=.env server/db/migrate.js
```

| Version | File | What it creates |
|---|---|---|
| 001 | `001_init.sql` | the full initial game schema below |
| 002 | `002_owner.sql` | `owner_accounts`, `owner_sessions`, `admin_audit` (the control centre) |
| 003 | `003_hardening.sql` | owner TOTP columns, `owner_mfa_challenges`, the durable `auth_throttle` counter, an audit read index |
| 004–005 | `004_multi_ticket.sql`, `005_award_ticket.sql` | multi-ticket seats and durable optional-pattern ticket attribution |
| 006 | `006_game_instances.sql` | Regular, Bumper and Legacy instances; required room ownership; moderator/grant and platform audit/settings schema |
| 007 | `007_room_instance_lock.sql` | Database guard against moving a room after its first game starts |
| 008 | `008_legacy_room_default.sql` | Backward-compatible Legacy default for direct SQL room inserts |
| 009 | `009_moderator_auth.sql` | Moderator accounts, sessions, grants, MFA challenges, socket tickets and append-only platform audit |
| 010 | `010_moderator_recovery.sql` | Hash-only short-lived moderator recovery tokens |

Migration 006 maps every pre-existing room to the hidden, archived `legacy`
instance because no historical product label exists in the source data. This is
reversible and preserves the original room/game/ticket/call/claim/award rows.
New host-created rooms default to Regular; owner-created rooms select an active
instance. Instance ownership is protected by a database trigger once a game has
started. Pausing blocks new room creation and player joins while current games
continue.

---

## 3. Schema inventory

Authoritative state is stored **once**. Anything derivable (points, called
count, leaderboard) is computed by query, never cached in a column that could
contradict its source. The only intentional runtime caches are
`room_members.connected` / `last_seen_at`, which describe a *socket*, not the
game; they are reset to `false` at boot and no game rule reads them.

| Table | Purpose | Key / uniqueness |
|---|---|---|
| `players` | stable participant identity (`player_id`), display name is only a label | `player_id` PK |
| `rooms` | lifecycle (`WAITING/RUNNING/PAUSED/COMPLETED`), current `game_number`, `host_player_id` (the host **authority reference**), `config` jsonb, `recovery_error` (fail-closed marker), timestamps, `closed_at` | `room_code` PK; partial index on open rooms |
| `room_members` | player↔room join, role, soft `left_at`, connection cache | `(room_code, player_id)` PK |
| `games` | one row per **round**; the private `draw_sequence` (permutation of 1..90, server-side only); start/complete times | `(room_code, game_number)` PK |
| `tickets` | the 3×9 grid assigned to a seat | `UNIQUE (room_code, game_number, player_id)` — a reconnect can never mint a second ticket |
| `draw_calls` | official call log: `call_index`, `number`, `source`, `called_at` | `PK (room_code, game_number, call_index)` **and** `UNIQUE (room_code, game_number, number)` — no duplicate tick, no duplicate number |
| `claims` | every claim decision, `AWARDED` or `REJECTED`, with reason | append-only decision log |
| `awards` | the winners, `points`, `winner_ordinal` | `UNIQUE (room_code, game_number, pattern, player_id)` + partial unique index on `(room_code, game_number, pattern) WHERE winner_ordinal = 1` — exclusive patterns have exactly one first winner |
| `audit_events` | durable audit trail (the host's ring buffer is just a recent view of it) | `event_id` PK |
| `sessions` | reconnection credentials: `token_hash` only, role, expiry/rotation/revocation columns | `token_hash UNIQUE` |
| `room_schedule` | one row per room = the durable calling clock: `auto_call`, `interval_ms`, `tick`, `next_due_at` | `room_code` PK; `interval_ms BETWEEN 500 AND 120000` |
| `instance_lease` | observability for the single-instance assumption (the real gate is the advisory lock) | `lease_key` PK |
| `owner_accounts` | the single owner: normalised username, scrypt digest, and the second factor as an AES-256-GCM envelope `totp_secret_enc` + `totp_confirmed_at` + `totp_last_step` | `owner_id` PK; unique `username`; CHECK forbids a confirmed factor without a secret |
| `owner_sessions` | owner sign-in sessions; **SHA-256 token hash only**, never a plaintext | `session_id` PK; unique `token_hash`; partial index on active/expiring |
| `owner_mfa_challenges` | short-lived, single-use pre-auth challenge a correct password returns when MFA is enrolled; hashed token, attempt budget, expiry | `challenge_id` PK; unique `token_hash`; owner id `ON DELETE CASCADE` |
| `auth_throttle` | the durable, shared sign-in attempt counter (survives restarts and is read by any process reaching this db); only a hash of the key is stored | `(scope, key_hash)` PK; decay index on `window_started_at` |
| `admin_audit` | append-only owner action log (actor/action/target/room/metadata, never a secret) | `event_id` PK; descending + per-room indexes |

Referential integrity: tickets/claims/awards/calls reference `games`, and seats
reference `room_members`. Leaving a seat or a game keeps history rows reachable
(`ON DELETE RESTRICT` on the membership edges); only closing a room cascades.
`updated_at` on `rooms`, `games`, `players` and `room_schedule` is maintained by
a database trigger, so no application path can forget it.

### What is deliberately **not** stored

- No plaintext password, session secret or reusable host token anywhere. A
  session is a SHA-256 hash; host authority is an identity reference
  (`rooms.host_player_id`) plus an active host session row, never a bearer
  secret on the wire.
- No copy of the draw in any client-bound place. `games.draw_sequence` is read
  only inside the server; clients receive called numbers one at a time from
  `draw_calls`. **Persisting the sequence must never mean returning future
  numbers to a player** - recovery hands back only what is already in
  `draw_calls`.

---

## 4. Persistence architecture (`persist/store.js`, `persist/controller.js`)

[`persist/controller.js`](persist/controller.js) is the **only** place a game
intent is both executed and saved. The transport calls it; it never touches the
engine and the database separately. Three invariants:

1. **One writer per room.** `runExclusive(roomId, …)` chains every durable
   operation for a room, so an `await` mid-write cannot let a second write
   interleave. Host requests, claims and scheduler ticks all queue behind each
   other per room; different rooms run independently.
2. **Durable before authoritative.** A number or award is written first, then
   applied to the live room. While the write is in flight the room's outgoing
   events are held by the dispatch gate ([`net/dispatch.js`](net/dispatch.js)):
   `suspend()` buffers, `flush()` releases on commit, `discard()` throws them
   away on failure. A number is never broadcast that the database did not
   commit.
3. **Fail closed.** If a write cannot be made, the buffered events are discarded,
   the room is rebuilt from what the database actually says, and the caller gets
   `PERSIST_FAILED`. If the rebuild cannot be trusted, the room is frozen
   (`recovery_error`, `RECOVERY_REQUIRED`) instead of carrying on with invented
   state.

Transaction helpers ([`db/pool.js`](db/pool.js)):

- `withTransaction(fn)` is `BEGIN / work / COMMIT` with `ROLLBACK` on any throw,
  so a half-written game state is never left behind.
- A transient failure is retried **only while the outcome is known to be rolled
  back**. If the failure happened during `COMMIT`, the caller is told
  `PERSIST_UNKNOWN` and the store **re-reads the row** rather than writing
  twice - every durable write is idempotent because it is keyed by a unique
  constraint.

Key write paths:

- `recordCall` reads the next number **out of the stored draw plan inside the
  transaction** and inserts it under the `call_index`/`number` uniqueness keys,
  so a replayed write at the same tick is reported as a `duplicate`, not a
  second announcement.
- `recordAward` takes `pg_advisory_xact_lock(hashtext(room … pattern))` and the
  exclusive-index insert, so two simultaneous claims for one exclusive pattern
  yield exactly one winner - even raced in the same instant.

---

## 5. Recovery and hydration (`persist/recovery.js`)

On boot, `recoverRooms()` reads every room with `closed_at IS NULL`, rebuilds
each engine room from durable rows, and never invents anything:

- tickets are loaded as stored (`buildHydrationSource`), not regenerated;
- the draw is read from `games.draw_sequence`, and the cursor is set to the
  count of contiguous `draw_calls` - so the room resumes **exactly where it
  was**, having "already called" the same numbers in the same order;
- members, host authority (`host_player_id`), configuration and completed-round
  history are all restored, not re-run.

**Fail-closed rules.** A room is refused recovery and written with
`recovery_error` when its history does not add up - e.g. the call log has a gap
or is not a contiguous prefix of the stored draw, or a number appears twice.
`buildHydrationSource` throws `IntegrityError` for those, `recoverRooms` returns
them in `frozen[]` with a reason, and the room is **not** handed to players as a
live room. No extra number is ever called simply because the process restarted.
The current game's start timestamp must parse; `RUNNING` games cannot have a
completion timestamp, `COMPLETED` games must have one, and completion cannot
precede start. Room/game status and timestamps are validated together before
hydration so inconsistent lifecycle rows freeze for operator review.

**Resume policy.** A room that was `RUNNING` comes back `RUNNING` with the same
cursor; if auto-call was on and a scheduler is present, its per-room clock is
re-armed from `room_schedule.next_due_at` (see §7). `PAUSED` stays paused. A
`COMPLETED` round stays completed and its awards/claims remain.

---

## 6. Sessions and reconnection (`persist/sessions.js`)

The browser holds one credential per seat: `sessionToken` (48 hex = 24 CSPRNG
bytes) plus the `roomId`. The database stores `SHA-256(token)` only.

- **Issue** at `room:create` / `room:join`. Re-issuing for the same seat revokes
  the prior live row atomically, so a reconnect returns the **same** `playerId`
  and ticket rather than a fresh seat.
- **Verify** on `session:resume`. Checks the hash, then `rotated_at` (theft/replay
  signal), then `revoked_at`, then expiry, then room scope. On success it slides
  the idle deadline. It never returns anything about a different seat or room.
- **Expiry**: idle 7 days (sliding on use), absolute 30 days (never extended),
  both measured by the database clock. An expired session is revoked on the
  attempt that discovers it and cannot be revived.
- **Rotation**: explicit `session:rotate` only (an automatic swap on every resume
  would make a harmless retry look like theft). The old row is marked rotated and
  points at its replacement; a replay of the old token returns `SESSION_ROTATED`.
- **Revocation**: leaving a seat, closing a room, host mismatch, or re-issue. A
  revoked token cannot regain access to any room; guessing a `roomId` with no
  live token yields nothing.

Reconnection behaviour (§5 of the phase): a disconnecting **player** keeps the
ticket and historical claims; a disconnecting **host** keeps ownership
(`host_player_id`) but loses live control until it resumes, and host privileges
never transfer to an arbitrary player. Sessions are scoped to the correct room
and identity, so no unauthorised private state (another seat's ticket) is ever
returned. When `DATABASE_URL` is absent the transport uses the identical
session-token contract via [`persist/memory-sessions.js`](persist/memory-sessions.js),
so browser-only state assumptions are gone in both modes.

---

## 7. Automatic calling and concurrency

- Each room owns one `room_schedule` row and its own `next_due_at`; the scheduler
  ([`persist/scheduler.js`](persist/scheduler.js)) keeps a per-room timer, so no
  room's timer can call in another room, and intervals are per-room (validated to
  500-120000 ms).
- A tick is consumed by a **conditional `UPDATE`** (`claimTick`): the row's
  `next_due_at` must still be due and the room must be `RUNNING` with no
  `recovery_error`. A second timer - another process, or a stray local timer -
  reads `next_due_at` already moved on and gets zero rows, so exactly one call
  happens per scheduled tick. Restarting the server does not duplicate or skip:
  the deadline is database state.
- Pausing clears `auto_call`/`next_due_at`; resuming re-arms from the configured
  interval (no replay of missed calls); ending disarms. A manual host call
  resets the room's clock rather than stacking on it.
- Every official call is committed **before** broadcast (WAL-before-broadcast,
  §4). A database failure therefore cannot announce a number the durable state
  does not hold, and repeated client requests cannot create duplicate calls.

---

## 8. Single-instance constraint (multi-instance readiness)

The scheduler and Socket.IO fan-out are **safe for one server process per
schema**. Enforced by a session-scoped advisory lock keyed from `DB_SCHEMA`
(`acquireInstanceLease`, [`db/pool.js`](db/pool.js)): a second server pointed at
the same database and schema **refuses to start** (`INSTANCE_LOCKED`) rather
than running two schedulers over one set of rooms. `instance_lease` records the
current owner in that schema for observability.

The schema and transaction boundaries are built so this *can* evolve to multiple
instances - per-room row locks, conditional tick claims keyed in the database,
idempotent constraint-keyed writes, and durable sessions - but **distributed
Socket.IO fan-out and a distributed scheduler are not implemented**, so this
phase does not claim horizontally scalable production readiness within one
schema. Separate application deployments may use distinct schemas in one
database, but they share its capacity; run exactly one game server per
database/schema pair. Product tenants such as Regular and Bumper remain within
one schema and one server process.

---

## 9. Environment

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Postgres connection string. Set → durable mode; absent → memory mode (unless the boot guard is disabled). |
| `DB_SCHEMA` | Schema to pin `search_path` to (default `public`). Tests use a throwaway `tambola_test_*` schema. |
| `ALLOW_MEMORY_ONLY` | `1` permits booting without a database; otherwise boot fails closed rather than running a volatile game server. |

The durable test suite ([`tests/persistence.test.js`](../tests/persistence.test.js))
skips cleanly when `DATABASE_URL` is unset and otherwise runs against an isolated
schema that is created and dropped per run - never `public`, never production.

## 11. Moderator security tables

Migration `009_moderator_auth.sql` adds `moderator_sessions` (hashed bearer token, idle/absolute expiry, revocation), `moderator_invites` (hashed one-time invitations), `moderator_mfa_challenges` (short-lived, attempt-limited, IP-bound challenges), and `moderator_socket_tickets` (single-use handshake tokens). It adds TOTP replay tracking to `moderator_accounts`. The existing `moderator_instance_grants` is the current permission source; permission arrays are checked on every HTTP or moderator socket operation. `platform_audit` remains append-only. These tables are included in whole-database dumps. See [`MODERATOR-SECURITY.md`](MODERATOR-SECURITY.md).

## 12. Scheduled bookings and retention

Migrations `011_ticket_bookings.sql` through `013_booking_moderator_ops.sql`
store scheduled sessions, count-only reservation holds, one-time secret hashes,
room-seat assignment and append-only reservation audit. A room lifecycle trigger
completes its bound session and cancels unassigned reservations when the room
starts or closes. Whole-schema backup/restore includes these tables and
triggers; an isolated booking fixture round-trip is covered by
`tests/bookings.test.js`.

Per the owner's instruction on 1 November 2026, booking records and audit rows
remain until a retention policy is provided. Expired holds release capacity
immediately by timestamp and are marked expired on the next booking/operator
read or mutation. No automatic record deletion or anonymization runs. Display
names remain on reservation rows, while audit actor labels avoid copying player
names. This preserves dispute/security history but creates ongoing storage and
display-name retention; a later owner policy is needed before cleanup is added.

---

## Theme library and release state (migration 014)

`theme_catalog` holds public identity and review status. Each package belongs to
an immutable row in `theme_versions`; the only permitted update is the single
draft-to-approved review transition. Publishing inserts an append-only
`theme_publications` row and advances `platform_theme_state`, retaining the
previous version for rollback. `theme_release_schedule` stores the IANA time
zone, local release time and reviewed rotation versions. A unique daily release
date and row lock make scheduler retries idempotent.

Instances resolve the latest publication, active rotation, or a pinned approved
version. Rooms persist the resolved version ID in their configuration at room
creation, so later releases cannot restyle an active game. The browser receives
only validated design tokens; it cannot load arbitrary CSS or fonts. Theme
changes are also recorded in `platform_audit`.

## Poster templates and publications (migration 015)

`poster_templates` describes original vector compositions; immutable
`poster_template_versions` stores the layout and allow-listed color palette.
Each version passes a one-way draft-to-approved transition before manual or
scheduled publication. `poster_template_release_schedule` uses a timezone,
local release time, and a reviewed rotation list. The existing lease owner runs
it once per minute; the unique daily date and row lock make retries safe.

`posters` contains an editable draft scoped to one active instance and pins the
approved template version and optional approved game theme. Publishing appends
a complete snapshot to `poster_publications` and locks that draft. A revision
starts by duplicating the published poster, retaining the old content and exact
template version. Public endpoints serve only publication snapshots and omit
internal instance IDs. SVG output uses fixed layouts and validated text/color
fields; arbitrary HTML, scripts, CSS and external image URLs are not accepted.

## 10. Backup and restore

The database is the entire durable state - rooms, tickets, draws, calls, claims,
awards, game audit, the owner account (digest + sealed second factor), owner
sessions, the shared throttle and the admin audit trail - so it is backed up as
one unit with standard PostgreSQL tooling.

- `npm run db:backup` runs `pg_dump --format=custom` into `BACKUP_DIR` (default
  `./backups`, outside the live data directory), timestamped, and writes a JSON
  manifest recording the migration ledger and every table's row count. The
  connection password reaches the tool through the process environment only - it
  never appears in a filename, a command log or the manifest.
- `npm run db:restore-check` is the proof, not the exit code: it checks the
  archive SHA-256 against its manifest, creates a throwaway database,
  `pg_restore`s the archive into it, checks the ledger, table
  inventory and row counts against the manifest, verifies each round's call log is
  a contiguous prefix of its stored draw (so a restored room is genuinely
  readable), then drops the throwaway database. It never restores into the source.
  A credential-free `.restore-check.json` sidecar records the result, which the
  owner Settings page reads along with the local archive manifests.
- Tool driver: `pg_dump`/`pg_restore` on `PATH` or under `PG_BIN`, or
  `PG_CONTAINER` to run them inside the database container. Restore-check needs a
  role able to `CREATE`/`DROP DATABASE`.
- A sealed TOTP secret is only openable with `OWNER_MFA_KEY`; back that key up
  **separately** from the dump. Losing it while enrolled owners exist forces each
  through `owner:mfa-reset`.

Frequency, retention, encryption and the recovery point are deployment decisions;
the commands, isolation rules and a full operational walkthrough live in
[`RUNBOOK.md`](RUNBOOK.md) §7.

## Runtime instance identity (migration 016)

`instances.branding` stores optional JSON identity settings. The API accepts only curated local logo paths, bounded plain-text taglines, and approved hex color fields with minimum contrast checks. Public directory and detail reads sanitize stored JSON again, so malformed or legacy values cannot turn into arbitrary image URLs or CSS. Migration 016 seeds distinct original Regular and Bumper marks, palettes and taglines beneath existing configured values.

The client maps the sanitized fields to fixed CSS variables and document metadata. Instance identity follows the resolved instance into booking links and published poster snapshots; poster branding is captured at publication time so later edits do not rewrite old shares. Instance identifiers remain private in public responses.

## Instance operational reports (migration 017)

The owner report API aggregates only counts and groups them by instance. Every room activity source joins `rooms.game_instance_id`; reservation activity joins through `game_sessions.instance_id`. UTC date bounds are inclusive in the UI and are validated to no more than 366 days. The response contains no player names, booking token material, or reservation details. Migration 017 adds date-window indexes for bounded report queries.

## Booking-linked room recovery integrity

Before a recovered room enters the live registry, hydration checks each reservation associated with the room against its linked durable member. The reservation must remain confirmed, have a player, point at this room, and match the member's player, room and locked `ticket_count`. A disagreement freezes the room and records `recovery_error`; booking reservation rows and reservation audit history are not rewritten to make recovery succeed.

After the underlying row discrepancy is corrected from an authoritative source, an authenticated owner may use **Recheck recovery** on the room detail page. The same hydration checks run again. Failure leaves the room frozen; success reopens it in memory and appends an owner action to `admin_audit`. The application does not provide a data-repair operation. Preserve a verified backup and the append-only booking history when arranging any manual repair; do not clear `recovery_error` directly as a substitute for rechecking.

## Reset round recovery

A reset changes the room row to `WAITING` but retains the prior `games` row and its tickets, calls and awards. On a cold restart, the recovery loader validates that completed round against its stored draw and call history, then hydrates only the new empty waiting-room projection. It keeps the roster and chosen ticket counts, while clearing the live projection's draw, calls, tickets and awards; the next start uses the following game number. A waiting room tied to a still-running game row, or a running/completed room whose game row disagrees, fails closed instead of guessing which state is authoritative.

Persisted awards are checked before hydration: pattern IDs and point values must agree with the registry, the winner must still belong to the room, the call index must reference stored history, any supplied ticket attribution must identify a ticket held by that winner, and winner ordinals must be contiguous without duplicate winners. Older records may omit nullable ticket attribution and ordinal metadata; recovery preserves that compatibility without manufacturing values.

The recovery snapshot also loads every claim decision for the current game. Decisions must reference an existing room participant and a call index from zero through the stored call count. Rejected attempts remain historical records even when they contain an unknown pattern ID. Each `AWARDED` claim must match exactly one award on player, pattern and call index, and each award must have exactly one such claim. A mismatch freezes the room; no claim or award row is rewritten to make the pair agree.

## Numbered ticket inventory (migrations 023–024)

Numbered sessions persist their full immutable ticket grid, fingerprint, stable UUID and serial in `session_tickets`. `ticket_inventory_batches` records the exact requested/generated quantity and idempotency key. `ticket_reservation_items` binds specific catalog IDs to holds and preserves release history; partial unique indexes prevent two active allocations for one ticket. `session_ticket_events` is append-only.

`tickets` game rows may carry all three nullable inventory identity columns. Legacy rows keep them null. For numbered rows, composite foreign keys and `tickets_inventory_assignment_guard` require the ticket to match the same room, confirmed reservation, assigned player, active allocation and persisted grid. Game start verifies each seat's issued ID set against its locked allocation before committing the round. Recovery compares each numbered reservation with its active allocation and game-ticket rows; inconsistency freezes the room instead of regenerating tickets. Full state transitions and APIs are documented in [`DURABLE-TICKET-INVENTORY.md`](../docs/DURABLE-TICKET-INVENTORY.md).
