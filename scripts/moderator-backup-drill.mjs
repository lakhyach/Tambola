#!/usr/bin/env node
/**
 * Synthetic moderator backup/restore drill. Creates an isolated schema in a
 * local development database, dumps only that schema, restores it to a new
 * throwaway database, verifies moderator security state, then drops both test
 * objects. It refuses non-loopback hosts and production mode.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import pg from "pg";
import { createPool } from "../server/db/pool.js";
import { migrate } from "../server/db/migrate.js";
import { hashPassword } from "../server/admin/password.js";
import { parseConnection, connectionArgs, connectionToDatabase, runPgTool, assertIdentifier } from "./pg-cli.js";

const { Pool } = pg;
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
if (process.env.NODE_ENV === "production") throw new Error("refusing to run the synthetic drill in production mode");
const source = parseConnection(url);
if (!new Set(["127.0.0.1", "::1", "localhost"]).has(source.host)) {
  throw new Error("refusing to run the synthetic drill against a non-loopback database host");
}

const schema = assertIdentifier(`tambola_mdrill_${randomBytes(4).toString("hex")}`);
const scratch = assertIdentifier(`tambola_mdr_${randomBytes(5).toString("hex")}`);
const container = process.env.PG_CONTAINER || null;
const binDir = process.env.PG_BIN || null;
const containerPort = Number(process.env.PG_CONTAINER_PORT) || 5432;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tambola-mod-restore-"));
const dumpPath = path.join(tempDir, "moderator-synthetic.dump");
const db = createPool({ connectionString: url, schema, log: () => {} });
const adminUrl = connectionToDatabase(url, "postgres");
let admin;
let restored;
let createdScratch = false;

const digest = (label) => createHash("sha256").update(`synthetic:${label}:${randomBytes(8).toString("hex")}`).digest("hex");

try {
  await db.query(`CREATE SCHEMA ${schema}`);
  await migrate({ db, log: () => {} });
  const activeId = randomUUID();
  const suspendedId = randomUUID();
  const activeSessionId = randomUUID();
  const revokedSessionId = randomUUID();
  const consumedRecoveryId = randomUUID();
  const liveRecoveryId = randomUUID();
  const consumedSocketTicketId = randomUUID();
  const passwordHash = await hashPassword("Synthetic-only moderator passphrase 2026!");

  await db.query(`INSERT INTO moderator_accounts(moderator_id,username,password_hash,status,created_by)
    VALUES ($1,'drill.active',$3,'active','synthetic-drill'),($2,'drill.suspended',$3,'suspended','synthetic-drill')`, [activeId, suspendedId, passwordHash]);
  await db.query(`INSERT INTO moderator_instance_grants(moderator_id,instance_id,permissions,granted_by)
    VALUES ($1,'regular',ARRAY['instance.read','room.read','players.read'],'synthetic-drill'),
           ($1,'bumper',ARRAY['room.read','reports.read'],'synthetic-drill'),
           ($2,'regular',ARRAY['instance.read'],'synthetic-drill')`, [activeId, suspendedId]);
  await db.query(`UPDATE moderator_instance_grants SET revoked_at=now(),revoked_by='synthetic-drill'
    WHERE moderator_id=$1 AND instance_id='bumper'`, [activeId]);

  await db.query(`INSERT INTO moderator_sessions(session_id,moderator_id,token_hash,expires_at,absolute_expires_at)
    VALUES ($1,$3,$5,now()+interval '1 hour',now()+interval '1 day'),
           ($2,$4,$6,now()+interval '1 hour',now()+interval '1 day')`,
    [activeSessionId, revokedSessionId, activeId, suspendedId, digest("active-session"), digest("revoked-session")]);
  await db.query(`UPDATE moderator_sessions SET revoked_at=now(),revoke_reason='synthetic revoked state' WHERE session_id=$1`, [revokedSessionId]);
  await db.query(`INSERT INTO moderator_socket_tickets(ticket_id,moderator_session_id,token_hash,expires_at,consumed_at)
    VALUES($1,$2,$3,now()+interval '1 minute',now())`, [consumedSocketTicketId, revokedSessionId, digest("consumed-socket-ticket")]);
  await db.query(`INSERT INTO moderator_recovery_tokens(recovery_id,moderator_id,token_hash,created_by,expires_at,consumed_at)
    VALUES($1,$3,$4,'synthetic-drill',now()+interval '20 minutes',now()),
          ($2,$3,$5,'synthetic-drill',now()+interval '20 minutes',NULL)`,
    [consumedRecoveryId, liveRecoveryId, activeId, digest("consumed-recovery"), digest("live-recovery")]);
  await db.query(`INSERT INTO platform_audit(actor,actor_role,instance_id,action,result,metadata)
    VALUES ('synthetic-drill','super_admin','regular','moderator.grant.synthetic','success','{"permissions":2}'),
           ('drill.active','moderator','regular','moderator.session.synthetic','success','{"session":"active"}'),
           ('drill.suspended','super_admin','regular','moderator.suspend.synthetic','success','{"state":"suspended"}')`);

  const dumpArgs = [...connectionArgs(source), "-d", source.database, "--format=custom", "--no-owner", "--no-privileges", "--schema", schema];
  const dump = await runPgTool({ tool: "pg_dump", args: dumpArgs, env: source.password ? { PGPASSWORD: source.password } : {}, container, binDir, containerPort, stdoutFile: dumpPath });
  if (dump.code !== 0) throw new Error(`pg_dump failed (${dump.code}): ${dump.stderr.slice(0, 400)}`);

  admin = new Pool({ connectionString: adminUrl, max: 1, connectionTimeoutMillis: 8000 });
  await admin.query(`CREATE DATABASE ${JSON.stringify(scratch)}`);
  createdScratch = true;
  const restoreArgs = [...connectionArgs(source), "-d", scratch, "--no-owner", "--no-privileges", "--exit-on-error"];
  const restore = await runPgTool({ tool: "pg_restore", args: restoreArgs, env: source.password ? { PGPASSWORD: source.password } : {}, container, binDir, containerPort, stdinFile: dumpPath });
  if (restore.code !== 0) throw new Error(`pg_restore failed (${restore.code}): ${restore.stderr.slice(0, 500)}`);

  const restoredUrl = connectionToDatabase(url, scratch);
  restored = new Pool({ connectionString: restoredUrl, max: 2, options: `-c search_path=${schema},public`, connectionTimeoutMillis: 8000 });
  const accounts = await restored.query(`SELECT username,status FROM moderator_accounts ORDER BY username`);
  if (JSON.stringify(accounts.rows) !== JSON.stringify([{ username: "drill.active", status: "active" }, { username: "drill.suspended", status: "suspended" }])) throw new Error("account identity/status did not survive restore");
  const grants = await restored.query(`SELECT a.username,g.instance_id,g.permissions,g.revoked_at IS NOT NULL AS revoked
    FROM moderator_instance_grants g JOIN moderator_accounts a USING(moderator_id) ORDER BY a.username,g.instance_id`);
  if (grants.rowCount !== 3 || grants.rows.filter((g) => g.username === "drill.active" && g.instance_id === "bumper")[0]?.revoked !== true) throw new Error("grant permissions or revoked state did not survive restore");
  const sessions = await restored.query(`SELECT a.username,s.revoked_at IS NOT NULL AS revoked
    FROM moderator_sessions s JOIN moderator_accounts a USING(moderator_id) ORDER BY a.username`);
  if (sessions.rowCount !== 2 || sessions.rows.filter((s) => s.username === "drill.suspended")[0]?.revoked !== true) throw new Error("revoked session state did not survive restore");
  const recoveries = await restored.query(`SELECT consumed_at IS NOT NULL AS consumed FROM moderator_recovery_tokens ORDER BY recovery_id`);
  const recoveryStates = recoveries.rows.map((r) => r.consumed).sort();
  if (recoveryStates.length !== 2 || recoveryStates[0] !== false || recoveryStates[1] !== true) throw new Error("consumed recovery-token state did not survive restore");
  const socketTickets = await restored.query(`SELECT consumed_at IS NOT NULL AS consumed FROM moderator_socket_tickets`);
  if (socketTickets.rowCount !== 1 || socketTickets.rows[0].consumed !== true) throw new Error("consumed socket-ticket state did not survive restore");
  const audit = await restored.query(`SELECT count(*)::int AS count FROM platform_audit WHERE actor LIKE 'drill.%' OR actor='synthetic-drill'`);
  if (audit.rows[0].count !== 3) throw new Error("moderator platform audit history did not survive restore");

  console.log(`[moderator-backup-drill] PASS — 2 accounts, 3 grants, 2 sessions, 2 recovery tokens, 1 consumed socket ticket, 3 audit rows`);
  console.log(`[moderator-backup-drill] source schema ${schema} and throwaway database ${scratch} are isolated synthetic fixtures`);
} finally {
  await restored?.end().catch(() => {});
  if (createdScratch) await admin.query(`DROP DATABASE IF EXISTS ${JSON.stringify(scratch)}`).catch(() => {});
  await admin?.end().catch(() => {});
  await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
  await db.end().catch(() => {});
  fs.rmSync(tempDir, { recursive: true, force: true });
}
