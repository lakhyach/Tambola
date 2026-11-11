import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import express from "express";
import http from "node:http";
import { HAS_DB, openDurableSchema } from "./pattern-harness.js";
import { createAdminBookingRouter } from "../server/bookings/routes.js";
import { createPool } from "../server/db/pool.js";
import { listMigrations, migrate, migrationStatus } from "../server/db/migrate.js";
import { fileURLToPath } from "node:url";

const future = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();
const payload = (title = "Atomic session") => ({
  title,
  startsAt: future(60),
  bookingOpensAt: future(-2),
  bookingClosesAt: future(55),
  capacity: 12,
  inventoryMode: "numbered",
  createRoom: true,
  winningPatterns: [{ id: "topLine", points: 13 }, { id: "fullHouse", points: 120 }],
});

async function setup() {
  const env = await openDurableSchema({ prefix: "managed_atomic" });
  const process = env.newProcess();
  const app = express();
  app.use(express.json());
  app.use("/api/admin", createAdminBookingRouter({
    db: env.db,
    controller: process.controller,
    ownerSessions: { async verify() { return { ok: true, ownerId: "owner-test", sessionId: "owner-session-test" }; } },
    ownerStore: { async getById() { return { ownerId: "owner-test", username: "owner", role: "super_admin" }; } },
    throttle: { adminMutation: { async check() { return { allowed: true }; }, async recordFailure() { return {}; } } },
  }));
  app.use((error, _req, res, _next) => res.status(500).json({ ok: false, error: "internal test failure" }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const csrf = "e".repeat(48);
  const headers = { cookie: `tambola_owner=${"f".repeat(64)}; tambola_csrf=${csrf}`, "x-csrf-token": csrf, "content-type": "application/json" };
  async function create(body = payload(), instanceId = "regular") {
    return fetch(`${base}/api/admin/instances/${instanceId}/sessions`, { method: "POST", headers, body: JSON.stringify(body) });
  }
  async function counts() {
    const result = await env.db.query(`SELECT
      (SELECT count(*)::int FROM rooms) AS rooms,
      (SELECT count(*)::int FROM game_sessions) AS sessions,
      (SELECT count(*)::int FROM players) AS players,
      (SELECT count(*)::int FROM room_members) AS members,
      (SELECT count(*)::int FROM room_schedule) AS schedules,
      (SELECT count(*)::int FROM sessions) AS auth_sessions,
      (SELECT count(*)::int FROM ticket_reservation_audit) AS session_audit,
      (SELECT count(*)::int FROM audit_events) AS room_audit`);
    return result.rows[0];
  }
  async function close() {
    await new Promise((resolve) => server.close(resolve));
    for (const roomId of process.registry.rooms.keys()) process.registry.close(roomId, "test finished");
    await env.close();
  }
  return { env, process, create, counts, close };
}

async function installFailure(env, { table, timing = "BEFORE", event = "INSERT", condition = "" }) {
  await env.db.query(`CREATE FUNCTION atomic_injected_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected atomicity failure' USING ERRCODE='P0001'; END $$`);
  const when = condition ? ` WHEN (${condition})` : "";
  const deferrable = timing === "DEFERRED" ? "DEFERRABLE INITIALLY DEFERRED" : "";
  const triggerTiming = timing === "DEFERRED" ? "AFTER" : timing;
  await env.db.query(`CREATE ${timing === "DEFERRED" ? "CONSTRAINT " : ""}TRIGGER atomic_injected_trigger ${triggerTiming} ${event} ON ${table} ${deferrable} FOR EACH ROW${when} EXECUTE FUNCTION atomic_injected_failure()`);
}

async function removeFailure(env) {
  await env.db.query("DROP TRIGGER IF EXISTS atomic_injected_trigger ON game_sessions").catch(() => {});
  await env.db.query("DROP TRIGGER IF EXISTS atomic_injected_trigger ON rooms").catch(() => {});
  await env.db.query("DROP FUNCTION IF EXISTS atomic_injected_failure()").catch(() => {});
}

const stages = [
  { name: "room insert", table: "rooms", timing: "BEFORE", event: "INSERT" },
  { name: "session insert", table: "game_sessions", timing: "BEFORE", event: "INSERT" },
  { name: "session-room association", table: "game_sessions", timing: "BEFORE", event: "INSERT", condition: "NEW.room_code IS NOT NULL" },
  { name: "pattern persistence", table: "rooms", timing: "BEFORE", event: "UPDATE", condition: "NEW.config ? 'patternPoints'" },
  { name: "transaction commit", table: "game_sessions", timing: "DEFERRED", event: "INSERT" },
];

for (const stage of stages) {
  test(`managed room/session transaction rolls back completely when ${stage.name} fails`, { skip: !HAS_DB, timeout: 30000 }, async () => {
    const ctx = await setup();
    try {
      const before = await ctx.counts();
      await installFailure(ctx.env, stage);
      const rejected = await ctx.create(payload(`fail at ${stage.name}`));
      assert.equal(rejected.status, 500);
      await removeFailure(ctx.env);
      assert.deepEqual(await ctx.counts(), before, "no room, host, schedule, audit, session, or pattern rows survive rollback");

      const accepted = await ctx.create(payload(`valid after ${stage.name}`));
      assert.equal(accepted.status, 201);
      const body = await accepted.json();
      assert.match(body.roomCode, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6,12}$/);
      const persisted = await ctx.env.db.query(`SELECT s.instance_id,s.room_code,s.winning_patterns,r.game_instance_id,r.config
        FROM game_sessions s JOIN rooms r ON r.room_code=s.room_code WHERE s.session_id=$1`, [body.session.sessionId]);
      assert.equal(persisted.rowCount, 1);
      assert.equal(persisted.rows[0].instance_id, "regular");
      assert.equal(persisted.rows[0].game_instance_id, "regular");
      assert.deepEqual(persisted.rows[0].winning_patterns, { topLine: 13, fullHouse: 120 });
      assert.deepEqual(persisted.rows[0].config.patternPoints, { topLine: 13, fullHouse: 120 });
    } finally {
      await removeFailure(ctx.env);
      await ctx.close();
    }
  });
}

test("room-code primary-key collision retries inside a savepoint and preserves the colliding room", { skip: !HAS_DB, timeout: 30000 }, async () => {
  const ctx = await setup();
  try {
    const collisionCode = "ABC234";
    await ctx.env.store.createRoom({ roomId: collisionCode, config: { name: "Existing room" }, instanceId: "regular", host: { playerId: "collision-host", name: "Existing host", connected: false } });
    const originalCreate = ctx.process.registry.create.bind(ctx.process.registry);
    let first = true;
    ctx.process.registry.create = (overrides) => {
      if (first) { first = false; return ctx.process.registry.restore({ roomId: collisionCode, overrides }); }
      return originalCreate(overrides);
    };
    const response = await ctx.create(payload("collision retry"));
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.notEqual(body.roomCode, collisionCode);
    const existing = await ctx.env.db.query("SELECT status,config FROM rooms WHERE room_code=$1", [collisionCode]);
    assert.equal(existing.rowCount, 1);
    assert.equal(existing.rows[0].status, "WAITING");
    assert.deepEqual(existing.rows[0].config, { name: "Existing room" });
    const created = await ctx.env.db.query("SELECT room_code,game_instance_id FROM rooms WHERE room_code=$1", [body.roomCode]);
    assert.equal(created.rows[0].room_code, body.roomCode);
    assert.equal(created.rows[0].game_instance_id, "regular");
  } finally { await ctx.close(); }
});

test("concurrent owner-created sessions commit unique rooms and stay instance scoped", { skip: !HAS_DB, timeout: 30000 }, async () => {
  const ctx = await setup();
  try {
    const responses = await Promise.all([
      ctx.create(payload("concurrent regular one"), "regular"),
      ctx.create(payload("concurrent regular two"), "regular"),
      ctx.create(payload("concurrent bumper"), "bumper"),
    ]);
    assert.deepEqual(responses.map((response) => response.status), [201, 201, 201]);
    const bodies = await Promise.all(responses.map((response) => response.json()));
    const codes = bodies.map((body) => body.roomCode);
    assert.equal(new Set(codes).size, codes.length);
    const rows = await ctx.env.db.query(`SELECT s.instance_id,s.room_code,r.game_instance_id
      FROM game_sessions s JOIN rooms r ON r.room_code=s.room_code
      WHERE s.title LIKE 'concurrent %' ORDER BY s.title`);
    assert.equal(rows.rowCount, 3);
    assert.deepEqual(rows.rows.map((row) => row.instance_id), ["bumper", "regular", "regular"]);
    assert.ok(rows.rows.every((row) => row.instance_id === row.game_instance_id));
  } finally { await ctx.close(); }
});

test("migration 034 applies atomically from 033, preserves legacy sessions, validates patterns, and can be rolled back in a disposable schema", { skip: !HAS_DB, timeout: 60000 }, async () => {
  const schema = `tambola_m034_${randomBytes(4).toString("hex")}`;
  const db = createPool({ connectionString: process.env.DATABASE_URL, schema, log: () => {} });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tambola-m034-"));
  const migrationsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../server/db/migrations");
  const beforeDir = path.join(tempRoot, "before-034");
  const only034Dir = path.join(tempRoot, "only-034");
  fs.mkdirSync(beforeDir); fs.mkdirSync(only034Dir);
  try {
    await db.query(`CREATE SCHEMA ${schema}`);
    for (const name of fs.readdirSync(migrationsRoot).filter((file) => /^\d{3,}_.*\.sql$/.test(file)).sort()) {
      if (Number(name.slice(0, 3)) <= 33) fs.copyFileSync(path.join(migrationsRoot, name), path.join(beforeDir, name));
      if (name.startsWith("034_")) fs.copyFileSync(path.join(migrationsRoot, name), path.join(only034Dir, name));
    }
    assert.equal((await migrate({ db, dir: beforeDir, log: () => {} })).latest, "033_scheduled_game_auto_start.sql");
    const legacyId = "bfe95ab4-9fea-49a9-a204-bad4bfe29d10";
    await db.query(`INSERT INTO game_sessions(session_id,instance_id,title,starts_at,booking_opens_at,booking_closes_at,ticket_capacity,created_by,updated_by)
      VALUES($1,'regular','legacy row',now()+interval '1 hour',now(),now()+interval '30 minutes',5,'test','test')`, [legacyId]);

    // Force the second DDL statement to fail after ADD COLUMN has run. PostgreSQL
    // should roll back both DDL statements and the migration-ledger insert.
    await db.query("ALTER TABLE game_sessions ADD CONSTRAINT game_sessions_winning_patterns_object CHECK (true)");
    await assert.rejects(() => migrate({ db, dir: only034Dir, log: () => {} }));
    const absentAfterFailure = await db.query("SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name='game_sessions' AND column_name='winning_patterns'", [schema]);
    assert.equal(absentAfterFailure.rowCount, 0);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM schema_migrations WHERE version='034'")).rows[0].n, 0);
    await db.query("ALTER TABLE game_sessions DROP CONSTRAINT game_sessions_winning_patterns_object");

    const migration = listMigrations().find((item) => item.version === "034");
    assert.ok(migration);
    await migrate({ db, dir: only034Dir, log: () => {} });
    const recorded = (await migrationStatus({ db })).find((row) => row.version === "034");
    assert.equal(recorded.checksum, migration.checksum);
    const legacy = await db.query("SELECT winning_patterns FROM game_sessions WHERE session_id=$1", [legacyId]);
    assert.equal(legacy.rows[0].winning_patterns, null, "existing rows keep legacy behavior");
    await db.query("UPDATE game_sessions SET winning_patterns=$2::jsonb WHERE session_id=$1", [legacyId, JSON.stringify({ topLine: 10 })]);
    await assert.rejects(() => db.query("UPDATE game_sessions SET winning_patterns='[]'::jsonb WHERE session_id=$1", [legacyId]), (error) => error.code === "23514");

    // Validate the documented disposable-schema rollback, then re-apply the
    // forward migration. Production rollback keeps 034 in place.
    await db.withTransaction(async (client) => {
      await client.query("ALTER TABLE game_sessions DROP CONSTRAINT game_sessions_winning_patterns_object");
      await client.query("ALTER TABLE game_sessions DROP COLUMN winning_patterns");
      await client.query("DELETE FROM schema_migrations WHERE version='034'");
    });
    const absentAfterRollback = await db.query("SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name='game_sessions' AND column_name='winning_patterns'", [schema]);
    assert.equal(absentAfterRollback.rowCount, 0);
    await migrate({ db, dir: only034Dir, log: () => {} });
    assert.equal((await migrationStatus({ db })).some((row) => row.version === "034" && row.checksum === migration.checksum), true);
  } finally {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await db.end().catch(() => {});
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
