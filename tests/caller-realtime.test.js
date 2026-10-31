/**
 * PHASE 17 — THE CALLER CONSOLE OVER THE REAL TRANSPORT.
 *
 * The console is only as good as the contract behind it. These tests start the
 * real server on an ephemeral port and drive it with independent sockets, so the
 * four things the console depends on are proven on the wire rather than in the
 * view-model:
 *
 *   • the cadence is host-only room state that the snapshot, the ack and the
 *     broadcast all agree about;
 *   • an illegal cadence is refused and changes nothing;
 *   • the round clock is the server's, and pause really stops it;
 *   • a round that is over, a second start, a duplicate click and a second host
 *     tab are all refused — the server stays authoritative in every case.
 *
 * Run with: npm test
 */

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { io as connectClient } from "socket.io-client";
import { createApp } from "../server/index.js";
import { ErrorCodes, GameState } from "../server/game/engine.js";

const connections = [];
let instance;
let url;

class Client {
  constructor(name) {
    this.name = name;
    this.records = [];
    this.socket = connectClient(url, {
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
      timeout: 5000,
    });
    connections.push(this);
    this.socket.onAny((event, ...args) => this.records.push({ event, payload: args[0] }));
  }

  async open() {
    if (this.socket.connected) return this;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(this.name + " could not connect")), 5000);
      this.socket.once("connect", () => {
        clearTimeout(timer);
        resolve();
      });
      this.socket.once("connect_error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    return this;
  }

  call(event, payload) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no ack for " + event)), 5000);
      const done = (response) => {
        clearTimeout(timer);
        resolve(response);
      };
      if (payload === undefined) this.socket.emit(event, done);
      else this.socket.emit(event, payload, done);
    });
  }

  count(event) {
    return this.records.filter((record) => record.event === event).length;
  }

  history(event) {
    return this.records.filter((record) => record.event === event).map((record) => record.payload);
  }

  last(event) {
    const found = this.history(event);
    return found.length ? found[found.length - 1] : null;
  }
}

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function newClient(name) {
  return new Client(name).open();
}

async function hostRoom(name = "Host") {
  const client = await newClient(name);
  const created = await client.call("room:create", { name });
  assert.equal(created.ok, true, JSON.stringify(created));
  return { client, session: created };
}

async function joinRoom(roomId, name) {
  const client = await newClient(name);
  const joined = await client.call("room:join", { roomId, name });
  assert.equal(joined.ok, true, JSON.stringify(joined));
  return { client, session: joined };
}

/** A room with a host, one seated player and a round already running. */
async function runningRoom() {
  const host = await hostRoom("Host");
  const player = await joinRoom(host.session.roomId, "Asha");
  const started = await host.client.call("game:start");
  assert.equal(started.ok, true, JSON.stringify(started));
  return { host, player };
}

before(async () => {
  instance = await createApp({
    memoryOnly: true,
    origins: [],
    config: { autoCall: false, chatIntervalMs: 0, disconnectGraceMs: 500, callIntervalMs: 60000 },
    limits: { burst: 500, perSecond: 2000 },
    log: () => {},
  });
  const port = await instance.listen(0);
  url = `http://127.0.0.1:${port}`;
});

after(async () => {
  for (const client of connections) {
    try {
      client.socket.disconnect();
    } catch {
      /* already gone */
    }
  }
  await settle(100);
  if (instance) await instance.closeServer();
});

// --------------------------------------------------------------- the cadence

test("only the host may change the calling cadence", async () => {
  const { host, player } = await runningRoom();
  const byPlayer = await player.client.call("game:set-autocall", { intervalMs: 3000 });
  assert.equal(byPlayer.ok, false);
  assert.equal(byPlayer.code, ErrorCodes.NOT_HOST, "a player cannot pace the room's calls");

  const byStranger = await (await newClient("Stranger")).call("game:set-autocall", { intervalMs: 3000 });
  assert.equal(byStranger.ok, false, "a socket with no room of its own cannot pace anything");

  const view = await host.client.call("room:state");
  assert.equal(view.snapshot.callIntervalMs, 60000, "the room kept the cadence it had");
});

test("the ack, the broadcast and the snapshot agree about a cadence change", async () => {
  const { host, player } = await runningRoom();

  const enabled = await host.client.call("game:set-autocall", { enabled: true, intervalMs: 3000 });
  assert.equal(enabled.ok, true, JSON.stringify(enabled));
  assert.equal(enabled.autoCall, true);
  assert.equal(enabled.callIntervalMs, 3000);

  // A pace change on its own must not switch auto-call off — that is the whole
  // reason the console sends `{ intervalMs }` without an `enabled` field.
  const retimed = await host.client.call("game:set-autocall", { intervalMs: 5000 });
  assert.equal(retimed.ok, true, JSON.stringify(retimed));
  assert.equal(retimed.autoCall, true, "auto-call stayed on");
  assert.equal(retimed.callIntervalMs, 5000);

  const view = await player.client.call("room:state");
  assert.equal(view.snapshot.callIntervalMs, 5000, "players see the cadence the caller chose");
  assert.equal(view.snapshot.autoCall, true);

  const pushed = player.client
    .history("game:state")
    .filter((payload) => payload && payload.callIntervalMs === 5000);
  assert.ok(pushed.length >= 1, "the change was broadcast, not just acked");
});

test("an unsafe or malformed cadence is refused and the room's pace is untouched", async () => {
  const { host } = await runningRoom();
  await host.client.call("game:set-autocall", { enabled: true, intervalMs: 4000 });

  for (const bad of [0, 250, 499, 120001, 999999, 4.5, "4000", null]) {
    const refused = await host.client.call("game:set-autocall", { intervalMs: bad });
    assert.equal(refused.ok, false, "the server refused intervalMs " + JSON.stringify(bad));
    assert.equal(refused.code, ErrorCodes.BAD_PAYLOAD, "as a bad payload, not a silent clamp");
  }
  const view = await host.client.call("room:state");
  assert.equal(view.snapshot.callIntervalMs, 4000, "the last safe cadence survives the refusals");
  assert.equal(view.snapshot.autoCall, true);
});

// ------------------------------------------------------------ the round clock

test("the reported round clock stops when the host pauses, and continues on resume", async () => {
  const { host, player } = await runningRoom();
  await settle(250);

  const running = await player.client.call("room:state");
  assert.equal(running.snapshot.state, GameState.RUNNING);
  assert.equal(typeof running.snapshot.elapsedMs, "number");
  assert.ok(running.snapshot.elapsedMs >= 200, "the round has been running: " + running.snapshot.elapsedMs);
  assert.equal(typeof running.snapshot.startedAt, "number");

  const paused = await host.client.call("game:pause");
  assert.equal(paused.ok, true);
  await settle(150);
  const a = await player.client.call("room:state");
  await settle(250);
  const b = await player.client.call("room:state");
  assert.equal(a.snapshot.state, GameState.PAUSED);
  assert.equal(b.snapshot.elapsedMs, a.snapshot.elapsedMs, "a paused round does not count time");

  const resumed = await host.client.call("game:resume");
  assert.equal(resumed.ok, true);
  await settle(250);
  const c = await player.client.call("room:state");
  assert.equal(c.snapshot.state, GameState.RUNNING);
  assert.ok(c.snapshot.elapsedMs > b.snapshot.elapsedMs, "resuming continues the clock rather than restarting it");
});

// --------------------------------------------------- authority and idempotency

test("a second start, and a call after the round is over, are both refused", async () => {
  const { host } = await runningRoom();

  const again = await host.client.call("game:start");
  assert.equal(again.ok, false, "a round cannot be opened twice");
  assert.equal(again.code, ErrorCodes.INVALID_STATE);

  const called = await host.client.call("game:call-next");
  assert.equal(called.ok, true);

  const ended = await host.client.call("game:end");
  assert.equal(ended.ok, true);
  assert.equal(ended.state, GameState.COMPLETED);

  const late = await host.client.call("game:call-next");
  assert.equal(late.ok, false, "a finished round cannot be called");
  assert.equal(late.code, ErrorCodes.INVALID_STATE);

  const results = await host.client.call("room:state");
  assert.equal(results.snapshot.state, GameState.COMPLETED);
  assert.ok(Array.isArray(results.snapshot.calledNumbers), "the call sheet is still readable");
  assert.equal(results.snapshot.calledNumbers.length, 1, "and it still holds the round's calls");
  assert.ok(Array.isArray(results.snapshot.leaderboard), "results stay available after completion");
});

test("a player cannot move the round's state", async () => {
  const { player } = await runningRoom();
  for (const event of ["game:pause", "game:resume", "game:end", "game:reset", "game:call-next", "game:start"]) {
    const refused = await player.client.call(event);
    assert.equal(refused.ok, false, event + " is host-only");
    assert.ok(
      refused.code === ErrorCodes.NOT_HOST || refused.code === ErrorCodes.INVALID_STATE,
      event + " refused as " + refused.code
    );
  }
});

test("ten simultaneous call intents draw ten distinct numbers in one order", async () => {
  const { host, player } = await runningRoom();
  const acks = await Promise.all(Array.from({ length: 10 }, () => host.client.call("game:call-next")));
  assert.equal(acks.every((ack) => ack.ok), true, "every intent was answered");

  const numbers = acks.map((ack) => ack.number);
  assert.equal(new Set(numbers).size, 10, "no number was drawn twice");
  for (const ack of acks) assert.ok(Number.isInteger(ack.number) && ack.number >= 1 && ack.number <= 90);

  const view = await player.client.call("room:state");
  assert.equal(view.snapshot.calledCount, 10);
  assert.equal(view.snapshot.calledNumbers.length, 10);
  assert.deepEqual([...view.snapshot.calledNumbers].sort((x, y) => x - y), [...numbers].sort((x, y) => x - y));
});

test("a second tab that resumes the host seat takes control; the old tab cannot call", async () => {
  const { host } = await runningRoom();

  const secondTab = await newClient("HostSecondTab");
  const resumed = await secondTab.call("session:resume", {
    roomId: host.session.roomId,
    sessionToken: host.session.sessionToken,
  });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(resumed.role, "host", "the saved credential carries the authority, not the tab");

  const stale = await host.client.call("game:call-next");
  assert.equal(stale.ok, false, "the tab that lost the host socket cannot call");
  assert.equal(stale.code, ErrorCodes.NOT_HOST);

  const current = await secondTab.call("game:call-next");
  assert.equal(current.ok, true, "the tab that holds the host socket can");

  const stillReadable = await host.client.call("room:state");
  assert.equal(stillReadable.ok, true, "the stale tab can still read the room it is seated in");
  assert.equal(stillReadable.snapshot.calledCount, 1);

  const stalePace = await host.client.call("game:set-autocall", { intervalMs: 3000 });
  assert.equal(stalePace.ok, false, "and it cannot pace the room either");
});
