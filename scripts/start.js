#!/usr/bin/env node
import { spawn } from "node:child_process";
import { validateEnv, formatReport } from "./env-check.mjs";

const report = validateEnv(process.env);
if (report.warnings) console.warn(formatReport(report));
if (!report.ok) {
  console.error("[tambola] startup refused by environment validation");
  process.exit(1);
}

const child = spawn(process.execPath, ["server/index.js"], {
  stdio: "inherit",
  env: process.env,
  windowsHide: true,
});
let stopping = false;

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    if (!child.kill(signal)) process.exitCode = 1;
  });
}

child.on("error", (error) => {
  console.error("[tambola] could not launch server process:", error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
