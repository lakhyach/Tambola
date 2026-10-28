/**
 * Shared plumbing for the database backup / restore-check CLIs.
 *
 * Design rules this file upholds (Phase 6 §8):
 *  - Use standard PostgreSQL tooling (`pg_dump` custom format, `pg_restore`),
 *    never a hand-rolled SQL dump, so a backup is a real backup.
 *  - A connection password must never appear in a filename, in a log line, in a
 *    written report, or in the tool's command-line arguments. It is handed to the
 *    tool through the process environment only (`PGPASSWORD`), and — when the
 *    tools run inside a container — via `docker exec -e PGPASSWORD` which inherits
 *    the value from the parent process env rather than embedding it in argv.
 *  - All SQL that this file runs goes through the plain `pg` driver over the
 *    (already host-reachable) connection string, so integrity checks need no
 *    external binary. Only the dump/restore themselves shell out.
 *
 * Tool execution has two drivers, chosen by configuration:
 *  - native: `pg_dump`/`pg_restore` found on PATH, or under `PG_BIN`.
 *  - container: when the database runs in Docker and the host has no client
 *    tools, set `PG_CONTAINER=<name-or-id>`; commands run with `docker exec`
 *    against the container's own loopback (port `PG_CONTAINER_PORT`, default 5432).
 *    This is a local/testing convenience; in production prefer the native driver
 *    so the secret stays in the environment of a single local process.
 */

import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import pg from "pg";

const { Pool } = pg;

/** Parse a `postgres://` URL into its parts. Never logs the password. */
export function parseConnection(url) {
  if (typeof url !== "string" || !url.trim()) throw new Error("a PostgreSQL connection string is required");
  const u = new URL(url);
  const searchSsl = u.searchParams.get("sslmode") || u.searchParams.get("ssl");
  return {
    user: decodeURIComponent(u.username || ""),
    password: u.password ? decodeURIComponent(u.password) : "",
    host: decodeURIComponent(u.hostname || "127.0.0.1"),
    port: Number(u.port || 5432),
    database: decodeURIComponent((u.pathname || "/").replace(/^\//, "")) || "postgres",
    ssl: searchSsl && searchSsl !== "disable" ? { rejectUnauthorized: searchSsl !== "no-verify" } : undefined,
  };
}

/** Swap the database segment of a connection string (used to reach the maintenance db). */
export function connectionToDatabase(url, database) {
  const u = new URL(url);
  u.pathname = "/" + database;
  return u.toString();
}

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;
export function assertIdentifier(name) {
  if (typeof name !== "string" || !IDENT.test(name)) throw new Error("unsafe database identifier: " + JSON.stringify(name));
  return name;
}

/**
 * Run one PostgreSQL tool to completion. Returns `{ code, signal, stderr }`.
 * `stdinFile` is streamed into the tool; `stdoutFile` captures binary stdout.
 * The chosen driver decides whether we exec a local binary or `docker exec`.
 */
export async function runPgTool({ tool, args, env = {}, container = null, binDir = null, containerHost = "127.0.0.1", containerPort = 5432, stdinFile = null, stdoutFile = null } = {}) {
  if (!/^[a-z_]+$/.test(tool || "")) throw new Error("unknown tool: " + String(tool));
  const spawnEnv = { ...process.env, ...env };
  // Which env keys we forward into the container without ever printing them.
  const forward = Object.keys(env).filter((k) => ["PGPASSWORD", "PGSSLMODE", "PGCONNECT_TIMEOUT", "PGOPTIONS"].includes(k));

  let cmd;
  let fullArgs;
  if (container) {
    cmd = "docker";
    const envFlags = [];
    for (const k of forward) envFlags.push("-e", k);
    // Re-point host/port at the container's own socket so the (already
    // container-local) DATABASE_URL host mapping does not confuse the tool.
    const retargeted = retargetHostPort(args, containerHost, containerPort);
    fullArgs = ["exec", "-i", ...envFlags, container, tool, ...retargeted];
  } else {
    cmd = binDir ? path.join(binDir, tool) : tool;
    fullArgs = args;
  }

  return await new Promise((resolve, reject) => {
    const child = spawn(cmd, fullArgs, { stdio: ["pipe", "pipe", "pipe"], env: spawnEnv });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 64 * 1024) stderr = stderr.slice(-32 * 1024);
    });

    let readStream;
    if (stdinFile) {
      readStream = fs.createReadStream(stdinFile);
      readStream.on("error", reject);
      readStream.pipe(child.stdin);
    } else {
      child.stdin.end();
    }

    let writeStream;
    if (stdoutFile) {
      writeStream = fs.createWriteStream(stdoutFile);
      writeStream.on("error", reject);
      child.stdout.pipe(writeStream);
    } else {
      child.stdout.resume();
    }

    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        reject(new Error(`${cmd} not found. Set PG_BIN to the directory holding the PostgreSQL client tools, or PG_CONTAINER to run them inside the database container.`));
      } else reject(error);
    });
    child.on("close", (code, signal) => {
      if (readStream) readStream.destroy();
      resolve({ code, signal, stderr: stderr.trim() });
    });
  });
}

/** Replace `-h <host> -p <port>` (if present) so a container tool targets the container loopback. */
function retargetHostPort(args, host, port) {
  const out = [...args];
  for (let i = 0; i < out.length; i++) {
    if (out[i] === "-h" || out[i] === "--host") out[i + 1] = host;
    else if (out[i] === "-p" || out[i] === "--port") out[i + 1] = String(port);
  }
  return out;
}

/** Common `-h host -p port -U user` args derived from a parsed connection. */
export function connectionArgs(conn) {
  return ["-h", conn.host, "-p", String(conn.port), "-U", conn.user];
}

/**
 * Snapshot a database's durable state through the `pg` driver: the migration
 * ledger, the base-table inventory in `schema`, and a per-table row count.
 * This is what a backup promises to contain and what a restore must reproduce.
 */
export async function collectSnapshot(connectionString, schema = "public") {
  assertSchemaLiteral(schema);
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 8000 });
  try {
    let ledger = [];
    try {
      const r = await pool.query("SELECT version, name, checksum FROM schema_migrations ORDER BY version");
      ledger = r.rows;
    } catch {
      ledger = []; // a fresh, pre-migration dump has no ledger
    }
    const tablesResult = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name",
      [schema]
    );
    const tables = tablesResult.rows.map((row) => row.table_name);
    const rows = {};
    for (const table of tables) {
      const c = await pool.query(`SELECT count(*)::bigint AS n FROM ${schemaQuoted(schema)}.${ident(table)}`);
      rows[table] = Number(c.rows[0].n);
    }
    return { schema, ledger, tables, rows };
  } finally {
    await pool.end();
  }
}

/**
 * Semantic checks that prove restored *rooms and history* are readable and
 * internally coherent, not just present row-for-row. These mirror exactly what
 * recovery relies on (server/DATABASE.md §5): the stored draw is a permutation
 * of 1..90, the official call log is a contiguous prefix of that draw, no
 * number repeats, and no call references a round that does not exist. Returns
 * an array of issue strings; empty means every invariant holds.
 */
export async function semanticChecks(connectionString, schema = "public") {
  assertSchemaLiteral(schema);
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 8000 });
  const sch = schemaQuoted(schema);
  const issues = [];
  try {
    if (!(await tableExists(pool, schema, "games"))) return issues; // nothing game-shaped to check

    const callsRes = await pool.query(
      `SELECT room_code, game_number, call_index, number FROM ${sch}.draw_calls ORDER BY room_code, game_number, call_index`
    );
    const outOfRange = callsRes.rows.filter((r) => r.number < 1 || r.number > 90);
    if (outOfRange.length) issues.push(`${outOfRange.length} call(s) outside 1..90`);

    // Group the call log by round and keep each round's numbers in call order.
    const byRound = new Map();
    for (const r of callsRes.rows) {
      const k = r.room_code + "#" + r.game_number;
      if (!byRound.has(k)) byRound.set(k, []);
      byRound.get(k).push(r);
    }
    for (const [k, rows] of byRound) {
      const base = Number(rows[0].call_index);
      for (let i = 0; i < rows.length; i++) {
        if (Number(rows[i].call_index) !== base + i) {
          issues.push(`non-contiguous call log in ${k} (row ${i} has call_index ${rows[i].call_index})`);
          break;
        }
      }
      const nums = rows.map((r) => r.number);
      if (new Set(nums).size !== nums.length) issues.push(`duplicate number called in ${k}`);
    }

    // Every round: the draw must be a full 1..90 permutation, and its called
    // numbers must be a prefix of that very draw - the exact recovery contract.
    const gamesRes = await pool.query(`SELECT room_code, game_number, draw_sequence FROM ${sch}.games`);
    for (const g of gamesRes.rows) {
      const k = g.room_code + "#" + g.game_number;
      const seq = Array.isArray(g.draw_sequence) ? g.draw_sequence : [];
      if (seq.length !== 90) {
        issues.push(`draw_sequence in ${k} has ${seq.length} entries, expected 90`);
        continue;
      }
      if (new Set(seq).size !== 90) issues.push(`draw_sequence in ${k} is not a permutation (contains duplicates)`);
      const called = (byRound.get(k) || []).map((r) => r.number);
      if (called.length > 90) issues.push(`more calls (${called.length}) than the 90-number draw in ${k}`);
      for (let i = 0; i < called.length; i++) {
        if (called[i] !== seq[i]) {
          issues.push(`call ${i + 1} in ${k} is ${called[i]} but the stored draw expects ${seq[i]} (history is not a prefix of the draw)`);
          break;
        }
      }
    }

    // A restored dump must preserve referential integrity: no orphan call rows.
    const orphan = await pool.query(
      `SELECT count(*)::int AS n FROM ${sch}.draw_calls dc LEFT JOIN ${sch}.games g
        ON g.room_code = dc.room_code AND g.game_number = dc.game_number WHERE g.room_code IS NULL`
    );
    if (orphan.rows[0].n > 0) issues.push(`${orphan.rows[0].n} draw_call(s) reference a round with no games row`);

    return issues;
  } finally {
    await pool.end();
  }
}

async function tableExists(pool, schema, table) {
  const r = await pool.query("SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2 LIMIT 1", [schema, table]);
  return r.rowCount === 1;
}

/** Compare a restore against the snapshot a backup recorded. Pure; unit-testable. */
export function compareSnapshots(expected, actual) {
  const issues = [];
  const eLed = JSON.stringify(expected.ledger || []);
  const aLed = JSON.stringify(actual.ledger || []);
  if (eLed !== aLed) {
    issues.push(`migration ledger differs: backup recorded ${(expected.ledger || []).length} row(s), restore has ${(actual.ledger || []).length}`);
  }
  const expectedTables = new Set(expected.tables || []);
  const actualTables = new Set(actual.tables || []);
  for (const t of expectedTables) if (!actualTables.has(t)) issues.push(`table missing after restore: ${t}`);
  for (const t of actualTables) if (!expectedTables.has(t)) issues.push(`unexpected table after restore: ${t}`);
  for (const t of expectedTables) {
    const want = (expected.rows || {})[t];
    const got = (actual.rows || {})[t];
    if (got === undefined) continue; // missing-table already reported
    if (Number(want) !== Number(got)) issues.push(`row count mismatch for "${t}": backup had ${want}, restore has ${got}`);
  }
  return issues;
}

function assertSchemaLiteral(schema) {
  if (typeof schema !== "string" || !IDENT.test(schema)) throw new Error("unsafe schema name: " + JSON.stringify(schema));
}
function ident(name) {
  if (!IDENT.test(name)) throw new Error("unsafe identifier: " + JSON.stringify(name));
  return '"' + name + '"';
}
function schemaQuoted(schema) {
  assertSchemaLiteral(schema);
  return '"' + schema + '"';
}

export function redact(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "<unparseable connection string>";
  }
}

/**
 * Whether a usable pg_dump/pg_restore driver is configured or reachable.
 * Used by the automated suite to run the real backup+restore end-to-end when
 * the tools exist and to skip cleanly when they do not (never fake a pass).
 *  - `PG_CONTAINER` set -> assume the tools are inside that container.
 *  - `PG_BIN/pg_dump` exists, or `pg_dump` resolves on PATH -> native.
 */
export function driverAvailable(env = process.env) {
  if (env.PG_CONTAINER) return true;
  if (env.PG_BIN && fs.existsSync(path.join(env.PG_BIN, process.platform === "win32" ? "pg_dump.exe" : "pg_dump"))) return true;
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["pg_dump"], { stdio: "ignore" });
  return probe.status === 0;
}
