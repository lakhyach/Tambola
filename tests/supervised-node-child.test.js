import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runner = path.join(repoRoot, ".preflight", "tools", "supervised-node-child.mjs");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "tambola-supervised-child-"));

after(() => fs.rmSync(scratch, { recursive: true, force: true }));

for (const expectedCode of [0, 7]) {
  test(`supervised Node child preserves exit code ${expectedCode} in its sidecar`, () => {
    const resultPath = path.join(scratch, `exit-${expectedCode}.json`);
    const env = {
      ...process.env,
      SUPERVISED_CHILD_EXIT_FILE: resultPath,
      SUPERVISED_CHILD_CWD: repoRoot,
    };
    const child = spawnSync(process.execPath, [runner, "-e", `process.exit(${expectedCode})`], {
      cwd: repoRoot,
      env,
      encoding: "utf8",
      timeout: 10_000,
    });

    assert.equal(child.error, undefined, child.error?.message);
    assert.equal(child.status, expectedCode, child.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(resultPath, "utf8")), { exitCode: expectedCode, signal: null });
  });
}
