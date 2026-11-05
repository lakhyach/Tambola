# Hostinger VPS deployment preparation

Status: configuration and runbook prepared; **nothing has been purchased, deployed, or connected to a Hostinger account**. No Hostinger account connector is available here, so the hosting product/plan already owned by the user is unknown. Confirm its plan name and VPS resources in hPanel before choosing a migration path.

## Compatibility finding

This application requires one continuously running Node.js process. Socket.IO accepts inbound WebSocket connections, game auto-call timers continue between requests, the live room projection is held in memory, and PostgreSQL advisory locking intentionally rejects a second app process. Hostinger’s current official Node.js limits page says Web/Cloud Node.js plans do **not** support inbound WebSockets or always-running background workers, and stop requests after 120 seconds. Those plans do not meet this app’s requirements, even though Hostinger supports Express/Node deployments there. Hostinger’s official guidance lists VPS hosting for custom server configuration, and its Docker VPS template is Ubuntu 24.04 with Docker Engine and Compose preinstalled. A VPS is therefore the viable Hostinger product class; Horizons/static hosting is not a replacement for the server.

The exact plan in the owner’s account is unverified. Do not purchase or upgrade from this document. For a first VPS that runs both the app and PostgreSQL locally, use at least **2 vCPU and 4 GB RAM as a planning floor**, with a persistent SSD volume sized for database growth and retained backups. This is an engineering starting point, not a measured capacity claim. Load-test the exact VPS, database size, and expected concurrent rooms before setting a production capacity. A managed external PostgreSQL may reduce local disk/backup pressure, but requires verified TLS and network access and does not remove the single app-process rule.

Official references (checked 1 November 2026):

- [Hostinger Node.js hosting options](https://www.hostinger.com/support/node-js-hosting-options/)
- [Hostinger Node.js limits for Web and Cloud plans](https://www.hostinger.com/support/hostinger-node-js-limits-for-web-and-cloud-plans/)
- [Hostinger VPS overview and supported technologies](https://www.hostinger.com/support/8852150-what-is-a-self-managed-vps-at-hostinger/)
- [Hostinger Docker VPS template](https://www.hostinger.com/support/8306612-how-to-use-the-docker-vps-template-at-hostinger/)

## Architecture

```text
Internet HTTPS/WSS :443
        │
        ▼
Hostinger VPS firewall → Caddy (automatic TLS, reverse proxy, WebSocket upgrade)
        │ 127.0.0.1:4000
        ▼
one Tambola Node container ─── private Docker bridge ─── PostgreSQL 16 container
```

The included stack binds the Node service to loopback, keeps PostgreSQL off host ports, persists the PostgreSQL data and backup volume, and runs exactly one app replica per configured database/schema pair. PostgreSQL uses an internal-only Docker network; the app also has a separate egress network for optional voice and poster providers. Caddy runs on the VPS host and proxies to `127.0.0.1:4000`; it handles the Socket.IO upgrade automatically. No Redis is required by the present architecture. Docker restart policies supervise container restart, bounded per-container JSON log rotation limits local disk use, and the app has a 60-second stop grace period to drain sockets and persist orderly room shutdown. The app runs as the image's non-root `node` user, with a read-only root filesystem and writable `/tmp`/backup mounts. The application’s `/livez`, `/readyz` and `/healthz` expose the existing operational signals. Do not add a second app process or replica for the same schema: the database lease is a correctness lock, not a load-balancing mechanism.

## Provision and deploy (operator checklist; not executed)

1. In hPanel, confirm the available plan is a VPS with root/SSH access, and note CPU/RAM/disk/region. If the account only has Web/Cloud hosting, stop: those plans do not provide the inbound WebSocket and always-on-worker behavior this app needs.
2. Select Hostinger’s Ubuntu 24.04 Docker template (or a supported Ubuntu image and install Docker Engine + Compose). Configure SSH keys and a non-root deploy account with Docker access. Keep an out-of-band recovery path. Install PostgreSQL client utilities on the host only if the separate host backup helper will be used; select a PG17-or-newer client compatible with the managed database.
3. Configure the VPS firewall to permit SSH only from trusted operator IPs where practical and public TCP 80/443. Do not open 4000 or 5432. Hostinger firewall policy and OS firewall both need review; Docker published-port rules can interact with UFW, which is why this stack binds the app port to loopback and exposes no database port.
4. Install Caddy on the host using its official package instructions. Copy `Caddyfile.example` to `/etc/caddy/Caddyfile`, replace the example hostname, validate it (`caddy validate --config /etc/caddy/Caddyfile`), then reload Caddy. Point the domain’s A/AAAA records only after explicit DNS authorization.
5. Put the repository in `/opt/tambola`. Create `.env` from `.env.example`, add the three `POSTGRES_*` values used by the Compose file, chmod it `600`, and set at minimum:
   - `POSTGRES_PASSWORD` to a long random **hex** value (URL-safe because this Compose file constructs the internal PostgreSQL URL).
   - `PUBLIC_ORIGIN=https://your-approved-domain`.
   - `OWNER_MFA_KEY` to the existing 32-byte owner MFA key if migrating an existing DB, or generate a new one only for a fresh DB and back it up separately.
   - `DATABASE_URL` for the host-side preflight only: use a local PostgreSQL URL with the same strong password (the app container receives its own `db:5432` URL from Compose). The test gate checks configuration; it does not connect to the database.
   - `SARVAM_API_KEY` and `OPENAI_API_KEY` only if the account owner has authorized the corresponding provider feature and billing. Keep both server-side; never use a `VITE_*` variable.
6. Review the generated compose configuration without printing `.env`: `docker compose --env-file .env -f deploy/hostinger/compose.yml config --quiet`.
7. Run `npm run env:check -- --production` on the host with a production-valid operator `.env`. For this local Compose stack, the app’s `DATABASE_URL` is constructed privately as `db:5432` on the internal-only database network and flagged with `DATABASE_PRIVATE_NETWORK=1`; the host-side checker can use a loopback DB URL for that same local PostgreSQL service. Database traffic inside the private network is not TLS-encrypted. If using a remote database, configure verified TLS (`sslmode=verify-full`) and the provider’s CA as required. The app must be `NODE_ENV=production`, `TRUST_PROXY=1`, and `TAMBOLA_COOKIE_SECURE=1` behind Caddy.
8. Take and verify a backup before changing an existing database. Apply the reviewed migrations explicitly with `docker compose --env-file .env -f deploy/hostinger/compose.yml run --rm app npm run migrate`; then build and start one replica: `docker compose --env-file .env -f deploy/hostinger/compose.yml up -d --build`. Inspect `docker compose ... ps` and logs. Check `https://your-approved-domain/livez`, `/readyz`, and `/healthz`, then run the production smoke suite against the intended environment only after its database is explicitly provisioned.
9. Create the owner account only after confirming database state; enroll MFA; verify a full regular and bumper game; exercise restart/recovery; then monitor database, disk, RSS, pool waiters, event-loop delay and scheduler state.

Application startup is read-only with respect to schema by default. It checks the migration ledger and refuses readiness when migrations are pending or drifted. Apply schema changes only through the explicit `npm run migrate` command after backup and review. `AUTO_MIGRATE=1` is available for development only; production environment validation refuses it.

### Existing Supabase database

Use `compose.supabase.yml` for the already-configured external Supabase Session Pooler. This file defines **no local PostgreSQL service**. Put the verified Session Pooler URI in the host `.env` with `sslmode=verify-full` and `sslrootcert=/app/deploy/supabase-root-ca.pem`; confirm its project reference and pooler endpoint before deployment. Keep `DB_SCHEMA=public`, `DB_POOL_MAX=8`, and exactly one app instance. Check the rendered Compose configuration with `docker compose --env-file .env -f deploy/hostinger/compose.supabase.yml config --quiet` (do not print the rendered environment to logs). Take and verify a production backup before running `docker compose --env-file .env -f deploy/hostinger/compose.supabase.yml --profile ops run --rm migrate`. Then start the app with `docker compose --env-file .env -f deploy/hostinger/compose.supabase.yml up -d --build app`.

## Backups and restore

The Compose volume `tambola-backups` is convenient scratch storage, not an off-site backup. `tambola-backup` creates a mode-0600 custom-format dump via the PostgreSQL container, verifies its archive directory, atomically renames it, and writes a SHA-256 sidecar. Install it as `/usr/local/sbin/tambola-backup`, verify permissions and a test run, then use `tambola-backup.cron.example` as the daily schedule. Keep the encryption key in a separate secure recovery system and copy encrypted archives to a separately controlled off-site destination with retention. This helper deliberately does not configure a storage provider or credentials. Before launch, configure an approved off-site destination and test the full backup → isolated restore → application recovery path. Never use the live database as the restore-check target.

The image carries PostgreSQL 17 client tools, compatible with the confirmed PostgreSQL 17.11 Supabase server. Backup tooling passes `PGSSLMODE=verify-full` and the configured CA path to libpq separately from the command arguments; remote backups refuse a missing verified-TLS configuration. A successful `pg` connection is not a backup verification. Before launch, produce a custom-format backup, validate the archive, restore it into a separate disposable PostgreSQL 17 target, compare the manifest, and run application integrity checks. These conditions are not yet met: this workstation has no `pg_dump`/`pg_restore` binary and its Docker daemon is unavailable.

## Recovery, rollback and operations

- **App rollback:** stop the app container gracefully, deploy the previous immutable image tag, and retain the same DB. Do not roll migrations backward; if a migration/data defect requires recovery, restore the pre-upgrade archive into a separate database and explicitly switch only after verification.
- **Database recovery:** stop app writes, restore into a newly named database/volume, verify migrations, counts and game history, and then update the app’s DB endpoint with a reviewed maintenance procedure. Keep the original volume read-only until acceptance.
- **Host loss:** provision a replacement VPS, restore off-site database backup, restore the same MFA encryption key, configure secrets and domain TLS, then verify readiness and reconnect recovery. A database dump alone cannot recover enrolled MFA secrets without that key.
- **Monitoring:** externally probe `/livez` and `/readyz`; alert on unavailable readiness, repeated restart loops, disk pressure, database connection errors, nonzero pool waiters, overdue scheduler signals, failed backup/upload, and backup age. `/healthz` is an operator diagnostic and may contain operational detail; do not expose it publicly beyond the app’s intended policy.
- **Logs:** Docker logs are structured JSON; the included Compose stack retains at most five 10 MB files per container. Ship critical alerts/backups off host as well. Avoid logging connection strings, session cookies, recovery tokens, or MFA material.
- **Capacity:** the current project’s load harness measures a particular test setup, not this Hostinger VPS. Run stepped and soak tests on a disposable staging DB/VPS, record CPU, memory, event-loop delay, pool pressure and call fan-out, then set documented safe limits with headroom. Never load-test a production database.

## Explicit unknowns

The owner’s current Hostinger plan, VPS inventory, account-level WebSocket features, region, domain/DNS state, and backup add-ons could not be inspected without account access. Official support documentation describes product classes and limits; it does not establish what this account owns. Check hPanel before scheduling a migration. No upgrade, purchase, DNS change, secret rotation, production database change, or deployment was performed for this guide.

## Local production-image verification — 1 November 2026

The Node 22 image was built from the repository Dockerfile. It was then run with the included production settings against a fresh, isolated PostgreSQL 16 container, a generated test-only MFA key, and host port 4174 (leaving port 4000 untouched). `scripts/smoke-deploy.mjs --full` passed all 11 checks: liveness, readiness, current migrations, built SPA, Socket.IO handshake, host WebSocket, room creation, second-player join, ticket issue, call fan-out and game completion. The app, database, volume and network were removed after the run. This validates the container/application path locally; it does not establish the owner's Hostinger plan, reverse-proxy/TLS setup, off-site backup, or production capacity.
