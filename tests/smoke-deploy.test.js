/**
 * The deployment smoke test, exercised against a real server on an ephemeral
 * port. Memory mode is deliberate: it proves the probe set distinguishes a
 * durable deployment from a throwaway one instead of just saying "healthy".
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/index.js";
import { runSmoke, formatSmoke } from "../scripts/smoke-deploy.mjs";

function find(result, id) {
  return result.checks.find((check) => check.id === id);
}

test("smoke test: probes pass, but memory mode is not a deployable answer", async (t) => {
  const instance = await createApp({ memoryOnly: true, origins: [], log: () => {} });
  const port = await instance.listen(0);
  t.after(() => instance.closeServer());

  const result = await runSmoke("http://127.0.0.1:" + port, { timeoutMs: 5000 });

  assert.equal(find(result, "livez").ok, true);
  assert.equal(find(result, "spa").ok, true);
  assert.equal(find(result, "socket-handshake").ok, true, "the Engine.IO handshake must work without a database");

  const ready = find(result, "readyz");
  assert.equal(ready.ok, false, "memory mode must never be reported as deployment-ready");
  assert.match(ready.detail, /memory mode/);
  assert.equal(result.ok, false);
});

test("smoke test: a full multiplayer round over real sockets", async (t) => {
  const instance = await createApp({
    memoryOnly: true,
    origins: [],
    config: { autoCall: false, callIntervalMs: 60000, chatIntervalMs: 0 },
    log: () => {},
  });
  const port = await instance.listen(0);
  t.after(() => instance.closeServer());

  const result = await runSmoke("http://127.0.0.1:" + port, { full: true, timeoutMs: 5000 });
  const multiplayer = result.checks.filter((check) => check.id.startsWith("multiplayer"));

  assert.ok(multiplayer.length >= 5, "the full profile ran: " + JSON.stringify(multiplayer));
  for (const check of multiplayer) {
    assert.equal(check.ok, true, check.id + ": " + check.detail);
  }
  const fanout = find(result, "multiplayer.call-fanout");
  assert.match(fanout.detail, /both seats saw number/, "the guest seat must receive the call broadcast");
});

test("smoke test: an unreachable URL fails every probe and exits non-zero", async () => {
  const result = await runSmoke("http://127.0.0.1:1", { timeoutMs: 700 });
  assert.equal(result.ok, false);
  assert.equal(find(result, "livez").ok, false);
  assert.match(formatSmoke(result), /RESULT: FAIL/);
});

test("smoke test: a malformed URL is refused before any request", async () => {
  const result = await runSmoke("games.example.com", { timeoutMs: 100 });
  assert.equal(result.ok, false);
  assert.equal(find(result, "url").ok, false);
  assert.equal(result.checks.length, 1);
});
