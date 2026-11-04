import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Read a bounded, credential-free summary of backup artifacts for the owner UI. */
export async function readBackupStatus({ backupDir = process.env.BACKUP_DIR || path.join(root, "backups"), limit = 10 } = {}) {
  const directory = path.resolve(backupDir);
  let names;
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    return { directoryStatus: error.code === "ENOENT" ? "missing" : "unavailable", backupCount: 0, backups: [] };
  }

  const archiveNames = names.filter((entry) => entry.endsWith(".dump"));
  const archives = [];
  let unreadableCount = 0;
  for (const name of archiveNames) {
    const archivePath = path.join(directory, name);
    try {
      const stat = await fs.stat(archivePath);
      if (!stat.isFile()) continue;
      const manifestPath = archivePath.replace(/\.dump$/, ".manifest.json");
      const checkPath = archivePath.replace(/\.dump$/, ".restore-check.json");
      const manifestFile = await readJsonFile(manifestPath);
      const restoreFile = await readJsonFile(checkPath);
      const manifest = manifestFile.value;
      const restore = restoreFile.value;
      const manifestValid = manifest?.format === "pg_dump-custom"
        && manifest.file === name
        && Number.isSafeInteger(manifest.bytes)
        && manifest.bytes > 0
        && typeof manifest.generatedAt === "string"
        && Number.isFinite(Date.parse(manifest.generatedAt))
        && typeof manifest.sha256 === "string"
        && /^[a-f0-9]{64}$/i.test(manifest.sha256)
        && Array.isArray(manifest.tables)
        && manifest.rowCountByTable && typeof manifest.rowCountByTable === "object";
      const rowTotal = manifestValid
        ? Object.values(manifest.rowCountByTable).reduce((sum, count) => sum + (Number.isSafeInteger(count) && count >= 0 ? count : 0), 0)
        : null;
      const restoreCheck = restore?.format === "tambola-restore-check"
        && restore.archive === name
        && Number.isFinite(Date.parse(restore.verifiedAt))
        && ["passed", "failed"].includes(restore.status)
        ? { status: restore.status, verifiedAt: restore.verifiedAt, issueCount: Number.isSafeInteger(restore.issueCount) ? restore.issueCount : null,
          checksumStatus: ["match", "mismatch", "unavailable", "unreadable", "invalid-manifest"].includes(restore.checksumStatus) ? restore.checksumStatus : "unavailable",
          tables: Number.isSafeInteger(restore.tables) ? restore.tables : null, rows: Number.isSafeInteger(restore.rows) ? restore.rows : null }
        : null;
      archives.push({
        backupAt: manifestValid ? manifest.generatedAt : stat.mtime.toISOString(),
        archiveBytes: stat.size,
        manifestStatus: !manifestFile.present ? "missing" : !manifestValid ? "invalid" : manifest.bytes === stat.size ? "valid" : "size-mismatch",
        tables: manifestValid ? manifest.tables.length : null,
        rows: rowTotal,
        restoreCheck: restoreCheck || (restoreFile.present ? { status: "invalid", verifiedAt: null, issueCount: null, tables: null, rows: null } : null),
      });
    } catch {
      // A damaged or concurrently changing artifact is represented as unavailable,
      // never by passing filesystem paths or parser errors into the API response.
      unreadableCount += 1;
    }
  }
  archives.sort((a, b) => Date.parse(b.backupAt) - Date.parse(a.backupAt));
  return { directoryStatus: "available", backupCount: archiveNames.length, unreadableCount, backups: archives.slice(0, Math.max(1, Math.min(50, limit))) };
}

async function readJsonFile(file) {
  try {
    return { present: true, value: JSON.parse(await fs.readFile(file, "utf8")) };
  } catch (error) {
    return error.code === "ENOENT" ? { present: false, value: null } : { present: true, value: null };
  }
}
