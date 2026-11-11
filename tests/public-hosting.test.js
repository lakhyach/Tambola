import test from "node:test";
import assert from "node:assert/strict";
import { io as connectClient } from "socket.io-client";
import { createApp } from "../server/index.js";

test("public Socket.IO clients cannot create a host room", async (t) => {
  const app = await createApp({ memoryOnly: true, origins: [], config: { autoCall: false }, log: () => {} });
  const port = await app.listen(0);
  const socket = connectClient(`http://127.0.0.1:${port}`, { transports: ["websocket"], forceNew: true, reconnection: false });
  t.after(async () => { socket.disconnect(); await app.closeServer(); });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  const response = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("room:create was not acknowledged")), 3000);
    socket.emit("room:create", { name: "Public Host" }, (ack) => { clearTimeout(timer); resolve(ack); });
  });
  assert.deepEqual({ ok: response.ok, code: response.code }, { ok: false, code: "NOT_ALLOWED" });
  assert.equal(app.registry.rooms.size, 0, "rejected requests do not create rooms");
});

test("production never enables public room creation even when the legacy opt-in is set", async (t) => {
  const app = await createApp({ memoryOnly: true, production: true, origins: [], config: { autoCall: false }, allowPublicHosting: true, log: () => {} });
  const port = await app.listen(0);
  const socket = connectClient(`http://127.0.0.1:${port}`, { transports: ["websocket"], forceNew: true, reconnection: false });
  t.after(async () => { socket.disconnect(); await app.closeServer(); });
  await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("connect_error", reject); });
  const response = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("room:create was not acknowledged")), 3000);
    socket.emit("room:create", { name: "Public Host" }, (ack) => { clearTimeout(timer); resolve(ack); });
  });
  assert.deepEqual({ ok: response.ok, code: response.code }, { ok: false, code: "NOT_ALLOWED" });
  assert.equal(app.registry.rooms.size, 0);
});
