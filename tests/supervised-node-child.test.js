import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The runner lives in the repository, not in a scratch directory: a committed
// test that leans on an ignored file passes on the machine that wrote it and can
// never pass anywhere else.
const runner = path.join(repoRoot, "scripts", "tools", "supervised-node-child.mjs");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "tambola-supervised-child-"));

after(() => fs.rmSync(scratch, { recursive: true, force: true }));

test("the supervised child runner is part of the shipped repository", () => {
  assert.equal(fs.existsSync(runner), true, `${runner} must be tracked so this suite can run anywhere`);
});

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
