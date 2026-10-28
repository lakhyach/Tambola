/**
 * Production-bootstrap regression test.
 *
 * The real main-module entrypoint calls `createApp({ config })` with NO injected
 * logger, so `createApp` must wire its own legacy `log` adapter. A past bug wrote
 * `const log = options.log || logger.shim()` (calling the adapter, which returns
 * undefined) instead of `logger.shim` (the adapter itself); the first `log(...)`
 * during a room lifecycle then threw "log is not a function" and every durable
 * boot crashed. The rest of the suite hides this by always passing `log: () => {}`.
 *
 * This file boots createApp the way production does - no `log` option - and drives
 * a room create/join/start/call cycle that exercises the internal logger. It must
 * succeed and must never surface a "log is not a function" error.
 */

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { io as connectClient } from "socket.io-client";
import { createApp } from "../server/index.js";

let instance;
let url;
const connections = [];

function client(name) {
  const socket = connectClient(url, { transports: ["websocket"], forceNew: true, reconnection: false, timeout: 5000 });
  connections.push(socket);
  const open = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(name + " could not connect")), 5000);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return {
    socket,
    open,
    call(event, payload = {}) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("no ack for " + event)), 5000);
        socket.emit(event, payload, (response) => {
          clearTimeout(timer);
          resolve(response);
        });
      });
    },
  };
}

before(async () => {
  // Deliberately NO `log` / `logger` option: this is the production wiring.
  instance = await createApp({
    memoryOnly: true,
    origins: [],
    config: { autoCall: false, chatIntervalMs: 0, disconnectGraceMs: 500, callIntervalMs: 60000 },
  });
  const port = await instance.listen(0);
  url = `http://127.0.0.1:${port}`;
});

after(async () => {
  for (const socket of connections) {
    try {
      socket.disconnect();
    } catch {
      /* already gone */
    }
  }
  if (instance) await instance.closeServer();
});

test("the app boots with the default logger and answers health checks", async () => {
  const res = await fetch(`${url}/readyz`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ready, true);
  assert.equal(body.mode, "memory");
});

test("a full room lifecycle runs on the injected-free logger", async () => {
  const host = client("Host");
  await host.open;
  const created = await host.call("room:create", { name: "Bootstrap Host" });
  assert.equal(created.ok, true, "room:create must not throw on the internal log adapter: " + JSON.stringify(created));
  assert.doesNotMatch(JSON.stringify(created), /log is not a function/i);

  const player = client("Player");
  await player.open;
  const joined = await player.call("room:join", { roomId: created.roomId, name: "Bootstrap Player" });
  assert.equal(joined.ok, true, JSON.stringify(joined));

  const started = await host.call("game:start", {});
  assert.equal(started.ok, true, JSON.stringify(started));

  const called = await host.call("game:call-next", {});
  assert.equal(called.ok, true, JSON.stringify(called));
  assert.ok(Number.isInteger(called.number), "a number was called through the logging path");
});
