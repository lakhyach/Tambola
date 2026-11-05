/**
 * Phase 13 §3/§4: repeatable room-lifecycle and load harness.
 *
 * SAFETY BOUNDARIES - read before running:
 *  - The server under test always binds 127.0.0.1. Nothing here touches the
 *    public tunnel deployment.
 *  - It NEVER reads DATABASE_URL. Durable mode requires a separate, explicitly
 *    provided TEST_DATABASE_URL, and refuses Supabase hosts outright: a load
 *    test must not push synthetic traffic into the live database.
 *  - All players are synthetic; all rooms are disposable.
 *
 * Modes
 *   sequential --rooms N [--calls M]
 *       Create N rooms one after another and run each through the full
 *       lifecycle (create, join, ticket choice, start, calls, claim, end,
 *       close). Proves repeated creation does not leak sockets, timers,
 *       sessions or stale room state, and that creation latency stays flat as
 *       the app ages. Runs in memory-only mode - the durable variant is the
 *       same path with a throwaway schema when TEST_DATABASE_URL is set.
 *
 *   staged --stages 10:50,50:250 [--calls 20]
 *       Real Socket.IO clients against a real local server, staged
 *       (rooms:players). Measures joins, reconnects, call fan-out, ack
 *       latency, timers, RSS and event-loop delay; checks for duplicate calls
 *       and cross-room leakage.
 *       Optional --soak-ms N keeps the connected clients idle after the burst
 *       to exercise Socket.IO heartbeat stability and detect disconnects.
 *
 * Examples
 *   node scripts/loadtest.mjs sequential --rooms 500
 *   node scripts/loadtest.mjs staged --stages 10:50,50:250 --calls 15
 */

import assert from "node:assert/strict";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { createApp } from "../server/index.js";

function arg(name, fallback = null) {
  const at = process.argv.indexOf("--" + name);
  return at === -1 ? fallback : process.argv[at + 1];
}

function intArg(name, fallback) {
  const raw = arg(name);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function guardTestDatabaseUrl() {
  const url = process.env.TEST_DATABASE_URL || "";
  if (!url) return null;
  if (/supabase/i.test(url)) {
    throw new Error(
      "TEST_DATABASE_URL points at a Supabase host. Load tests must never target the live database; " +
        "use a local Postgres instead (see server/RUNBOOK.md)."
    );
  }
  return url;
}

/**
 * The load harness runs against a throwaway schema, and a schema with no
 * migration ledger will not let the app boot. That is the correct fail-closed
 * behaviour for production, so the harness reproduces it rather than relying on
 * AUTO_MIGRATE: migrate the schema first, exactly as an operator migrates a real
 * one.
 */
async function migrateSchema(url, schema) {
  if (!url) return;
  const { createPool } = await import("../server/db/pool.js");
  const { migrate } = await import("../server/db/migrate.js");
  const db = createPool({ connectionString: url, schema, log: () => {} });
  try {
    await migrate({ db, log: () => {} });
  } finally {
    await db.end();
  }
}

function configuredPoolMax(instance) {
  const max = instance && instance.db && instance.db.pool && instance.db.pool.options && instance.db.pool.options.max;
  return Number.isFinite(max) ? max : "?";
}

function snap() {
  const resources = process.getActiveResourcesInfo();
  return {
    rssMb: Math.round((process.memoryUsage().rss / 1048576) * 10) / 10,
    heapMb: Math.round((process.memoryUsage().heapUsed / 1048576) * 10) / 10,
    timers: resources.filter((kind) => kind === "Timeout" || kind === "Timer").length,
    sockets: resources.filter((kind) => kind === "TCPSocketWrap" || kind === "TCPConnectRequest").length,
  };
}

/** Cumulative CPU in milliseconds; the caller turns the delta into a percentage. */
function cpuMs() {
  const usage = process.cpuUsage();
  return (usage.user + usage.system) / 1000;
}

/**
 * Peak memory sampling. RSS is sampled on a timer because the interesting
 * number is the high-water mark during the burst, not whatever is left when
 * the stage ends and the garbage collector has already tidied up.
 */
function startMemoryProbe(sampleMs = 100) {
  const probe = { peakRssMb: 0, peakHeapMb: 0, samples: 0 };
  const timer = setInterval(() => {
    const usage = process.memoryUsage();
    probe.peakRssMb = Math.max(probe.peakRssMb, usage.rss / 1048576);
    probe.peakHeapMb = Math.max(probe.peakHeapMb, usage.heapUsed / 1048576);
    probe.samples += 1;
  }, sampleMs);
  if (typeof timer.unref === "function") timer.unref();
  probe.stop = () => {
    clearInterval(timer);
    probe.peakRssMb = Math.round(probe.peakRssMb * 10) / 10;
    probe.peakHeapMb = Math.round(probe.peakHeapMb * 10) / 10;
    return probe;
  };
  return probe;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))];
}

/**
 * Phase 16B: durable-database profiler.
 *
 * The staged harness could already show a slow ack, but not WHY it was slow.
 * This separates the four answers an operator actually needs:
 *   - pool pressure      (total/waiting, sampled by the harness itself)
 *   - transaction time   (measured around withTransaction, no SQL overhead)
 *   - server-side load   (active/waiting backends, sampled on a dedicated
 *                         connection so the sampler cannot starve the pool it
 *                         is measuring)
 *   - write amplification(WAL bytes and database counters before/after)
 *
 * Everything is read-only except the counter snapshot. Returns null without a
 * database, so memory-mode runs are unchanged.
 */
async function createDbProfiler(instance) {
  const handle = instance && instance.db;
  if (!handle || !handle.pool) return null;
  const pg = (await import("pg")).default;
  const client = new pg.Client({ connectionString: handle.pool.options.connectionString });
  await client.connect();

  const durations = [];
  const failedTransactions = [];
  const original = handle.withTransaction.bind(handle);
  handle.withTransaction = async (fn) => {
    const t0 = performance.now();
    try {
      return await original(fn);
    } catch (error) {
      // pg_stat_database tells the soak that a transaction rolled back, but
      // not which operation caused it. Keep only the error code and first
      // application call frame; omit SQL, values and connection details.
      const frames = String(new Error().stack || "").split("\n").slice(1);
      const site = frames.find((frame) => !frame.includes("createDbProfiler") && !frame.includes("scripts/loadtest.mjs"));
      failedTransactions.push({
        code: String(error && error.code || "UNKNOWN").slice(0, 32),
        committed: Boolean(error && error.committed),
        site: site ? site.trim().slice(0, 180) : "unknown application call site",
      });
      throw error;
    } finally {
      durations.push(performance.now() - t0);
    }
  };

  const snapshot = async () => {
    const one = async (sql) => (await client.query(sql)).rows[0] || {};
    return {
      database: await one(
        "SELECT xact_commit, xact_rollback, blks_hit, blks_read, tup_inserted, tup_updated, deadlocks, conflicts FROM pg_stat_database WHERE datname = current_database()"
      ),
      wal: await one("SELECT wal_records, wal_fpi, wal_bytes, wal_buffers_full FROM pg_stat_wal"),
      settings: await one("SELECT setting::int AS max_connections FROM pg_settings WHERE name = 'max_connections'"),
    };
  };

  const peaks = { active: 0, waiting: 0, idleInTransaction: 0, longestMs: 0, samples: 0, samplerErrors: 0 };
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      try {
        const { rows } = await client.query(
          `SELECT count(*) FILTER (WHERE state = 'active')::int AS active,
                  count(*) FILTER (WHERE wait_event_type = 'Lock')::int AS waiting,
                  count(*) FILTER (WHERE state = 'idle in transaction')::int AS idle_in_tx,
                  coalesce(max(extract(epoch FROM now() - query_start) * 1000) FILTER (WHERE state = 'active'), 0) AS longest_ms
             FROM pg_stat_activity
            WHERE datname = current_database() AND pid <> pg_backend_pid()`
        );
        const row = rows[0] || {};
        peaks.active = Math.max(peaks.active, row.active || 0);
        peaks.waiting = Math.max(peaks.waiting, row.waiting || 0);
        peaks.idleInTransaction = Math.max(peaks.idleInTransaction, row.idle_in_tx || 0);
        peaks.longestMs = Math.max(peaks.longestMs, Math.round(Number(row.longest_ms) || 0));
        peaks.samples += 1;
      } catch {
        peaks.samplerErrors += 1;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  })();

  const before = await snapshot();
  const startedAt = performance.now();

  return {
    async stop() {
      sampling = false;
      await sampler.catch(() => {});
      const after = await snapshot();
      const seconds = (performance.now() - startedAt) / 1000;
      const delta = (key, section = "database") => Number(after[section][key] || 0) - Number(before[section][key] || 0);
      const hits = delta("blks_hit");
      const reads = delta("blks_read");
      const result = {
        seconds: Math.round(seconds * 10) / 10,
        transactions: durations.length,
        txPerSecond: Math.round((durations.length / Math.max(seconds, 0.001)) * 10) / 10,
        txP50: Math.round(percentile(durations, 50) * 10) / 10,
        txP95: Math.round(percentile(durations, 95) * 10) / 10,
        txP99: Math.round(percentile(durations, 99) * 10) / 10,
        txMax: Math.round((durations.length ? Math.max(...durations) : 0) * 10) / 10,
        commits: delta("xact_commit"),
        rollbacks: delta("xact_rollback"),
        failedTransactions: failedTransactions.slice(),
        deadlocks: delta("deadlocks"),
        walBytes: Number(after.wal.wal_bytes || 0) - Number(before.wal.wal_bytes || 0),
        walRecords: Number(after.wal.wal_records || 0) - Number(before.wal.wal_records || 0),
        walBuffersFull: Number(after.wal.wal_buffers_full || 0) - Number(before.wal.wal_buffers_full || 0),
        cacheHitRatio: hits + reads === 0 ? null : Math.round((hits / (hits + reads)) * 1000) / 10,
        tupInserted: delta("tup_inserted"),
        tupUpdated: delta("tup_updated"),
        maxConnections: Number(after.settings.max_connections || 0),
        peaks,
      };
      await client.end().catch(() => {});
      handle.withTransaction = original;
      return result;
    },
  };
}

function formatDbProfile(profile) {
  if (!profile) return null;
  const mb = (bytes) => Math.round((bytes / 1048576) * 10) / 10;
  return (
    "[db profile] " + profile.seconds + "s, " + profile.transactions + " transactions (" + profile.txPerSecond + "/s) | " +
    "tx p50 " + profile.txP50 + "ms p95 " + profile.txP95 + "ms p99 " + profile.txP99 + "ms max " + profile.txMax + "ms | " +
    "commits " + profile.commits + " rollbacks " + profile.rollbacks + " deadlocks " + profile.deadlocks + " | " +
    "application transaction failures " + profile.failedTransactions.length +
      (profile.failedTransactions.length ? " (" + profile.failedTransactions.slice(0, 5).map((failure) => failure.code + " at " + failure.site).join("; ") + ")" : "") + " | " +
    "WAL " + mb(profile.walBytes) + "MB in " + profile.walRecords + " records (buffers full " + profile.walBuffersFull + ") | " +
    "cache hit " + (profile.cacheHitRatio === null ? "n/a" : profile.cacheHitRatio + "%") + " | " +
    "peak active " + profile.peaks.active + ", lock waits " + profile.peaks.waiting + ", idle-in-tx " + profile.peaks.idleInTransaction +
    ", longest query " + profile.peaks.longestMs + "ms, samples " + profile.peaks.samples + " (errors " + profile.peaks.samplerErrors + ") | " +
    "max_connections " + profile.maxConnections
  );
}

function report(title, lines) {
  console.log("\n== " + title + " " + "=".repeat(Math.max(0, 58 - title.length)));
  for (const line of lines) console.log("   " + line);
}

// ------------------------------------------------------------------ sequential

async function sequential() {
  const rooms = intArg("rooms", 300);
  const callsPerRoom = intArg("calls", 10);
  const url = guardTestDatabaseUrl();
  const schema = "tambola_load_" + Math.random().toString(16).slice(2, 8);
  await migrateSchema(url, schema);

  const instance = await createApp({
    memoryOnly: !url,
    databaseUrl: url || undefined,
    schema: url ? schema : undefined,
    origins: [],
    config: { autoCall: false, chatIntervalMs: 0, disconnectGraceMs: 60000, callIntervalMs: 60000 },
    log: () => {},
  });

  console.log("mode:", url ? "durable (throwaway schema " + schema + ")" : "memory-only");
  const baseline = snap();
  const cpuStart = cpuMs();
  const startedAt = performance.now();
  const memProbe = startMemoryProbe();
  const createdIds = new Set();
  const createMs = [];
  let fullCycles = 0;
  let claimsAwarded = 0;
  let errors = 0;
  let poolPeakTotal = 0;
  let poolPeakWaiting = 0;
  const samplePool = () => {
    const p = instance.db && instance.db.pool;
    if (!p) return;
    poolPeakTotal = Math.max(poolPeakTotal, p.totalCount || 0);
    poolPeakWaiting = Math.max(poolPeakWaiting, p.waitingCount || 0);
  };

  for (let i = 0; i < rooms; i++) {
    const t0 = performance.now();
    let openedRoomId = null;
    try {
      const host = await instance.controller.createRoom({ name: "Host" + i, socketId: "s-h-" + i });
      assert.equal(host.ok, true, JSON.stringify(host));
      openedRoomId = host.roomId;
      createMs.push(performance.now() - t0);
      createdIds.add(host.roomId);
      const room = instance.registry.get(host.roomId);
      assert.ok(room, "room is live in the registry");

      // a second seat that deliberately holds three tickets
      const player = await instance.controller.joinRoom({ roomId: host.roomId, name: "Player" + i, socketId: "s-p-" + i });
      assert.equal(player.ok, true, JSON.stringify(player));
      const picked = await instance.controller.selectTickets({ room, playerId: player.playerId, count: 3, socketId: "s-p-" + i });
      if (url) assert.equal(picked.ok, true, "ticket choice: " + JSON.stringify(picked));

      const started = await instance.controller.start({ room, socketId: "s-h-" + i });
      assert.equal(started.ok, true, "start: " + JSON.stringify(started));
      for (let c = 0; c < callsPerRoom; c++) {
        const called = await instance.controller.callNext({ room, socketId: "s-h-" + i, source: "host" });
        assert.equal(called.ok, true, "call: " + JSON.stringify(called));
      }
      const claim = await instance.controller.claim({ room, playerId: player.playerId, pattern: "fullHouse", socketId: "s-p-" + i });
      if (claim.ok) claimsAwarded += 1; // usually refused (no full house) - either answer is valid
      const ended = await instance.controller.transition({ room, socketId: "s-h-" + i, action: "end" });
      assert.equal(ended.ok, true, "end: " + JSON.stringify(ended));
      await instance.controller.closeRoom({ roomId: host.roomId, reason: "load cycle" });
      samplePool();
      fullCycles += 1;
    } catch (error) {
      errors += 1;
      console.error("room " + i + " failed:", error.message);
      // a half-run room must not be left live, or the leak report lies
      if (openedRoomId) await instance.controller.closeRoom({ roomId: openedRoomId, reason: "cycle failed" }).catch(() => {});
    }
  }

  const after = snap();
  const wallSeconds = (performance.now() - startedAt) / 1000;
  const cpuPercent = ((cpuMs() - cpuStart) / (wallSeconds * 1000)) * 100;
  const memory = memProbe.stop();
  const liveRooms = instance.registry.size();
  const early = createMs.slice(0, 25);
  const late = createMs.slice(-25);
  const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);

  report("sequential lifecycle", [
    "target: " + rooms + " rooms x full lifecycle (" + callsPerRoom + " calls each)",
    "completed cycles: " + fullCycles + ", errors: " + errors,
    "unique room codes: " + createdIds.size + " of " + (fullCycles + errors) + " created - duplicates: " + (createdIds.size !== fullCycles + errors ? "YES" : "none"),
    "claims awarded mid-cycle (expected ~0): " + claimsAwarded,
    "create latency first25 mean: " + mean(early).toFixed(2) + "ms | last25 mean: " + mean(late).toFixed(2) + "ms",
    "registry live after closing everything: " + liveRooms + (liveRooms === 0 ? " (clean)" : " <-- LEAK"),
    "timers: " + baseline.timers + " before -> " + after.timers + " after",
    "sockets: " + baseline.sockets + " before -> " + after.sockets + " after",
    "RSS: " + baseline.rssMb + "MB -> " + after.rssMb + "MB (+" + (after.rssMb - baseline.rssMb).toFixed(1) + "MB over " + rooms + " rooms)",
    "heap: " + baseline.heapMb + "MB -> " + after.heapMb + "MB",
    "CPU: " + cpuPercent.toFixed(0) + "% of one core over " + wallSeconds.toFixed(1) + "s | peak RSS " + memory.peakRssMb + "MB | peak heap " + memory.peakHeapMb + "MB",
  ]);

  if (url) {
    const connErrors = instance.db.connectionErrors();
    report("durable database", [
      "connection pool: peak total " + poolPeakTotal + " (max " + configuredPoolMax(instance) + ") | peak waiting " + poolPeakWaiting,
      "idle pool connections after teardown: " + (instance.db.pool.idleCount || 0),
      "connection errors during the run: " + connErrors,
      "live rooms still open in the database after closing all: checking...",
    ]);
    const stillOpen = await instance.store.loadRecoverableRooms();
    console.log("   recoverable (open) rooms left: " + stillOpen.length + (stillOpen.length === 0 ? " (no orphans)" : " <-- ORPHANS"));
    // drop the throwaway schema so repeated runs never accumulate state
    await instance.db.query("DROP SCHEMA IF EXISTS " + schema + " CASCADE").catch(() => {});
    console.log("   dropped throwaway schema " + schema);
  }

  await instance.closeServer();
  const leaked = liveRooms !== 0 || after.timers > baseline.timers + 5;
  process.exitCode = errors === 0 && fullCycles === rooms && !leaked ? 0 : 1;
  console.log(process.exitCode === 0 ? "RESULT: PASS" : "RESULT: FAIL (see numbers above)");
}

// ---------------------------------------------------------------------- staged

const { io: connectClient } = await import("socket.io-client").catch(() => ({ io: null }));

async function staged() {
  if (!connectClient) throw new Error("socket.io-client is required for staged mode");
  const stages = arg("stages", "10:50,50:250").split(",").map((pair) => pair.split(":").map(Number));
  if (stages.length === 0 || stages.some((pair) => pair.length !== 2 || !pair.every((n) => Number.isSafeInteger(n) && n > 0))) {
    throw new Error("--stages must be comma-separated positive integer pairs in rooms:players form");
  }
  const rawCalls = arg("calls");
  const callsPerRoom = rawCalls === null ? 15 : Number(rawCalls);
  if (!Number.isSafeInteger(callsPerRoom) || callsPerRoom <= 0) throw new Error("--calls must be a positive integer");
  const rawSoak = arg("soak-ms", "0");
  const soakMs = Number(rawSoak);
  if (!Number.isSafeInteger(soakMs) || soakMs < 0 || soakMs > 14_400_000) {
    throw new Error("--soak-ms must be an integer from 0 through 14400000 (four hours)");
  }
  const url = guardTestDatabaseUrl();
  const schema = "tambola_load_" + Math.random().toString(16).slice(2, 8);
  await migrateSchema(url, schema);

  const instance = await createApp({
    memoryOnly: !url,
    databaseUrl: url || undefined,
    schema: url ? schema : undefined,
    origins: [],
    config: { autoCall: false, chatIntervalMs: 0, disconnectGraceMs: 30000, callIntervalMs: 60000 },
    log: () => {},
  });
  const port = await instance.listen(0);
  const endpoint = "http://127.0.0.1:" + port;
  const profiler = url ? await createDbProfiler(instance) : null;

  const delayHistogram = monitorEventLoopDelay({ resolution: 20 });
  delayHistogram.enable();
  const stageFailures = [];

  const openSockets = [];
  async function oneClient() {
    const client = connectClient(endpoint, { transports: ["websocket"], forceNew: true, reconnection: false, timeout: 8000 });
    openSockets.push(client);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("connect timeout")), 8000);
      client.once("connect", () => {
        clearTimeout(timer);
        resolve();
      });
      client.once("connect_error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    return {
      socket: client,
      calls: new Map(),
      tickets: [],
      /** when each broadcast reached this seat, for fan-out latency */
      arrivals: [],
      call(event, payload = {}) {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("ack timeout: " + event)), 8000);
          client.emit(event, payload, (response) => {
            clearTimeout(timer);
            resolve(response);
          });
        });
      },
    };
  }

  for (const [roomCount, playerCount] of stages) {
    const perRoom = Math.max(2, Math.floor(playerCount / roomCount));
    const stats = { joins: 0, joinFail: 0, starts: 0, callsAcked: 0, dupCalls: 0, leaks: 0, reconnects: 0, reconnectFail: 0, ackMs: [], joinMs: [], fanoutMs: [], claimRejects: 0, claimAwards: 0, errors: 0 };
    const t0 = performance.now();
    const cpuStart = cpuMs();
    const memProbe = startMemoryProbe();

    const jobs = [];
    for (let r = 0; r < roomCount; r++) jobs.push(r);
    const rooms = [];
    for (const r of jobs) {
      try {
        const host = await oneClient();
        const created = await host.call("room:create", { name: "LoadHost" + r });
        if (!created.ok) throw new Error("create refused: " + JSON.stringify(created));
        stats.joins += 1;
        rooms.push({ host, roomId: created.roomId, index: rooms.length, departures: new Map(), expectedCalls: [], players: [] });
      } catch (error) {
        stats.errors += 1;
        console.error("host create failed:", error.message);
      }
    }

    // spread the remaining players across the rooms, in parallel waves.
    // Each seat's name is computed synchronously (room + slot) so concurrent
    // joins can never race on a shared counter and collide on NAME_TAKEN.
    const wave = [];
    for (const room of rooms) {
      for (let p = 1; p < perRoom; p++) {
        const seatName = "Seat" + room.index + "-" + p;
        wave.push(
          (async () => {
            try {
              const client = await oneClient();
              const joinStarted = performance.now();
              const joined = await client.call("room:join", { roomId: room.roomId, name: seatName });
              if (!joined.ok) throw new Error("join refused " + JSON.stringify(joined));
              stats.joinMs.push(performance.now() - joinStarted);
              stats.joins += 1;
              room.players = room.players || [];
              room.players.push({ client, session: joined });
              client.socket.on("number:called", (payload) => {
                const seen = client.calls.get(payload.number) || 0;
                if (seen > 0) stats.dupCalls += 1;
                client.calls.set(payload.number, seen + 1);
                client.arrivals.push({ index: payload.index, number: payload.number, at: performance.now() });
              });
              client.socket.on("ticket:assigned", (payload) => client.tickets.push(payload));
            } catch (error) {
              stats.joinFail += 1;
            }
          })()
        );
        if (wave.length >= 50) {
          await Promise.all(wave.splice(0));
        }
      }
    }
    await Promise.all(wave);

    // start + drive calls, measuring ack latency (sampled hosts)
    const poolPeak = { total: 0, waiting: 0 };
    const samplePool = () => {
      const p = instance.db && instance.db.pool;
      if (!p) return;
      poolPeak.total = Math.max(poolPeak.total, p.totalCount || 0);
      poolPeak.waiting = Math.max(poolPeak.waiting, p.waitingCount || 0);
    };
    const driveStart = performance.now();
    const drivers = rooms.map(async (room) => {
      const started = await room.host.call("game:start");
      if (!started.ok) throw new Error("start refused " + JSON.stringify(started));
      stats.starts += 1;
      for (let c = 0; c < callsPerRoom; c++) {
        const t = performance.now();
        const called = await room.host.call("game:call-next");
        if (!called.ok) throw new Error("call refused " + JSON.stringify(called));
        stats.callsAcked += 1;
        stats.ackMs.push(performance.now() - t);
        room.expectedCalls.push({ index: called.index, number: called.number });
        // when the intent left the host; the seats' arrivals are compared to this
        room.departures.set(called.index ?? c + 1, t);
        samplePool();
      }
      // a fullHouse claim must be refused: nobody has all fifteen called
      const anyPlayer = (room.players || [])[0];
      if (anyPlayer) {
        const claim = await anyPlayer.client.call("claim:submit", { pattern: "fullHouse" });
        if (claim.ok) stats.claimAwards += 1;
        else stats.claimRejects += 1;
      }
    });
    const driveResults = await Promise.allSettled(drivers);
    stats.errors += driveResults.filter((entry) => entry.status === "rejected").length;

    // Fan-out: how long after the host asked for a number each seat's screen had
    // it. Measured before the reconnect sample, which tears sockets down.
    await new Promise((resolve) => setTimeout(resolve, 300));
    for (const room of rooms) {
      for (const seat of room.players || []) {
        for (const arrival of seat.client.arrivals) {
          const sentAt = room.departures.get(arrival.index);
          if (sentAt !== undefined) stats.fanoutMs.push(arrival.at - sentAt);
        }
      }
    }

    // Check every player before intentionally disconnecting the reconnect
    // sample. Checking only connected sockets here used to omit one player per
    // room, making a partially broken fan-out look healthy.
    let syncChecked = 0;
    let syncOk = 0;
    for (const room of rooms) {
      for (const seat of room.players || []) {
        syncChecked += 1;
        const received = seat.client.arrivals.map(({ index, number }) => ({ index, number }));
        const exactRoomStream = received.length === room.expectedCalls.length && received.every((call, index) =>
          call.index === room.expectedCalls[index]?.index && call.number === room.expectedCalls[index]?.number
        );
        if (exactRoomStream) syncOk += 1;
        else {
          const sharedLength = Math.min(received.length, room.expectedCalls.length);
          const differingCalls = received.slice(0, sharedLength).filter((call, index) =>
            call.index !== room.expectedCalls[index]?.index || call.number !== room.expectedCalls[index]?.number
          ).length;
          stats.leaks += Math.max(1, Math.abs(received.length - room.expectedCalls.length) + differingCalls);
        }
      }
    }

    // reconnect sample: one player per room, first where available
    for (const room of rooms) {
      const seat = (room.players || [])[0];
      if (!seat) continue;
      try {
        seat.client.socket.disconnect();
        const back = await oneClient();
        const resumed = await back.call("session:resume", { roomId: room.roomId, sessionToken: seat.session.sessionToken });
        if (resumed.ok) stats.reconnects += 1;
        else stats.reconnectFail += 1;
      } catch {
        stats.reconnectFail += 1;
      }
    }

    let soakDisconnects = 0;
    let soakClients = [];
    const soakFailures = [];
    const soakDisconnectReasons = new Map();
    if (soakMs > 0) {
      soakClients = openSockets.filter((client) => client.connected);
      for (const client of soakClients) client.on("disconnect", (reason) => {
        soakDisconnects += 1;
        soakDisconnectReasons.set(reason, (soakDisconnectReasons.get(reason) || 0) + 1);
      });
      await new Promise((resolve) => setTimeout(resolve, soakMs));
      const connectedAtEnd = soakClients.filter((client) => client.connected).length;
      const serverClients = instance.io.engine.clientsCount;
      if (soakDisconnects !== 0) soakFailures.push(`${soakDisconnects} unexpected disconnects during soak`);
      if (connectedAtEnd !== soakClients.length) soakFailures.push(`${connectedAtEnd}/${soakClients.length} soak clients remained connected`);
      if (serverClients !== connectedAtEnd) soakFailures.push(`server held ${serverClients} clients but ${connectedAtEnd} harness clients remained connected`);
      if (instance.registry.size() !== rooms.length) soakFailures.push(`room count changed during soak`);
    }

    const expectedSeats = rooms.length * perRoom;
    const expectedPlayerSeats = rooms.reduce((sum, room) => sum + (room.players || []).length, 0);
    const expectedCalls = rooms.length * callsPerRoom;
    const failures = soakFailures.slice();
    if (rooms.length !== roomCount) failures.push(`created ${rooms.length}/${roomCount} rooms`);
    if (stats.joins !== expectedSeats) failures.push(`joined ${stats.joins}/${expectedSeats} expected seats`);
    if (stats.joinFail !== 0) failures.push(`${stats.joinFail} player joins failed`);
    if (stats.errors !== 0) failures.push(`${stats.errors} room/game operations failed`);
    if (stats.starts !== rooms.length) failures.push(`started ${stats.starts}/${rooms.length} rooms`);
    if (stats.callsAcked !== expectedCalls) failures.push(`acknowledged ${stats.callsAcked}/${expectedCalls} calls`);
    if (stats.dupCalls !== 0) failures.push(`${stats.dupCalls} duplicate calls were observed`);
    if (stats.leaks !== 0) failures.push(`${stats.leaks} player call stream(s) differed from its room's authoritative stream`);
    if (stats.claimAwards !== 0 || stats.claimRejects !== rooms.length) failures.push(`premature claim outcomes ${stats.claimRejects} refused, ${stats.claimAwards} awarded; expected ${rooms.length} refusals`);
    if (syncChecked !== expectedPlayerSeats || syncOk !== syncChecked) failures.push(`call fan-out sync ${syncOk}/${syncChecked}, expected ${expectedPlayerSeats} player seats`);
    if (stats.reconnects !== rooms.length || stats.reconnectFail !== 0) failures.push(`reconnects ${stats.reconnects}/${rooms.length}, ${stats.reconnectFail} failed`);

    const seconds = (performance.now() - t0) / 1000;
    const cpuPercent = (((cpuMs() - cpuStart) / (seconds * 1000)) * 100);
    const memory = memProbe.stop();
    const now = snap();
    report("stage " + roomCount + " rooms x ~" + perRoom + " players (" + playerCount + " target)", [
      "duration: " + seconds.toFixed(1) + "s | setup->drives->reconnects done in " + ((performance.now() - driveStart) / 1000).toFixed(1) + "s for drives",
      "joins ok: " + stats.joins + " | join failures: " + stats.joinFail + " | other errors: " + stats.errors,
      "rooms started: " + stats.starts + " | call acks: " + stats.callsAcked + " (expected " + stats.starts * callsPerRoom + ")",
      "call ack latency: p50 " + percentile(stats.ackMs, 50).toFixed(1) + "ms p95 " + percentile(stats.ackMs, 95).toFixed(1) + "ms p99 " + percentile(stats.ackMs, 99).toFixed(1) + "ms",
      "join ack latency: p50 " + percentile(stats.joinMs, 50).toFixed(1) + "ms p95 " + percentile(stats.joinMs, 95).toFixed(1) + "ms p99 " + percentile(stats.joinMs, 99).toFixed(1) + "ms (n=" + stats.joinMs.length + ")",
      "call-to-screen fan-out: p50 " + percentile(stats.fanoutMs, 50).toFixed(1) + "ms p95 " + percentile(stats.fanoutMs, 95).toFixed(1) + "ms p99 " + percentile(stats.fanoutMs, 99).toFixed(1) + "ms max " + (stats.fanoutMs.length ? Math.max(...stats.fanoutMs).toFixed(1) : "0") + "ms (n=" + stats.fanoutMs.length + ")",
      "duplicate calls seen by any client: " + stats.dupCalls,
      "cross-room/missing/unexpected call stream mismatches: " + stats.leaks,
      "claim verdicts: " + stats.claimRejects + " correctly refused, " + stats.claimAwards + " awarded (expect 0)",
      "call fan-out sync: " + syncOk + "/" + syncChecked + " players saw exactly all their room's calls",
      "reconnects ok: " + stats.reconnects + " | failed: " + stats.reconnectFail,
      ...(soakMs > 0 ? ["heartbeat soak: " + soakMs + "ms | connected clients " + soakClients.filter((client) => client.connected).length + "/" + soakClients.length + " | unexpected disconnects " + soakDisconnects] : []),
      ...(soakDisconnectReasons.size ? ["disconnect reasons: " + [...soakDisconnectReasons].map(([reason, count]) => `${reason}=${count}`).join(", ")] : []),
      "open sockets (harness side): " + openSockets.length + " | server live rooms: " + instance.registry.size(),
      "RSS: " + now.rssMb + "MB | heap: " + now.heapMb + "MB | timers: " + now.timers,
      "CPU: " + cpuPercent.toFixed(0) + "% of one core over " + seconds.toFixed(1) + "s | peak RSS " + memory.peakRssMb + "MB | peak heap " + memory.peakHeapMb + "MB",
      "event-loop delay p99: " + (delayHistogram.percentile(99) / 1e6).toFixed(1) + "ms",
      "stage result: " + (failures.length === 0 ? "PASS" : "FAIL — " + failures.join("; ")),
    ]);
    if (failures.length) stageFailures.push(`stage ${roomCount}:${playerCount}: ${failures.join("; ")}`);
    if (url) {
      console.log(
        "   [durable] pool peak total " + poolPeak.total + "/" + configuredPoolMax(instance) +
          " | peak waiting " + poolPeak.waiting + " | connection errors " + instance.db.connectionErrors()
      );
    }

    // tear this stage down completely before the next one
    for (const client of openSockets.splice(0)) client.disconnect();
    for (const room of [...instance.registry.all()]) {
      try {
        const closed = await instance.controller.closeRoom({ roomId: room.roomId, reason: "stage teardown" });
        if (closed?.ok === false) stageFailures.push(`stage ${roomCount}:${playerCount}: room ${room.roomId} teardown refused`);
      } catch (error) {
        stageFailures.push(`stage ${roomCount}:${playerCount}: room teardown failed (${error.message})`);
      }
    }
    if (instance.registry.size() !== 0) stageFailures.push(`stage ${roomCount}:${playerCount}: ${instance.registry.size()} rooms remain after teardown`);
  }

  delayHistogram.disable();
  if (profiler) {
    const profile = await profiler.stop();
    console.log("\n== database profile (staged run) " + "=".repeat(30));
    console.log("   " + formatDbProfile(profile));
  }
  if (url) await instance.db.query("DROP SCHEMA IF EXISTS " + schema + " CASCADE").catch(() => {});
  await instance.closeServer();
  process.exitCode = stageFailures.length === 0 ? 0 : 1;
  if (stageFailures.length) {
    console.error("RESULT: FAIL\n" + stageFailures.map((failure) => " - " + failure).join("\n"));
  } else {
    console.log("RESULT: PASS (all staged correctness and teardown checks passed)");
  }
}

// ------------------------------------------------------------------------ main

const mode = process.argv[2];
if (mode === "sequential") await sequential();
else if (mode === "staged") await staged();
else {
  console.error("usage: node scripts/loadtest.mjs <sequential|staged> [--rooms N] [--stages R:P,R:P] [--calls M] [--soak-ms N]");
  process.exitCode = 2;
}
