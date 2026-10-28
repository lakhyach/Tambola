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
import { createPool } from "../server/db/pool.js";
import { migrate, listMigrations, migrationStatus } from "../server/db/migrate.js";
import { createStore } from "../server/persist/store.js";
import { createSessionStore, SESSION_CODES } from "../server/persist/sessions.js";
import { createGameController } from "../server/persist/controller.js";
import { createRoomRegistry } from "../server/net/registry.js";
import { createCallScheduler } from "../server/persist/scheduler.js";
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
  const controller = createGameController({ store: extraStore, sessions: extraSessions, registry, log: () => {} });
  controller.bindRegistry(registry);
  return controller;
}

async function makeDurableRoom() {
  const registry = freshRegistry();
  const controller = freshController(registry);
  const created = await controller.createRoom({ name: "Host " + Math.random().toString(36).slice(2, 6), socketId: "s-host" });
  assert.equal(created.ok, true, JSON.stringify(created));
  return { registry, controller, roomId: created.roomId, hostId: created.playerId, room: registry.get(created.roomId), session: created };
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
  const ticketBySeat = new Map([...room.players.values()].map((p) => [p.id, JSON.stringify(p.ticket)]));

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
    assert.equal(JSON.stringify(player.ticket), ticketBySeat.get(player.id), "the ticket is the stored one, not a redraw");
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
  const controller = createGameController({ store: broken, sessions, registry, log: () => {} });
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

test("buildHydrationSource rejects a non-contiguous call history", { skip }, async () => {
  const { controller, roomId, room } = await makeDurableRoom();
  await controller.joinRoom({ roomId, name: "Olga", socketId: "s-o" });
  await controller.start({ room, socketId: "s-host" });
  await controller.callNext({ room, socketId: "s-host", source: "host" });
  const bundle = await store.loadRoomBundle({ roomId });

  const brokenBundle = { ...bundle, calls: [{ call_index: 3, number: bundle.calls[0].number, source: "host", called_at: new Date() }] };
  assert.throws(() => buildHydrationSource(brokenBundle, { log: () => {} }), IntegrityError);
});
