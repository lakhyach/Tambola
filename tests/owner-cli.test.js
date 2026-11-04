import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createPool } from "../server/db/pool.js";
import { migrate } from "../server/db/migrate.js";
import { createOwnerStore } from "../server/admin/owner-store.js";

const databaseUrl = process.env.DATABASE_URL;
const cliPath = fileURLToPath(new URL("../scripts/owner.js", import.meta.url));

test("owner:list does not apply migrations to an uninitialized schema", { skip: !databaseUrl }, async () => {
  const schema = `owner_cli_list_${randomBytes(4).toString("hex")}`;
  const db = createPool({ connectionString: databaseUrl, schema, log: () => {} });
  let created = false;
  try {
    await db.query(`CREATE SCHEMA ${schema}`);
    created = true;

    const runList = () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cliPath, "list"], {
        env: { ...process.env, DATABASE_URL: databaseUrl, DB_SCHEMA: schema },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
      child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, stdout, stderr }));
    });

    const uninitialized = await runList();
    assert.equal(uninitialized.code, 0, uninitialized.stderr);
    assert.match(uninitialized.stdout, /Owner schema is not initialized; no migrations were run\./);
    const state = await db.query(
      "SELECT to_regclass('owner_accounts') AS owner_table, to_regclass('schema_migrations') AS migration_table"
    );
    assert.equal(state.rows[0].owner_table, null);
    assert.equal(state.rows[0].migration_table, null);

    await migrate({ db, log: () => {} });
    const store = createOwnerStore({ db });
    await store.create({ username: "readonly.owner", passwordHash: "test-only-unused-password-hash" });
    const initialized = await runList();
    assert.equal(initialized.code, 0, initialized.stderr);
    assert.match(initialized.stdout, /readonly\.owner/);
  } finally {
    if (created) await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await db.end();
  }
});
