# Deployment readiness — what is proven, what is one command away, and what needs a human

Phase 16B · prepared 31 October 2026 · base commit `0a4de55`

This paper is the operational half of `docs/FREE-INFRASTRUCTURE-RESEARCH.md`. That
one answers *where* the application can run for nothing. This one answers *how it
gets there without breaking the seven guarantees*, and it names every step that
cannot be taken without the client's approval.

Nothing here was activated. No account, card, domain, subscription or public URL
exists as a result of this phase.

---

## 1. The deploy gate, in one line

```bash
npm run build && npm run env:check && npm start      # then: npm run smoke -- --url http://127.0.0.1:4000 --full
```

`npm run env:check` (`scripts/env-check.mjs`) is the gate that turns
`DEPLOYMENT.md`'s environment checklist into an assertion. It reads the same
environment the server will read, prints a report that never contains a value, and
exits non-zero when production is wrong. Run it **before** the container starts,
in the pipeline or on the box, so a misconfiguration is a failed deploy rather
than a bad first hour.

What it refuses in `--production` (each one is an error, not a warning):

| Check | Why it is fatal |
| --- | --- |
| `DATABASE_URL` missing or unparseable | The server would refuse to boot anyway; failing here says why |
| Password empty or one of `tambola`, `postgres`, `password`, `admin`, `root`, `changeme` | A default password on a public host is a breach, not a risk |
| Remote host with no `sslmode`, or with `disable`/`prefer` | Game data and credentials cross the internet in plaintext |
| `ALLOW_MEMORY_ONLY=1` | Memory mode loses every room on restart and cannot sign an owner in |
| `PUBLIC_ORIGIN` missing, not `https`, or carrying a path | Invite links, QR codes, Socket.IO origin checks and cookies all derive from it |
| `TRUST_PROXY` not `1` | Real client IPs collapse to the proxy's, which breaks rate limits and audit |
| `TAMBOLA_COOKIE_SECURE` false | Session and owner cookies travel over a channel that can downgrade |
| `OWNER_MFA_KEY` missing or not 32 bytes (hex or base64) | The owner console either breaks or stores a second factor nobody can decrypt |
| `DB_POOL_MAX` above the hard ceiling of 50 | A typo would exhaust the database's connection slots |

It warns (does not block) on: a localhost database, port `6543` (the transaction
pooler, which breaks the advisory lease), a large-but-legal pool, the default
`MFA_ISSUER`, `LOG_FILE` set on an ephemeral filesystem, and gameplay values
outside the documented ranges.

`npm run env:check` with no flags auto-selects the profile from `NODE_ENV`, so a
laptop report is warnings and a production report is errors.

## 2. Health, readiness and liveness — and how to read them

| Endpoint | Touches the database | Answers | Used by |
| --- | --- | --- | --- |
| `/livez` | never | "the process is alive" | container health check, supervisor |
| `/readyz` | yes | "the database answers, migrations are current, the lease is held, not draining" | load balancer, platform health check, uptime probe |
| `/healthz` | yes | the full snapshot below | an operator, an alert, a runbook step |

`/healthz` now reports the two signals that separate the failures which look
identical from outside:

```json
{
  "durable": true,
  "lease": { "held": true },
  "migrations": { "current": true },
  "scheduler": { "armed": 3, "nextDueInMs": 4210, "overdue": false, "ticking": true },
  "pool": { "total": 8, "idle": 1, "waiting": 42, "max": 8, "errors": 0 },
  "draining": false
}
```

- `scheduler.ticking === false` with `armed > 0` means **the calling clock
  stopped** while rooms still expect numbers — the failure a player sees as "the
  game froze".
- `scheduler.overdue === true` means an armed timer is more than a minute past its
  due time: the process is starved, suspended, or the machine slept.
- `pool.waiting` persistently above zero means requests are queueing for a
  connection; §7 says which dial to turn.
- `pool.errors` counts connection failures since boot.

`overdue` is deliberately **not** a readiness failure: a single late timer during
a deploy is not a reason to pull the instance out of service, and failing readiness
would stop the very process that is trying to catch up. It is a signal for the
alert and the operator, and the uptime workflow quotes it.

## 3. Provisioning, in the two architectures that cost nothing

### B1 — this machine behind a Quick Tunnel (demo, UAT, acceptance)

Already automated: `deploy/free-start.ps1` / `deploy/free-stop.ps1`.

```powershell
docker compose up -d --build          # app + PostgreSQL 16 on :4000
npm run env:check                     # development profile: warnings, no blockers
npm run smoke -- --url http://127.0.0.1:4000 --full
.\deploy\free-start.ps1               # cloudflared quick tunnel, prints the https URL
```

The tunnel hostname changes on every restart. Treat the URL as an invitation to a
session, not as the product's address, and send it to the client by hand.

### B2 — Oracle Cloud Always Free Ampere A1 (stable URL, needs a card)

```bash
# on the VM, once
sudo apt-get install -y docker.io docker-compose-plugin git
git clone <repository> tambola && cd tambola
cp .env.example .env && chmod 600 .env       # fill DATABASE_URL, OWNER_MFA_KEY, PUBLIC_ORIGIN
docker compose up -d --build
npm run env:check -- --production            # must exit 0 before announcing the URL
npm run smoke -- --url https://games.example.com --full
```

TLS is terminated by Caddy or nginx on the VM (`deploy/nginx-tambola.conf` is the
template), then `TRUST_PROXY=1`, `TAMBOLA_COOKIE_SECURE=1` and
`PUBLIC_ORIGIN=https://…`. A card is required for identity verification at signup,
which is why this phase did not create the account.

### D — managed host (paid, for comparison)

`deploy/render.yaml`, `deploy/fly.toml` and `deploy/railway.json` are ready. The
only provider-specific settings that matter are the ones that preserve the
contract: **one replica**, **no autoscaling**, **no scale-to-zero**, a health check
on `/readyz`, and a stop grace of at least 20 s so SIGTERM can drain.

## 4. Secrets: where each one lives, and the rule that never changes

| Secret | Where it goes | How it is generated | Rotation |
| --- | --- | --- | --- |
| `DATABASE_URL` | platform secret / `.env` with `chmod 600` | the provider console | rotate the database password; restart |
| `OWNER_MFA_KEY` | **separate** from the database backup | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | **cannot rotate while MFA enrollments exist** — re-enroll every owner (`npm run owner:mfa-reset`) or the sealed secrets become unreadable |
| Owner password | typed into `npm run owner:create`, never stored in `.env` | the operator | `npm run owner:reset -- <username>` |
| `VITE_*` | build arguments | not secret, ever | rebuild |

Rules that this repository enforces mechanically rather than by discipline:

- `npm run secret-scan` compares every value in `.env` against every tracked file
  **and the built bundle**, and flags credential-shaped text anywhere
  (`scripts/secret-scan.mjs`). It is part of `npm run verify` and of CI.
- `.env` is git-ignored; `.env.example` contains only placeholders.
- The Docker image is built from the repository and receives secrets at run time
  (`--env-file`, platform secrets), never at build time — so no layer can contain
  one.
- This deployment phase wrote **no** value into any file. The only credential the
  repository has ever carried is the throwaway password of the local Docker
  database in `docker-compose.yml`, which is reachable only from `127.0.0.1`.

## 5. Migrations

Migrations `001_init` … `004_*` apply automatically at boot, are checksummed, and
are ledgered in `schema_migrations`; a checksum mismatch fails the boot instead of
silently diverging. `AUTO_MIGRATE=0` plus `npm run migrate` is the manual path, and
`/readyz` reports `migrations.current === false` when one is pending.

Two rules that prevent the only unrecoverable mistake available here:

1. **Never drop or recreate a database that has data.** No script in this
   repository does; the restore check creates and drops a *throwaway* database
   whose name it prints first.
2. **Never point the test suite at production.** `tests/*` create and drop
   `tambola_test_*` / `tambola_harden_*` schemas. `scripts/loadtest.mjs` refuses
   managed hosts outright.

## 6. Deploy, verify, roll back

```bash
# 1. build and gate
docker build -t tambola:<tag> .
npm run env:check -- --production

# 2. run one instance (no replicas, no autoscaling)
docker run -d --name tambola -p 4000:4000 --env-file .env tambola:<tag>

# 3. prove it, not just that it started
npm run smoke -- --url https://games.example.com --full

# 4. watch it for the first ten minutes
curl -s https://games.example.com/healthz | jq '{scheduler,pool,lease}'
```

`npm run smoke` (`scripts/smoke-deploy.mjs`) checks `/livez`, refuses a `/readyz`
that reports memory mode ("a restart would lose every room"), requires
`/healthz` to show current migrations, fetches the SPA, performs a real Socket.IO
handshake, and with `--full` plays a round: create a room, join, start, call a
number, confirm the guest received it, end the game. It never touches the owner
console and never writes a ticket to a live room outside the one it created.

**Rollback** — the image is the unit of rollback, and the database is
forward-only:

1. `docker stop tambola` (SIGTERM drains, rooms freeze with a reason, the lease is
   released). Do not `kill -9`; that leaves the lease to expire instead of being
   released.
2. Start the previous tag with the same `DATABASE_URL`. Rooms the old process
   closed durably are recovered by the boot pass; rooms that were mid-game resume
   from the database, not from memory.
3. If the failure is a migration, **do not** roll the schema backwards by hand.
   Restore the pre-deploy dump into a new database, verify it with
   `npm run db:restore-check` semantics, then point `DATABASE_URL` at it.
4. Announce: a rollback freezes every room in play. That is the correct trade
   against double-calling numbers.

## 7. Sizing the pool with evidence, not optimism

Measured on 31 October 2026 with `scripts/loadtest.mjs staged 10:50,50:250`
against a local PostgreSQL 16 (`max_connections=100`, throwaway schema) and the
new database profiler (transaction durations, `pg_stat_activity` sampling,
`pg_stat_database`, `pg_stat_wal`). 50 rooms × 5 players = 250 players, 3 calls
per room fired back-to-back — a far harsher write rate than real play, where calls
are seconds apart.

| `DB_POOL_MAX` | call-ack p50 | p95 | p99 | pool peak | peak waiters | tx p95 | tx p99 | lock waits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 8 (default) | 44.6 ms | 84.8 ms | 101.2 ms | 8/8 | 42 | 102.3 ms | 158.2 ms | 1 |
| 16 | 37.1 ms | 65.0 ms | 89.8 ms | 16/16 | 34 | 151.5 ms | 236.7 ms | 1 |
| 32 | 42.9 ms | 56.4 ms | 62.9 ms | 32/32 | 18 | 141.1 ms | 320.8 ms | **16** |

Correctness held at every size: 750 call acknowledgements, **zero duplicate
calls**, zero cross-room leakage, 150/150 room syncs, 50/50 reconnects.

Reproduced after the dependency patch with the default pool: ack p50 48.8 / p95
87.0 / p99 121.0 ms, pool 8/8 with 42 waiting, peak 7 active backends, longest
query 48 ms, cache hit 100%, 0 lock waits, WAL 1.8 MB over 19 869 records. Same
shape, same conclusion — the run-to-run difference is noise, not a regression.

What the database said while the queue was 42 deep: peak active backends **7** of
8, longest query **23 ms**, cache hit **100%**, **0** deadlocks, **0** rollbacks,
WAL 2.2 MB across 25 750 records, buffers-full 0. So the queue was **pool
checkout**, not Postgres capacity — and raising the pool only helps until the
per-call transaction's round-trips become the floor.

**The operating rule:** keep the default 8 for real play; set
`DB_POOL_MAX=16` for a known peak of ~50 concurrent rooms, and never above the
database plan's client-concurrency budget minus one for the lease. Going to 32
buys ~8 ms of p95 and costs 16 lock waits and a 321 ms transaction p99 — the wrong
trade for a game whose worst failure is a frozen room.

## 8. Continuous integration, on a public repository, for nothing

`.github/workflows/ci.yml` runs on every push and pull request:

1. `postgres:16-alpine` service, throwaway credentials, `NODE_ENV=test`.
2. `npm ci` for the server and the client.
3. `npm test` (the whole suite, durable tests included — no silent skips).
4. `npm run lint`, the client build, `npm run secret-scan`, `npm run security-probe`.
5. `npm run e2e` and `npm run e2e:durable`.
6. `npm run db:backup` + `npm run db:restore-check`, with the archive uploaded as
   an artifact.
7. A self-test that `npm run env:check -- --production` **fails** on an unsafe
   environment — a gate that cannot fail is decoration.
8. A second job builds the Docker image and curls `/livez` inside the container.

`.github/workflows/uptime.yml` is the backup alert layer: every 20 minutes it
probes `/readyz` and `/healthz` at `secrets.DEPLOY_URL` and opens an issue when
the deployment is not ready, closing it on recovery. With no secret it exits green
and says so, so a fresh clone is never red.

## 9. Monitoring that costs nothing and needs no account

| Signal | Mechanism | Status |
| --- | --- | --- |
| Application up | `/readyz` + `/livez` | in the image, in CI, in the uptime workflow |
| Database connectivity | `/readyz` fails closed; `pool.errors` | implemented |
| Scheduler heartbeat | `scheduler.overdue`, `scheduler.ticking` | implemented |
| Process crash | container restart policy + the issue opened by `uptime.yml` | configured |
| WebSocket failure | `smoke --full` fails if a guest does not receive a call; the client surfaces a reconnect banner | implemented |
| Backup success/failure | `db:backup` exit code + manifest; CI artifact | implemented (scheduled execution is an approval) |
| Disk and memory | `pool`, RSS in the load harness; host metrics are the provider's | partial — see §10 |
| Structured logs | JSON to stdout, `LOG_LEVEL`, redaction applied by the logger | implemented |

Redaction is verified by a test, not by inspection: the logger replaces session
tokens and cookies in the fields it logs, and `npm run secret-scan` fails the
build if a value from `.env` appears in a tracked file or in the bundle.

**What is deliberately not wired:** Sentry (needs an account, one user on the free
plan), UptimeRobot (50 free monitors at 5-minute intervals — the primary alert
once there is a public URL to watch), R2 offsite dumps (activating R2 asks for a
payment method), Resend (no email is sent by this product). All four are
documented, none is claimed to be running.

## 10. The approvals this document cannot take

Every item below is prepared up to the boundary and stops there.

| # | Approval needed | Exactly what it unblocks |
| --- | --- | --- |
| A1 | A hosting account in the client's name (Oracle Always Free needs a card for identity verification) | A stable public URL. Until then the only $0 path is B1, whose URL changes on restart |
| A2 | A domain (~$10–15/year, or the existing one) | `PUBLIC_ORIGIN`, a named Cloudflare Tunnel, a certificate the client controls, invite links that survive a restart |
| A3 | A Sentry account (free Developer plan) | Error grouping and the cron monitor for `db:backup` |
| A4 | An UptimeRobot account (free, 50 monitors, 5 minutes) | The primary alert; `uptime.yml` stays the backup layer |
| A5 | Permission to set `DEPLOY_URL` as a repository secret | Turns on the scheduled probe |
| A6 | Permission to schedule `db:backup` (cron or provider cron) | Daily dumps; the command and the verification already exist |
| A7 | A named person on call | Decides email-only versus paging, and who reads the issue the probe opens |
| A8 | Client sign-off on rules, brand, legal text, budget | The remaining P0 items in `docs/GAP-REPORT.md` |

No item on this list was attempted. None of them is a code change.

## 11. Readiness verdict

- **Runnable and provable today:** `docker compose up`, `npm run env:check`,
  `npm run smoke -- --full`, `npm run db:backup`, `npm run db:restore-check`,
  CI on push. All exercised in this phase (§7, `TEST-REPORT.md`).
- **Deployable the moment a URL exists:** the image, the compose file, the three
  provider manifests, the TLS templates, the runbook, this paper.
- **Not deployable publicly until:** A1–A8 above, plus the brand and legal text in
  `docs/CLIENT-SIGNOFF.md`. Nothing in that list is engineering work, and nothing
  in it was guessed.
