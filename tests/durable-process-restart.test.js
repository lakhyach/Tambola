import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { fork } from "node:child_process";
import { io as connectClient } from "socket.io-client";
import { createPool } from "../server/db/pool.js";
import { migrate } from "../server/db/migrate.js";

const databaseUrl = process.env.DATABASE_URL;
const skip = databaseUrl ? false : "no DATABASE_URL - process restart test needs PostgreSQL";
const schema = "restart_test_" + randomBytes(5).toString("hex");
const fixture = new URL("./fixtures/durable-restart-server.mjs", import.meta.url);

function boot() {
  const child = fork(fixture, [], {
    env: { ...process.env, TEST_DATABASE_URL: databaseUrl, TEST_DB_SCHEMA: schema },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server child did not become ready")), 15000);
    child.on("message", (message) => {
      if (message?.type === "ready") {
        clearTimeout(timer);
        resolve(message);
      } else if (message?.type === "error") {
        clearTimeout(timer);
        reject(new Error(message.error));
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("server child exited before ready: " + code));
    });
  });
  return { child, ready };
}

function connect(port) {
  const socket = connectClient(`http://127.0.0.1:${port}`, {
    transports: ["websocket"], forceNew: true, reconnection: false, timeout: 5000,
  });
  const connected = new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return {
    socket,
    async open() { await connected; return this; },
    call(event, payload = {}) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("no ack for " + event)), 5000);
        socket.emit(event, payload, (result) => { clearTimeout(timer); resolve(result); });
      });
    },
  };
}

function exited(child) {
  return new Promise((resolve) => child.once("exit", (code) => resolve(code)));
}

test("an abrupt server process restart recovers a live game and its sessions", { skip, timeout: 45000 }, async () => {
  const admin = createPool({ connectionString: databaseUrl, schema: "public", log: () => {} });
  // The fixture server boots through the production gate: a schema with no
  // migration ledger refuses traffic. Prepare this run's throwaway schema the
  // way an operator prepares a real one, otherwise the test only passes on a
  // machine whose ambient AUTO_MIGRATE setting would let the server self-migrate
  // - a setting production deliberately does not have.
  const setup = createPool({ connectionString: databaseUrl, schema, log: () => {} });
  let first;
  let second;
  let host;
  let player;
  try {
    await admin.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await migrate({ db: setup, log: () => {} });
    first = boot();
    const firstReady = await first.ready;
    host = connect(firstReady.port);
    player = connect(firstReady.port);
    await Promise.all([host.open(), player.open()]);

    const created = await host.call("room:create", { name: "Restart Host" });
    assert.equal(created.ok, true, JSON.stringify(created));
    const joined = await player.call("room:join", { roomId: created.roomId, name: "Restart Player" });
    assert.equal(joined.ok, true, JSON.stringify(joined));
    const started = await host.call("game:start");
    assert.equal(started.ok, true, JSON.stringify(started));
    for (let index = 0; index < 3; index += 1) {
      assert.equal((await host.call("game:call-next")).ok, true);
    }
    const before = await host.call("room:state");
    assert.equal(before.snapshot.state, "RUNNING");
    assert.equal(before.snapshot.calledNumbers.length, 3);

    const firstExit = exited(first.child);
    first.child.send("crash"); // intentionally bypass closeServer and its room-closing writes
    assert.equal(await firstExit, 77);
    host.socket.close();
    player.socket.close();

    second = boot();
    const secondReady = await second.ready;
    assert.deepEqual(secondReady.recovered, [created.roomId]);
    assert.deepEqual(secondReady.frozen, []);
    host = connect(secondReady.port);
    player = connect(secondReady.port);
    await Promise.all([host.open(), player.open()]);
    assert.equal((await host.call("session:resume", { roomId: created.roomId, sessionToken: created.sessionToken })).ok, true);
    assert.equal((await player.call("session:resume", { roomId: created.roomId, sessionToken: joined.sessionToken })).ok, true);

    const recovered = await player.call("room:state");
    assert.equal(recovered.ok, true);
    assert.equal(recovered.snapshot.state, "RUNNING");
    assert.deepEqual(recovered.snapshot.calledNumbers, before.snapshot.calledNumbers);
    const nextCall = await host.call("game:call-next");
    assert.equal(nextCall.ok, true, JSON.stringify(nextCall));
    const updated = await player.call("room:state");
    assert.equal(updated.snapshot.calledNumbers.length, 4);
    assert.equal(updated.snapshot.calledNumbers.at(-1), nextCall.number);
  } finally {
    host?.socket.close();
    player?.socket.close();
    for (const instance of [first, second]) {
      if (instance?.child.exitCode === null) {
        const exit = exited(instance.child);
        instance.child.send(instance === second ? "close" : "crash");
        await Promise.race([exit, new Promise((resolve) => setTimeout(resolve, 8000))]);
        if (instance.child.exitCode === null) instance.child.kill();
      }
    }
    await setup.end().catch(() => {});
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    await admin.end();
  }
});
