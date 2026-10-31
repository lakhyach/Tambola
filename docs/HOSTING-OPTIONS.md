# Hosting options, architecture and cost — decision paper

Phase 16 · prepared 31 October 2026 · build `2063f0b`

**Nothing in this document has been purchased, created, or deployed.** No provider account was
touched, no card was entered, and no resource exists as a result of this review. The prices are the
published list prices recorded in `deploy/README.md` (verified against provider pages, October 2026)
plus a pricing check on 31 October 2026; every figure must be re-verified in the provider's console at
the moment of purchase, because all of them change.

---

## 1. What the product actually requires

These are not preferences. Each one rules a hosting class in or out, and the reason is written in the
code, not in a marketing deck.

| Requirement | Why | Consequence |
| --- | --- | --- |
| One long-lived Node process | Socket.IO keeps per-socket state; live room projections live in memory | Serverless functions (Vercel, Netlify, Lambda without a container) cannot host this |
| Persistent WebSockets | Every call, claim and chat message rides a socket | The host must not buffer or half-close idle sockets; HTTP-only proxies are out |
| An in-process scheduler | Auto-call is a timer per room (`server/game/engine.js`) | The process must stay warm — no scale-to-zero, no cold starts |
| Exactly one active instance | A PostgreSQL advisory lease (`INSTANCE_LOCK_KEY`) admits one engine; a second instance fails `/readyz` by design | Autoscaling, replicas > 1, and blue/green overlap must stay off |
| PostgreSQL with session semantics | The lease is session-scoped and the pool pins `search_path`; transaction pooling breaks both | Managed **session** pooler (port 5432) or a direct connection — never a transaction pooler (6543) |
| TLS on the database link | Supabase's pooler presents its own CA | `?sslmode=verify-full&sslrootcert=/app/deploy/supabase-root-ca.pem` (bundled in the image) |
| HTTPS + real client IPs | Secure cookies, CORS origin checks, invite links | Terminate TLS at the platform proxy; `TRUST_PROXY=1`, `TAMBOLA_COOKIE_SECURE=1`, `PUBLIC_ORIGIN` set |
| A health endpoint the platform understands | `/readyz` fails closed on DB, migrations, lease or draining | Render/Fly/Railway health checks all support this |
| Graceful shutdown on SIGTERM | Drains calls, freezes rooms with a reason, releases the lease | Requires a 15–30 s stop grace, which all three providers give |
| Durable backups **outside** the container | The container filesystem is ephemeral | Provider daily backup and/or `db:backup` shipped to object storage |

Measured load, for sizing (Phase F, `.preflight/phaseF-*.log`): 400 concurrent joins across rooms with
**0 join failures**, call-to-screen fan-out p95 **53 ms** (3 600 events), call acknowledgement p95
**70 ms**, event-loop delay p99 **32 ms**; 800 sequential full room lifecycles with **0 errors**. The
work is I/O-bound; the expensive parts (speech, rendering) run on the player's phone.

---

## 2. Reference architecture (the same on all four options below)

```
        players' phones (no install)
                 │  HTTPS + WSS
                 ▼
   ┌───────────────────────────┐
   │  provider edge / proxy    │  TLS, X-Forwarded-*, CORS origin
   └─────────────┬─────────────┘
                 ▼
   ┌───────────────────────────┐        /readyz health check
   │  ONE app container        │◀────  (restart on failure, no autoscale)
   │  Express + Socket.IO      │
   │  per-room auto-call timer │
   │  owner console (/admin)   │
   └─────────────┬─────────────┘
                 │  TLS (verify-full, pinned CA)
                 ▼
   ┌───────────────────────────┐
   │  managed PostgreSQL       │  session pooler, port 5432
   │  migrations 001–004       │  daily backup (provider or db:backup)
   └───────────────────────────┘

   monitoring: /readyz probe + external uptime ping → email/phone
   logs: provider log stream (JSON lines, LOG_LEVEL)
   backups: provider daily + `npm run db:backup` → object storage; `db:restore-check` monthly
```

Deploy artefacts already in the repo: `Dockerfile` (multi-stage, builds the client, runs as a
non-root user), `docker-compose.yml` (single-VM variant with the app + Postgres + backup volume),
`deploy/render.yaml`, `deploy/fly.toml`, `deploy/railway.json`, `deploy/nginx-tambola.conf` and
`deploy/supabase-root-ca.pem`.

---

## 3. The four realistic options

### Option A — Render (Starter) + Supabase (existing project) — **recommended**

| | |
| --- | --- |
| App | Render Web Service, Docker, region **Frankfurt**, **Starter 0.5 CPU / 512 MB**, `numReplicas` fixed at 1 |
| Database | The existing Supabase project, **session pooler (5432)**, TLS `verify-full` with the bundled CA |
| Health | Render health check on `/readyz`; the app drains on SIGTERM |
| Ops effort | Lowest — managed TLS, managed deploys, no autoscaling so the single-instance lease is never fought |
| Risks | 0.5 CPU is a small ceiling; Render restarts on deploy (rooms freeze and recover) |

Cost: **$7/mo** for the app. Database: **$0** on Supabase Free (500 MB, pauses after 7 days of
inactivity, **no daily backups**) or **$25/mo** on Supabase Pro (8 GB, daily backups, never pauses).
For a game that must be reachable on a Saturday night after a quiet week, Free is not safe; the honest
choice for a launch is Pro.

**Option A totals: ~$7/mo (free DB, friends-and-family, accepting pause risk) or ~$32/mo (Pro DB).**

### Option B — Fly.io (shared-cpu-1x, 512 MB, `fra`) + Supabase

| | |
| --- | --- |
| App | `deploy/fly.toml`, `min_machines_running = 1`, exactly one machine, primary region `fra` |
| Database | same Supabase project |
| Ops effort | Medium — `flyctl` for deploys, secrets and logs; no dashboard hand-holding |
| Risks | No free tier (card required); 256 MB is too tight for Node 24 + a 350 kB client bundle, so plan on 512 MB |

Cost: roughly **$3.20–4/mo** for a 512 MB shared machine plus a small egress charge, plus the same
database choice as Option A. **Total ≈ $3.20/mo (free DB) to ≈ $29/mo (Pro DB).**

### Option C — Single VM (e.g. Hetzner CX22) + `docker compose` + Caddy

| | |
| --- | --- |
| App | The repo's `docker-compose.yml`: app + Postgres 16 + a named backup volume, one host |
| Database | Self-hosted in the same compose file (no managed pooler, so no TLS pinning needed) |
| Ops effort | **Highest** — OS patching, Docker upgrades, Caddy TLS, Postgres upgrades, off-host backups, alerting; all of it is the operator's job |
| Risks | A single VM is a single point of failure with no managed daily backup; recovering a lost disk is a data-loss event unless off-host dumps exist |

Cost: **~€3.79 ≈ $4.20/mo** for the VM plus a domain. Cheapest by a few dollars, most expensive in
attention. Only sensible if the operator wants to run infrastructure.

### Option D — Railway + Supabase

| | |
| --- | --- |
| App | Docker build via `deploy/railway.json`, `numReplicas: 1` |
| Risks | **EU region availability must be verified before committing** — a US region puts the lease heartbeat and every call write across the Atlantic to a Frankfurt database |

Cost: **$5–9/mo** usage-based (memory $10/GB-month, CPU $20/vCPU-month, per second), plus the
database choice. **Total ≈ $5–9/mo (free DB).** No advantage over A or B for this workload.

### Cost summary

| Option | App / month | DB / month | Realistic total | Ops burden |
| --- | --- | --- | --- | --- |
| A. Render + Supabase **Pro** | $7 | $25 | **~$32** | Lowest |
| A. Render + Supabase Free | $7 | $0 | **~$7** (pause + no-backup risk) | Lowest |
| B. Fly 512 MB + Supabase Pro | ~$3.20–4 | $25 | **~$29** | Medium |
| B. Fly 512 MB + Supabase Free | ~$3.20–4 | $0 | **~$4** | Medium |
| C. VM + compose (self-hosted DB) | ~$4.20 | $0 | **~$4.20** | Highest |
| D. Railway + Supabase | $5–9 | $0–25 | **~$5–34** | Low–medium |

Plus, once, outside any provider: **a domain, ~$10–15/year** (~$1/mo), and an optional external uptime
monitor (free tiers exist at 5-minute intervals). SSL is included by every option above.

**Recommendation.** Start on **Option A with Supabase Pro (~$32/mo)** if the product must never be
down and must have managed daily backups; start on **Option A with Supabase Free (~$7/mo)** only if
the launch is a known-date event and `db:backup` is scheduled to object storage from day one. Revisit
if concurrency exceeds a few hundred simultaneous players — at that point the evidence says the
bottleneck is the database link and the app's CPU, not the socket layer, so the first upgrade is
Render Standard (1 CPU / 2 GB, ~$25) rather than a second instance (which the lease forbids anyway).

---

## 4. Current production state (as of this review)

- The repository documents a **Supabase production database** reachable through the session pooler,
  with the CA bundle committed and a verified `verify-full` handshake. `deploy/README.md` records that
  the database was empty (no `owner_accounts`) at the time those notes were written; nothing in this
  phase touched it, paused it, migrated it, or connected to it.
- **No application deployment is evidenced.** There is no public URL in the repo, no provider-specific
  runtime evidence, and no Render/Fly service referenced anywhere except in the checklists. Treat the
  app as *not deployed*.
- Local verification during Phase 15/16 used a **local Docker Postgres on port 55432** and ephemeral
  servers on 4100; none of that is production.

## 5. Operating model once deployed

| Duty | Cadence | Who | Command / signal |
| --- | --- | --- | --- |
| Health | continuous | provider + external pinger | `/readyz` → 200; `/healthz` for the full snapshot |
| Backup | daily | provider (Pro) **and** `npm run db:backup` | manifest + `pg_dump -Fc` archive |
| Restore proof | monthly | operator | `npm run db:restore-check` — restores into a throwaway DB and compares the ledger, tables, row counts and call sequence |
| Certificate | automatic | provider | renew-on-deploy |
| Dependency patching | monthly | engineering | `npm audit`, `npm run verify` |
| Migrations | on deploy | the app at boot | checksummed, ledgered in `schema_migrations`; never run by hand |
| Incident | as needed | whoever answers the phone | `server/RUNBOOK.md` |
| Secret rotation | yearly / on suspicion | operator | `OWNER_MFA_KEY` **cannot** change while MFA enrollments exist — back it up separately |

## 6. What is explicitly out of scope until approved

- Creating any account, service, database, domain, or DNS record.
- Entering a payment card anywhere.
- Deploying the app or running migrations against the production database.
- Enabling a second instance, a staging replica, or autoscaling.

Approval needed from the client: **which option (A/B/C/D), which database tier, and who owns the
account.**
