#!/usr/bin/env node
/**
 * Run a Node child under supervision and record its real exit status.
 *
 * `process.exit(n)` inside a child is not always the status the parent observes:
 * an uncaught exception, a signal, or a wrapped launcher can rewrite it. The
 * restart/rollback tooling needs the child's own verdict, so it runs through
 * here and this file writes the exit code and signal to a sidecar before it
 * re-raises the same code to its own parent.
 *
 * Environment:
 *   SUPERVISED_CHILD_EXIT_FILE  where the {exitCode, signal} record is written
 *   SUPERVISED_CHILD_CWD        working directory for the child (defaults to cwd)
 *   argv beyond this file       the Node program and its arguments
 *
 * The sidecar is written with flag "wx": a supervisor that could not report a
 * status fails loudly instead of overwriting one that was already recorded.
 */
import fs from "node:fs";
import { spawn } from "node:child_process";

const resultPath = process.env.SUPERVISED_CHILD_EXIT_FILE;
const workingDirectory = process.env.SUPERVISED_CHILD_CWD || process.cwd();
const args = process.argv.slice(2);

if (!resultPath || args.length === 0) {
  console.error("supervised child requires SUPERVISED_CHILD_EXIT_FILE and a command");
  process.exitCode = 2;
} else {
  let recorded = false;
  const record = (result) => {
    if (recorded) return;
    recorded = true;
    try {
      fs.writeFileSync(resultPath, JSON.stringify(result) + "\n", { encoding: "utf8", flag: "wx" });
      process.exitCode = result.exitCode;
    } catch (error) {
      console.error("could not record supervised child exit status: " + error.message);
      process.exitCode = 1;
    }
  };

  const child = spawn(process.execPath, args, {
    cwd: workingDirectory,
    env: process.env,
    stdio: "inherit",
  });
  child.once("error", (error) => record({ exitCode: 127, signal: null, error: error.message }));
  child.once("exit", (code, signal) => record({ exitCode: code ?? 1, signal: signal || null }));
}
