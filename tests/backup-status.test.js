import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readBackupStatus } from "../server/admin/backup-status.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("backup status exposes bounded artifact and restore facts without manifest secrets or paths", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tambola-backup-status-"));
  try {
    const archive = "tambola-db-20261101T010203Z.dump";
    await fs.writeFile(path.join(directory, archive), "archive");
    await fs.writeFile(path.join(directory, archive.replace(/\.dump$/, ".manifest.json")), JSON.stringify({
      format: "pg_dump-custom", file: archive, generatedAt: "2026-11-01T01:02:03.000Z", bytes: 7,
      sha256: "a".repeat(64), tables: ["rooms", "games"], rowCountByTable: { rooms: 3, games: 4 },
      database: "private-database-name", schema: "private-schema", host: "private-host", connectionString: "private-credential",
    }));
    await fs.writeFile(path.join(directory, archive.replace(/\.dump$/, ".restore-check.json")), JSON.stringify({
      format: "tambola-restore-check", archive, verifiedAt: "2026-11-01T02:00:00.000Z", status: "passed",
      issueCount: 0, checksumStatus: "match", tables: 2, rows: 7, database: "private-database-name", mfaKey: "private-key",
    }));

    const status = await readBackupStatus({ backupDir: directory });
    assert.equal(status.directoryStatus, "available");
    assert.equal(status.backupCount, 1);
    assert.equal(status.unreadableCount, 0);
    assert.deepEqual(status.backups[0], {
      backupAt: "2026-11-01T01:02:03.000Z", archiveBytes: 7, manifestStatus: "valid", tables: 2, rows: 7,
      restoreCheck: { status: "passed", verifiedAt: "2026-11-01T02:00:00.000Z", issueCount: 0, checksumStatus: "match", tables: 2, rows: 7 },
    });
    const json = JSON.stringify(status);
    for (const secret of ["private-database-name", "private-schema", "private-host", "private-credential", "private-key", directory, archive]) {
      assert.equal(json.includes(secret), false, `status must not expose ${secret}`);
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("backup status distinguishes a missing directory from an empty available directory", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "tambola-backup-status-"));
  try {
    assert.deepEqual(await readBackupStatus({ backupDir: path.join(parent, "missing") }), {
      directoryStatus: "missing", backupCount: 0, backups: [],
    });
    assert.deepEqual(await readBackupStatus({ backupDir: parent }), {
      directoryStatus: "available", backupCount: 0, unreadableCount: 0, backups: [],
    });
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("restore-check rejects a modified archive before opening a database connection", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tambola-checksum-reject-"));
  try {
    const archive = "tambola-test-20261101T010203Z.dump";
    await fs.writeFile(path.join(directory, archive), "modified archive bytes");
    await fs.writeFile(path.join(directory, archive.replace(/\.dump$/, ".manifest.json")), JSON.stringify({
      format: "pg_dump-custom", file: archive, generatedAt: "2026-11-01T01:02:03.000Z", bytes: 22,
      sha256: "a".repeat(64), schema: "public", tables: ["rooms"], migrationLedger: [], rowCountByTable: { rooms: 1 },
    }));
    const result = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "restore-check.js")], {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: "postgres://testuser:not-a-secret@127.0.0.1:1/testdb", BACKUP_DIR: directory },
      encoding: "utf8", timeout: 15_000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /archive SHA-256 does not match/);
    assert.doesNotMatch(result.stdout, /created throwaway database/);
    const statusPath = path.join(directory, archive.replace(/\.dump$/, ".restore-check.json"));
    const verification = JSON.parse(await fs.readFile(statusPath, "utf8"));
    assert.equal(verification.status, "failed");
    assert.equal(verification.checksumStatus, "mismatch");
    assert.equal(verification.issueCount, 1);
    assert.doesNotMatch(JSON.stringify(verification), /not-a-secret|testuser|127\.0\.0\.1/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
