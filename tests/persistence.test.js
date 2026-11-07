/**
 * Phase 3 durable-persistence integration tests.
 *
 * These exercise the real PostgreSQL stack (server/db, server/persist) against
 * an isolated, throwaway schema - never `public`, never production. If no
 * DATABASE_URL is present the whole file is skipped, so `npm test` still runs
 * on a machine without a database; the durable path is only proven where a
 * database is actually reachable.
 *
 * Run on its own with a live database:
 *   node --env-file-if-exists=.env --test tests/persistence.test.js
 *
 * The focus is exactly what the in-memory engine tests cannot cover: that
 * rooms, tickets, draws, calls, claims and sessions survive a process restart,
 * that a number is never broadcast before it is durable, and that the database
 * - not application memory - arbitrates exclusive winners and single ticks.
 */

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, instanceLeaseKey } from "../server/db/pool.js";
import { migrate, listMigrations, migrationStatus, verifyMigrationStatus } from "../server/db/migrate.js";
import { createStore } from "../server/persist/store.js";
import { createSessionStore, SESSION_CODES } from "../server/persist/sessions.js";
import { createGameController } from "../server/persist/controller.js";
import { createRoomRegistry } from "../server/net/registry.js";
import { createCallScheduler } from "../server/persist/scheduler.js";
import { createScheduledStartScheduler } from "../server/persist/scheduled-start-scheduler.js";
import { createBookingService } from "../server/bookings/service.js";
import { recoverRooms, buildHydrationSource } from "../server/persist/recovery.js";
import { GameState, ErrorCodes, IntegrityError } from "../server/game/engine.js";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const skip = hasDatabase ? false : "no DATABASE_URL - durable suite needs PostgreSQL";

// a schema unique to this run so parallel worktrees never collide
const SCHEMA = "tambola_test_" + randomBytes(4).toString("hex");

let db;
let store;
let sessions;

function freshRegistry(overrides = {}) {
  return createRoomRegistry({
    io: null,
    config: { autoCall: false, callIntervalMs: 8000, disconnectGraceMs: 60000, chatIntervalMs: 0, ...overrides },
    externalScheduler: true, // the durable clock belongs to the scheduler, not the engine
    keepHostSeat: true,
    log: () => {},
  });
}

function freshController(registry, extraStore = store, extraSessions = sessions) {
  const controller = createGameController({ store: extraStore, sessions: extraSessions, registry, log: () => {}, allowPublicHostSessions: true });
  controller.bindRegistry(registry);
  return controller;
}

async function makeDurableRoom({ instanceId = "regular", overrides = {} } = {}) {
  const registry = freshRegistry();
  const controller = freshController(registry);
  const created = await controller.createRoom({ name: "Host " + Math.random().toString(36).slice(2, 6), socketId: "s-host", instanceId, overrides });
  assert.equal(created.ok, true, JSON.stringify(created));
  return { registry, controller, roomId: created.roomId, hostId: created.playerId, room: registry.get(created.roomId), session: created };
}

async function createDueAutoStartSession({ instanceId = "bumper", roomCode, timeZone = "Asia/Kolkata", due = true, autoStartEnabled = true }) {
  const bookings = createBookingService({ db });
  const future = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();
  const created = await bookings.createSession({
    instanceId, actor: "owner-test", title: `Scheduled ${instanceId} test`, startsAt: future(30),
    bookingOpensAt: future(-10), bookingClosesAt: future(20), capacity: 12,
    roomCode, autoStartEnabled, timeZone,
  });
  assert.ok(created.session, JSON.stringify(created));
  const published = await bookings.updateSession({ instanceId, sessionId: created.session.sessionId, actor: "owner-test", patch: { status: "open" } });
  assert.equal(published.session.status, "open");
  // Move the schedule using database time, keeping booking_closes_at <= starts_at.
  if (due) await db.query(`UPDATE game_sessions SET starts_at=clock_timestamp()-interval '2 seconds',
      booking_opens_at=clock_timestamp()-interval '4 seconds',booking_closes_at=clock_timestamp()-interval '3 seconds'
    WHERE session_id=$1`, [created.session.sessionId]);
  return { bookings, sessionId: created.session.sessionId };
}

/** A room plus one real seated player, for the session tests (FK-safe). */
async function seatedPlayer() {
  const made = await makeDurableRoom();
  const player = await made.controller.joinRoom({ roomId: made.roomId, name: "Seat " + Math.random().toString(36).slice(2, 6), socketId: "s-seat" });
  assert.equal(player.ok, true, JSON.stringify(player));
  return { ...made, playerId: player.playerId };
}

before(async () => {
  if (!hasDatabase) return;
  db = createPool({ connectionString: process.env.DATABASE_URL, schema: SCHEMA, log: () => {} });
  const client = await db.pool.connect();
  await client.query("CREATE SCHEMA IF NOT EXISTS " + SCHEMA);
  await client.query("DROP SCHEMA IF EXISTS " + SCHEMA + " CASCADE");
  await client.query("CREATE SCHEMA " + SCHEMA);
  client.release();
  await migrate({ db, log: () => {} });
  store = createStore({ db, log: () => {} });
  sessions = createSessionStore({ db, log: () => {} });
});

after(async () => {
  if (!db) return;
  const client = await db.pool.connect();
  await client.query("DROP SCHEMA IF EXISTS " + SCHEMA + " CASCADE").catch(() => {});
  client.release();
  await db.end();
});

// ------------------------------------------------------------------- migrations

test("migrations are versioned, recorded and idempotent", { skip }, async () => {
  const files = listMigrations();
  assert.ok(files.length >= 1, "at least one migration exists");
  assert.equal(files[0].version, "001");
  assert.match(files[0].checksum, /^[0-9a-f]{64}$/);

  const rows = await migrationStatus({ db });
  const recorded = rows.find((row) => row.version === "001");
  assert.ok(recorded, "001 is recorded in schema_migrations");
  assert.equal(recorded.checksum, files[0].checksum, "the stored checksum matches the file");

  // re-running changes nothing
  const again = await migrate({ db, log: () => {} });
  assert.deepEqual(again.applied, [], "nothing re-applied");
  assert.ok(again.skipped.includes(files[0].name), "001 reported skipped");
  const gate = await verifyMigrationStatus({ db });
  assert.equal(gate.current, true, "the read-only boot gate accepts a fully migrated schema");
  assert.equal(gate.pending.length, 0);
});

test("migration 033 preserves existing host-controlled sessions and game defaults", { skip }, async () => {
  const columns = await db.query(`SELECT column_name,column_default,is_nullable FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='game_sessions' AND column_name IN ('auto_start_enabled','auto_start_state')`);
  assert.equal(columns.rows.length, 2);
  assert.equal(columns.rows.find((r) => r.column_name === "auto_start_enabled").column_default, "false");
  assert.equal(columns.rows.find((r) => r.column_name === "auto_start_state").column_default, "'disabled'::text");
  assert.equal((await db.query("SELECT start_source,scheduled_for FROM games LIMIT 0")).fields.length, 2);
});

test("migration 033 applies after 032 and rolls back atomically on a failed DDL batch", { skip }, async () => {
  const schema = "tambola_m033_" + randomBytes(4).toString("hex");
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "tambola-m033-"));
  const pre = path.join(scratch, "pre"); const broken = path.join(scratch, "broken"); const good = path.join(scratch, "good");
  for (const dir of [pre, broken, good]) fs.mkdirSync(dir);
  const migrationSource = fileURLToPath(new URL("../server/db/migrations/", import.meta.url));
  const files = fs.readdirSync(migrationSource).filter((name) => /^\d{3,}_[A-Za-z0-9_]+\.sql$/.test(name)).sort();
  for (const name of files.filter((name) => Number(name.slice(0, 3)) <= 32)) {
    const sql = fs.readFileSync(path.join(migrationSource, name));
    fs.writeFileSync(path.join(pre, name), sql); fs.writeFileSync(path.join(broken, name), sql);
    fs.writeFileSync(path.join(good, name), sql);
  }
  const migration033 = files.find((name) => name.startsWith("033_"));
  const sql033 = fs.readFileSync(path.join(migrationSource, migration033), "utf8");
  fs.writeFileSync(path.join(broken, migration033), sql033 + "\nTHIS IS INVALID SQL;\n");
  fs.writeFileSync(path.join(good, migration033), sql033);
  const isolated = createPool({ connectionString: process.env.DATABASE_URL, schema, log: () => {} });
  try {
    await migrate({ db: isolated, dir: pre, log: () => {} });
    const before = await migrationStatus({ db: isolated });
    assert.ok(before.some((row) => row.version === "032"));
    assert.equal(before.some((row) => row.version === "033"), false);
    await assert.rejects(() => migrate({ db: isolated, dir: broken, log: () => {} }));
    assert.equal((await isolated.query("SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='game_sessions' AND column_name='auto_start_enabled'")).rowCount, 0, "DDL from failed 033 was rolled back");
    assert.equal((await migrationStatus({ db: isolated })).some((row) => row.version === "033"), false);
    const applied = await migrate({ db: isolated, dir: good, log: () => {} });
    assert.match(applied.latest, /^033_scheduled_game_auto_start\.sql$/);
    assert.equal((await isolated.query("SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='game_sessions' AND column_name='auto_start_enabled'")).rowCount, 1);
  } finally {
    const client = await isolated.pool.connect();
    await client.query("DROP SCHEMA IF EXISTS " + schema + " CASCADE").catch(() => {});
    client.release();
    await isolated.end();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test("the read-only production boot gate rejects migration drift", { skip }, async () => {
  const client = await db.pool.connect();
  try {
    await client.query("SET search_path TO " + SCHEMA + ", public");
    await client.query("UPDATE schema_migrations SET checksum = 'tampered' WHERE version = '001'");
    await assert.rejects(() => verifyMigrationStatus({ db }), (error) => error.code === "MIGRATION_DRIFT");
  } finally {
    await client.query("UPDATE schema_migrations SET checksum = $1 WHERE version = '001'", [listMigrations()[0].checksum]).catch(() => {});
    client.release();
  }
});

test("migration 027 removes the historical per-player ticket-count ceiling in the isolated schema", { skip }, async () => {
  const result = await db.query(`
    SELECT c.relname AS table_name, pg_get_constraintdef(k.oid) AS definition
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
     WHERE k.connamespace = current_schema()::regnamespace
       AND k.conname IN ('room_members_ticket_count_check','ticket_reservations_ticket_count_check')
  `);
  const definitions = new Map(result.rows.map((row) => [row.table_name, row.definition]));
  assert.match(definitions.get("room_members"), /ticket_count\s*>=\s*1/i);
  assert.match(definitions.get("ticket_reservations"), /ticket_count\s*>=\s*1/i);
  assert.doesNotMatch(definitions.get("room_members"), /<=|BETWEEN/i);
  assert.doesNotMatch(definitions.get("ticket_reservations"), /<=|BETWEEN/i);
});

test("editing an applied migration is a hard error, not silent drift", { skip }, async () => {
  const client = await db.pool.connect();
  try {
    await client.query("SET search_path TO " + SCHEMA + ", public");
    await client.query("UPDATE schema_migrations SET checksum = 'tampered' WHERE version = '001'");
    await assert.rejects(() => migrate({ db, log: () => {} }), (error) => error.code === "MIGRATION_DRIFT");
    await client.query("UPDATE schema_migrations SET checksum = $1 WHERE version = '001'", [listMigrations()[0].checksum]);
  } finally {
    client.release();
  }
});

test("every pooled connection is pinned to this schema before any query runs", { skip }, async () => {
  // Four fresh connections at once: a client that is handed to the pool while
  // its own setup is still running would answer from `public` instead.
  const pinned = (value) => String(value).replace(/\s+/g, "");
  const clients = await Promise.all([1, 2, 3, 4].map(() => db.pool.connect()));
  try {
    const seen = await Promise.all(clients.map((client) => client.query("SHOW search_path")));
    for (const result of seen) assert.equal(pinned(result.rows[0].search_path), SCHEMA + ",public");
  } finally {
    for (const client of clients) client.release();
  }
  const pooled = await db.query("SHOW search_path");
  assert.equal(pinned(pooled.rows[0].search_path), SCHEMA + ",public", "and so does a query taken straight from the pool");
});

// ------------------------------------------------------------- room + recovery

test("a created room is durable and reconstructs after a restart", { skip }, async () => {
  const { controller, roomId, room, session } = await makeDurableRoom();
  assert.match(session.sessionToken, /^[0-9a-f]{48}$/, "a session token is issued");
  assert.equal(session.hostToken, undefined, "no raw engine credential is returned");

  await controller.joinRoom({ roomId, name: "Dana", socketId: "s-d" });
  await controller.start({ room, socketId: "s-host" });
  for (let i = 0; i < 5; i++) await controller.callNext({ room, socketId: "s-host", source: "host" });
  const firstFive = room.calledNumbers.slice();
  const hostId = room.hostPlayerId;
  const ticketBySeat = new Map([...room.players.values()].map((p) => [p.id, JSON.stringify(p.tickets.map((t) => t.grid))]));

  // a brand-new process: empty registry, same database
  const registry2 = freshRegistry();
  const recovered = await recoverRooms({ store, registry: registry2, log: () => {} });
  assert.equal(recovered.frozen.length, 0, "nothing was refused recovery: " + JSON.stringify(recovered.frozen));
  const room2 = registry2.get(roomId);
  assert.ok(room2, "the room came back");
  assert.equal(room2.state, GameState.RUNNING);
  assert.deepEqual(room2.calledNumbers, firstFive, "the same numbers, in the same order");
  assert.equal(room2.cursor, 5, "the position in the draw is restored, not re-run");
  assert.equal(room2.players.size, ticketBySeat.size, "no seat was invented or lost");
  assert.equal(room2.hostPlayerId, hostId, "authority returns to the same owner");
  for (const player of room2.players.values()) {
    assert.equal(JSON.stringify(player.tickets.map((t) => t.grid)), ticketBySeat.get(player.id), "the tickets are the stored ones, not a redraw");
  }
});

test("an operator room keeps its name in storage and after recovery", { skip }, async () => {
  const registry = freshRegistry();
  const controller = freshController(registry);
  const created = await controller.createManagedRoom({ hostName: "Operator", overrides: { name: "Friday Night", callIntervalMs: 5000 } });
  assert.equal(created.ok, true, JSON.stringify(created));

  const stored = await db.query("SELECT config FROM rooms WHERE room_code = $1", [created.roomId]);
  assert.equal(stored.rows[0].config.name, "Friday Night", "the label the operator typed is what was saved");

  const registry2 = freshRegistry();
  const recovered = await recoverRooms({ store, registry: registry2, log: () => {} });
  assert.equal(recovered.frozen.length, 0, JSON.stringify(recovered.frozen));
  const room2 = registry2.get(created.roomId);
  assert.ok(room2, "the room came back");
  assert.equal(room2.config.name, "Friday Night", "and so did its name");
});

test("due Bumper session starts once from the server, persists audit times, and arms calls after transition", { skip }, async () => {
  const made = await makeDurableRoom({ instanceId: "bumper", overrides: { autoCall: true, callIntervalMs: 8000 } });
  const participant = await made.controller.joinRoom({ roomId: made.roomId, name: "Bumper player", socketId: "s-bumper-player" });
  assert.equal(participant.ok, true);
  const { sessionId } = await createDueAutoStartSession({ instanceId: "bumper", roomCode: made.roomId, timeZone: "Asia/Kolkata" });
  const held = await db.query("SELECT auto_start_enabled,auto_start_state,starts_at,time_zone FROM game_sessions WHERE session_id=$1", [sessionId]);
  assert.equal(held.rows[0].auto_start_enabled, true);
  assert.equal(held.rows[0].auto_start_state, "scheduled");
  assert.equal(held.rows[0].time_zone, "Asia/Kolkata");
  const publicSession = await createBookingService({ db }).getPublicSession(sessionId);
  assert.equal(publicSession.gameStatus, "waiting", "the published session remains visible during the due-to-start handoff");

  let armedAfterState = null;
  let scheduleWhenArmed;
  const callScheduler = { arm(room) { armedAfterState = room.state; scheduleWhenArmed = store.loadSchedule({ roomId: room.roomId }); return {}; }, cancel() {} };
  made.controller.bindScheduler(callScheduler);
  const tokenA = "11111111-1111-4111-8111-111111111111";
  const tokenB = "22222222-2222-4222-8222-222222222222";
  const stores = [store, createStore({ db, log: () => {} })];
  const claims = await Promise.all(stores.map((candidate, index) => candidate.claimDueScheduledStart({ claimToken: index ? tokenB : tokenA })));
  assert.equal(claims.filter((claim) => claim.claimed).length, 1, "parallel workers cannot claim one session twice");
  const claim = claims.find((candidate) => candidate.claimed);
  assert.ok(claim);

  const manual = await made.controller.start({ room: made.room, socketId: "s-host" });
  assert.equal(manual.code, "AUTO_START_RESERVED", "the public host action cannot bypass its scheduled start");
  const result = await made.controller.startScheduled({ sessionId, claimToken: claim.claimToken });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(made.room.state, GameState.RUNNING);
  assert.equal(result.snapshot.state, GameState.RUNNING);
  assert.equal(made.room.playerSnapshot(participant.playerId).state, GameState.RUNNING, "a player snapshot receives the authoritative running state");
  assert.equal(armedAfterState, GameState.RUNNING, "auto-caller arms only after the durable room transition");
  assert.equal((await scheduleWhenArmed).auto_call, true, "the durable call schedule exists before its local timer is armed");

  const game = await db.query("SELECT status,start_source,scheduled_for,started_at FROM games WHERE room_code=$1", [made.roomId]);
  assert.equal(game.rows.length, 1);
  assert.equal(game.rows[0].status, "RUNNING");
  assert.equal(game.rows[0].start_source, "scheduled");
  assert.equal(new Date(game.rows[0].scheduled_for).toISOString(), new Date(held.rows[0].starts_at).toISOString());
  assert.ok(new Date(game.rows[0].started_at) >= new Date(game.rows[0].scheduled_for));
  const session = await db.query("SELECT auto_start_state,auto_started_at,auto_start_claim_token FROM game_sessions WHERE session_id=$1", [sessionId]);
  assert.equal(session.rows[0].auto_start_state, "started");
  assert.ok(session.rows[0].auto_started_at);
  assert.equal(session.rows[0].auto_start_claim_token, null);
  const cannotCancelStarted = await createBookingService({ db }).updateSession({ instanceId: "bumper", sessionId, actor: "owner-test", patch: { status: "cancelled" } });
  assert.equal(cannotCancelStarted.error, "AUTO_START_ALREADY_STARTED");
  const audit = await db.query("SELECT detail FROM audit_events WHERE room_code=$1 AND type='start'", [made.roomId]);
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0].detail.source, "scheduled");
  assert.ok(audit.rows[0].detail.scheduledAt);

  const duplicate = await stores[1].claimDueScheduledStart({ claimToken: tokenB });
  assert.equal(duplicate.claimed, false, "a started game cannot be claimed a second time");
});

test("due Regular Tambola session uses the shared durable auto-start and caller path", { skip }, async () => {
  const made = await makeDurableRoom({ instanceId: "regular", overrides: { autoCall: true, callIntervalMs: 8000 } });
  const player = await made.controller.joinRoom({ roomId: made.roomId, name: "Regular player", socketId: "s-regular-player" });
  assert.equal(player.ok, true, JSON.stringify(player));
  const { sessionId } = await createDueAutoStartSession({ instanceId: "regular", roomCode: made.roomId, timeZone: "Asia/Kolkata" });

  const firstToken = "88888888-8888-4888-8888-888888888888";
  const secondToken = "99999999-9999-4999-8999-999999999999";
  const stores = [store, createStore({ db, log: () => {} })];
  const claims = await Promise.all(stores.map((candidate, index) => candidate.claimDueScheduledStart({ claimToken: index ? secondToken : firstToken })));
  assert.equal(claims.filter((claim) => claim.claimed).length, 1, "multiple workers cannot start a Regular session twice");
  const claim = claims.find((candidate) => candidate.claimed);
  assert.equal(claim.instanceId, "regular");
  const manual = await made.controller.start({ room: made.room, socketId: "s-host" });
  assert.equal(manual.code, "AUTO_START_RESERVED", "Regular hosts cannot bypass the explicit scheduled start");

  let armedState = null;
  made.controller.bindScheduler({ arm(room) { armedState = room.state; return {}; }, cancel() {} });
  const result = await made.controller.startScheduled({ sessionId, claimToken: claim.claimToken });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(made.room.state, GameState.RUNNING);
  assert.equal(armedState, GameState.RUNNING, "the caller arms after the authoritative Regular transition");
  assert.equal(made.room.playerSnapshot(player.playerId).state, GameState.RUNNING);
  const callSchedule = await store.loadSchedule({ roomId: made.roomId });
  assert.equal(callSchedule.auto_call, true, "the durable caller schedule is written for the Regular round");

  const game = await db.query("SELECT status,start_source,scheduled_for,started_at FROM games WHERE room_code=$1", [made.roomId]);
  assert.equal(game.rows.length, 1);
  assert.equal(game.rows[0].status, "RUNNING");
  assert.equal(game.rows[0].start_source, "scheduled");
  assert.ok(new Date(game.rows[0].started_at) >= new Date(game.rows[0].scheduled_for));
  const duplicate = await stores[1].claimDueScheduledStart({ claimToken: secondToken });
  assert.equal(duplicate.claimed, false);
});

test("auto-start cancellation and invalid room association are terminal and never start gameplay", { skip }, async () => {
  const room = await makeDurableRoom({ instanceId: "bumper" });
  const cancelled = await createDueAutoStartSession({ instanceId: "bumper", roomCode: room.roomId });
  const bookings = createBookingService({ db });
  const cancelledResult = await bookings.updateSession({ instanceId: "bumper", sessionId: cancelled.sessionId, actor: "owner-test", patch: { status: "cancelled" } });
  assert.equal(cancelledResult.session.scheduledStartStatus, "cancelled");
  const noCancelledClaim = await store.claimDueScheduledStart({ claimToken: "33333333-3333-4333-8333-333333333333" });
  assert.equal(noCancelledClaim.claimed, false);
  assert.equal((await room.controller.start({ room: room.room, socketId: "s-host" })).ok, true, "cancelling the automatic session restores host control of the waiting room");

  const wrongRoom = await makeDurableRoom({ instanceId: "bumper" });
  const mismatch = await createDueAutoStartSession({ instanceId: "bumper", roomCode: wrongRoom.roomId });
  await db.query("UPDATE rooms SET game_instance_id='regular' WHERE room_code=$1", [wrongRoom.roomId]);
  const rejected = await store.claimDueScheduledStart({ claimToken: "44444444-4444-4444-8444-444444444444" });
  assert.equal(rejected.claimed, false);
  assert.equal(rejected.failed, true);
  assert.equal(rejected.errorCode, "SESSION_ROOM_INVALID");
  const rejectedState = await db.query("SELECT auto_start_state,auto_start_error FROM game_sessions WHERE session_id=$1", [mismatch.sessionId]);
  assert.equal(rejectedState.rows[0].auto_start_state, "failed");
  assert.equal(rejectedState.rows[0].auto_start_error, "SESSION_ROOM_INVALID");
  assert.equal((await db.query("SELECT count(*)::int AS n FROM games WHERE room_code=$1", [wrongRoom.roomId])).rows[0].n, 0);
});

test("a published session with auto-start disabled keeps the host-controlled start path", { skip }, async () => {
  const made = await makeDurableRoom({ instanceId: "bumper" });
  const { sessionId } = await createDueAutoStartSession({ instanceId: "bumper", roomCode: made.roomId, due: false, autoStartEnabled: false });
  const session = await db.query("SELECT auto_start_enabled,auto_start_state FROM game_sessions WHERE session_id=$1", [sessionId]);
  assert.equal(session.rows[0].auto_start_enabled, false);
  assert.equal(session.rows[0].auto_start_state, "disabled");
  const result = await made.controller.start({ room: made.room, socketId: "s-host" });
  assert.equal(result.ok, true, JSON.stringify(result));
  const game = await db.query("SELECT start_source FROM games WHERE room_code=$1", [made.roomId]);
  assert.equal(game.rows[0].start_source, "host");
});

test("a due start without seats waits and can be recovered after a process restart", { skip }, async () => {
  const made = await makeDurableRoom({ instanceId: "bumper" });
  const { sessionId } = await createDueAutoStartSession({ instanceId: "bumper", roomCode: made.roomId, due: false });
  const early = await store.claimDueScheduledStart({ claimToken: "55555555-5555-4555-8555-555555555555" });
  assert.equal(early.claimed, false, "database clock prevents a future session from starting early");

  await db.query(`UPDATE game_sessions SET starts_at=clock_timestamp()-interval '1 second',
      booking_opens_at=clock_timestamp()-interval '3 seconds',booking_closes_at=clock_timestamp()-interval '2 seconds'
    WHERE session_id=$1`, [sessionId]);
  const interrupted = await store.claimDueScheduledStart({ claimToken: "66666666-6666-4666-8666-666666666666", leaseMs: 1000 });
  assert.equal(interrupted.claimed, true);
  // Simulate a process dying after it claimed the durable lease but before it
  // changed the room. Expiry makes the event recoverable without replaying a
  // partially committed game.
  await db.query("UPDATE game_sessions SET auto_start_claimed_until=clock_timestamp()-interval '1 second' WHERE session_id=$1", [sessionId]);
  const restartedRegistry = freshRegistry();
  const recovered = await recoverRooms({ store, registry: restartedRegistry, log: () => {} });
  assert.equal(recovered.frozen.length, 0);
  assert.ok(restartedRegistry.get(made.roomId));
  const retry = await store.claimDueScheduledStart({ claimToken: "77777777-7777-4777-8777-777777777777" });
  assert.equal(retry.claimed, true);
  const restartedController = freshController(restartedRegistry);
  const result = await restartedController.startScheduled({ sessionId, claimToken: retry.claimToken });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(restartedRegistry.get(made.roomId).state, GameState.RUNNING);
});

test("each durable call is audited exactly once", { skip }, async () => {
  const { controller, roomId, room } = await makeDurableRoom();
  await controller.joinRoom({ roomId, name: "Audit", socketId: "s-a" });
  await controller.start({ room, socketId: "s-host" });
  await controller.callNext({ room, socketId: "s-host", source: "host" });
  await controller.callNext({ room, socketId: "s-host", source: "host" });

  // The store writes these inside the transaction that caused them; the engine
  // mirror must not write a second copy of the same fact.
  const calls = await db.query("SELECT count(*)::int AS n FROM audit_events WHERE room_code = $1 AND type = 'call'", [roomId]);
  assert.equal(calls.rows[0].n, 2, "two calls, two rows");

  const starts = await db.query("SELECT count(*)::int AS n FROM audit_events WHERE room_code = $1 AND type = 'start'", [roomId]);
  assert.equal(starts.rows[0].n, 1, "one start, one row");

  const joins = await db.query("SELECT count(*)::int AS n FROM audit_events WHERE room_code = $1 AND type = 'join'", [roomId]);
  assert.equal(joins.rows[0].n, 1, "one join, one row");
});

test("a room whose history does not add up is frozen, never invented", { skip }, async () => {
  const { controller, roomId, room } = await makeDurableRoom();
  await controller.joinRoom({ roomId, name: "Eve", socketId: "s-e" });
  await controller.start({ room, socketId: "s-host" });
  await controller.callNext({ room, socketId: "s-host", source: "host" });

  // corrupt the durable call log so it contradicts the stored draw plan
  const client = await db.pool.connect();
  try {
    await client.query("SET search_path TO " + SCHEMA + ", public");
    await client.query("UPDATE draw_calls SET number = number % 90 + 1 WHERE room_code = $1 AND call_index = 1", [roomId]);
  } finally {
    client.release();
  }

  const registry2 = freshRegistry();
  const recovered = await recoverRooms({ store, registry: registry2, log: () => {} });
  const frozen = recovered.frozen.find((entry) => entry.roomId === roomId);
  assert.ok(frozen, "the room is refused recovery");
  assert.ok(/number|contiguous|prefix|draw/i.test(frozen.reason), "for a documented reason: " + frozen.reason);
  assert.equal(registry2.get(roomId), null, "and it is not handed to players as a live room");
});

test("recovery freezes a durable draw that is not a permutation of 1–90", { skip }, async () => {
  const { controller, roomId, room } = await makeDurableRoom();
  assert.equal((await controller.start({ room, socketId: "s-host" })).ok, true);

  // Keep the array length intact while introducing one duplicate, so this
  // exercises the engine integrity guard rather than the hydration length check.
  // draw_sequence is JSONB, whose array indexes start at zero.
  await db.query(
    "UPDATE games SET draw_sequence = jsonb_set(draw_sequence, '{89}', draw_sequence -> 88) WHERE room_code = $1 AND game_number = $2",
    [roomId, room.gameNumber]
  );

  const registry2 = freshRegistry();
  const recovered = await recoverRooms({ store, registry: registry2, log: () => {} });
  const frozen = recovered.frozen.find((entry) => entry.roomId === roomId);
  assert.ok(frozen, "the invalid persisted draw is refused");
  assert.match(frozen.reason, /draw contains a repeated number|not a permutation of 1-90/);
  assert.equal(registry2.get(roomId), null, "players cannot resume on the corrupted draw");
  const durable = await db.query("SELECT recovery_error FROM rooms WHERE room_code = $1", [roomId]);
  assert.match(durable.rows[0].recovery_error, /draw contains a repeated number|not a permutation of 1-90/);
});

test("a corrupt room is frozen without blocking recovery or scheduler arming for healthy rooms", { skip }, async () => {
  const corrupted = await makeDurableRoom();
  const healthy = await makeDurableRoom();
  assert.equal((await corrupted.controller.start({ room: corrupted.room, socketId: "s-host" })).ok, true);
  assert.equal((await healthy.controller.start({ room: healthy.room, socketId: "s-host" })).ok, true);
  await db.query(
    "UPDATE games SET draw_sequence = jsonb_set(draw_sequence, '{89}', draw_sequence -> 88) WHERE room_code = $1 AND game_number = $2",
    [corrupted.roomId, corrupted.room.gameNumber]
  );

  const armedRoomIds = [];
  const registry = freshRegistry();
  const result = await recoverRooms({
    store,
    registry,
    log: () => {},
    onArmed: (room) => armedRoomIds.push(room.roomId),
  });

  assert.ok(result.frozen.some((entry) => entry.roomId === corrupted.roomId));
  assert.ok(result.recovered.some((room) => room.roomId === healthy.roomId));
  assert.equal(registry.get(corrupted.roomId), null, "the invalid room is not registered");
  assert.ok(registry.get(healthy.roomId), "the valid room still recovers");
  assert.equal(armedRoomIds.includes(corrupted.roomId), false, "the invalid room's scheduler stays disarmed");
  assert.equal(armedRoomIds.includes(healthy.roomId), true, "the healthy room can arm its scheduler");
});

test("room recovery loads claim history and freezes a decision beyond the stored calls", { skip }, async () => {
  const { controller, roomId, room, hostId } = await makeDurableRoom();
  assert.equal((await controller.start({ room, socketId: "s-host" })).ok, true);
  const rejectedClaim = await store.recordClaimDecision({
    roomId,
    gameNumber: room.gameNumber,
    playerId: hostId,
    pattern: "unknown-pattern",
    status: "REJECTED",
    reason: "unknown pattern",
    callIndex: 0,
  });
  assert.equal(rejectedClaim.ok, true);

  const intact = await store.loadRoomBundle({ roomId });
  assert.deepEqual(intact.claims.map((claim) => [claim.pattern, claim.status, claim.call_index]), [["unknown-pattern", "REJECTED", 0]]);
  const recoveredRegistry = freshRegistry();
  const recoveredController = freshController(recoveredRegistry);
  const recovered = await recoveredController.ensureRoom({ roomId });
  assert.equal(recovered.ok, true, JSON.stringify(recovered));

  await db.query("UPDATE claims SET call_index=1 WHERE room_code=$1 AND game_number=$2", [roomId, room.gameNumber]);
  const coldRegistry = freshRegistry();
  const coldController = freshController(coldRegistry);
  const refused = await coldController.ensureRoom({ roomId });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "RECOVERY_REQUIRED");
  assert.match(refused.error, /claim decision refers to a call outside the stored history/);
  assert.equal(coldRegistry.get(roomId), null, "a room with contradictory claim history never becomes live");
});

test("a reset waiting room recovers empty while retaining the completed round as history", { skip }, async () => {
  const { controller, roomId, room, session } = await makeDurableRoom();
  const joined = await controller.joinRoom({ roomId, name: "Reset Recovery", socketId: "s-reset-player" });
  assert.equal(joined.ok, true, JSON.stringify(joined));
  assert.equal((await controller.selectTickets({ room, playerId: joined.playerId, socketId: "s-reset-player", count: 2 })).ok, true);
  assert.equal((await controller.start({ room, socketId: "s-host" })).ok, true);
  await controller.callNext({ room, socketId: "s-host", source: "host" });
  await controller.callNext({ room, socketId: "s-host", source: "host" });
  assert.equal((await controller.transition({ room, socketId: "s-host", action: "end" })).ok, true);
  assert.equal((await controller.transition({ room, socketId: "s-host", action: "reset" })).ok, true);
  assert.equal((await controller.selectTickets({ room, playerId: joined.playerId, socketId: "s-reset-player", count: 1 })).ok, true);

  const beforeRestart = await store.loadRoomBundle({ roomId });
  assert.equal(beforeRestart.room.status, GameState.WAITING);
  assert.equal(beforeRestart.room.recovery_error, null, "the live reset path has not frozen the room");
  assert.equal(beforeRestart.game.status, "COMPLETED");
  assert.equal(beforeRestart.calls.length, 2, "the completed game's calls remain durable");
  assert.equal(beforeRestart.tickets.length, 3, "the completed game's tickets remain durable");
  assert.deepEqual(beforeRestart.calls.map((call) => call.number), beforeRestart.game.draw_sequence.slice(0, 2), "the retained game history matches its stored draw plan");

  const source = buildHydrationSource(beforeRestart);
  assert.equal(source.state, GameState.WAITING);
  assert.deepEqual(source.draw, []);
  assert.deepEqual(source.calledNumbers, []);
  assert.equal(source.cursor, 0);
  assert.ok(source.players.every((player) => player.tickets.length === 0));

  const registry2 = freshRegistry();
  const controller2 = freshController(registry2);
  const recovered = await recoverRooms({ store, registry: registry2, log: () => {} });
  assert.equal(recovered.frozen.some((entry) => entry.roomId === roomId), false, JSON.stringify(recovered.frozen));
  const room2 = registry2.get(roomId);
  assert.ok(room2, "the reset room is not frozen by its previous round's durable plan");
  assert.equal(room2.state, GameState.WAITING);
  assert.equal(room2.gameNumber, room.gameNumber);
  assert.equal(room2.cursor, 0);
  assert.deepEqual(room2.calledNumbers, []);
  assert.equal(room2.awards.size, 0);
  assert.ok([...room2.players.values()].every((player) => player.tickets.length === 0));
  assert.equal(room2.players.get(joined.playerId).ticketCount, 1, "the new waiting-room selection survives independently of historical ticket count");
  assert.deepEqual(room2.integrityErrors(), []);

  const resumed = await controller2.resume({ roomId, sessionToken: session.sessionToken, socketId: "s-host-after-reset" });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  const restarted = await controller2.start({ room: room2, socketId: "s-host-after-reset" });
  assert.equal(restarted.ok, true, JSON.stringify(restarted));
  assert.equal(room2.gameNumber, 2, "the next game starts after, rather than replacing, retained history");
  const history = await db.query("SELECT count(*)::int AS calls FROM draw_calls WHERE room_code=$1 AND game_number=1", [roomId]);
  assert.equal(history.rows[0].calls, 2);
});

// ------------------------------------------------------------ tickets + draws

test("tickets are unique per seat and the draw is a full 90 permutation", { skip }, async () => {
  const { controller, roomId, room } = await makeDurableRoom();
  const joined = await controller.joinRoom({ roomId, name: "Fay", socketId: "s-f" });
  assert.equal(joined.ok, true, JSON.stringify(joined));
  await controller.start({ room, socketId: "s-host" });

  const bundle = await store.loadRoomBundle({ roomId });
  assert.equal(bundle.game.draw_sequence.length, 90, "the whole plan is stored");
  assert.equal(new Set(bundle.game.draw_sequence).size, 90, "exactly once each");
  assert.equal(bundle.tickets.length, room.players.size, "one ticket per seat");
  const perSeat = new Map();
  for (const ticket of bundle.tickets) {
    assert.equal(perSeat.has(ticket.player_id), false, "a seat has no second ticket");
    perSeat.set(ticket.player_id, true);
  }

  // reconnecting the same seat must return the same identity and no new ticket
  const rejoin = await controller.resume({ roomId, sessionToken: joined.sessionToken, socketId: "s-f2" });
  assert.equal(rejoin.ok, true, JSON.stringify(rejoin));
  assert.equal(rejoin.playerId, joined.playerId, "the same seat, not a fresh one");
  const after = await store.loadRoomBundle({ roomId });
  assert.equal(after.tickets.length, bundle.tickets.length, "still one ticket for that seat");
});

test("a chosen ticket count survives a restart and every ticket is durable per number", { skip }, async () => {
  const { controller, roomId, room, session } = await makeDurableRoom();
  const joined = await controller.joinRoom({ roomId, name: "Mira", socketId: "s-m" });
  assert.equal(joined.ok, true, JSON.stringify(joined));

  const picked = await controller.selectTickets({ room, playerId: joined.playerId, count: 3, socketId: "s-m" });
  assert.equal(picked.ok, true, JSON.stringify(picked));
  assert.equal(picked.ticketCount, 3);

  // the WAITING-time choice is durable before any game row exists
  const waiting = await store.loadRoomBundle({ roomId });
  const mira = waiting.members.find((m) => m.player_id === joined.playerId);
  assert.equal(mira.ticket_count, 3, "the choice is stored with the seat");
  assert.equal(waiting.tickets.length, 0, "no grids are invented before the start");

  // restart before the round begins: the seat wakes up still wanting three
  const registry2 = freshRegistry();
  const controller2 = freshController(registry2);
  await recoverRooms({ store, registry: registry2, log: () => {} });
  const room2 = registry2.get(roomId);
  assert.ok(room2, "the waiting room came back");
  assert.equal(room2.players.get(joined.playerId).ticketCount, 3, "the chosen count survived the restart");
  assert.equal((await controller2.resume({ roomId, sessionToken: session.sessionToken, socketId: "s-host" })).ok, true);

  // starting in the recovered room mints exactly the chosen tickets
  const started = await controller2.start({ room: room2, socketId: "s-host" });
  assert.equal(started.ok, true, JSON.stringify(started));
  assert.equal(started.ticketsIssued, 4, "host 1 + mira 3");

  const running = await store.loadRoomBundle({ roomId });
  const mine = running.tickets.filter((t) => t.player_id === joined.playerId);
  assert.equal(mine.length, 3);
  assert.deepEqual(mine.map((t) => t.ticket_no), [1, 2, 3], "one stored row per ticket number");
  assert.equal(new Set(mine.map((t) => JSON.stringify(t.grid))).size, 3, "no duplicate grids");

  // restart again mid-round: the whole set returns unchanged
  await controller2.callNext({ room: room2, socketId: "s-host", source: "host" });
  const seat2 = room2.players.get(joined.playerId);
  const gridsBefore = JSON.stringify(seat2.tickets.map((t) => [t.no, t.grid]));
  const registry3 = freshRegistry();
  await recoverRooms({ store, registry: registry3, log: () => {} });
  const seat3 = registry3.get(roomId).players.get(joined.playerId);
  assert.equal(
    JSON.stringify(seat3.tickets.map((t) => [t.no, t.grid])),
    gridsBefore,
    "the same three tickets with the same numbers, not a redraw"
  );
});

// -------------------------------------------------------- duplicate-call safety

test("two requests for the same tick cannot produce two calls", { skip }, async () => {
  const { controller, roomId, room } = await makeDurableRoom();
  await controller.joinRoom({ roomId, name: "Gil", socketId: "s-g" });
  await controller.start({ room, socketId: "s-host" });

  // the first call at position 1 is durable
  const one = await controller.callNext({ room, socketId: "s-host", source: "host" });
  assert.equal(one.ok, true);
  const committedNumber = one.number;

  // a replayed write at the same position is detected as a duplicate at the store
  const dupe = await store.recordCall({ roomId, gameNumber: room.gameNumber, expectedIndex: 1, source: "host" });
  assert.equal(dupe.duplicate, true, "the primary key refuses a second call at index 1");
  assert.equal(dupe.number, committedNumber, "and reports the number that already won");

  const count = await db.query(
    "SELECT count(*)::int AS n FROM draw_calls WHERE room_code = $1 AND call_index = 1",
    [roomId]
  );
  assert.equal(count.rows[0].n, 1, "exactly one row for the tick");
});

test("a scheduled tick can only be claimed once", { skip }, async () => {
  const { controller, roomId, room } = await makeDurableRoom();
  await controller.joinRoom({ roomId, name: "Hal", socketId: "s-h" });
  await controller.start({ room, socketId: "s-host" });
  await store.upsertSchedule({
    roomId,
    gameNumber: room.gameNumber,
    autoCall: true,
    intervalMs: room.config.callIntervalMs,
    nextDueAt: new Date(Date.now() - 1000),
    resetTick: true,
  });

  const both = await Promise.all([
    store.claimTick({ roomId, gameNumber: room.gameNumber, dueAt: Date.now() }),
    store.claimTick({ roomId, gameNumber: room.gameNumber, dueAt: Date.now() }),
  ]);
  const winners = both.filter((entry) => entry.claimed);
  assert.equal(winners.length, 1, "one timer wins the tick, the other finds it gone");
});

// ---------------------------------------------------- transaction-failure policy

test("a database failure is never announced as an official call", { skip }, async () => {
  const registry = freshRegistry();
  // a store whose call write always explodes, after the engine buffered events
  const broken = Object.create(store);
  broken.recordCall = async () => {
    throw new Error("simulated connection loss mid-write");
  };
  const controller = createGameController({ store: broken, sessions, registry, log: () => {}, allowPublicHostSessions: true });
  controller.bindRegistry(registry);

  const created = await controller.createRoom({ name: "Ivy", socketId: "s-i" });
  assert.equal(created.ok, true);
  const room = registry.get(created.roomId);
  await controller.joinRoom({ roomId: created.roomId, name: "Jay", socketId: "s-j" });
  const started = await controller.start({ room, socketId: "s-i" });
  assert.equal(started.ok, true, JSON.stringify(started));

  const before = room.cursor;
  const result = await controller.callNext({ room, socketId: "s-i", source: "host" });
  assert.equal(result.ok, false, "the call is refused, not faked");
  assert.equal(result.code, "PERSIST_FAILED");
  assert.equal(room.cursor, before, "the live room did not advance");
});

// ---------------------------------------------------- exclusive winner durability

test("an exclusive pattern is awarded to exactly one winner, twice tried", { skip }, async () => {
  const { controller, roomId, room } = await makeDurableRoom();
  await controller.joinRoom({ roomId, name: "Kim", socketId: "s-k" });
  await controller.start({ room, socketId: "s-host" });
  const players = [...room.players.values()];
  const gameNumber = room.gameNumber;

  const first = await store.recordAward({
    roomId, gameNumber, playerId: players[0].id, pattern: "smallstraight", points: 40, callIndex: 1, exclusive: true,
  });
  assert.equal(first.ok, true);

  const second = await store.recordAward({
    roomId, gameNumber, playerId: players[1].id, pattern: "smallstraight", points: 40, callIndex: 1, exclusive: true,
  });
  assert.equal(second.ok, false, "the same exclusive pattern cannot be won twice");
  assert.equal(second.code, "ALREADY_AWARDED");

  const concurrent = await Promise.all([
    store.recordAward({ roomId, gameNumber, playerId: players[0].id, pattern: "corners", points: 20, callIndex: 1, exclusive: true }),
    store.recordAward({ roomId, gameNumber, playerId: players[1].id, pattern: "corners", points: 20, callIndex: 1, exclusive: true }),
  ]);
  const awarded = concurrent.filter((entry) => entry.ok);
  assert.equal(awarded.length, 1, "even raced in the same instant, one winner emerges");

  const rows = await db.query("SELECT count(*)::int AS n FROM awards WHERE room_code = $1 AND pattern = 'smallstraight'", [roomId]);
  assert.equal(rows.rows[0].n, 1, "and it is one row in the database");
});

test("the claim window is a stored room decision, and a restart cannot widen it", { skip }, async () => {
  const registry = freshRegistry();
  const controller = freshController(registry);
  const created = await controller.createRoom({
    name: "Window host",
    socketId: "s-host",
    overrides: { claimWindowCalls: 1 },
  });
  assert.equal(created.ok, true, JSON.stringify(created));
  const roomId = created.roomId;
  const room = registry.get(roomId);

  const joined = await controller.joinRoom({ roomId, name: "Neha", socketId: "s-neha" });
  assert.equal(joined.ok, true, JSON.stringify(joined));
  await controller.start({ room, socketId: "s-host" });

  // draw until this seat's ticket holds five called numbers: the ordinary Early
  // Five moment, reached by the same path a player would
  const mine = new Set(room.players.get(joined.playerId).tickets[0].grid.flat().filter((n) => n !== null));
  let hits = 0;
  while (hits < 5) {
    const drawn = await controller.callNext({ room, socketId: "s-host", source: "host" });
    assert.equal(drawn.ok, true, JSON.stringify(drawn));
    hits = room.calledNumbers.filter((n) => mine.has(n)).length;
  }
  const completedAt = room.cursor;

  // the operator's choice is a stored decision, not a process-wide default
  const stored = await db.query("SELECT config FROM rooms WHERE room_code = $1", [roomId]);
  assert.equal(stored.rows[0].config.claimWindowCalls, 1, "the chosen window is what the database holds");

  // a brand-new process: empty registry, same database
  // This suite shares one schema, and an earlier test deliberately corrupts a
  // room, so the sweep is asserted for THIS room rather than for the whole set.
  const registry2 = freshRegistry();
  const recovered = await recoverRooms({ store, registry: registry2, log: () => {} });
  assert.equal(recovered.frozen.some((entry) => entry.roomId === roomId), false, JSON.stringify(recovered.frozen));
  const room2 = registry2.get(roomId);
  assert.ok(room2, "the room came back");
  assert.equal(room2.config.claimWindowCalls, 1, "a restart does not quietly restore the shipped default of 0");
  assert.equal(room2.cursor, completedAt, "the clock resumes where it stopped, it is not re-run");

  const controller2 = freshController(registry2);
  const back = room2.resume({ hostToken: room2.hostToken, socketId: "s-host2" });
  assert.equal(back.ok, true, JSON.stringify(back));

  // Exactly one call of grace is inside a window of one - which is also the
  // proof that the restored setting is enforced, not merely stored: a window of
  // 0 would refuse this claim. The completion ordinal is recomputed from the
  // authoritative call history, so a restart cannot reset the clock for free.
  const grace = await controller2.callNext({ room: room2, socketId: "s-host2", source: "host" });
  assert.equal(grace.ok, true, JSON.stringify(grace));
  const onGrace = await controller2.claim({ room: room2, playerId: joined.playerId, pattern: "earlyFive" });
  assert.equal(onGrace.ok, true, "one call late is inside a window of one: " + JSON.stringify(onGrace));

  // a second restart: the paid award and the standings it produced are durable
  const registry3 = freshRegistry();
  await recoverRooms({ store, registry: registry3, log: () => {} });
  const room3 = registry3.get(roomId);
  assert.ok(room3, "the room comes back again");
  const neha = room3.leaderboard().find((row) => row.playerId === joined.playerId);
  assert.ok(neha, "the winner is still on the board after a restart");
  assert.equal(neha.points, 20, "with the points she was paid");
  assert.deepEqual(neha.claims, ["earlyFive"]);
  assert.equal(room3.awards.get("earlyFive").length, 1, "one winner, not a re-award");

  const awards = await db.query("SELECT count(*)::int AS n FROM awards WHERE room_code = $1 AND pattern = 'earlyFive'", [roomId]);
  assert.equal(awards.rows[0].n, 1, "and exactly one row in the database");
});

test("a closed tab does not erase a finished round's standings", { skip }, async () => {
  const { controller, roomId, room } = await makeDurableRoom();
  const joined = await controller.joinRoom({ roomId, name: "Omar", socketId: "s-o" });
  assert.equal(joined.ok, true, JSON.stringify(joined));
  await controller.start({ room, socketId: "s-host" });

  // Make a legitimate early-five claim through the durable controller path,
  // then end the round while the winner is still seated.
  let eligible = room.evaluateForSeat(room.players.get(joined.playerId), "earlyFive");
  while (!eligible.valid && room.cursor < 90) {
    const called = await controller.callNext({ room, socketId: "s-host" });
    assert.equal(called.ok, true, JSON.stringify(called));
    eligible = room.evaluateForSeat(room.players.get(joined.playerId), "earlyFive");
  }
  assert.equal(eligible.valid, true, "the test keeps calling until the issued ticket completes early five");
  const recorded = await controller.claim({ room, playerId: joined.playerId, pattern: "earlyFive", socketId: "s-o" });
  assert.equal(recorded.ok, true, JSON.stringify(recorded));
  const ended = await controller.transition({ room, socketId: "s-host", action: "end" });
  assert.equal(ended.ok, true, JSON.stringify(ended));
  assert.equal(room.state, GameState.COMPLETED);

  // the winner's phone goes away after the whistle: a grace timer fires
  room.dropPlayer(joined.playerId, "grace period expired");
  assert.ok(room.players.has(joined.playerId), "the seat stays on the final board");
  assert.equal(room.players.get(joined.playerId).connected, false, "and is shown as away");
  const member = await db.query("SELECT left_at FROM room_members WHERE room_code = $1 AND player_id = $2", [
    roomId,
    joined.playerId,
  ]);
  assert.equal(member.rows[0].left_at, null, "a dropped connection is not a departure in the durable record");

  // and a restart still shows the room they won
  const registry2 = freshRegistry();
  const recovered = await recoverRooms({ store, registry: registry2, log: () => {} });
  assert.equal(recovered.frozen.some((entry) => entry.roomId === roomId), false, JSON.stringify(recovered.frozen));
  const room2 = registry2.get(roomId);
  assert.ok(room2, "the finished room comes back");
  assert.equal(room2.state, GameState.COMPLETED);
  const omar = room2.leaderboard().find((row) => row.playerId === joined.playerId);
  assert.ok(omar, "the winner is still in the standings");
  assert.equal(omar.points, 20);
  assert.equal(room2.awards.get("earlyFive").length, 1, "with their award intact");
});

// ------------------------------------------------------- independent schedules

test("two rooms keep independent clocks and histories", { skip }, async () => {
  const a = await makeDurableRoom();
  const b = await makeDurableRoom();
  await a.controller.joinRoom({ roomId: a.roomId, name: "Lena", socketId: "a-l" });
  await b.controller.joinRoom({ roomId: b.roomId, name: "Mora", socketId: "b-m" });
  await a.controller.start({ room: a.room, socketId: "s-host" });
  await b.controller.start({ room: b.room, socketId: "s-host" });

  await a.controller.callNext({ room: a.room, socketId: "s-host", source: "host" });
  await a.controller.callNext({ room: a.room, socketId: "s-host", source: "host" });
  await b.controller.callNext({ room: b.room, socketId: "s-host", source: "host" });

  assert.equal(a.room.cursor, 2);
  assert.equal(b.room.cursor, 1);

  const counts = await db.query(
    "SELECT room_code, count(*)::int AS n FROM draw_calls GROUP BY room_code ORDER BY room_code",
    []
  );
  const byRoom = new Map(counts.rows.map((row) => [row.room_code, row.n]));
  assert.equal(byRoom.get(a.roomId), 2);
  assert.equal(byRoom.get(b.roomId), 1);
});

// ------------------------------------------------------ pause / resume / end

test("pause, resume and end move the durable status and clock", { skip }, async () => {
  const { controller, roomId, room } = await makeDurableRoom();
  await controller.joinRoom({ roomId, name: "Nell", socketId: "s-n" });
  await controller.start({ room, socketId: "s-host" });

  await controller.transition({ room, socketId: "s-host", action: "pause" });
  assert.equal(room.state, GameState.PAUSED);
  let sched = await store.loadSchedule({ roomId });
  assert.equal(sched.auto_call, false, "a paused room has no running clock");
  assert.equal(sched.next_due_at, null);

  await controller.transition({ room, socketId: "s-host", action: "resume" });
  assert.equal(room.state, GameState.RUNNING);

  await controller.transition({ room, socketId: "s-host", action: "end" });
  assert.equal(room.state, GameState.COMPLETED);
  const statusRow = await db.query("SELECT status FROM rooms WHERE room_code = $1", [roomId]);
  assert.equal(statusRow.rows[0].status, "COMPLETED", "the durable state agrees");
  sched = await store.loadSchedule({ roomId });
  assert.equal(sched.auto_call, false, "ending cancels the schedule");
});

// ------------------------------------------------------------------- sessions

test("a session verifies once, and a revoked or expired one never verifies", { skip }, async () => {
  const { roomId, playerId } = await seatedPlayer();
  const issued = await sessions.issue({ roomId, playerId, role: "player" });
  assert.match(issued.sessionToken, /^[0-9a-f]{48}$/);

  const ok = await sessions.verify({ sessionToken: issued.sessionToken, roomId });
  assert.equal(ok.ok, true);

  await sessions.revoke({ sessionId: issued.sessionId, roomId, reason: "test" });
  const gone = await sessions.verify({ sessionToken: issued.sessionToken, roomId });
  assert.equal(gone.ok, false);
  assert.equal(gone.code, SESSION_CODES.REVOKED);

  // a token cannot unlock a different room
  const other = await makeDurableRoom();
  const cross = await sessions.verify({ sessionToken: issued.sessionToken, roomId: other.roomId });
  assert.equal(cross.ok, false, "scoped to its own room: " + JSON.stringify(cross));
});

test("an expired session is refused and stays revoked", { skip }, async () => {
  const { roomId, playerId } = await seatedPlayer();
  const quick = createSessionStore({ db, log: () => {}, idleMs: 1, absoluteMs: 2 });
  const issued = await quick.issue({ roomId, playerId, role: "player" });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const result = await quick.verify({ sessionToken: issued.sessionToken, roomId });
  assert.equal(result.ok, false);
  assert.equal(result.code, SESSION_CODES.EXPIRED);
  const again = await quick.verify({ sessionToken: issued.sessionToken, roomId });
  assert.equal(again.ok, false, "an expired session cannot be revived");
});

test("rotation retires the old token and points at its replacement", { skip }, async () => {
  const { roomId, playerId } = await seatedPlayer();
  const issued = await sessions.issue({ roomId, playerId, role: "player" });
  const rotated = await sessions.rotate({ sessionToken: issued.sessionToken });
  assert.equal(rotated.ok, true);
  assert.notEqual(rotated.sessionToken, issued.sessionToken);

  const oldAgain = await sessions.verify({ sessionToken: issued.sessionToken, roomId });
  assert.equal(oldAgain.ok, false, "the old credential is dead");
  assert.equal(oldAgain.code, SESSION_CODES.ROTATED);
  const fresh = await sessions.verify({ sessionToken: rotated.sessionToken, roomId });
  assert.equal(fresh.ok, true, "the new one works");
});

test("a stored session never keeps the plaintext token", { skip }, async () => {
  const { roomId, playerId } = await seatedPlayer();
  const issued = await sessions.issue({ roomId, playerId, role: "player" });
  const rows = await db.query("SELECT token_hash FROM sessions WHERE session_id = $1", [issued.sessionId]);
  assert.equal(rows.rows.length, 1);
  assert.notEqual(rows.rows[0].token_hash, issued.sessionToken, "the hash is not the token");
  assert.match(rows.rows[0].token_hash, /^[0-9a-f]{64}$/, "a sha-256 digest is stored");
});

// --------------------------------------------------------------- lease + build

test("the single-instance lease refuses a second scheduler", { skip }, async () => {
  const lease = await db.acquireInstanceLease({ holder: "first" });
  try {
    await assert.rejects(() => db.acquireInstanceLease({ holder: "second" }), (error) => error.code === "INSTANCE_LOCKED");
  } finally {
    await lease.release();
  }
  const again = await db.acquireInstanceLease({ holder: "third" });
  await again.release();
});

test("the lease belongs to a schema, so another schema on the same database is not blocked", () => {
  // The key is derived, not fixed: a staging instance on its own schema (and
  // this suite on its throwaway schema) must not be refused by - or refuse - a
  // server that owns `public`. Both halves must fit the int4 lock form.
  assert.deepEqual(instanceLeaseKey("public"), instanceLeaseKey("public"), "stable across calls");
  assert.notDeepEqual(instanceLeaseKey("public"), instanceLeaseKey("tambola_staging"));
  for (const half of instanceLeaseKey(SCHEMA)) {
    assert.ok(Number.isInteger(half) && half >= 0 && half <= 2147483647, "inside the int4 range");
  }
});

test("two isolated schemas in one database can hold separate game-server leases", { skip }, async () => {
  const otherSchema = "tambola_lease_" + randomBytes(4).toString("hex");
  const otherDb = createPool({ connectionString: process.env.DATABASE_URL, schema: otherSchema, log: () => {} });
  let firstLease;
  let otherLease;
  try {
    await db.query("CREATE SCHEMA " + otherSchema);
    await migrate({ db: otherDb, log: () => {} });
    firstLease = await db.acquireInstanceLease({ holder: "schema-one" });
    otherLease = await otherDb.acquireInstanceLease({ holder: "schema-two" });
    await assert.rejects(() => otherDb.acquireInstanceLease({ holder: "schema-two-duplicate" }), (error) => error.code === "INSTANCE_LOCKED");
  } finally {
    if (otherLease) await otherLease.release();
    if (firstLease) await firstLease.release();
    await otherDb.end();
    await db.query("DROP SCHEMA IF EXISTS " + otherSchema + " CASCADE");
  }
});

test("buildHydrationSource rejects a non-contiguous call history", { skip }, async () => {
  const { controller, roomId, room } = await makeDurableRoom();
  await controller.joinRoom({ roomId, name: "Olga", socketId: "s-o" });
  await controller.start({ room, socketId: "s-host" });
  await controller.callNext({ room, socketId: "s-host", source: "host" });
  const bundle = await store.loadRoomBundle({ roomId });

  const brokenBundle = { ...bundle, calls: [{ call_index: 3, number: bundle.calls[0].number, source: "host", called_at: new Date() }] };
  assert.throws(() => buildHydrationSource(brokenBundle, { log: () => {} }), IntegrityError);
});
