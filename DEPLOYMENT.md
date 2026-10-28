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
