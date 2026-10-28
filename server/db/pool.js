/**
 * Database connection plumbing. The only file in the project that knows how to
 * reach PostgreSQL; everything above it (persist/, net/) talks to the small
 * interface returned here.
 *
 * Responsibilities
 *  - one pg Pool per server instance, pinned to a schema (search_path)
 *  - query() and withTransaction(): BEGIN / work / COMMIT, with ROLLBACK on
 *    any throw, so a half-written game state can never be left behind
 *  - a retried transaction only ever retries a ROLLED BACK attempt. Once a
 *    COMMIT may have reached the server the caller is told PERSIST_UNKNOWN and
 *    the store re-reads the row instead of writing it twice.
 *  - the single-instance lease: a session-scoped advisory lock held on a
 *    dedicated connection. A second server pointed at the same database
 *    refuses to start rather than running two schedulers over one set of rooms.
 */

import { randomUUID } from "node:crypto";
import pg from "pg";

const { Pool } = pg;

/** Transient failures worth a fresh connection and a retry. */
const RETRYABLE = new Set([
  "40001", // serialization failure
  "40P01", // deadlock detected
  "53300", // too many connections
  "57P01", // admin shutdown
  "57P02", // crash shutdown
  "57P03", // cannot connect now
  "58000", // backend error
  "08006", // connection failure
  "08001", // sqlclient unable to connect
  "08004", // server rejected connection
  "08P01", // protocol violation
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "57014", // statement timeout - the write was aborted
]);

const SCHEMA_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

/** Guard: schema names reach SQL as identifiers, so they are whitelisted. */
export function assertSchemaName(name) {
  if (typeof name !== "string" || !SCHEMA_PATTERN.test(name)) {
    throw new Error("unsafe schema name: " + JSON.stringify(name));
  }
  return name;
}

/** Advisory-lock key for "one Tambola game server owns these rooms". */
export const INSTANCE_LOCK_KEY = 728439273842317;

export function createPool(options = {}) {
  const schema = assertSchemaName(options.schema || "public");
  const log = options.log || (() => {});
  const connectionString = options.connectionString;
  if (!connectionString) throw new Error("createPool needs a connectionString");

  const pool = new Pool({
    connectionString,
    max: options.max ?? 8,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5000,
    statement_timeout: options.statementTimeoutMs ?? 5000,
    idle_timeout_millis: options.idleTimeoutMs ?? 30000,
    application_name: options.applicationName || "tambola-server",
  });

  // Every physical connection works inside the chosen schema, so the same SQL
  // runs against production `public` or a throwaway test schema unchanged.
  pool.on("connect", (client) => {
    client.query("SET search_path TO " + schema + ", public").catch((error) => {
      log("search_path failed", error && error.message);
    });
  });

  let lost = 0;
  pool.on("error", (error) => {
    lost += 1;
    log("idle database connection error", error && error.message);
  });

  function codeOf(error) {
    return String((error && error.code) || (error && error.message) || "UNKNOWN");
  }

  async function query(text, params) {
    return pool.query(text, params);
  }

  /**
   * Run `fn(client)` inside one transaction. Returns fn's value.
   * Throws an error carrying `code`:
   *   PERSIST_FAILED  - the transaction definitely did not commit
   *   PERSIST_UNKNOWN - the failure happened while committing, so the outcome
   *                     is unknown and the caller must re-read instead of
   *                     writing again
   */
  async function withTransaction(fn) {
    const client = await pool.connect();
    let committed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      const result = await fn(client);
      await client.query("COMMIT");
      committed = true;
      return result;
    } catch (error) {
      if (!committed) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          log("rollback failed", rollbackError && rollbackError.message);
        }
      }
      const wrapped = new Error("database transaction failed: " + (error && error.message));
      wrapped.cause = error;
      wrapped.code = error && error.code === "PERSIST_FAILED" ? error.code : codeOf(error);
      wrapped.retryable = RETRYABLE.has(codeOf(error));
      wrapped.committed = committed;
      throw wrapped;
    } finally {
      client.release();
    }
  }

  /**
   * `fn` must be idempotent (every durable write in this project is keyed by a
   * unique constraint, so replaying it is a no-op or a clean conflict).
   */
  async function withRetry(fn, { attempts = 3, backoffMs = 40 } = {}) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (error.committed) throw error; // outcome unknown: never blind-retry
        if (!error.retryable || attempt === attempts) break;
        await new Promise((resolve) => setTimeout(resolve, backoffMs * attempt));
      }
    }
    throw lastError;
  }

  async function healthCheck() {
    try {
      const result = await pool.query("SELECT 1 AS ok");
      return Boolean(result.rows[0] && result.rows[0].ok === 1);
    } catch (error) {
      log("health check failed", error && error.message);
      return false;
    }
  }

  /**
   * Take the single-instance advisory lock on a dedicated connection. The lock
   * is owned by the session, so it disappears with the process - a crash never
   * leaves a stale lock behind.
   */
  async function acquireInstanceLease({ holder = randomUUID() } = {}) {
    const client = await pool.connect();
    let acquired = false;
    try {
      const result = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [INSTANCE_LOCK_KEY]);
      acquired = result.rows[0].locked === true;
      if (!acquired) {
        const error = new Error("another game server already holds this database");
        error.code = "INSTANCE_LOCKED";
        throw error;
      }
      await client.query(
        `INSERT INTO instance_lease (lease_key, holder, acquired_at, heartbeat_at)
         VALUES ($1, $2, now(), now())
         ON CONFLICT (lease_key)
         DO UPDATE SET holder = EXCLUDED.holder, acquired_at = now(), heartbeat_at = now()`,
        ["game-server", holder]
      );
    } catch (error) {
      // release exactly once: the lock never made it past `acquired`, so an
      // INSTANCE_LOCKED throw must not double-release the connection
      if (acquired) await client.query("SELECT pg_advisory_unlock($1)", [INSTANCE_LOCK_KEY]).catch(() => {});
      client.release();
      throw error;
    }

    let released = false;
    return {
      holder,
      /**
       * Prove the lease is still ours and refresh heartbeat_at.
       *
       * Two ways to lose it, and both must be reported rather than swallowed:
       * the dedicated lock connection died (a Postgres restart, a network
       * partition - which also released the advisory lock), or the lease row
       * was re-pointed at another holder (a restore, an operator command). A
       * heartbeat that cannot write its own row is no authority at all, so the
       * caller is told `held: false` instead of being left to assume success.
       */
      async heartbeat() {
        if (released) return { held: false, at: Date.now(), reason: "released" };
        try {
          const result = await client.query(
            "UPDATE instance_lease SET heartbeat_at = now() WHERE lease_key = $1 AND holder = $2",
            ["game-server", holder]
          );
          const held = result.rowCount === 1;
          return { held, at: Date.now(), reason: held ? null : "lease row is held by another instance" };
        } catch (error) {
          return { held: false, at: Date.now(), reason: (error && error.message) || "heartbeat failed" };
        }
      },
      async release() {
        if (released) return;
        released = true;
        try {
          await client.query("DELETE FROM instance_lease WHERE lease_key = $1 AND holder = $2", ["game-server", holder]);
          await client.query("SELECT pg_advisory_unlock($1)", [INSTANCE_LOCK_KEY]);
        } finally {
          client.release();
        }
      },
    };
  }

  return {
    pool,
    schema,
    query,
    withTransaction,
    withRetry,
    healthCheck,
    acquireInstanceLease,
    connectionErrors: () => lost,
    end: () => pool.end(),
  };
}
