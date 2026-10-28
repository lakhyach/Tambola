/**
 * Hand-written, versioned SQL migrations.
 *
 * Rules
 *  - files live in server/db/migrations/ and are named NNN_label.sql
 *  - a migration is applied exactly once, inside its own transaction
 *  - the runner keeps a checksum: editing an already-applied migration is a
 *    hard error (MIGRATION_DRIFT) rather than a silent mismatch
 *  - an advisory lock serialises two servers that boot at the same moment
 *
 * The schema itself is written without qualifying table names, so the same
 * SQL runs in production's `public` and in a throwaway test schema.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { assertSchemaName } from "./pool.js";

const MIGRATION_NAME = /^(\d{3,})_[A-Za-z0-9_]+\.sql$/;
const MIGRATE_LOCK_KEY = 728439273842318;
const here = path.dirname(fileURLToPath(import.meta.url));

export function listMigrations(dir = path.join(here, "migrations")) {
  const files = fs
    .readdirSync(dir)
    .filter((name) => MIGRATION_NAME.test(name))
    .sort();
  return files.map((name) => {
    const sql = fs.readFileSync(path.join(dir, name), "utf8");
    return {
      version: name.split("_")[0],
      name,
      sql,
      checksum: createHash("sha256").update(sql).digest("hex"),
    };
  });
}

async function ensureSchema(db, client) {
  if (db.schema === "public") return;
  await client.query("CREATE SCHEMA IF NOT EXISTS " + assertSchemaName(db.schema));
  await client.query("SET search_path TO " + assertSchemaName(db.schema) + ", public");
}

/**
 * @param {{query:Function, withTransaction:Function, schema:string}} db  from createPool()
 * @returns {Promise<{applied: string[], skipped: string[], latest: string|null}>}
 */
export async function migrate({ db, dir, log = () => {} } = {}) {
  if (!db) throw new Error("migrate() needs a database handle");
  const migrations = listMigrations(dir);
  const applied = [];
  const skipped = [];

  const client = await db.pool.connect();
  try {
    await ensureSchema(db, client);
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATE_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    text PRIMARY KEY,
        name       text NOT NULL,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const existing = await client.query("SELECT version, checksum FROM schema_migrations ORDER BY version");
    const byVersion = new Map(existing.rows.map((row) => [row.version, row.checksum]));

    for (const migration of migrations) {
      const recorded = byVersion.get(migration.version);
      if (recorded !== undefined) {
        if (recorded !== migration.checksum) {
          const error = new Error(
            "migration " + migration.name + " changed after it was applied (MIGRATION_DRIFT)"
          );
          error.code = "MIGRATION_DRIFT";
          throw error;
        }
        skipped.push(migration.name);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)",
          [migration.version, migration.name, migration.checksum]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        error.message = "migration " + migration.name + " failed: " + error.message;
        error.code = error.code || "MIGRATION_FAILED";
        throw error;
      }
      applied.push(migration.name);
      log("migration applied", migration.name);
    }

    return {
      applied,
      skipped,
      latest: migrations.length ? migrations[migrations.length - 1].name : null,
      pending: migrations.filter((m) => !byVersion.has(m.version)).map((m) => m.name),
    };
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATE_LOCK_KEY]).catch(() => {});
    client.release();
  }
}

/** What this database already has, for health output and for the tests. */
export async function migrationStatus({ db } = {}) {
  const client = await db.pool.connect();
  try {
    await ensureSchema(db, client);
    const rows = await client.query("SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version");
    return rows.rows;
  } finally {
    client.release();
  }
}

// ------------------------------------------------------------------- command

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const { createPool } = await import("./pool.js");
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const db = createPool({ connectionString, schema: process.env.DB_SCHEMA || "public" });
  try {
    const result = await migrate({ db, log: (...args) => console.log("[migrate]", ...args) });
    console.log(
      "applied:", result.applied.join(", ") || "nothing (already up to date)",
      "| latest:", result.latest || "none"
    );
  } catch (error) {
    console.error("[migrate] " + error.message);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}
