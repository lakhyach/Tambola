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

## Post-deploy verification

Confirm the public URL, not just the build: landing page, room creation, an
invitation link + QR opened from another device, multiple players in one room,
room isolation, synchronised calls, reconnect/recovery, owner sign-in
(password + MFA), and `/livez` `/readyz` `/healthz` over HTTPS. No real money is
involved at any point.
