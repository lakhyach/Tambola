# Scheduled Bumper game auto-start

## Runtime behavior

Automatic start is an explicit per-session setting and defaults to off. Only a
published session with a linked waiting room is eligible. The session's
`starts_at` value is an absolute `timestamptz`; `time_zone` describes the
operator-entered wall time for display and audit. The admin form converts the
selected IANA timezone to that instant before submitting it. PostgreSQL's
`clock_timestamp()` is the due-time authority, so client clock skew cannot
start a game early.

The durable worker polls once per second after room recovery and only runs
while this process holds the existing per-schema instance lease. It claims due
sessions atomically with `FOR UPDATE SKIP LOCKED` and a UUID lease. The
controller revalidates that lease and the room association before calling the
same game transition used by the host. The room, game row, ticket issuance,
session start timestamp, and audit entry commit transactionally. The existing
number caller is armed only after that transition and its durable call schedule
have succeeded. Socket clients cannot invoke the internal scheduled-start
method.

Two processes pointed at the same schema still cannot both serve the game:
the existing advisory instance lease rejects the second process. The durable
session claim additionally fences duplicate scheduler passes and safely
reconciles an expired claim after a restart. Missed due times run on the next
poll; future times remain unclaimed. A room with no active seats retries every
five seconds. Invalid/cross-instance room associations fail closed. Pausing or
cancelling clears any outstanding claim; reopening a paused session makes its
schedule eligible again. Non-auto-start sessions keep the host-controlled
path.

## Migration

`server/db/migrations/033_scheduled_game_auto_start.sql` is additive. Existing
sessions receive `auto_start_enabled=false` and remain host-controlled. It adds
durable claim/retry/audit fields to `game_sessions`, start source and scheduled
timestamp fields to `games`, and a partial due-session index. It does not
rewrite tickets, bookings, owner records, or unrelated schemas.

The migration runner applies each migration in a transaction. Migration 033
was tested after 032 on isolated PostgreSQL 17. A forced SQL error after the
033 DDL confirmed that both the DDL and ledger entry roll back; the clean
re-application then succeeded.

## Production release procedure (approval required)

1. Build and publish the image from the reviewed commit using an immutable
   commit tag; record the registry digest and OCI revision.
2. Immediately before any production migration, verify a fresh Ninety Club
   public-schema backup checksum and complete isolated restore evidence. Do not
   proceed if either check fails.
3. Run the explicit migration command against the Ninety Club Supabase
   connection only. Verify the 033 row and checksum in that project's
   `schema_migrations` ledger. Never use the ZANCTA database or public endpoint.
4. Update only the existing Ninety Club `app` service in its isolated Compose
   project to the immutable image digest. Keep its current network, environment
   file, Traefik labels, and replica count. Do not run a project-wide pull or
   recreate unrelated services.
5. Verify the running image digest and OCI revision, migration ledger,
   `/livez`, `/readyz`, `/healthz`, public booking/session views, and the owner
   admin session table. Do not publish a public test game or open bookings as
   part of a deployment smoke check.

## Rollback

Do not reverse migration 033 or restore production data as an application
rollback. It is additive and old code ignores the added columns, but the
application's migration gate refuses a database ledger entry it does not know
about. Therefore, after applying 033, the previous image by itself is not a
valid rollback image. Before deployment approval, prepare and validate a
compatibility rollback image from the prior application source while retaining
the unchanged 033 migration file. That image can run the prior host-controlled
behavior while recognizing the ledger. Roll back by updating only the Ninety
Club app service to that compatibility image digest and verifying health.

If migration 033 fails before it commits, the migration runner rolls its DDL
back atomically; leave the current app image in place and investigate. If the
compatibility image has not been prepared and verified, stop after any
post-migration failure and use the approved forward-fix path rather than
improvising a downgrade.

## QA recommendation

After production-release approval, first run a private staging Bumper session
with one host and one player, scheduled a few minutes ahead in `Asia/Kolkata`.
Verify it stays waiting until the due instant, starts once, synchronizes both
clients, and begins calls only after the running snapshot. Then test restart
recovery in staging. A production game QA requires separate approval and is
outside this implementation.
