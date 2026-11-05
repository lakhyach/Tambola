import test from "node:test";
import assert from "node:assert/strict";
import { listMigrations, verifyMigrationStatus } from "../server/db/migrate.js";

function fakeDb(rows, ledgerExists = true) {
  return {
    schema: "public",
    pool: {
      async connect() {
        return {
          async query(sql) {
            if (sql.includes("to_regclass")) return { rows: [{ ledger: ledgerExists ? "schema_migrations" : null }] };
            return { rows };
          },
          release() {},
        };
      },
    },
  };
}

const currentLedger = () => listMigrations().map(({ version, name, checksum }) => ({ version, name, checksum }));

test("migration startup gate accepts an exact ledger without changing it", async () => {
  const status = await verifyMigrationStatus({ db: fakeDb(currentLedger()) });
  assert.equal(status.current, true);
  assert.equal(status.pending.length, 0);
});

test("migration startup gate refuses pending migrations", async () => {
  const rows = currentLedger().slice(0, -1);
  await assert.rejects(() => verifyMigrationStatus({ db: fakeDb(rows) }), (error) => error.code === "MIGRATIONS_PENDING");
});

test("migration startup gate refuses a missing ledger", async () => {
  await assert.rejects(() => verifyMigrationStatus({ db: fakeDb([], false) }), (error) => error.code === "MIGRATIONS_MISSING");
});

test("migration startup gate refuses drift and an unknown newer ledger", async () => {
  const drift = currentLedger();
  drift[0] = { ...drift[0], checksum: "tampered" };
  await assert.rejects(() => verifyMigrationStatus({ db: fakeDb(drift) }), (error) => error.code === "MIGRATION_DRIFT");

  const ahead = [...currentLedger(), { version: "999", name: "999_future.sql", checksum: "future" }];
  await assert.rejects(() => verifyMigrationStatus({ db: fakeDb(ahead) }), (error) => error.code === "MIGRATION_AHEAD");
});
