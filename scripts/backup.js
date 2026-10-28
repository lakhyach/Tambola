#!/usr/bin/env node
/**
 * Database backup (Phase 6 §8).
 *
 *   npm run db:backup
 *
 * Produces a `pg_dump` custom-format archive of the durable database plus a
 * small JSON manifest describing exactly what the archive contains, so a later
 * `db:restore-check` can prove the archive restores faithfully. The archive is
 * a real Postgres dump, not a hand-written SQL script.
 *
 * Safety / hygiene this command upholds:
 *  - Backups are written OUTSIDE the live data directory, to `BACKUP_DIR`
 *    (default `<repo>/backups`, git-ignored). Nothing is dropped into `.pgdata`.
 *  - No credential ever touches a filename, this command's logs, or the
 *    manifest. The password reaches `pg_dump` through the process environment
 *    only; the manifest stores table counts and the migration ledger, never a
 *    connection string.
 *  - The dump is never taken over a partially-written transaction: `pg_dump`
 *    runs in a single repeatable-read transaction and gives a consistent snapshot.
 *
 * Tool driver (see scripts/pg-cli.js header):
 *  - native `pg_dump` on PATH, or under `PG_BIN=/path/to/pg/bin`
 *  - `PG_CONTAINER=<name-or-id>` to run it inside the database container
 *
 * Configuration (environment):
 *  DATABASE_URL   required — the database to back up
 *  DB_SCHEMA      optional (default public) — the schema counted into the manifest
 *  BACKUP_DIR     optional — where to write dumps (default <repo>/backups)
 *  PG_BIN         optional — directory holding pg client tools
 *  PG_CONTAINER   optional — container name/id to run the tools inside
 *  PG_CONTAINER_PORT optional (default 5432) — the tool's port inside that container
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseConnection, connectionArgs, runPgTool, collectSnapshot } from "./pg-cli.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function timestamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + "T" + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z"
  );
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. A backup needs the durable database; see server/RUNBOOK.md §7.");
    process.exit(1);
  }
  const conn = parseConnection(url);
  const container = process.env.PG_CONTAINER || null;
  const binDir = process.env.PG_BIN || null;
  const containerPort = Number(process.env.PG_CONTAINER_PORT) || 5432;
  const schema = process.env.DB_SCHEMA || "public";
  const backupDir = path.resolve(process.env.BACKUP_DIR || path.join(root, "backups"));

  fs.mkdirSync(backupDir, { recursive: true });
  // Filename carries the database name and a timestamp — never a user or password.
  const stamp = timestamp();
  const dumpName = `tambola-${conn.database}-${stamp}.dump`;
  const dumpPath = path.join(backupDir, dumpName);
  const manifestPath = dumpPath.replace(/\.dump$/, ".manifest.json");

  console.log(`[backup] dumping database "${conn.database}" (schema "${schema}") with ${container ? "pg_dump in container " + container : "pg_dump via " + (binDir || "PATH")}`);
  console.log(`[backup] writing to ${dumpPath}`);

  const args = [...connectionArgs(conn), "-d", conn.database, "--format=custom", "--compress=6", "--no-owner", "--no-privileges"];
  if (schema !== "public") args.push("--schema", schema);
  const result = await runPgTool({
    tool: "pg_dump",
    args,
    env: conn.password ? { PGPASSWORD: conn.password } : {},
    container,
    binDir,
    containerPort,
    stdoutFile: dumpPath,
  });

  if (result.code !== 0) {
    fs.rmSync(dumpPath, { force: true });
    console.error("[backup] pg_dump failed (exit " + result.code + "). No partial archive left behind.");
    if (result.stderr) console.error(redactLines(result.stderr));
    process.exit(1);
  }

  const bytes = fs.statSync(dumpPath).size;
  if (bytes === 0) {
    fs.rmSync(dumpPath, { force: true });
    console.error("[backup] pg_dump produced an empty archive; aborting.");
    process.exit(1);
  }
  const sha256 = createHash("sha256").update(fs.readFileSync(dumpPath)).digest("hex");

  // Snapshot the LIVE source so the manifest records what the archive promises.
  // The tools may run inside a container but this query uses the already-reachable
  // host connection string, so it needs no binary.
  const snapshot = await collectSnapshot(url, schema);

  const manifest = {
    format: "pg_dump-custom",
    generatedAt: new Date().toISOString(),
    database: conn.database,
    schema,
    file: dumpName,
    bytes,
    sha256,
    host: os.hostname(),
    toolDriver: container ? "container:" + container : "native",
    tables: snapshot.tables,
    rowCountByTable: snapshot.rows,
    migrationLedger: snapshot.ledger,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  console.log(`[backup] wrote ${dumpName} (${bytes} bytes, sha256 ${sha256.slice(0, 16)}…)`);
  console.log(`[backup] ${snapshot.tables.length} table(s), ${countTotal(snapshot.rows)} row(s) recorded in ${path.basename(manifestPath)}`);
  console.log(`[backup] verify with:  npm run db:restore-check`);
}

function countTotal(rows) {
  return Object.values(rows || {}).reduce((sum, n) => sum + Number(n || 0), 0);
}

// Defensive: if a tool ever echoes something credential-shaped, do not pass it through.
function redactLines(text) {
  return String(text)
    .replace(/:\/\/[^:@/]+:[^@/]+@/g, "://***:***@")
    .replace(/(password|PGPASSWORD)\s*[=:]\s*\S+/gi, "$1=[redacted]");
}

main().catch((error) => {
  console.error("[backup] failed: " + (error && error.message));
  process.exit(1);
});
