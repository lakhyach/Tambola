# Ninety Club database compatibility report

**Assessment date:** 4 November 2026
**Scope:** read-only configuration and architecture review; no provider switch, remote connection, migration, or production database change.

## Decision

**Yes. Ninety Club can use Supabase PostgreSQL with its current backend and authoritative multiplayer architecture. No database provider replacement or backend rewrite is required.** Supabase must be reached through a session-preserving connection: direct PostgreSQL on port 5432 when the application host supports IPv6 (or has Supabase's IPv4 add-on), or Supabase's shared **session** pooler on port 5432 from an IPv4-only host. Do not use the transaction pooler on port 6543 for this backend: its session-level advisory locks and session state are not preserved across transactions. Supabase documents these mode differences and recommends direct or session mode for long-lived sessions. [Supabase connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres), [transaction pooling limitations](https://supabase.com/docs/guides/database/connecting-to-postgres#transaction-mode-limitations).

This is a **static compatibility verdict**, not a live Supabase certification. No Supabase URL or credentials are configured in this workspace, so I did not connect to a Supabase project or run migrations there.

## What the application currently uses

- The active, ignored `.env` has `DATABASE_URL` pointing at `127.0.0.1:55432/tambola`, `DB_SCHEMA=public`, and `NODE_ENV=development`. The password is intentionally omitted here.
- A Node 24 launch using the repository's `--env-file-if-exists=.env` option resolves to that same host, port, database, schema, and environment. `npm run start`, `npm run server`, tests, migrations, and the environment check use that option. A process-level environment variable takes precedence over the file when already set.
- A **read-only** query succeeded against local PostgreSQL 16.14 and returned database `tambola`, schema `public`. Docker reports the local `tambola-pg` PostgreSQL 16 container mapped from host port 55432 to container port 5432.
- The current backend API is not listening on port 4000. This explains why the application was unavailable through the API; it does not indicate that its local database URI is missing.
- The tracked `.env.example` is a template with a local `127.0.0.1:5432` example. That is the container's internal/default port, while the workstation's current Docker host mapping is 55432. The current `.env` still matches the redacted URI supplied in the request; it has not been replaced by the template.
- `.env` is ignored by Git, is not tracked, and has no Git history entries. Consequently, the exact earlier contents or the date/reason for any past local edit cannot be reconstructed from commits. The observable difference is between the ignored local configuration and the tracked example template. It would be an inference to claim a more specific historical cause.
- The backend reads a single `DATABASE_URL` plus optional `DB_SCHEMA`. `RESTORE_ADMIN_DATABASE_URL` is a separate maintenance connection used by the restore-check utility. There is no Prisma or Drizzle configuration and no Supabase client/database URL in the browser configuration. The installed database driver is `pg` 8.23.1.

Relevant implementation: `server/index.js` resolves `DATABASE_URL`; `server/db/pool.js` constructs `pg.Pool`; `server/db/migrate.js` applies versioned SQL; and `server/persist/` owns durable writes and recovery.

## Why the architecture fits PostgreSQL on Supabase

Ninety Club keeps the authoritative room/game engine, Socket.IO transport, call scheduler, and caller/player sessions in its existing long-running Node process. PostgreSQL persists rooms, tickets, calls, claims, account/session records, audit events, and recovery state. Supabase's PostgreSQL database can serve as that persistence layer; it does not replace the Node server, Socket.IO, the game's authentication, or server-authoritative logic. Supabase Realtime and Supabase Auth are not required for this design.

The reviewed code uses standard PostgreSQL facilities:

- `pg.Pool`, transactions (`BEGIN`/`COMMIT`/`ROLLBACK`), constraints, and ordinary SQL.
- A dedicated connection holding `pg_try_advisory_lock` for the single-instance game-server lease; migrations also use an advisory lock.
- `search_path` selected through the PostgreSQL startup `options` parameter, plus a configurable schema.
- Transactional persistence before authoritative game state is broadcast.

Those requirements work with a direct PostgreSQL session or a session pooler. They do **not** fit transaction pooling, where the server connection can change between transactions and session-level advisory locks, `SET`/search-path state, and other session features are not guaranteed. The connection mode is therefore a real requirement, not a tuning preference.

The current application-side pool defaults to 8 clients. The persistent advisory lease consumes one additional connection, so plan for up to **9 Ninety Club database sessions per application process**, with additional headroom for migrations, monitoring, backup tools, and any other services. Supabase notes that project services also consume database connections and that both client and backend pooler limits apply. Check the chosen project's compute-specific limits before selecting a plan. [Supabase pool limits](https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits).

## Supabase connection configuration

Use the exact connection details copied from the Supabase Dashboard's **Connect** panel; do not construct the pooler hostname or username from a project reference.

| Mode | Host and port | Database/user | TLS |
|---|---|---|---|
| Direct (backend host supports IPv6 or project has the IPv4 add-on) | Dashboard-provided `db.[PROJECT_REF].supabase.co`, port `5432` | Database `postgres`; role `postgres` | Use `sslmode=verify-full` with the Supabase CA certificate path. |
| Shared session pooler (IPv4-only backend host) | Exact Dashboard-provided pooler hostname, port `5432` | Database `postgres`; role `postgres.[PROJECT_REF]` | Use `sslmode=verify-full` with the Supabase CA certificate path. |

Put the Dashboard-provided connection string in server-only `DATABASE_URL`; percent-encode any reserved characters in its password. Do not construct the pooler hostname or username yourself. Set `DB_SCHEMA=tambola_private` and keep `DB_POOL_MAX=8` unless measurements and the project's connection budget justify another value.

These are **templates only**, not working credentials. URL-encode reserved characters in the password. Keep the connection string only in the backend's environment/secret manager; never put it in `VITE_*`, browser storage, client bundles, or screenshots. Use Supabase's CA certificate and `verify-full` so TLS both encrypts and validates the server. Supabase describes `require` as encrypted without certificate/hostname verification and documents obtaining/configuring the CA certificate. [Supabase SSL guidance](https://supabase.com/docs/guides/platform/ssl-enforcement), [node-postgres SSL configuration](https://github.com/brianc/node-postgres/blob/master/docs/pages/features/ssl.mdx).

The present app defaults to `DB_SCHEMA=public`. Supabase's `public` schema is exposed through its Data APIs by default; tables in an exposed schema need carefully reviewed grants and RLS. Since the app does not need those APIs, prefer a dedicated non-exposed schema such as `tambola_private`, or explicitly disable/restrict the Data API and audit all grants. Do not assume that putting the database URL in the server alone makes publicly exposed tables safe. Supabase warns that exposed tables without RLS are accessible to roles with grants. [Supabase custom schemas](https://supabase.com/docs/guides/api/using-custom-schemas), [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).

### Migration compatibility and safe application

The repository currently contains **27 versioned SQL migrations**. The reviewed migration directory has no `CREATE EXTENSION`, `CREATE DATABASE`, role/user creation, `ALTER SYSTEM`, publication/subscription, or provider-specific SQL. The runner applies each migration transactionally and checks stored checksums. The local PostgreSQL-backed suite has already exercised the migration and persistence paths in disposable schemas; the latest full suite result recorded during the acceptance continuation was 736 passed, 0 failed, 0 skipped.

This supports compatibility with a clean Supabase PostgreSQL project, but it does not prove that an arbitrary existing Supabase schema is safe to migrate. Some migrations seed or update product data. Apply them first to a **separate, empty staging project** or isolated private schema and review the resulting schema, grants, migration status, and recovery behavior. Do not point the startup migration runner at a production project for the first test.

The project's restore-check script assumes it can create and drop a temporary database. A normal managed Supabase database role should not be assumed to have those cluster-level privileges. A Supabase adoption would need an independently verified backup/restore procedure using supported Supabase backups and/or a separate disposable PostgreSQL restore target; the current restore-check behavior is not certified against Supabase.

### Safe connectivity test plan (not run against Supabase)

After approval and provision of a non-production project:

1. Copy the exact direct or session-mode URL from the Dashboard into a server-only secret store; never paste it into chat or source control.
2. Set a private `DB_SCHEMA` and verify the Data API does not expose it. Use a new empty project, not production.
3. Run a read-only `SELECT 1` connectivity check first and verify TLS/certificate validation, database identity, schema, and server version without printing the connection string.
4. Apply migrations only to the staging target; record migration versions and checksums. Confirm the lease lock can be acquired and released using that same session-preserving mode.
5. Run database-backed persistence, transaction, reconnect, call durability, claim, and recovery tests against a dedicated throwaway schema. Verify connection counts and monitor idle/pool behavior.
6. Test backup and restoration separately; do not use the current restore-check script against the Supabase project unless its required database-creation privileges and cleanup have been proven on a disposable target.

## Provider comparison

| Provider | Fit for the existing backend | Main constraints | Assessment |
|---|---|---|---|
| **Supabase PostgreSQL** | Native PostgreSQL, `pg`, SQL migrations, transactions, and session advisory locks work with direct or shared session-mode connections. | Must choose direct/session mode, size connection limits, configure verified TLS, and secure the exposed `public` Data API schema. Free projects are 500 MB and can pause after a week of inactivity; the current pricing page lists Pro from $25/month with 8 GB included and daily backups retained 7 days. | **Recommended** after a staging proof. Pro is the better production starting point; Free is suitable only for development/experiments where pausing and lack of automatic backups are acceptable. [Connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres), [pricing](https://supabase.com/pricing). |
| **Neon PostgreSQL** | PostgreSQL/`pg` compatible when connecting directly; its pooled `-pooler` endpoint uses transaction pooling and is not suitable for the app's session lease. | A direct endpoint can support the lease, but the always-running 30-second lease heartbeat is likely to keep compute active. Neon currently advertises 100 CU-hours and 1 GB/project on Free; 100 CU-hours covers only 400 hours at 0.25 CU, below a 730-hour month. Cost is usage-based; confirm current rates and connection behavior before production. | Suitable for dev/staging and potentially paid production with direct connections and budget monitoring; not a drop-in choice of the pooled endpoint. [Neon Free plan](https://neon.com/blog/neon-free-plan-1-gb-per-project), [Neon pooled connections](https://neon.com/blog/survive-thousands-connections), [compute pricing](https://neon.com/blog/major-compute-price-reduction-on-neon). |
| **Amazon RDS for PostgreSQL** | Full PostgreSQL compatibility using direct sessions; no SQL or schema rewrite is required. | Costs vary by region, instance, storage, backups, and availability configuration. RDS Proxy can pin sessions when it sees `pg_advisory_lock` or session state, so do not assume its multiplexing benefits apply to this lease architecture. | A sound conventional managed-Postgres alternative if the app is already hosted in AWS or needs AWS operations; no technical reason here to prefer it over Supabase. [RDS pricing](https://aws.amazon.com/rds/pricing/), [proxy pinning behavior](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy-pinning.html). |
| **Firebase Firestore / Realtime Database** | Not PostgreSQL and cannot accept this app's `pg` SQL, migrations, relational constraints, or PostgreSQL advisory locks. Firebase could provide a different realtime transport, but Ninety Club already uses Socket.IO. | Would require a substantial persistence/schema and transaction/locking rewrite, followed by new recovery, audit, and concurrency tests. Firestore is document-oriented; Realtime Database is a JSON tree with subtree-scoped transactions. | **Not recommended** as a replacement for this architecture. [Firestore data model](https://firebase.google.com/docs/firestore/data-model), [Firebase database comparison](https://firebase.google.com/docs/database/rtdb-vs-firestore). |

## Credential and configuration security

- `.env` is ignored by `.gitignore`, is not a tracked file, and has no Git history entries. `.env.example` is a tracked template, not the runtime secret store.
- The repository's `secret-scan` passed during this assessment: 634 files checked, including the built client bundle, and 3 local `.env` values checked; no credential values or credential-shaped content were detected in shipped content.
- The current browser bundle does not receive `DATABASE_URL`; the application uses the server-side `pg` pool. Keep any future Supabase URL exclusively server-side.
- These checks cover the current worktree and confirm `.env` itself was never committed under that path. They do not constitute an exhaustive forensic scan of every historical blob for unrelated accidental copies of a credential.
- No actual Supabase password or project endpoint was present in the inspected environment files. No credential was printed, transmitted, or changed.

## Acceptance-audit continuation

- Route inventory: the existing source audit lists the 45 route templates and is linked in `docs/NINETY-CLUB-FRONTEND-AUDIT.md`; source inventory is not route-by-route browser verification.
- Chrome: the supported Computer Use integration still fails during runtime bootstrap with `failed to write kernel assets: The system cannot find the path specified. (os error 3)`, including after resetting and retrying the Node Computer Use kernel. Chrome is installed, but no supported runtime exposed a window. No alternate browser automation was used.
- Backend/API: the local PostgreSQL service is up and read-only connectivity succeeds; the app API was not listening on port 4000. No authenticated browser flows or live game were run.
- Screenshots/issues: no new screenshots were captured and no visual/functional defect was confirmed from actual rendered UI. No issue was invented from source alone.
- Roles/gameplay: no Super Admin, Admin, Host, Moderator, or Player browser session; no acceptance game, ticket play, claims, settlement, or role permission test was performed in this continuation.
- Database tests: local PostgreSQL-backed automated tests ran in isolated schemas in the previous acceptance verification; the full suite reported 736 passed, 0 failed, 0 skipped. This is not a Supabase migration test.
- Regression: the full automated suite passed previously; the current source has not changed in this database assessment. No new regression run was needed for this documentation-only update.
- Overall acceptance remains **FAIL / blocked**, not PASS: real Chrome visual review, role-based live gameplay, screenshots, and remote Supabase connection/migration proof remain outstanding.

## Recommendation and next action

Do not switch the current local database URI yet. Approve a **separate non-production Supabase staging project** for a compatibility proof, then put its exact Dashboard-provided **session pooler** URL into an ignored local secret file or deployment secret manager (not into chat or source). If the eventual application host has IPv6, use the Dashboard's direct connection instead. Confirm the production host's IPv4/IPv6 support and choose a Supabase plan with enough connections, always-on behavior, and backup retention before any production migration. No provider switch or migration has been started.


## 4 November 2026 continuation — existing Supabase URL supplied

The ignored `.env` now contains `DATABASE_URL`. The URL was inspected locally without printing it or its credentials. Sanitized metadata identifies a Supabase shared **session pooler** endpoint on port `5432`, database `postgres`, with a pooler username shape; `DB_SCHEMA=public` and `NODE_ENV=development`. The URL contains a password, but the value was never logged or recorded. The backend loads this file through its `--env-file-if-exists=.env` launch scripts, and `server/index.js` reads `process.env.DATABASE_URL`. No `.env` values were changed.

### Live connection evidence

- `npm run env:check` detects the managed remote URL but fails its TLS readiness check because the URL has no `sslmode`. Its other warnings concern unset public origin, proxy trust, and the default MFA issuer.
- A read-only `pg` connection was attempted with certificate verification explicitly enabled. The first attempt using Node's default trust roots returned `SELF_SIGNED_CERT_IN_CHAIN`. The repository's `deploy/supabase-root-ca.pem` is present and is a currently valid Supabase intermediate CA. Retrying with that CA and `rejectUnauthorized: true` completed TLS validation and reached PostgreSQL, which returned `28P01` (`password authentication failed`). The password and full username/host were not printed. This proves DNS/network reachability and a verified TLS handshake to the configured endpoint, but it does **not** establish whether the supplied password, username, or URL encoding is the rejected authentication detail.
- Because PostgreSQL rejected authentication before a SQL session was established, database identity/version, `pg_stat_ssl`, schema privileges, installed extensions, schema contents, and migration tracking state could not be read. Do not interpret the configured database name or `DB_SCHEMA` as proof of remote database identity or state.

### Compatibility and safety status

- **Connection mode (configuration evidence):** port `5432` on a Supabase pooler hostname indicates the session-pooler route, which is the right mode for this backend's session-scoped advisory lock. A successful authenticated session was not established, so pool behavior and advisory-lock compatibility were not live-tested.
- **TLS (live and static evidence):** a verified TLS handshake succeeds when the bundled Supabase CA is supplied. However, the current URL omits `sslmode`, `server/db/pool.js` does not explicitly configure TLS, and the runtime parser reports no SSL option. The normal application pool therefore has no explicit CA/hostname-verification configuration. `npm run env:check` correctly marks this configuration not ready. Do not start the backend against this URL until its server-side TLS settings are made explicit and the credential issue is resolved.
- **Migrations/extensions:** the repository contains migrations `001` through `027`; a static search found no `CREATE EXTENSION` statements. Remote migration checksums, whether any migrations are pending, the remote table count, and any data-changing effects relative to the live schema remain **not tested**, because authentication failed. No migration was run.
- **Staging identity:** `NODE_ENV=development` describes this local process, not the Supabase project's purpose. Neither the hostname nor the safe connection metadata can prove that the remote project is dedicated non-production staging. Production/staging status is **unverified**.
- **Heartbeat and server health:** the application lease acquisition writes to `instance_lease`, heartbeat updates that row, and startup applies migrations before taking the lease. These were not run. Doing so without authentication and confirmed staging would be unsafe. No backend process was started; health, Socket.IO, persistence, recovery, scheduler, and gameplay are **not tested**.
- **Test suite:** not run in this continuation. The repository's default test command loads `.env`; database-backed tests may create and drop isolated schemas. With the remote target's staging status unverified and credentials rejected, running that command could target an unconfirmed remote database, so it was deliberately withheld. The prior result of 736 passing tests remains historical evidence only, not a Supabase acceptance result.

### Computer Use and acceptance audit

The documented supported `@oai/sky` initialization failed with `failed to write kernel assets: The system cannot find the path specified. (os error 3)`. After the prescribed kernel reset and one retry, the same error recurred before any app/window state was returned. This is evidence of failure in the Computer Use kernel asset bootstrap; the error does not expose the missing internal path, so its exact filesystem cause cannot be determined from the supported diagnostics. No alternate browser automation was used, and no Chrome UI, role flow, responsive viewport, screenshots, or live multiplayer game was inspected in this continuation.

**Current verdict: BLOCKED / FAIL for end-to-end acceptance.** The Supabase endpoint is reachable over verified TLS when its CA is supplied, but credentials are rejected; the live database state and staging identity are unverified; normal backend TLS is not explicitly configured; and the supported browser integration remains unavailable. No database writes, migrations, application startup, tests, or project code changes were made. The only repository edits in this continuation are this report and the corresponding frontend-audit status update.



## 4 November 2026 follow-up — verified TLS configuration applied locally

After the initial TLS finding, the existing ignored `.env` `DATABASE_URL` was updated in place to add `sslmode=verify-full` and `sslrootcert=deploy/supabase-root-ca.pem`. The existing credentials and other environment assignments were preserved; no credential was printed. The repository CA had already completed a verified TLS handshake in the prior probe. The runtime connection-string parser now loads that CA and does not disable certificate verification.

- `npm run env:check` now reports 7 checks OK, 0 errors, and 3 unrelated warnings (public origin, proxy trust, default MFA issuer).
- A connection attempt using the exact normal `pg` URL configuration loaded from `.env` reaches PostgreSQL and still returns `28P01`. Thus the TLS configuration issue is resolved locally, but the authentication failure remains. Dashboard access was unavailable, so the exact rejected credential detail (password versus effective username/URL parameter) and the URL-to-project match remain unverified.
- `node --env-file-if-exists=.env --test tests/env-check.test.js`: 11 passed, 0 failed, 0 skipped. This is an isolated environment-validator unit test, not a database test.
- No TLS bypass was used. No application startup, SQL query, migration, database-backed test, heartbeat, or gameplay action was performed.

This correction supersedes the earlier continuation statement that the local URL lacked explicit TLS configuration. It does not change the unresolved remote authentication or staging blockers.



## 4 November 2026 follow-up — fresh Supabase authentication and read-only state check

A new Node process explicitly loaded the current ignored `.env` file after clearing any inherited `DATABASE_URL` in that child process. No URL or credential was printed. This was a fresh attempt, not a cached connection.

- DNS returned three IPv4 addresses. The URL points to a Supabase pooler hostname on port `5432`, uses database `postgres`, and contains the expected `postgres.<project-ref>` pooler username form. Authentication now **succeeds**. PostgreSQL reports the effective role as `postgres`.
- Read-only SQL reports database `postgres`, schema `public`, PostgreSQL `17.11`, and transaction read-only mode `on`.
- The node-postgres connection socket reports encrypted TLS and successful certificate authorization. The connection parser loaded the Supabase CA from `deploy/supabase-root-ca.pem`, `sslmode=verify-full` is active, and certificate verification is not disabled. `pg_stat_ssl` reports false for the backend PID on this pooled path; that server-side value does not override the verified client socket result.
- The schema exposes 18 ordinary/partitioned tables to this login; schema USAGE and CREATE are granted. Installed extensions are `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, and `uuid-ossp`.
- The migration tracker exists. Versions `001`, `002`, and `003` are applied and their stored checksums match the corresponding local files. There are no checksum mismatches or unknown versions. Local migrations `004` through `027` remain pending. Static inspection shows pending migrations include schema/data updates, backfills and seed inserts (including legacy room-instance backfill and theme catalog seeds); none were applied.
- PostgreSQL planner statistics show nonzero estimated rows in `audit_events`, `draw_calls`, `instance_lease`, and `room_schedule`. These are estimates, not exact counts, and no application rows were read. The database is initialized and not empty; these findings do not identify it as staging or production.
- The Dashboard could not be opened, so the actual Supabase project identity, intended-project match, Data API exposure/RLS settings, and dedicated staging status remain **unverified**. Because the database is initialized, has historical activity estimates, and its purpose is uncertain, no migrations, acceptance schemas, advisory-lock probes, lease/heartbeat writes, server startup, or gameplay tests were run. The backend auto-migrates on startup, so starting it would apply 24 pending migrations.
- The previous `28P01` no longer reproduces with the current `.env` credentials. The password was rotated according to the user; stale credentials are consistent with the old failure, but the former secret was not retained, so its precise historical mismatch cannot be proven.

### Computer Use diagnosis update

Windows reports Chrome installed at `C:\Program Files\Google\Chrome\Application\chrome.exe`, version `156.0.8078.80`, with 15 Chrome processes and one visible window. The local Windows temporary directory and Local AppData exist. These facts rule out a missing Chrome executable or absent local temp directory; they do not identify the path requested by the separate Computer Use kernel.

Both supported entry points still fail before exposing state: `@oai/sky` initialization and `cua.getState()` return `failed to write kernel assets: The system cannot find the path specified. (os error 3)`. The tool exposes no runtime process, asset destination, host logs, or configuration diagnostics before this failure. The bundled guidance documents initialization and a single reset/retry, already attempted; it does not provide a supported way to repair the host-owned kernel asset path. No helper executable was launched or searched for, no alternate automation was used, and no system configuration was changed. The exact missing internal path and its permissions cannot be diagnosed through the available supported interface.

### Current status

The latest Supabase connection is **PASS for authentication, TLS, server identity, and read-only migration inspection**. Supabase project identity/staging status is **BLOCKED**, so schema migration, server health, advisory-lock behavior, heartbeat, and acceptance gameplay remain **NOT TESTED**. The local TLS change from the preceding follow-up remains in place. The overall acceptance result remains **FAIL / blocked** pending staging confirmation and working real-Chrome Computer Use.



## 4 November 2026 — browser acceptance gate

The supported real Chrome integration still fails before browser state is available. Current initialization attempts using both documented Computer Use entry points return the same kernel-assets Windows path error. The separate recovery record is in `docs/COMPUTER-USE-RECOVERY.md`.

The last successful database work remains a read-only PostgreSQL 17.11 connection over verified TLS. The public schema has applied migrations 001–003 with matching checksums; 004–027 are pending, and catalog estimates indicate existing activity. The Supabase Dashboard project purpose remains unverified. No migrations, backend startup, lease writes, or database-backed acceptance tests were performed in this continuation.
