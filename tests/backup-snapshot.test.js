import test from "node:test";
import assert from "node:assert/strict";
import { collectSnapshot, withExportedSnapshot } from "../scripts/pg-cli.js";
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
      assert.equal(manifest.ledger.length, 29);
      const live = await collectSnapshot(process.env.DATABASE_URL, fixture.schema);
      assert.equal(live.rows.snapshot_probe, 2, "the later write really committed");
    });
  } finally { await fixture.close(); }
});
