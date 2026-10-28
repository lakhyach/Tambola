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
- An advisory lock (`MIGRATE_LOCK_KEY`) serialises two servers that boot at the
  same instant, so they cannot both apply the same migration.
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

The scheduler and Socket.IO fan-out are **safe for one server instance** per
database. Enforced by a session-scoped advisory lock
(`acquireInstanceLease`, [`db/pool.js`](db/pool.js)): a second server pointed at
the same database **refuses to start** (`INSTANCE_LOCKED`) rather than running
two schedulers over one set of rooms. `instance_lease` records the current owner
for observability.

The schema and transaction boundaries are built so this *can* evolve to multiple
instances - per-room row locks, conditional tick claims keyed in the database,
idempotent constraint-keyed writes, and durable sessions - but **distributed
Socket.IO fan-out and a distributed scheduler are not implemented**, so this
phase does not claim multi-instance production readiness. Deploy exactly one game
server per database.

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

---

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
- `npm run db:restore-check` is the proof, not the exit code: it creates a
  throwaway database, `pg_restore`s the archive into it, checks the ledger, table
  inventory and row counts against the manifest, verifies each round's call log is
  a contiguous prefix of its stored draw (so a restored room is genuinely
  readable), then drops the throwaway database. It never restores into the source.
- Tool driver: `pg_dump`/`pg_restore` on `PATH` or under `PG_BIN`, or
  `PG_CONTAINER` to run them inside the database container. Restore-check needs a
  role able to `CREATE`/`DROP DATABASE`.
- A sealed TOTP secret is only openable with `OWNER_MFA_KEY`; back that key up
  **separately** from the dump. Losing it while enrolled owners exist forces each
  through `owner:mfa-reset`.

Frequency, retention, encryption and the recovery point are deployment decisions;
the commands, isolation rules and a full operational walkthrough live in
[`RUNBOOK.md`](RUNBOOK.md) §7.
