# Hosting Provider Deployment Checklists

Prepared for **Phase 8**. Nothing here has been deployed, purchased, or applied to
the database. Pick ONE provider, authorize it, then follow its checklist. All three
run the same repo-root `Dockerfile` as a **single long-lived instance** with
WebSockets, `/readyz` health checks, SIGTERM graceful shutdown, and the PostgreSQL
advisory lease intact.

## Requirement recap (why serverless/Vercel is out)

The app is a stateful Node process: persistent Socket.IO connections, a per-room
auto-call scheduler, in-memory projections, and a **database-wide advisory lock**
that allows exactly one instance. A host must keep one warm process, support
WebSockets and HTTPS, honour SIGTERM, and let us pin a region near the DB.

## Provider comparison (verified against official pages, Oct 2026)

| | Render (Hobby) | Railway (Hobby) | Fly.io | VM (e.g. Hetzner Cloud) |
| --- | --- | --- | --- | --- |
| Min. always-on cost | **$7/mo** (0.5c/512MB web service; Hobby workspace $0) | **$5/mo** plan incl. $5 usage; realistically **$5-9** (Memory $10/GB-mo, CPU $20/vCPU-mo, per-second) | **~$2.53/mo** (shared-cpu-1x 256MB, `fra`) + $0.02/GB egress; no free tier | raw VM cheapest (confirm current price) but + all ops |
| Free tier usable? | **No** - free web services spin down | No (would exhaust $1 credit; latency) | No free tier | n/a |
| Sleep / scale-to-zero | Paid tier never sleeps | Does not sleep by default | `min_machines_running=1` keeps warm | Full control |
| Frankfurt (AWS eu-central-1) region | **Yes** | Not clearly offered (likely US) - verify | **Yes** (`fra`, x1.154) | Germany/Finland DC |
| WebSockets / health check / auto-TLS / graceful shutdown / Docker / secret env | All yes | All yes (health check + region via dashboard) | All yes | DIY (you build all of it) |
| Single instance guaranteed | Yes (Hobby has no autoscaling) | Set numReplicas=1 | Set machine count/min=1 | Your responsibility |
| Ops effort | Lowest | Low | Medium | Highest |

**Recommendation: Render Hobby** (Frankfurt) for the best reliability-to-effort
ratio at ~$7/mo predictable cost - managed TLS, health checks, zero-downtime
deploys, WebSockets, and no autoscaling so it stays one instance next to the DB.
**Runner-up: Fly.io** if you want the lowest cost (~$2.5-5/mo) and don't mind more
config. Avoid Railway until you confirm an EU region, since a US region adds
cross-Atlantic latency to the Frankfurt Supabase DB that the 30s lease heartbeat
and real-time call writes both feel.

## Production configuration for ANY provider (identical requirements)

Environment variables - **secrets go in the provider's encrypted secret store, never in
the repo, never in `.env` committed**:

| Name | Value | Secret? |
| --- | --- | --- |
| `NODE_ENV` | `production` | no |
| `PORT` | provider default (the app reads it; our image defaults 4000) | no |
| `TRUST_PROXY` | `1` (all three are real TLS-terminating proxies) | no |
| `TAMBOLA_COOKIE_SECURE` | `1` (Secure cookies over HTTPS) | no |
| `PUBLIC_ORIGIN` | exact https origin (`https://<domain>`) | no |
| `DATABASE_URL` | your Supabase URL **+ `?sslmode=require`** (see TLS below) | **yes** |
| `OWNER_MFA_KEY` | your existing base64/hex key, set ONCE and backed up separately | **yes** |

Health check path: **`/readyz`** (fails closed on DB / migrations / lease / drain).
`/livez` is liveness-only; `/healthz` is the full snapshot. Shutdown grace: the app
drains on SIGTERM in well under a second, so a 15-30s grace is ample.

### Enabling TLS on the Supabase connection (without touching your local `.env`)

`server/db/pool.js` passes `connectionString` straight to `pg` with no `ssl` option,
so `pg` only uses TLS if the URL itself says so. The current URL has no `sslmode`,
and the Supabase session pooler accepts plaintext - so traffic is currently
**unencrypted**. To secure it you do NOT edit the repo `.env`; you set the value in
the provider's secret manager:

- Append `?sslmode=require` to the `DATABASE_URL` **stored as the provider secret**
  (encryption in transit; the pooler/Supabase cert is valid). This is the only
  change needed - it is a connection-string query param, not a code change.
- For strict certificate verification use `?sslmode=verify-full` and provide the
  Supabase/root CA (`fullchain.pem`) to the container; for a hobby game `require`
  is the standard, low-footprint choice.
- Because the DB password itself contains a `@`, keep the whole value quoted when
  pasting into the dashboard, and verify TLS with a one-off connection check that
  prints only `current_database()`/success - never the URL/password.
- Confirm you are on the **session pooler (port 5432)**, not the transaction pooler
  (6543): the lease uses a session-scoped advisory lock and pins `search_path` per
  connection, both of which break under transaction pooling.

### Owner account + MFA initialization (do this AFTER DB + env are confirmed)

1. The production Supabase DB is currently empty (no `owner_accounts`). Do **not**
   reset anything. Verify state first with a one-off run using the provider secret:
   `node scripts/owner.js status`.
2. If no owner exists, create it WITHOUT putting the password in source or logs:
   pass `OWNER_USERNAME`/`OWNER_PASSWORD` (or the hidden prompt) to a one-off
   command (`render run` / `fly ssh console` / Railway's `railway run`) that calls
   `node scripts/owner.js create`, then remove those transient env vars.
3. Ensure `OWNER_MFA_KEY` is already set as a secret BEFORE enrolling: enrolling
   seals the TOTP secret with it, and a later key change makes existing enrollments
   unreadable. Back `OWNER_MFA_KEY` up separately from the DB.
4. Sign in to `https://<domain>/admin` with the password, enroll MFA, and confirm by
   validating one code (enrollment stays pending until one code is confirmed).
5. Recovery if an authenticator is lost: `node scripts/owner.js mfa-reset` (requires
   the same `OWNER_MFA_KEY`) - documented in `server/ADMIN.md`.

### Preserve the safety controls

- **Single instance only.** Never enable autoscaling/replicas > 1; a second process
  is refused by the advisory lock and `/readyz` would fail - that is by design.
- **Backups.** The host filesystem is ephemeral - do not trust a local `backups/`
  dir. Rely on Supabase's own daily backup as the primary safety net, and/or run
  `npm run db:backup` on a schedule writing to object storage. `db:restore-check`
  needs host `pg_dump`/`pg_restore` and a role that can `CREATE/DROP DATABASE`.
- **Migrations** 001/002/003 apply automatically on first boot - **wait for plan
  approval before any deploy that would run them against Supabase.**
- No payments, entry fees, wagering, or prize payouts - free-to-play only.

## Per-provider quick steps

### Render (recommended)
1. Create a Render account (card required for the $7 paid instance; Hobby workspace is free).
2. New -> Blueprint -> connect `lakhyach/Tambola`. It reads `deploy/render.yaml`.
3. Confirm **region = Frankfurt**; instance **Starter (0.5c/512MB)**.
4. Set `DATABASE_URL` (with `?sslmode=require`) and `OWNER_MFA_KEY` as **secret
   Environment Values**; set `PUBLIC_ORIGIN` to the assigned `https://*.onrender.com`.
5. Deploy. Check `/readyz` returns `ready:true, lease.held:true`. Then run the Owner/MFA
   steps above. Custom domain + TLS: add in Render, set `PUBLIC_ORIGIN` to it.

### Fly.io (lowest cost)
1. `flyctl auth login` (card on file; no free tier).
2. Edit `deploy/fly.toml` `app=` to a unique name; `flyctl launch --from-file deploy/fly.toml`.
3. `flyctl secrets set DATABASE_URL=... OWNER_MFA_KEY=... PUBLIC_ORIGIN=https://<app>.fly.dev`
   (keep `DATABASE_URL` with `?sslmode=require`; primary region `fra`).
4. `flyctl deploy`; verify `/readyz` and one running machine (`min_machines_running=1`).

### Railway (verify region first)
1. Confirm an EU/Frankfurt region is offered for your project before committing;
   otherwise latency to the DB is a concern (see comparison).
2. New project from GitHub; it uses `deploy/railway.json` (Dockerfile build).
3. Add `DATABASE_URL` (+`?sslmode=require`), `OWNER_MFA_KEY`, `PUBLIC_ORIGIN` in Variables.
4. Deploy; verify `/readyz`. Keep `numReplicas: 1`.
