import test from "node:test";
import assert from "node:assert/strict";
import { createPool } from "../server/db/pool.js";

function fixture(failures = {}) {
  const db = createPool({ connectionString: "postgresql://localhost/unused", idleTimeoutMs: 1234 });
  const statements = [];
  const releases = [];
  db.pool.connect = async () => ({
    async query(sql) {
      statements.push(sql);
      if (failures[sql]) throw Object.assign(new Error(sql + " failed"), { code: failures[sql] });
    },
    release(error) { releases.push(error); },
  });
  return { db, statements, releases };
}

test("a lost COMMIT acknowledgement is never retried and discards the connection", async () => {
  const { db, statements, releases } = fixture({ COMMIT: "ECONNRESET" });
  let attempts = 0;
  try {
    await assert.rejects(db.withRetry(() => db.withTransaction(async () => { attempts++; }), { backoffMs: 0 }), (error) => {
      assert.equal(error.code, "PERSIST_UNKNOWN");
      assert.equal(error.retryable, false);
      return true;
    });
    assert.equal(attempts, 1);
    assert.equal(statements.filter((sql) => sql === "COMMIT").length, 1);
    assert.ok(releases[0], "uncertain connection must be destroyed");
  } finally { await db.end(); }
});

test("failed rollback discards the connection and prevents transaction retry", async () => {
  const { db, releases } = fixture({ ROLLBACK: "ECONNRESET" });
  let attempts = 0;
  try {
    await assert.rejects(db.withRetry(() => db.withTransaction(async () => {
      attempts++;
      throw Object.assign(new Error("deadlock"), { code: "40P01" });
    }), { backoffMs: 0 }));
    assert.equal(attempts, 1);
    assert.ok(releases[0]);
  } finally { await db.end(); }
});

test("a confirmed rollback permits retry and a successful commit releases normally", async () => {
  const { db, statements, releases } = fixture();
  let attempts = 0;
  try {
    const value = await db.withRetry(() => db.withTransaction(async () => {
      if (++attempts === 1) throw Object.assign(new Error("deadlock"), { code: "40P01" });
      return 42;
    }), { backoffMs: 0 });
    assert.equal(value, 42);
    assert.equal(attempts, 2);
    assert.equal(statements.filter((sql) => sql === "ROLLBACK").length, 1);
    assert.ok(releases.every((error) => !error));
  } finally { await db.end(); }
});

test("pool applies the configured idle timeout using the pg option", async () => {
  const { db } = fixture();
  try { assert.equal(db.pool.options.idleTimeoutMillis, 1234); }
  finally { await db.end(); }
});
