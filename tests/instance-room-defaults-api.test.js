import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { HAS_DB, openDurableSchema } from "./pattern-harness.js";
import { createAdmin } from "../server/admin/index.js";
import { hashPassword } from "../server/admin/password.js";

test("owner-managed room defaults are validated, audited, tenant-scoped, and applied only to new rooms", { skip: !HAS_DB }, async (t) => {
  const env = await openDurableSchema({ prefix: "roomdefaults" });
  const runtime = env.newProcess();
  const admin = createAdmin({
    db: env.db,
    durable: true,
    registry: runtime.registry,
    controller: runtime.controller,
    mfaKey: { configured: false, key: null },
  });
  const app = express();
  app.use(express.json());
  app.use("/api/admin", admin.router);
  const server = http.createServer(app);
  t.after(async () => {
    for (const roomId of runtime.registry.rooms.keys()) runtime.registry.close(roomId, "test teardown");
    await new Promise((resolve) => server.close(resolve));
    await env.close();
  });
  await admin.ownerStore.create({ username: "defaults-owner", passwordHash: await hashPassword("RoomDefaultsOwnerPass9!"), role: "super_admin" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const cookies = new Map();
  let csrf = null;
  const request = async (method, path, body) => {
    const headers = {};
    if (cookies.size) headers.cookie = [...cookies].map(([key, value]) => `${key}=${value}`).join("; ");
    if (body !== undefined) headers["content-type"] = "application/json";
    if (method !== "GET" && csrf) headers["x-csrf-token"] = csrf;
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(";", 1)[0];
      const index = pair.indexOf("=");
      if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const payload = await response.json();
    if (payload.csrfToken) csrf = payload.csrfToken;
    return { status: response.status, payload };
  };

  await request("GET", "/api/admin/session");
  assert.equal((await request("POST", "/api/admin/signin", { username: "defaults-owner", password: "RoomDefaultsOwnerPass9!" })).status, 200);

  const existing = await runtime.controller.createRoom({ name: "Existing Bumper", socketId: "existing-bumper-host", instanceSlug: "bumper" });
  assert.equal(existing.ok, true, JSON.stringify(existing));
  const existingRoom = runtime.registry.get(existing.roomId);
  const existingDefaults = {
    maxPlayers: existingRoom.config.maxPlayers,
    ticketCeiling: existingRoom.ticketCeiling(),
    callIntervalMs: existingRoom.config.callIntervalMs,
    autoCall: existingRoom.config.autoCall,
  };

  const saved = await request("PATCH", "/api/admin/instances/bumper", {
    roomDefaults: { maxPlayers: 40, maxTicketsPerPlayer: 6, callIntervalMs: 12000, autoCall: false },
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.payload.instance.config.roomDefaults, { maxPlayers: 40, callIntervalMs: 12000, autoCall: false });

  const invalid = await request("PATCH", "/api/admin/instances/bumper", { roomDefaults: { maxPlayers: 501 } });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.payload.code, "INVALID_INSTANCE_SETTINGS");
  const unchanged = await env.db.query("SELECT config->'roomDefaults' AS defaults FROM game_instances WHERE instance_id='bumper'");
  assert.deepEqual(unchanged.rows[0].defaults, saved.payload.instance.config.roomDefaults);
  assert.deepEqual(
    { maxPlayers: existingRoom.config.maxPlayers, ticketCeiling: existingRoom.ticketCeiling(), callIntervalMs: existingRoom.config.callIntervalMs, autoCall: existingRoom.config.autoCall },
    existingDefaults,
    "changing defaults does not mutate a room that already exists"
  );

  const created = await runtime.controller.createRoom({ name: "Bumper Defaults Host", socketId: "defaults-bumper-host", instanceSlug: "bumper" });
  assert.equal(created.ok, true, JSON.stringify(created));
  const room = runtime.registry.get(created.roomId);
  assert.deepEqual(
    { maxPlayers: room.config.maxPlayers, ticketCeiling: room.ticketCeiling(), callIntervalMs: room.config.callIntervalMs, autoCall: room.config.autoCall },
    { maxPlayers: 40, ticketCeiling: 10001, callIntervalMs: 12000, autoCall: false }
  );
  const regular = await runtime.controller.createRoom({ name: "Regular Defaults", socketId: "defaults-regular-host", instanceSlug: "regular" });
  assert.equal(regular.ok, true, JSON.stringify(regular));
  const regularRoom = runtime.registry.get(regular.roomId);
  assert.deepEqual(
    { maxPlayers: regularRoom.config.maxPlayers, ticketCeiling: regularRoom.ticketCeiling(), callIntervalMs: regularRoom.config.callIntervalMs, autoCall: regularRoom.config.autoCall },
    { maxPlayers: 100, ticketCeiling: 10001, callIntervalMs: 8000, autoCall: false },
    "a Bumper settings change does not alter Regular defaults"
  );

  const events = await admin.audit.recent({ limit: 10 });
  const updateEvent = events.find((event) => event.action === "INSTANCE_UPDATE" && event.targetId === "bumper");
  assert.ok(updateEvent);
  assert.deepEqual(updateEvent.metadata.roomDefaults, saved.payload.instance.config.roomDefaults, "the immutable owner audit records the actual validated defaults");
});
