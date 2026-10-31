#!/usr/bin/env node
/**
 * Restore verification (Phase 6 §8) — the "a backup you have never restored is
 * not a backup" check.
 *
 *   npm run db:restore-check            # verify the newest dump in BACKUP_DIR
 *   npm run db:restore-check -- <dump>  # verify a specific .dump file
 *
 * What it does, and what it refuses to do:
 *  1. Creates a brand-NEW, throwaway database on the same cluster
 *     (`tambola_rc_<hex>`), never touching the live one.
 *  2. `pg_restore`s the chosen archive into it (--no-owner, exit-on-error).
 *  3. Runs integrity checks against the manifest the backup recorded:
 *       - migration ledger (version/name/checksum) matches,
 *       - the base-table inventory matches,
 *       - every table's row count matches,
 *       - semantic invariants of restored games hold (no gaps/duplicates in the
 *         call log, numbers within 1..90, calls never exceed the round marker) —
 *         i.e. restored rooms and history are actually readable and coherent.
 *  4. Drops the throwaway database, then prints PASS or FAIL.
 *
 * It will NOT restore over, or into, the source database, and it never restores
 * into `public` of the live schema. Credentials are handled exactly as in
 * backup.js: environment only, never in argv, a log line, or a filename.
 *
 * Configuration (environment):
 *  DATABASE_URL   required — source database (also used to reach its cluster)
 *  DB_SCHEMA      optional (default public) — schema the manifest counted
 *  BACKUP_DIR     optional — where dumps live (default <repo>/backups)
 *  DUMP_FILE      optional — explicit archive; a positional arg overrides it
 *  RESTORE_ADMIN_DATABASE_URL  optional — maintenance connection (defaults to
 *                              DATABASE_URL pointed at the "postgres" database)
 *  RESTORE_CHECK_KEEP=1  optional — leave the scratch database for inspection
 *  PG_BIN / PG_CONTAINER / PG_CONTAINER_PORT  — tool driver, as in backup.js
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  parseConnection,
  connectionArgs,
  connectionToDatabase,
  runPgTool,
  collectSnapshot,
  compareSnapshots,
  semanticChecks,
  assertIdentifier,
  redact,
} from "./pg-cli.js";

const { Pool } = pg;
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function latestDump(dir) {
  if (!fs.existsSync(dir)) return null;
  const dumps = fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".dump"))
    .map((n) => ({ n, t: fs.statSync(path.join(dir, n)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return dumps.length ? path.join(dir, dumps[0].n) : null;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Restore-check needs the source database; see server/RUNBOOK.md §7.");
    process.exit(1);
  }
  const source = parseConnection(url);
  // Validated up front: this name is interpolated into SQL and into a regular
  // expression that reads the archive's table of contents.
  const schema = assertIdentifier(process.env.DB_SCHEMA || "public");
  const container = process.env.PG_CONTAINER || null;
  const binDir = process.env.PG_BIN || null;
  const containerPort = Number(process.env.PG_CONTAINER_PORT) || 5432;
  const backupDir = path.resolve(process.env.BACKUP_DIR || path.join(root, "backups"));

  // Choose the archive.
  const argPath = process.argv[2] && process.argv[2].endsWith(".dump") ? process.argv[2] : null;
  const dumpPath = path.resolve(argPath || process.env.DUMP_FILE || latestDump(backupDir) || "");
  if (!dumpPath || !fs.existsSync(dumpPath)) {
    console.error("No archive to verify. Run `npm run db:backup` first, or pass a .dump path.");
    process.exit(1);
  }
  const manifestPath = dumpPath.replace(/\.dump$/, ".manifest.json");
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : null;
  console.log(`[restore-check] archive: ${path.basename(dumpPath)}`);
  console.log(`[restore-check] manifest: ${manifest ? path.basename(manifestPath) : "MISSING — will compare against the live source instead"}`);

  const scratch = assertIdentifier(`tambola_rc_${randomBytes(5).toString("hex")}`);
  const adminUrl = process.env.RESTORE_ADMIN_DATABASE_URL || connectionToDatabase(url, "postgres");
  const admin = parseConnection(adminUrl);
  if (admin.database === source.database && scratch === source.database) {
    console.error("[restore-check] refusing to restore into the source database.");
    process.exit(1);
  }

  const scratchUrl = connectionToDatabase(url, scratch);
  const env = source.password ? { PGPASSWORD: source.password } : {};

  let restoreFailures = [];
  let issues = [];
  let semanticIssues = [];
  let created = false;
  let adminPool = null;
  try {
    adminPool = new Pool({ connectionString: adminUrl, max: 1, connectionTimeoutMillis: 8000 });
    await adminPool.query(`CREATE DATABASE ${JSON.stringify(scratch)}`);
    created = true;
    console.log(`[restore-check] created throwaway database "${scratch}" (source "${redact(url).split("/").pop()}" untouched)`);

    // An archive dumped with an explicit `--schema` carries its own CREATE SCHEMA,
    // but a brand-new database already contains `public` — so restoring straight
    // into one dies on `schema "public" already exists` even though the archive is
    // perfectly good. Ask the archive what it intends to create, and clear exactly
    // that schema out of the scratch database first. Archives that assume the
    // schema already exists (an unscoped dump of `public`) are left alone.
    if (await archiveCreatesSchema({ dumpPath, schema, container, binDir, containerPort, env })) {
      const scratchPool = new Pool({ connectionString: scratchUrl, max: 1, connectionTimeoutMillis: 8000 });
      try {
        await scratchPool.query(`DROP SCHEMA IF EXISTS ${JSON.stringify(schema)} CASCADE`);
      } finally {
        await scratchPool.end().catch(() => {});
      }
      console.log(`[restore-check] archive creates schema "${schema}" itself — removed the pre-existing one from the scratch database`);
    }

    // Restore the archive into the empty scratch database. The tool connects
    // with the source's credentials (same cluster); --exit-on-error makes any
    // SQL failure a hard, visible failure rather than a silent warning.
    const restore = await runPgTool({
      tool: "pg_restore",
      args: [...connectionArgs(source), "-d", scratch, "--no-owner", "--no-privileges", "--exit-on-error"],
      env,
      container,
      binDir,
      containerPort,
      stdinFile: dumpPath,
    });
    if (restore.code === 0) {
      console.log(`[restore-check] pg_restore into "${scratch}" completed`);

      // Gather what actually landed in the restored database.
      const actual = await collectSnapshot(scratchUrl, schema);
      // Gather what the backup promised. Prefer the manifest; otherwise re-read
      // the live source (a valid faithful-restore check for a just-taken backup).
      const expected = manifest
        ? { schema: manifest.schema, ledger: manifest.migrationLedger, tables: manifest.tables, rows: manifest.rowCountByTable }
        : await collectSnapshot(url, schema);

      issues = compareSnapshots(expected, actual);
      console.log(`[restore-check] restored ${actual.tables.length} table(s), ${countTotal(actual.rows)} row(s); ledger ${(actual.ledger || []).length} entry(ies)`);

      // Prove restored rooms and history are readable and internally consistent.
      semanticIssues = await semanticChecks(scratchUrl, schema);
    } else {
      restoreFailures.push(`pg_restore exited ${restore.code}`);
      if (restore.stderr) restoreFailures.push("pg_restore said: " + redactLines(restore.stderr).slice(0, 2000));
      // Never throw here: this exit code plus the captured stderr are the only
      // place the real reason lives. The old behaviour threw past the report, so
      // an operator was told "pg_restore failed" and nothing else.
    }
  } catch (error) {
    // An unexpected failure (connection, permissions) is collected as a problem
    // instead of escaping as a stack trace, so cleanup still runs and the reason
    // is still printed in the report below.
    restoreFailures.push("restore-check aborted: " + redactLines(String((error && error.message) || error)));
  } finally {
    if (adminPool) await adminPool.end().catch(() => {});
    if (created && process.env.RESTORE_CHECK_KEEP !== "1") {
      // Reconnect to maintenance to drop; FORCE terminates any straggler backends.
      try {
        const cleaner = new Pool({ connectionString: adminUrl, max: 1, connectionTimeoutMillis: 8000 });
        await cleaner.query(`DROP DATABASE IF EXISTS ${JSON.stringify(scratch)} WITH (FORCE)`);
        await cleaner.end();
        console.log(`[restore-check] dropped throwaway database "${scratch}"`);
      } catch (error) {
        console.error(`[restore-check] could not drop "${scratch}" (drop it manually): ` + error.message);
      }
    } else if (created) {
      console.log(`[restore-check] RESTORE_CHECK_KEEP=1 — leaving "${scratch}" in place for inspection`);
    }
  }

  report(restoreFailures, issues, semanticIssues);
}

// The single exit path. Reachable whether the restore succeeded, failed, or threw
// part-way, so the reason is always printed rather than being lost to an exception.
function report(restoreFailures, issues, semanticIssues) {
  const problems = [...restoreFailures, ...issues, ...semanticIssues];
  if (problems.length) {
    console.error("\nRESTORE CHECK FAILED");
    for (const p of problems) console.error("  - " + p);
    process.exit(1);
  }
  console.log("\nRESTORE CHECK PASSED");
  console.log(`  archive restores faithfully into an isolated database; ledger, table inventory, row counts and game-history invariants all match.`);
}

// Does this archive intend to CREATE the schema it dumped? Read from the archive's
// own table of contents (`pg_restore --list`), never from the archive name or the
// settings of whoever took it, so an archive produced by any version of this tool —
// or by a hand-run pg_dump — is judged on what it actually contains.
async function archiveCreatesSchema({ dumpPath, schema, container, binDir, containerPort, env }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tambola-restore-check-"));
  const listFile = path.join(dir, "toc.txt");
  try {
    const list = await runPgTool({
      tool: "pg_restore",
      args: ["--list"],
      env,
      container,
      binDir,
      containerPort,
      stdinFile: dumpPath,
      stdoutFile: listFile,
    });
    if (list.code !== 0) {
      throw new Error("could not read the archive's contents: pg_restore --list exited " + list.code + (list.stderr ? " — " + redactLines(list.stderr).slice(0, 500) : ""));
    }
    // A schema-definition TOC line looks like:  4; 2615 2200 SCHEMA - public pg_database_owner
    // (a COMMENT ON SCHEMA line is `COMMENT - SCHEMA public …` and deliberately does
    // not match, since only the definition itself would fail on an existing schema.)
    const definition = new RegExp("^\\s*\\d+;\\s+\\d+\\s+\\S+\\s+SCHEMA\\s+-\\s+" + schema + "\\b");
    return fs.readFileSync(listFile, "utf8").split(/\r?\n/).some((line) => definition.test(line));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function countTotal(rows) {
  return Object.values(rows || {}).reduce((sum, n) => sum + Number(n || 0), 0);
}

function redactLines(text) {
  return String(text)
    .replace(/:\/\/[^:@/]+:[^@/]+@/g, "://***:***@")
    .replace(/(password|PGPASSWORD)\s*[=:]\s*\S+/gi, "$1=[redacted]");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("[restore-check] failed: " + (error && error.message));
    process.exit(1);
  });
}
