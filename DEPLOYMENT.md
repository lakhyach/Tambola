# Production Deployment

Tambola is a **free-to-play** multiplayer Tambola/Housie game: a long-running
Node.js server (Express + Socket.IO) that serves the built React client, backed
by PostgreSQL. This document is the deployment contract; `server/RUNBOOK.md`
covers operations, `server/ADMIN.md` the owner plane, `server/DATABASE.md` the
schema.

## Why not Vercel / ordinary serverless

The server keeps **state in the process**: persistent Socket.IO connections, a
per-room auto-call scheduler, and in-memory live projections that
`syncRoomStateToClients` rehydrates on reconnect. It also takes a **database-wide
advisory lease** (`server/db/pool.js`, `INSTANCE_LOCK_KEY`) that deliberately
allows exactly **one** application instance. A serverless function can scale out,
cold-start, or run more than one instance, which either duplicates work or trips
the lease and fails `/readyz`. The previous `vercel.json` pointed at a
non-existent root `index.js` and could not work; it has been removed.
`server/RUNBOOK.md` section 11 has the full assessment.

**Use a host that runs one warm, continuously running container/process with
WebSocket support** — Fly.io, Google Cloud Run (min-instances=1 + sessions),
AWS ECS/App Runner, Railway, Render, a container service, or a plain VM with
Docker. The repo ships a `Dockerfile` and a single-host `docker-compose.yml`.

## Build & run

```bash
# Reproducible image (multi-stage: builds client/dist, installs prod deps only).
docker build -t tambola .

# One-off run against an existing managed Postgres:
docker run -d -p 4000:4000 --env-file .env --name tambola tambola

# Or the whole stack on a single VM (app + Postgres + persistent volumes):
docker compose up -d --build
```

The client is built into `client/dist` inside the image; the server serves it and
resolves it at `../client/dist` relative to `server/index.js`.

## Environment variables (names only for secrets)

Set these on the host / secret manager — **never** commit real values:

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes (secret) | `postgres://…` connection string |
| `DB_SCHEMA` | no | defaults to `public`; must pre-exist for non-public |
| `NODE_ENV` | yes | `production` |
| `PORT` | yes | the host usually injects this |
| `PUBLIC_ORIGIN` | prod | exact https origin for cookies/CORS/invites |
| `TRUST_PROXY` | topology | `1` only when a real reverse proxy sets forwarding headers |
| `TAMBOLA_COOKIE_SECURE` | prod | `1` so session/owner cookies are `Secure` over HTTPS |
| `OWNER_MFA_KEY` | yes (secret) | base64 32-byte key sealing MFA secrets; cannot change once enrollments exist |
| `OWNER_USERNAME`/`OWNER_EMAIL`/`OWNER_PASSWORD` | bootstrap only | consumed on first boot, then remove |
| `LOG_LEVEL` / `LOG_FILE` / `LOG_MAX_BYTES` / `LOG_KEEP` | no | see `server/RUNBOOK.md` §6 |

Full list with safe defaults is in `.env.example`.

## First boot: migrations, owner, data safety

- Migrations `001_init`, `002_owner`, `003_hardening` apply **automatically** on
  startup and are checksummed + ledgered in `schema_migrations`. Do not run them
  by hand unless `AUTO_MIGRATE=0`. Never drop or recreate a database that has
  data.
- The owner account is created only if it does not exist. Verify state first with
  `node scripts/owner.js status` (needs the prod env). Do **not** reset the owner
  or MFA unless the credentials are genuinely lost; recovery is
  `node scripts/owner.js mfa-reset` and requires `OWNER_MFA_KEY`.
- Exactly **one** application instance. `/readyz` and `/healthz` report the lease;
  `lease: held:false` on a would-be second instance is the intended signal.

## Health, shutdown, HTTPS

- `/livez` liveness (never touches the DB), `/readyz` readiness (DB + migrations
  + lease + not draining), `/healthz` full snapshot. The Dockerfile wires a
  `HEALTHCHECK` on `/readyz`.
- SIGTERM drains (stops new calls, `503` on `/readyz`, closes sockets, releases
  the lease); rooms mid-game freeze with a reason and recover on the next boot.
- Terminate TLS at the reverse proxy / load balancer, forward `X-Forwarded-Proto`
  and `X-Forwarded-For`, and set `TRUST_PROXY=1`, `TAMBOLA_COOKIE_SECURE=1`, and
  `PUBLIC_ORIGIN=https://your-domain` so Socket.IO origin checks and invite links
  are correct.

## Backups

`npm run db:backup` writes a `pg_dump -Fc` archive plus a manifest **outside** the
live data directory; `npm run db:restore-check` restores into a throwaway database
and verifies the ledger, table inventory, row counts and the call-log-vs-draw
sequence, then drops it. On a host with an ephemeral filesystem, ship dumps to
separate durable object storage (the `backups/` volume in `docker-compose.yml` is
a local example only). `OWNER_MFA_KEY` is backed up separately from the database.
Details: `server/RUNBOOK.md` §7.

## Managed Postgres (e.g. Supabase) notes

The project's production `DATABASE_URL` is a Supabase **session pooler**
(`…pooler.supabase.com:5432`). Two things matter for this app specifically:

- **Use the session pooler (port 5432), never the transaction pooler (6543).**
  The single-instance lease uses a session-scoped `pg_try_advisory_lock` and the
  pool pins `search_path` per connection (`server/db/pool.js`); transaction
  pooling multiplexes sessions and breaks both. Verified: the app's connection
  path (connection string only) reaches Supabase and holds the lease.
- **Enable TLS in production.** The URL as shipped connects without `sslmode`,
  which the Supabase pooler accepts but leaves game data and credentials in
  plaintext. Supabase's pooler is signed by its **own private CA**, not a
  publicly-trusted one, so on current `pg`/`pg-connection-string` a plain
  `?sslmode=require` (now an alias for `verify-full`) FAILS with "self-signed
  certificate in certificate chain". Use the safest supported form:
  `?sslmode=verify-full&sslrootcert=/app/deploy/supabase-root-ca.pem` (the public
  CA bundle is committed at `deploy/supabase-root-ca.pem` and baked into the image
  by the `Dockerfile`). If you cannot ship the CA, fall back to `?sslmode=no-verify`
  (encrypted, identity unverified). Verify the connection still succeeds in the
  target environment before cutover.
- **Backups**: `db:restore-check` needs a role that can `CREATE/DROP DATABASE`
  and real `pg_dump`/`pg_restore` binaries on the host (`PG_BIN`). The pooler role
  has `createdb`, but run the client tools from the host against a maintenance
  connection, and treat the provider's own daily backup as the primary safety net.
- **Never run the automated test suite against the production database.** It
  creates and drops `tambola_test_*` / `tambola_harden_*` schemas; point
  `DATABASE_URL` at a scratch database when testing (as done here on a local
  container), not at the live `postgres` database.

## Post-deploy verification

Confirm the public URL, not just the build: landing page, room creation, an
invitation link + QR opened from another device, multiple players in one room,
room isolation, synchronised calls, reconnect/recovery, owner sign-in
(password + MFA), and `/livez` `/readyz` `/healthz` over HTTPS. No real money is
involved at any point.

`npm run smoke -- --url https://your-domain --full` performs the mechanical part of
that list and exits non-zero on the first failure: /livez, /readyz (refusing a
memory-mode server), /healthz (requiring current migrations), the SPA, a real
Socket.IO handshake, and — with `--full` — one complete round in a room of its
own. The human part is still the human part: a second device, a real handset, and
the owner console.

## Appendix A — the pre-start gate

```bash
npm run env:check -- --production     # exits non-zero on any unsafe value
```

It re-reads the same environment the server will read and prints a report that
never contains a value. It refuses, in production: a missing or unparseable
`DATABASE_URL`; a default or empty database password; a remote host with no
`sslmode` or with `disable`/`prefer`; `ALLOW_MEMORY_ONLY=1`; a missing, non-https
or path-bearing `PUBLIC_ORIGIN`; `TRUST_PROXY` other than `1`;
`TAMBOLA_COOKIE_SECURE` false; a malformed `OWNER_MFA_KEY`; `DB_POOL_MAX` above the
ceiling of 50. It warns on a localhost database, port `6543` (the transaction
pooler, which breaks the session-scoped lease) and gameplay values outside their
ranges. Run it in the pipeline, before the container, so a misconfiguration is a
failed deploy rather than a bad first hour. Full reference:
`docs/DEPLOYMENT-READINESS.md` §1.

## Appendix B — pool sizing, measured

`DB_POOL_MAX` (default 8, ceiling 50) is the one capacity dial. The instance lease
holds one connection outside the pool, so keep `DB_POOL_MAX + 1` under the plan's
client-concurrency limit. Measured with `scripts/loadtest.mjs` at 50 rooms × 250
players, calls fired back-to-back (harsher than real play) against local
PostgreSQL 16:

| `DB_POOL_MAX` | ack p95 | ack p99 | peak waiters | tx p99 | lock waits |
| --- | --- | --- | --- | --- | --- |
| 8 | 84.8 ms | 101.2 ms | 42 | 158.2 ms | 1 |
| 16 | 65.0 ms | 89.8 ms | 34 | 236.7 ms | 1 |
| 32 | 56.4 ms | 62.9 ms | 18 | 320.8 ms | 16 |

At a 42-deep queue the database was idle (peak 7 active of 8, longest query 23 ms,
cache hit 100%, zero deadlocks), so the queue is pool checkout, not database
capacity. **Use 8 for real play, 16 for a known ~50-room peak, and never size the
pool to "make the queue go away".** Zero duplicate calls, zero cross-room leakage
and 50/50 reconnects held at every size.

## Appendix C — continuous integration

`.github/workflows/ci.yml` (free on a public repository): a `postgres:16-alpine`
service; `npm test`, lint, client build, `secret-scan`, `security-probe`;
`e2e` and `e2e:durable`; `db:backup` + `db:restore-check` with the archive
uploaded as an artifact; a self-test that `env:check --production` fails on an
unsafe environment; and a second job that builds the image and curls `/livez`
inside the container. `.github/workflows/uptime.yml` probes `/readyz` and
`/healthz` every 20 minutes at `secrets.DEPLOY_URL` and opens (then closes) an
issue. With no secret it exits green and says so.

## Appendix D — rollback

1. `docker stop` (SIGTERM) — drains, freezes rooms with a reason, releases the
   lease. Never `kill -9`; the lease would have to time out instead.
2. Start the previous image tag with the same `DATABASE_URL`. Boot recovery
   rebuilds open rooms from the database, not from memory.
3. A bad migration is not rolled back by hand: restore the pre-deploy dump into a
   fresh database, prove it, then repoint `DATABASE_URL`.
4. A rollback freezes every room in play. That is the correct trade against
   double-calling numbers.

## Appendix E — monitoring with no vendor account

`/healthz` reports `scheduler { armed, nextDueInMs, overdue, ticking }` and
`pool { total, idle, waiting, max, errors }` next to the lease and migration
state. `scheduler.ticking === false` with `armed > 0` is "the calling clock
stopped"; `overdue` is "a timer is more than a minute late"; `pool.waiting`
persistently above zero is "requests are queueing". `overdue` is deliberately not
a readiness failure — one late timer during a deploy is not a reason to drain the
instance that is catching up. The practical arrangement, all $0: UptimeRobot
(50 monitors, 5-minute interval) as the primary alert, `uptime.yml` as the backup
layer, and the platform's log stream for the JSON lines. Sentry, R2 and Resend are
documented in `docs/FREE-INFRASTRUCTURE-RESEARCH.md` and deliberately not
activated: they need an account.

## Appendix F — the $0 deployment, precisely

`docs/FREE-INFRASTRUCTURE-RESEARCH.md` holds the research; the short version is
that a genuinely free 24/7 host with a stable hostname does not exist at this
scale. The zero-cost options are this machine behind a Cloudflare Quick Tunnel
(URL changes on restart, no uptime guarantee, 200 in-flight requests) or Oracle
Cloud Always Free (card required for identity verification, and an idle 30-day
account may be reclaimed). Render Free and Railway Free are **not** options: Render
suspends after 15 minutes without HTTP *or WebSocket* traffic and deletes its free
database after 30 days; Railway's free plan grants $1 of usage per month and no
custom domains. `docs/DEPLOYMENT-READINESS.md` §3 has the provisioning commands
and §10 lists every approval that remains.

