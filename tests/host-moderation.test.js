import test from "node:test";
import assert from "node:assert/strict";
import { io as connectClient } from "socket.io-client";
import { createApp } from "../server/index.js";
import { createLogger } from "../server/observability/log.js";

test("only the waiting-room host can remove a seat and removal revokes its socket session", async () => {
  const app = await createApp({
    memoryOnly: true,
    production: false,
    origins: [],
    config: { autoCall: false },
    logger: createLogger({ level: "silent", sink: () => {} }),
    log: () => {},
  });
  const clients = [];
  let url;

  async function client() {
    const socket = connectClient(url, { transports: ["websocket"], forceNew: true, reconnection: false, timeout: 5000 });
    clients.push(socket);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("socket connect timed out")), 5000);
      socket.once("connect", () => { clearTimeout(timer); resolve(); });
      socket.once("connect_error", (error) => { clearTimeout(timer); reject(error); });
    });
    return socket;
  }

  function emit(socket, event, payload) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${event} ack timed out`)), 5000);
      socket.emit(event, payload, (answer) => { clearTimeout(timer); resolve(answer); });
    });
  }

  try {
    url = `http://127.0.0.1:${await app.listen(0)}`;
    const host = await client();
    const created = await emit(host, "room:create", { name: "Host User" });
    assert.equal(created.ok, true, JSON.stringify(created));
    const guest = await client();
    const joined = await emit(guest, "room:join", { roomId: created.roomId, name: "Guest User" });
    assert.equal(joined.ok, true, JSON.stringify(joined));

    const deniedPlayerAction = await emit(guest, "room:remove-player", { playerId: joined.playerId });
    assert.equal(deniedPlayerAction.code, "NOT_HOST", "a player cannot remove another room member");
    const removedEvent = new Promise((resolve) => guest.once("room:removed", resolve));
    const removed = await emit(host, "room:remove-player", { playerId: joined.playerId });
    assert.deepEqual(removed, { ok: true, removed: joined.playerId });
    assert.deepEqual(await removedEvent, { reason: "removed-by-host" });
    const staleResume = await emit(guest, "session:resume", { roomId: created.roomId, sessionToken: joined.sessionToken });
    assert.ok(["SESSION_REVOKED", "SESSION_UNKNOWN"].includes(staleResume.code), "the removed credential cannot reclaim the seat");

    const remaining = await app.registry.get(created.roomId).playersList();
    assert.deepEqual(remaining.map((player) => player.id), [created.playerId], "only the host seat remains");
    const secondGuest = await client();
    const secondJoin = await emit(secondGuest, "room:join", { roomId: created.roomId, name: "Next Guest" });
    assert.equal(secondJoin.ok, true, JSON.stringify(secondJoin));
    assert.equal((await emit(host, "game:start", {})).ok, true);
    const tooLate = await emit(host, "room:remove-player", { playerId: secondJoin.playerId });
    assert.equal(tooLate.code, "INVALID_STATE", "host moderation cannot change a round in progress");
    assert.ok(app.registry.get(created.roomId).players.has(secondJoin.playerId), "late removal refusal leaves the seat intact");
  } finally {
    for (const socket of clients) socket.disconnect();
    await app.closeServer({ closeRoomsDurably: false });
  }
});
