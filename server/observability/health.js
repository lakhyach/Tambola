/**
 * Liveness and readiness, answered from facts rather than hope.
 *
 * The Phase 5 server had one endpoint, /healthz, that returned `ok: true` in
 * every case - including with Postgres down, the instance lease lost and the
 * schema behind the code. A load balancer reading it would keep sending traffic
 * to a process that could not serve a single game.
 *
 * Three answers, three questions:
 *   liveness   is this process alive and not stuck?  Never touches the
 *              database: a database outage must not make a supervisor kill a
 *              perfectly healthy server (that would restart-loop the fleet).
 *   readiness  can this process serve traffic right now?  Database reachable,
 *              schema current, instance lease held, not draining. A failing
 *              answer takes the process out of rotation without killing it.
 *   report     the same facts in one object, for an operator reading /healthz.
 *
 * Nothing here returns a connection string, a query, a stack trace or a secret.
 * Every database call is bounded, so a probe can never hang a load balancer.
 */

import { listMigrations, migrationStatus } from "../db/migrate.js";

/** Name of the newest migration on disk, or null when there are none. */
export function latestMigrationName() {
  const all = listMigrations();
  return all.length ? all[all.length - 1].name : null;
}

function withTimeout(promise, ms, fallback) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
    if (typeof timer.unref === "function") timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Is the schema this database carries the schema this build expects?
 *
 * A server started against a database that is one migration behind will serve
 * requests whose queries reference a column that does not exist yet. That is a
 * deployment error, not a runtime one, so it is reported as not-ready.
 */
export async function checkMigrations({ db, timeoutMs = 2000 } = {}) {
  const latest = latestMigrationName();
  if (!db) return { current: false, latest, applied: [], pending: [], error: "no database" };
  try {
    const rows = await withTimeout(migrationStatus({ db }), timeoutMs, null);
    if (!rows) return { current: false, latest, applied: [], pending: [], error: "migration check timed out" };
    const appliedNames = rows.map((row) => row.name);
    const appliedVersions = new Set(rows.map((row) => row.version));
    const pending = listMigrations()
      .filter((migration) => !appliedVersions.has(migration.version))
      .map((migration) => migration.name);
    return {
      current: pending.length === 0,
      latest,
      applied: appliedNames.length,
      pending,
      error: pending.length ? "migrations pending" : null,
    };
  } catch (error) {
    return { current: false, latest, applied: [], pending: [], error: "migrations unreadable" };
  }
}

/**
 * @param {object} deps
 * @param {boolean} deps.durable        durable mode (a database backs the game)
 * @param {object|null} deps.db         pool handle, or null in memory mode
 * @param {boolean} deps.production     NODE_ENV === "production"
 * @param {boolean} deps.memoryAllowed  ALLOW_MEMORY_ONLY=1 was set explicitly
 * @param {() => object} deps.lease     current lease state { held, lost, lastHeartbeatAt }
 * @param {() => boolean} deps.draining shutting down
 * @param {() => object} deps.rooms     { live, frozen } from the registry/controller
 * @param {() => object|null} deps.scheduler  calling-clock summary: how many rooms
 *        have an armed timer, when the next tick is due and whether one is
 *        overdue. A scheduler that has silently stopped is a game that has
 *        silently stopped, and no other probe can see that.
 * @param {() => object|null} deps.pool      pg pool occupancy { total, idle,
 *        waiting, max, errors }. A pool permanently at max with waiters is the
 *        earliest visible sign that the database is the bottleneck.
 */
export function createHealth({
  durable,
  db = null,
  production = false,
  memoryAllowed = false,
  lease = () => ({ held: false, lost: false }),
  draining = () => false,
  rooms = () => ({ live: 0, frozen: 0 }),
  scheduler = () => null,
  pool = () => null,
  now = () => Date.now(),
  cacheMs = 1500,
  timeoutMs = 2000,
} = {}) {
  const startedAt = now();
  let cached = null;

  function liveness() {
    // Only facts about this process. A database outage is a readiness problem.
    // Not even uptime belongs here: /livez answers one question — is this
    // process alive — and says nothing else, so a public probe URL cannot
    // become a free telemetry feed. Uptime is still on /readyz and /healthz.
    return { ok: true, live: true, draining: Boolean(draining()) };
  }

  async function readiness() {
    const at = now();
    if (cached && at - cached.at < cacheMs) return cached.value;

    const counts = rooms() || { live: 0, frozen: 0 };
    const reasons = [];
    const leaseState = lease() || {};
    if (draining()) reasons.push("draining");
    if (leaseState.lost) reasons.push("instance_lease_lost");

    if (!durable) {
      if (production && !memoryAllowed) reasons.push("no_database_in_production");
      const value = {
        ready: reasons.length === 0,
        mode: "memory",
        durable: false,
        degraded: true,
        reasons,
        note: "memory mode: nothing survives a restart",
        rooms: counts,
        scheduler: scheduler() || null,
        at,
      };
      cached = { at, value };
      return value;
    }

    let database = false;
    try {
      database = await withTimeout(db.healthCheck(), timeoutMs, false);
    } catch {
      database = false;
    }
    if (!database) reasons.push("database_unreachable");

    let migrations = { current: false, latest: latestMigrationName(), pending: [], error: "database unreachable" };
    if (database) {
      migrations = await checkMigrations({ db, timeoutMs });
      if (!migrations.current) reasons.push("migrations_pending");
    }

    const value = {
      ready: reasons.length === 0,
      mode: durable ? "durable" : "memory",
      durable: Boolean(durable),
      database,
      migrations: { current: Boolean(migrations.current), latest: migrations.latest, pending: migrations.pending },
      lease: { held: Boolean(leaseState.held), lost: Boolean(leaseState.lost) },
      draining: Boolean(draining()),
      reasons,
      rooms: counts,
      scheduler: scheduler() || null,
      pool: pool() || null,
      uptimeSeconds: Math.round((now() - startedAt) / 1000),
      at,
    };
    cached = { at, value };
    return value;
  }

  /** One object with everything an operator or a probe could want. */
  async function report() {
    const ready = await readiness();
    return { ok: ready.ready, ...ready, live: true, uptimeSeconds: Math.round((now() - startedAt) / 1000) };
  }

  return { liveness, readiness, report };
}
