# Operations runbook

This file is the operational contract for a production Tambola server. Several
error messages printed by the running server point here on purpose; if you got
here from one of those, skip to the section named in the message.

The most important thing to understand before anything else: **this is a single,
long-lived process.** It holds a PostgreSQL advisory lock, keeps one calling
timer per live room in memory, and streams game state over WebSocket. It is not
a stateless request function. Sections
[Single instance](#5-the-single-instance-rule) and
[Where this does not fit](#11-where-this-does-not-fit) explain what that means
for how you deploy it.

---

## 1. What the server is

- A Node process that serves the built web client, a Socket.IO game transport,
  and a private owner control centre at `/api/admin`.
- PostgreSQL is the source of truth for rooms, tickets, draws, calls, claims,
  the owner account, its sessions and the admin audit trail. Without a database
  the process can only run in **memory mode** (development only).
- The owner account is created **only** from the command line on the host.
  Nothing in a request path can register an owner, and there are no payments or
  wagering anywhere in the system.

## 2. Configuration reference

All configuration is environment variables. `npm start` loads `.env` when it
exists (`node --env-file-if-exists=.env`). Copy `.env.example` and adjust.

### Persistence

| Variable | Required | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | yes in production | PostgreSQL connection string. Without it the server runs in memory mode. |
| `DB_SCHEMA` | no (default `public`) | Schema the pooled connections pin to. Use a non-`public` schema to run several isolated deployments against one cluster. |
| `DB_POOL_MAX` | no (default `8`, hard ceiling `50`) | Max pooled connections the app opens per instance. The single-instance lease holds one extra connection outside the pool, so keep `DB_POOL_MAX + 1 + headroom` under the **usable `max_connections` of your database plan** (for Supabase, the pooler's client-concurrency limit, not the raw server value). Beyond that every checkout queues and eventually times out. See "Connection pool and capacity" below. |
| `DB_POOL_ACQUIRE_TIMEOUT_MS` | no (default `5000`) | How long a request waits for a free pooled connection before failing. Kept short so a saturated pool surfaces as a clean retryable error rather than a hung socket. |
| `ALLOW_MEMORY_ONLY` | no | Must be the literal `1` to start without `DATABASE_URL`. Memory mode loses every game on restart and **cannot sign an owner in**. Development only; in production an explicit `1` is the only way to opt into it. |

### Network and identity

| Variable | Required | Meaning |
| --- | --- | --- |
| `PORT` | usually set by the platform | Listen port (default `4000`). |
| `NODE_ENV` | yes in production | `production` marks cookies `Secure` (requires HTTPS) and refuses memory mode. |
| `ALLOWED_ORIGINS` | usually empty | Comma-separated browser origins allowed to open a socket. Leave empty for same-origin, which is correct when this server serves the built client. This does **not** enable credentialed admin CORS — the control centre is same-origin by design. |
| `PUBLIC_ORIGIN` | recommended | Exact public origin (e.g. `https://hall.example.com`) used in invite links and QR codes. Without it invites fall back to the request host and the admin UI shows a setup warning. |
| `TRUST_PROXY` | set to `1` behind a proxy | Tells Express to trust `X-Forwarded-*` so `req.ip` / `req.protocol` describe the real client. This matters for correct rate-limit keying. Leave unset for direct connections. |
| `HTTP_REQUEST_TIMEOUT_MS` | `30000` | How long one client may take to finish a request before the server answers `408` and frees the socket. Node's own default is five minutes, which is a slowloris invitation; lower it only if your reverse proxy is slower than 30 s end-to-end. |

### Gameplay and sessions

| Variable | Default | Meaning |
| --- | --- | --- |
| `CALL_INTERVAL_MS` | `8000` | Milliseconds between automatic calls. Clamped to 500–120000. |
| `MAX_PLAYERS` | `100` | Maximum players per room. |
| `CHAT_INTERVAL_MS` | `2000` | Minimum milliseconds between two chat messages from the same player. |
| `SESSION_IDLE_MS` | `604800000` (7d) | Idle window for host/player reconnect sessions. |
| `SESSION_ABSOLUTE_MS` | `2592000000` (30d) | Hard lifetime for host/player sessions. |

### Second factor (TOTP MFA)

| Variable | Required | Meaning |
| --- | --- | --- |
| `OWNER_MFA_KEY` | to use MFA | 32 bytes, as 64 hex characters **or** base64. Encrypts the TOTP secret at rest (AES-256-GCM). **If it is absent the feature reports itself unconfigured and enrollment is refused. If it is present but malformed the server fails at boot** rather than silently downgrading. If it is ever changed or lost, already-enrolled owners cannot sign in until a recovery reset (see [§6](#6-owner-accounts)). |
| `MFA_ISSUER` | no (default `Tambola`) | The issuer label shown in authenticator apps. Cosmetic; changing it does not break existing devices. |

### Reliability and observability

| Variable | Default | Meaning |
| --- | --- | --- |
| `LEASE_HEARTBEAT_MS` | `30000` | How often the instance lease is refreshed. A missed/failed heartbeat fails the process closed (see [§5](#5-the-single-instance-rule)). |
| `MAINTENANCE_INTERVAL_MS` | `300000` | Background sweep of expired lockouts, spent challenges and dead sessions. |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error`. |
| `LOG_FILE` | unset → stdout | File to append structured logs to. Prefer stdout and let the platform's log driver handle retention. |
| `LOG_MAX_BYTES` | `5242880` | Rotate `LOG_FILE` at this size (5 MB). |
| `LOG_KEEP` | `3` | How many rotated files to keep. |
| `TAMBOLA_COOKIE_SECURE` | unset | Force `Secure` cookies even when `NODE_ENV` is not `production` (e.g. production behind a nonstandard setup). |

There are deliberately **no** owner credentials in the environment for the
running server. The server never reads an owner password from the environment;
only the bootstrap CLI does, for the single command that needs it.

## 3. Running it

**Development (no database, memory mode):**

```bash
ALLOW_MEMORY_ONLY=1 npm start
```

Games vanish on restart and you cannot open the control centre. That is the
honest, intended limitation.

**Production (durable):**

```bash
cp .env.example .env   # set DATABASE_URL, NODE_ENV=production, PUBLIC_ORIGIN, OWNER_MFA_KEY
npm run migrate        # apply schema (see §4)
npm run build          # install + build the client into client/dist
npm start
```

## 4. Database and migrations

Migrations are hand-written, versioned and checksummed files in
`server/db/migrations/` (`001_init`, `002_owner`, `003_hardening`). The runner
(`npm run migrate`, which the server also runs at boot) applies each exactly
once inside its own transaction, records a SHA-256 checksum, and serialises
concurrent boots with an advisory lock.

- **Never edit an applied migration.** The runner refuses with `MIGRATION_DRIFT`
  instead of silently mismatching. To change schema, add the next numbered file.
- The server migrates itself at start-up, so a rolling deploy that points at a
  new database is safe.
- Owner accounts, sessions, audit, the throttle table and the MFA challenge
  table all live in this schema. Back them up together (see
  [Backup and restore](#7-backup-and-restore)).

## 5. The single-instance rule

**Exactly one server process may run against a given database at a time.** This
is not a preference; it is enforced.

- On boot, the durable server takes a PostgreSQL **session advisory lock**
  (`pg_try_advisory_lock(INSTANCE_LOCK_KEY)`) on a dedicated connection it holds
  for the life of the process.
- If a second process tries to boot against the same database, the lock is
  already held, `pg_try_advisory_lock` returns false, and startup throws
  `INSTANCE_LOCKED`. The bootstrap prints
  `another server already owns this database` and exits non-zero. You will never
  get two schedulers racing.
- A background **heartbeat** refreshes the lease row on that same connection
  every `LEASE_HEARTBEAT_MS`. If the refresh fails or the row now names a
  different holder, the process has lost the right to act on its own initiative,
  so it **fails closed**: it disarms every calling clock, stops the heartbeat
  monitor, marks itself draining, and answers `503` on readiness for the
  supervisor to act on. A half-alive instance that keeps calling numbers on a
  database it no longer owns is far worse than one that stops.
- The lock is keyed to the **cluster/database**, not the schema. Running two
  isolated deployments against one cluster therefore needs either two databases
  or two clusters — a distinct `DB_SCHEMA` alone does **not** allow two live
  servers on one database.

**Why not just scale horizontally?** The per-room clock lives in this process,
and a room's authoritative state is rebuilt into memory before it can be driven.
Two processes calling the same room would double-call numbers. The advisory lock
is the safety mechanism that makes the single-instance constraint real rather
than a comment in the README. It is deliberate and must not be removed.

**Restarting safely:** send `SIGTERM` (see [§9](#9-graceful-shutdown)). The
process drains, closes rooms durably, releases the advisory lock and exits. Only
start the replacement after the old process has released the lock — otherwise
the new one gets `INSTANCE_LOCKED` and exits, which is the correct outcome.

### Connection pool and measured capacity

Because one process owns every room, the practical ceiling on concurrent play is
**the connection pool and the latency of a single durable write**, not CPU or
socket count. Every number call, claim, ticket choice and reconnect is written to
Postgres *before* it is broadcast (see `server/persist/controller.js`: durable-
before-authoritative), and a call transaction issues several statements —
`BEGIN`, a `SELECT … FOR UPDATE` on the room's `games` row, the `draw_calls`
insert, an audit insert and `COMMIT`. Those are separate round-trips, so the
per-call latency has a floor set by that round-trip cost, not by pool size.

Measured with `scripts/loadtest.mjs staged` against a local PostgreSQL 16
(`max_connections = 100`, single app instance, throwaway schema). The harness
fires calls **back-to-back**, which is a far harsher write rate than real play,
where `CALL_INTERVAL_MS` spaces calls by seconds. Numbers are p50/p99 call-**ack**
latency at that artificial worst case:

| Active rooms | `DB_POOL_MAX` | p50 | p99 | peak pool | peak waiters | dup calls / leaks / conn errors |
| --- | --- | --- | --- | --- | --- | --- |
| 20 | 8 (default) | 25 ms | 58 ms | 8/8 | 12 | 0 / 0 / 0 |
| 50 | 8 (default) | 61 ms | 101 ms | 8/8 | 42 | 0 / 0 / 0 |
| 50 | 24 | 49 ms | 90 ms | 24/24 | 26 | 0 / 0 / 0 |
| 50 | 40 | 49 ms | 86 ms | 40/40 | 10 | 0 / 0 / 0 |
| 100 | 40 | 108 ms | 170 ms | 40/40 | 60 | 0 / 0 / 0 |

What the data shows:

- **The pool default of 8 starves under load** (42 requests queued behind 8
  connections at 50 rooms). Raising it to ~24 removes most of the queue; going
  to 40 shrinks the backlog further but the p99 barely moves. Past ~24 the
  bottleneck is the per-call transaction round-trips, **not** connection count —
  so "just make the pool bigger" is the wrong lever once you are around 24.
- **Correctness held at every size**: zero duplicate calls, zero cross-room
  fan-out leakage, zero connection errors, and every reconnect sample recovered
  — the durable-before-authoritative and one-writer-per-room guarantees were
  never broken under saturation.
- **A starting production target**: with `DB_POOL_MAX` sized to your plan's
  connection budget, **~100 concurrent active rooms** sustained the back-to-back
  burst at p99 ≈ 170 ms; real gameplay (calls seconds apart) is dramatically
  lighter, so this is a conservative worst case, not a recommended operating
  point.

**Phase 16B re-measurement, with the database profiler.** `loadtest.mjs` now also
wraps `withTransaction` and samples `pg_stat_activity`, `pg_stat_database` and
`pg_stat_wal`, so the queue can be attributed instead of guessed at. Run
`staged 10:50,50:250` (50 rooms × 5 players, three calls per room fired
back-to-back):

| `DB_POOL_MAX` | ack p50 | p95 | p99 | peak waiters | tx p95 | tx p99 | lock waits |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 8 (default) | 44.6 ms | 84.8 ms | 101.2 ms | 42 | 102.3 ms | 158.2 ms | 1 |
| 16 | 37.1 ms | 65.0 ms | 89.8 ms | 34 | 151.5 ms | 236.7 ms | 1 |
| 32 | 42.9 ms | 56.4 ms | 62.9 ms | 18 | 141.1 ms | 320.8 ms | 16 |

At 42 waiters the database itself was idle: peak **7** active backends of 8,
longest query **23 ms**, cache hit **100%**, **0** deadlocks and 0 rollbacks, WAL
2.2 MB over 25 750 records, buffers-full 0. The queue is therefore **pool
checkout plus per-room serialisation**, not Postgres capacity — which is why a
bigger pool stops helping once the per-call transaction's round-trips become the
floor. 16 is the recommended setting for a known ~50-room peak; 32 buys ~8 ms of
p95 and costs 16 lock waits and a 321 ms transaction p99, the wrong trade for a
game whose worst failure is a frozen room. Correctness held at every size: 750
acks, zero duplicate calls, 150/150 room syncs, 50/50 reconnects. Re-running the
same stage after the dependency patch reproduced the shape: ack p50 48.8 / p95
87.0 / p99 121.0 ms, pool 8/8 with 42 waiting, peak 7 active, longest query 48 ms,
0 lock waits.

**Sizing `DB_POOL_MAX` honestly:** do **not** copy the local `max_connections =
100`. Production runs against a **Supabase session pooler**, whose *client*
concurrency limit is set by the plan and is typically far below the raw server
`max_connections`. Set `DB_POOL_MAX + 1 (lease) + headroom` under that pooler
limit, then re-run the staged test with a throwaway local database (never the
live one — `loadtest.mjs` refuses Supabase hosts) to confirm waiters stay near
zero. The single-instance lease is retained deliberately: multi-instance
fan-out is a redesign, not a dial.

## 6. Owner accounts

There is one owner account and no public registration. Every command below runs
on the server host and reads `DATABASE_URL`. Prefer the hidden interactive
prompt over an environment variable so a password never lands in shell history.

| Command | What it does |
| --- | --- |
| `npm run owner:create` | Create the single owner account. Refuses if one already exists. |
| `npm run owner:list` | List owner usernames with their MFA state. Never prints a secret. |
| `npm run owner:reset -- <username>` | Rotate a password and revoke every live session for that owner. |
| `npm run owner:mfa-reset -- <username>` | Destroy a lost second factor (see below). |
| `npm run owner:remove -- <username>` | Delete an owner and cascade its sessions/challenges. |

Non-interactive overrides: `OWNER_USERNAME`, `OWNER_PASSWORD` (create),
`OWNER_NEW_PASSWORD` (reset), `OWNER_CONFIRM=1` (skip the typed confirmation).

### Second factor (MFA)

Enrollment happens in the owner dashboard under **Settings → Two-factor
sign-in**: scan the QR with an authenticator app, then enter one current code to
confirm. Until a valid code is entered the enrollment stays *pending* and
sign-in is still password-only — an abandoned enrollment can never lock you out.

Once enrolled, a correct password alone buys only a short-lived single-use
challenge; the authenticator code completes the sign-in. The base32 secret is
sealed with `OWNER_MFA_KEY` and only ever the ciphertext reaches the database.

**"I lost my authenticator."** From the server host:

```bash
npm run owner:mfa-reset -- <username>
```

This requires `OWNER_MFA_KEY` to be set to the same value the server uses — if
it is missing or unreadable the command **refuses to run**, because a half-done
reset could leave an account that cannot sign in at all. On success it destroys
the sealed secret, clears the confirmation, revokes every live owner session,
cancels every outstanding challenge and writes an audit row. The owner then
signs in with the password alone and can enroll a fresh device. The barrier is
host access to the database — not anything the dashboard can leak.

## 7. Backup and restore

The database is the whole durable state: rooms, tickets, draws, calls, claims,
owner accounts (password digests and sealed MFA secrets), sessions, the audit
trail, the shared attempt counter and the MFA challenge table. Back it up as one
unit.

- Use `npm run db:backup` (a thin `pg_dump` wrapper) to produce a timestamped
  custom-format archive plus a JSON manifest that records the migration ledger
  and every table's row count. By default it writes to `backups/` in the
  repository (git-ignored, and outside the live `.pgdata` data directory);
  override with `BACKUP_DIR`. The dump connects with `DATABASE_URL` through the
  process environment only — no password is ever written into a filename, the
  command's own logs, or the manifest.
- Use `npm run db:restore-check` (optionally `-- <archive.dump>`, else the newest
  in `BACKUP_DIR`) to prove a real restore. It creates a brand-new **throwaway
  database** on the same cluster, `pg_restore`s the archive into it, checks that
  the migration ledger, the table inventory and every row count match the backup
  manifest, verifies the restored call logs are contiguous prefixes of their
  stored draws (so a room's history is genuinely readable), then drops the
  throwaway database. It never restores into the source.
- The tools need a driver: put `pg_dump`/`pg_restore` on `PATH`, or set `PG_BIN`
  to their directory, or — when the database runs in a container with no host
  client tools — set `PG_CONTAINER` (e.g. `tambola-pg`, optional
  `PG_CONTAINER_PORT`, default `5432`) to run them via `docker exec`. The native
  driver is preferred in production because the secret stays in one local
  process's environment.
- A restore-check also needs a role that can `CREATE`/`DROP DATABASE` on the
  cluster; it reaches the maintenance database via `DATABASE_URL` pointed at
  `postgres` (override with `RESTORE_ADMIN_DATABASE_URL`).
- Never restore a production dump over the live `public` schema as a "check".
  See the `db:restore-check` header and `server/DATABASE.md` for the isolation
  rules.

Because a sealed MFA secret can only be opened with `OWNER_MFA_KEY`, back up
`OWNER_MFA_KEY` **separately and durably**. Losing the key while a database with
enrolled owners survives means every enrolled owner must be recovered with
`owner:mfa-reset`.

## 8. Health probes

Three endpoints, three different questions. Wire your orchestrator to them
exactly:

- `GET /livez` — **liveness.** Process-level only; never touches the database.
  A Postgres outage must not make a supervisor kill a healthy server. Use this
  for restart decisions. It answers `{ok, live, draining}` and nothing else —
  uptime and every other detail live on `/readyz` and `/healthz`.
- `GET /readyz` — **readiness.** `200` only when the database is reachable, the
  schema is current, the instance lease is held and the process is not draining;
  otherwise `503`. Use this to gate traffic. Readiness is cached briefly so a
  chatty load balancer cannot stampede the database.
- `GET /healthz` — the same facts as one JSON object for an operator or script,
  including room counts (`{ live, frozen }`) and the persistence `mode`.

No probe ever returns a connection string, a query, a stack trace or a secret.
Memory mode answers ready with `durable: false` and an explicit note; in
production, absence of a database is reported **not-ready** unless
`ALLOW_MEMORY_ONLY=1` was set on purpose.

### A round that pauses itself

A `PAUSED` room with nobody at the keyboard is usually correct, not a fault. When
the **host's socket drops while the round is RUNNING**, the room stops its calling
clock and pauses on purpose: an unreachable owner is not a gone owner, and nobody
else may drive a game they did not start. The host's audit trail records
`host-lost`, the snapshot reports `PAUSED` with its `elapsedMs` frozen, and the
room resumes — same clock, same call sheet — when the host reconnects and presses
Resume. The same rule covers a host who simply reloads the page.

What it is *not*: a scheduler fault. `game:call-next` still works for the
reconnected host, `/healthz` still shows the room live, and no number is lost or
replayed. If a room is stuck in `PAUSED` with **no** host seat connected at all,
treat it as an abandoned room and close it from the owner control centre rather
than forcing it to run.

## 9. Graceful shutdown

On `SIGTERM` or `SIGINT` the server:

1. sets the **draining** flag, so `/readyz` immediately returns `503` and the
   scheduler's authority gate refuses any further automatic call;
2. stops the lease monitor, the maintenance timer and every per-room clock;
3. closes the Socket.IO listener, then the HTTP server;
4. closes open rooms **durably** and releases the advisory lock and the pool.

Give the process enough time to finish (the bootstrap falls back to a hard exit
after 5 seconds). Under systemd/Docker, `docker stop` and `systemctl stop` send
`SIGTERM` by default; make sure your `stop_grace_period`/timeout exceeds that 5s
window so rooms are written rather than dropped.

## 10. Logging

Logs are structured JSON, one object per line, with a timestamp, a level, a
`service` name and an event or message. Secrets are scrubbed before they are
written: fields named like `password`, `token`, `secret`, `cookie`, `csrf`,
`totp`/`otp`, `database_url` are redacted, and connection-string credentials
quoted inside a message are replaced with `[redacted]`. Default sink is stdout —
let the platform collect and rotate it. Only set `LOG_FILE` if you must, and
remember it rotates at `LOG_MAX_BYTES` keeping `LOG_KEEP` files, inside the
directory you point it at and nowhere else.

## 11. Where this does not fit

This server is a stateful, long-lived process holding an advisory lock and
in-memory timers. It does **not** fit a request-scoped serverless platform. The
stale `vercel.json` files that once named a non-existent root `./index.js` entry
path and a stateless single route have been **removed**; the supported path is the
repo-root `Dockerfile` and `docker-compose.yml`, documented in `DEPLOYMENT.md`.
Do not deploy this on serverless functions. Run it on a single long-lived host that
can keep a PostgreSQL connection open: a VM/container under systemd, a Docker service,
a
Fly.io/Render/Railway-style long-running service, or an app server behind a
reverse proxy that sets `TRUST_PROXY=1` and terminates TLS.

## 12. Deploy checklist

Before calling a deployment ready, confirm every line:

- [ ] `DATABASE_URL` points at a managed PostgreSQL instance the process can keep
      open; `DB_SCHEMA` is set if you isolate deployments on one cluster.
- [ ] Migrations have run (`npm run migrate`, or the server boot reported them);
      `schema_migrations` lists `001`, `002`, `003`.
- [ ] `NODE_ENV=production`, and TLS is terminated in front of the server.
- [ ] `PUBLIC_ORIGIN` is the exact public HTTPS origin.
- [ ] `TRUST_PROXY=1` when behind a proxy; `ALLOWED_ORIGINS` left empty for
      same-origin unless you specifically need another browser origin.
- [ ] The client is built into `client/dist` (`npm run build`) — the directory the server serves.
- [ ] `OWNER_MFA_KEY` is set to a durable random 32-byte value, recorded in your
      secret manager, and **backed up separately** from the database.
- [ ] The owner account exists (`npm run owner:list`) and, ideally, has MFA
      enrolled.
- [ ] Exactly one instance runs against this database. The platform's instance
      count is pinned to 1; a second boot is expected to exit `INSTANCE_LOCKED`.
- [ ] Liveness is wired to `/livez`, readiness to `/readyz`, and the container
      stop grace period exceeds 5 seconds so shutdown drains.
- [ ] Backups run on a schedule and a restore has actually been exercised with
      `npm run db:restore-check`.
- [ ] The full test suite passes with the server **stopped**
      (`node --env-file-if-exists=.env --test "tests/*.test.js"`), the client
      builds, and lint is clean.
