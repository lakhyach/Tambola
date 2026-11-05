import test from "node:test";
import assert from "node:assert/strict";
import { collectSnapshot, withExportedSnapshot } from "../scripts/pg-cli.js";
import { listMigrations } from "../server/db/migrate.js";
import { HAS_DB, openDurableSchema } from "./pattern-harness.js";

test("backup manifest shares the dump snapshot while concurrent writes continue", { skip: !HAS_DB }, async () => {
  const fixture = await openDurableSchema({ prefix: "snapshot" });
  try {
    await fixture.db.query("CREATE TABLE snapshot_probe (id integer PRIMARY KEY)");
    await fixture.db.query("INSERT INTO snapshot_probe VALUES (1)");
    await withExportedSnapshot(process.env.DATABASE_URL, async (snapshotId) => {
      await fixture.db.query("INSERT INTO snapshot_probe VALUES (2)");
      const manifest = await collectSnapshot(process.env.DATABASE_URL, fixture.schema, snapshotId);
      assert.equal(manifest.rows.snapshot_probe, 1, "manifest must exclude commits after the dump snapshot");
      // A backup owes the whole ledger the running code knows about, so compare
      // against the migration files instead of naming a version. A hard-coded
      // number went stale the day the next migration shipped and passed while
      // saying nothing about completeness.
      const expected = listMigrations();
      assert.deepEqual(
        manifest.ledger.map((row) => row.version),
        expected.map((migration) => migration.version),
        "the snapshot carries every migration the code knows about, in order"
      );
      assert.equal(manifest.ledger.at(-1)?.version, expected.at(-1)?.version, "the snapshot includes the current final migration");
      const live = await collectSnapshot(process.env.DATABASE_URL, fixture.schema);
      assert.equal(live.rows.snapshot_probe, 2, "the later write really committed");
    });
  } finally { await fixture.close(); }
});
