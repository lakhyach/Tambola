/**
 * Multi-client integration tests over real Socket.IO connections.
 * Run with: npm test
 *
 * These start the actual server stack (server/index.js -> createApp) on an
 * ephemeral port and drive it with independent socket.io clients, so they prove
 * what the unit tests cannot: that the transport itself isolates rooms, refuses
 * forged payloads and arbitrates races.
 */

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { io as connectClient } from "socket.io-client";
import { createApp } from "../server/index.js";
import { GameState, ErrorCodes } from "../server/game/engine.js";
import { ROOM_ID_PATTERN, LEGACY_EVENTS } from "../server/net/validate.js";

const connections = [];
let instance;
let url;

/** Small client wrapper: records every push event and promisifies acks. */
class Client {
  constructor(name) {
    this.name = name;
    this.records = [];
    this.waiters = new Map();
    this.socket = connectClient(url, {
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
      timeout: 5000,
    });
    connections.push(this);
    this.socket.onAny((event, ...args) => {
      const record = { event, payload: args[0] };
      this.records.push(record);
      const waiting = this.waiters.get(event);
      if (waiting) {
        this.waiters.set(event, []);
        for (const resolve of waiting) resolve(record.payload);
      }
    });
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

  get id() {
    return this.socket.id;
  }

  /** Emit and await the ack. */
  call(event, payload = {}) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no ack for " + event)), 5000);
      this.socket.emit(event, payload, (response) => {
        clearTimeout(timer);
        resolve(response);
      });
    });
  }

  /** Await the next push of an event, or the ones already buffered. */
  next(event, timeout = 5000) {
    const seen = this.records.find((record) => record.event === event && !record.consumed);
    if (seen) {
      seen.consumed = true;
      return Promise.resolve(seen.payload);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(this.name + " never received " + event)), timeout);
      const wrapped = (payload) => {
        clearTimeout(timer);
        resolve(payload);
      };
      this.waiters.set(event, (this.waiters.get(event) || []).concat(wrapped));
    });
  }

  history(event) {
    return this.records.filter((record) => record.event === event).map((record) => record.payload);
  }

  count(event) {
    return this.records.filter((record) => record.event === event).length;
  }

  /** Await the first payload for `event` that satisfies `predicate`. */
  until(event, predicate, timeout = 4000) {
    const matching = () => this.records.find((r) => r.event === event && predicate(r.payload));
    const found = matching();
    if (found) return Promise.resolve(found.payload);
    const deadline = Date.now() + timeout;
    return new Promise((resolve, reject) => {
      const poll = () => {
        const hit = matching();
        if (hit) return resolve(hit.payload);
        if (Date.now() > deadline) return reject(new Error(this.name + " never saw a matching " + event));
        setTimeout(poll, 20);
      };
      poll();
    });
  }

  tickets() {
    return this.history("ticket:assigned").map((payload) => payload.ticket);
  }

  async disconnect() {
    this.socket.disconnect();
    await new Promise((resolve) => {
      if (!this.socket.connected) return resolve();
      this.socket.once("disconnect", resolve);
      setTimeout(resolve, 500);
    });
  }
}

async function newClient(name) {
  return new Client(name).open();
}

/** Host a brand new room and return the client plus its session. */
async function hostRoom(name = "Host") {
  const host = await newClient(name);
  const created = await host.call("room:create", { name });
  assert.equal(created.ok, true, JSON.stringify(created));
  return { client: host, session: created };
}

async function joinRoom(roomId, name) {
  const client = await newClient(name);
  const joined = await client.call("room:join", { roomId, name });
  assert.equal(joined.ok, true, JSON.stringify(joined));
  return { client, session: joined };
}

function numbersOf(calls) {
  return calls.map((entry) => entry.number);
}

function settle(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

before(async () => {
  instance = await createApp({
    memoryOnly: true,
    origins: [],
    config: { autoCall: false, chatIntervalMs: 400, disconnectGraceMs: 500, callIntervalMs: 60000 },
    // generous budget here so the long games below are testing the game, not
    // the limiter; the limiter has its own dedicated test
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

// ------------------------------------------------------------------- handshake

test("a host creates a room and gets a server-generated code plus a session token", async () => {
  const { client, session } = await hostRoom("Creator");
  assert.match(session.roomId, ROOM_ID_PATTERN);
  assert.equal(session.roomId.length, 8);
  assert.match(session.sessionToken, /^[0-9a-f]{48}$/);
  assert.match(session.playerId, /^[0-9a-f]{12}$/);
  assert.equal(session.role, "host");
  assert.equal(session.state, GameState.WAITING);
  assert.ok(session.enabledPatterns.includes("fullHouse"));
  assert.equal(session.hostToken, undefined, "no raw engine credential crosses the wire");
  assert.equal(session.playerToken, undefined, "no raw engine credential crosses the wire");
  assert.equal(instance.registry.size(), 1);
  assert.equal(instance.registry.get(session.roomId).roomId, session.roomId);
});

test("joining an unknown or malformed room code is refused", async () => {
  const stranger = await newClient("Stranger");
  const missing = await stranger.call("room:join", { roomId: "ZZZZZZZZ", name: "Stranger" });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, ErrorCodes.ROOM_NOT_FOUND);

  for (const bad of ["abc", "has spaces", "!!!!!!!!", "", "prototype"]) {
    const rejected = await stranger.call("room:join", { roomId: bad, name: "Stranger" });
    assert.equal(rejected.ok, false, "refused code " + bad);
    assert.equal(rejected.code, ErrorCodes.BAD_PAYLOAD);
  }
  for (const badName of ["al", "x".repeat(25), 42, null]) {
    const rejected = await stranger.call("room:join", { roomId: "ABCD2345", name: badName });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, ErrorCodes.BAD_PAYLOAD);
  }
});

test("an in-room player sees the roster, an outsider does not", async () => {
  const { client: host, session } = await hostRoom("RoomHost");
  const bob = await joinRoom(session.roomId, "Bobby");
  const outsider = await newClient("Outsider");

  const inside = await host.call("room:state");
  assert.equal(inside.ok, true);
  assert.equal(inside.snapshot.players.length, 2);
  const names = inside.snapshot.players.map((p) => p.name).sort();
  assert.deepEqual(names, ["Bobby", "RoomHost"]);

  const outside = await outsider.call("room:state");
  assert.equal(outside.ok, false, "a socket with no session has no room to ask about");
  assert.equal(outside.code, ErrorCodes.NOT_PLAYER);
});

// --------------------------------------------------------------- room isolation

test("two rooms run independently and never leak to each other", async () => {
  const a = await hostRoom("HostA");
  const b = await hostRoom("HostB");
  const playerA = await joinRoom(a.session.roomId, "PlayerA");
  const playerB = await joinRoom(b.session.roomId, "PlayerB");
  assert.notEqual(a.session.roomId, b.session.roomId);

  const startedA = await a.client.call("game:start");
  const startedB = await b.client.call("game:start");
  assert.equal(startedA.ok, true);
  assert.equal(startedB.ok, true);

  for (let i = 0; i < 4; i++) assert.equal((await a.client.call("game:call-next")).ok, true);
  await settle(150);

  assert.equal(numbersOf(playerA.client.history("number:called")).length, 4);
  assert.equal(numbersOf(playerB.client.history("number:called")).length, 0, "room B heard nothing from room A");
  assert.equal(numbersOf(b.client.history("number:called")).length, 0);
  assert.equal(b.client.count("game:state"), 1, "only its own start");

  const viewB = await b.client.call("room:state");
  assert.equal(viewB.snapshot.calledNumbers.length, 0);
  assert.equal(viewB.snapshot.state, GameState.RUNNING);
  const viewA = await a.client.call("room:state");
  assert.equal(viewA.snapshot.calledNumbers.length, 4);
  assert.deepEqual(viewA.snapshot.calledNumbers, numbersOf(playerA.client.history("number:called")));

  // tickets never cross either
  assert.equal(playerA.client.tickets().length, 1);
  assert.equal(playerB.client.tickets().length, 1);
  assert.notDeepEqual(playerA.client.tickets()[0], playerB.client.tickets()[0]);

  // closing one room leaves the other untouched
  instance.registry.close(a.session.roomId, "test teardown");
  await settle(120);
  assert.equal(playerA.client.history("room:closed").length, 1);
  assert.equal(playerB.client.count("room:closed"), 0, "the other room was not told");
  assert.equal(instance.registry.get(a.session.roomId), null, "room A is gone from the registry");
  assert.ok(instance.registry.get(b.session.roomId), "room B is still live");
  const orphan = await a.client.call("game:call-next");
  assert.equal(orphan.ok, false);
  assert.equal(orphan.code, ErrorCodes.ROOM_NOT_FOUND, "a closed room takes no further orders");
  assert.equal((await b.client.call("game:call-next")).ok, true);
});

test("a client cannot point a privileged event at somebody else's room", async () => {
  const a = await hostRoom("OwnerOne");
  const b = await hostRoom("OwnerTwo");
  const intruder = await joinRoom(b.session.roomId, "Intruder");

  // the payload names room A and carries A's host credential
  const forged = await intruder.client.call("game:call-next", {
    roomId: a.session.roomId,
    hostToken: a.session.hostToken,
    number: 7,
  });
  assert.equal(forged.ok, false);
  assert.equal(forged.code, ErrorCodes.NOT_HOST);
  await settle(80);
  assert.equal(intruder.client.count("number:called"), 0);
  const aView = await a.client.call("room:state");
  const bView = await b.client.call("room:state");
  assert.equal(aView.snapshot.calledNumbers.length, 0, "room A was not touched");
  assert.equal(bView.snapshot.calledNumbers.length, 0, "room B was not touched either");
});

// ------------------------------------------------------------- host authority

test("a player cannot start, call, pause, end or reset", async () => {
  const { client: host, session } = await hostRoom("Strict Host");
  const player = await joinRoom(session.roomId, "Naughty");

  const privileged = ["game:start", "game:call-next", "game:pause", "game:resume", "game:end", "game:reset", "game:set-autocall"];
  for (const event of privileged) {
    const denied = await player.client.call(event, { hostToken: session.hostToken });
    assert.equal(denied.ok, false, event + " refused");
    assert.equal(denied.code, ErrorCodes.NOT_HOST, event);
  }
  await settle(100);
  assert.equal(player.client.count("number:called"), 0);
  assert.equal(host.count("game:state"), 0, "no state was ever broadcast");
  const view = await host.call("room:state");
  assert.equal(view.snapshot.state, GameState.WAITING);
  assert.equal(view.snapshot.calledNumbers.length, 0);

  // and the host still can
  assert.equal((await host.call("game:start")).ok, true);
  assert.equal((await host.call("game:call-next")).ok, true);
});

test("the client never decides which number is called", async () => {
  const { client: host, session } = await hostRoom("Caller");
  const player = await joinRoom(session.roomId, "Watcher");
  await host.call("game:start");

  const announced = [];
  for (let i = 0; i < 30; i++) {
    // insist on 7 every single time
    const ack = await host.call("game:call-next", { number: 7, numbers: [7], value: 7 });
    assert.equal(ack.ok, true);
    announced.push(ack.number);
  }
  assert.equal(new Set(announced).size, announced.length, "no repeats");
  assert.equal(announced.filter((n) => n === 7).length <= 1, true, "the server is not obeying the client");
  for (const n of announced) assert.ok(n >= 1 && n <= 90);

  await settle(120);
  const pushed = numbersOf(player.client.history("number:called"));
  assert.deepEqual(pushed, announced, "the ack and the broadcast are the same official call");
  const view = await host.call("room:state");
  assert.deepEqual(view.snapshot.calledNumbers, announced);
});

test("a refreshed host recovers authority with its session, a guessed token does not", async () => {
  const { client: host, session } = await hostRoom("Refreshable");
  const oldId = host.id;
  await host.disconnect();

  // a stranger that only knows the room code gets nothing
  const guesser = await newClient("Guesser");
  const noToken = await guesser.call("session:resume", { roomId: session.roomId });
  assert.equal(noToken.ok, false, "a room code alone is not a credential");
  assert.equal(noToken.code, ErrorCodes.BAD_PAYLOAD);

  // the browser that holds the session token is the host again
  const resumed = await guesser.call("session:resume", { roomId: session.roomId, sessionToken: session.sessionToken });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.role, "host");
  assert.equal(resumed.snapshot.recentEvents !== undefined, true, "the host view came back");
  assert.equal(resumed.hostToken, undefined, "the raw credential is not re-sent over the wire");
  assert.equal(resumed.sessionToken, undefined, "the token is not echoed back");
  assert.equal((await guesser.call("game:start")).ok, true, "authority restored");
  assert.equal((await guesser.call("game:call-next")).ok, true);
  assert.notEqual(oldId, guesser.id);

  const wrong = await newClient("Impostor").then((c) =>
    c.call("session:resume", { roomId: session.roomId, sessionToken: "f".repeat(48) })
  );
  assert.equal(wrong.ok, false);
  assert.equal(wrong.code, "SESSION_UNKNOWN");
});

// ------------------------------------------------------------------ game flow

test("a whole game over the wire: 90 unique calls, then it completes", async () => {
  const { client: host, session } = await hostRoom("Marathon");
  const players = [await joinRoom(session.roomId, "Runner1"), await joinRoom(session.roomId, "Runner2")];
  await host.call("game:start");

  const called = [];
  for (let i = 0; i < 95; i++) {
    const ack = await host.call("game:call-next");
    if (!ack.ok) {
      assert.equal(ack.code, ErrorCodes.INVALID_STATE, "the completed game refuses more calls");
      break;
    }
    called.push(ack.number);
  }
  assert.equal(called.length, 90);
  assert.deepEqual(called.slice().sort((x, y) => x - y), Array.from({ length: 90 }, (_, i) => i + 1));
  assert.equal(new Set(called).size, 90, "no number twice");

  await settle(150);
  for (const entry of [host, ...players.map((p) => p.client)]) {
    assert.deepEqual(numbersOf(entry.history("number:called")), called, entry.name + " saw the same history");
  }
  const completed = host.history("game:completed");
  assert.equal(completed.length, 1);
  assert.ok(Array.isArray(completed[0].leaderboard));
  const view = await host.call("room:state");
  assert.equal(view.snapshot.state, GameState.COMPLETED);
  assert.equal(view.snapshot.remaining, 0);
  // nobody can claim after the game is over
  const late = await players[0].client.call("claim:submit", { pattern: "fullHouse" });
  assert.equal(late.ok, false);
});

test("every participant gets exactly one private ticket, and nobody else's", async () => {
  const { client: host, session } = await hostRoom("Ticketeer");
  const players = [];
  for (let i = 0; i < 5; i++) players.push(await joinRoom(session.roomId, "Holder" + i));
  await host.call("game:start");
  await settle(150);

  const tickets = [];
  for (const entry of [host, ...players.map((p) => p.client)]) {
    const own = entry.tickets();
    assert.equal(own.length, 1, "exactly one ticket per socket");
    tickets.push(own[0]);
  }
  const unique = new Set(tickets.map((ticket) => JSON.stringify(ticket)));
  assert.equal(unique.size, 6, "all six tickets differ");

  // shape checks from the client's own view
  for (const ticket of tickets) {
    assert.equal(ticket.length, 3);
    for (const row of ticket) assert.equal(row.length, 9);
    const flat = ticket.flat().filter((cell) => cell !== null);
    assert.equal(flat.length, 15);
    assert.equal(new Set(flat).size, 15);
  }

  // and the ticket never appears in any room-wide broadcast
  for (const entry of [host, ...players.map((p) => p.client)]) {
    for (const record of entry.records) {
      if (record.event === "ticket:assigned") continue;
      assert.equal(JSON.stringify(record.payload).includes('"ticket"'), false, record.event + " carried a ticket");
    }
  }
});

test("starting twice is refused and a reset makes the room playable again", async () => {
  const { client: host, session } = await hostRoom("Twice");
  const player = await joinRoom(session.roomId, "Patient");
  assert.equal((await host.call("game:start")).ok, true);
  const twice = await host.call("game:start");
  assert.equal(twice.ok, false);
  assert.equal(twice.code, ErrorCodes.INVALID_STATE);

  await host.call("game:call-next");
  const tooEarly = await host.call("game:reset");
  assert.equal(tooEarly.ok, false);
  assert.equal(tooEarly.code, ErrorCodes.INVALID_TRANSITION);

  assert.equal((await host.call("game:end")).ok, true);
  assert.equal((await host.call("game:reset")).ok, true);
  const view = await host.call("room:state");
  assert.equal(view.snapshot.state, GameState.WAITING);
  assert.deepEqual(view.snapshot.calledNumbers, []);
  assert.equal((await host.call("game:start")).ok, true);
  await settle(120);
  assert.equal(player.client.tickets().length, 2, "a fresh ticket for the second game");
  assert.notDeepEqual(player.client.tickets()[0], player.client.tickets()[1]);
});

test("pause stops the draw and resume continues the same sequence", async () => {
  const { client: host, session } = await hostRoom("Pausey");
  const player = await joinRoom(session.roomId, "Sitter");
  await host.call("game:start");
  await host.call("game:call-next");
  const afterOne = (await host.call("room:state")).snapshot.calledNumbers.slice();
  assert.equal((await host.call("game:pause")).ok, true);
  const blocked = await host.call("game:call-next");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, ErrorCodes.INVALID_STATE);
  await settle(100);
  assert.equal(player.client.history("number:called").length, 1, "nothing drew during the pause");
  assert.equal((await host.call("game:resume")).ok, true);
  const next = await host.call("game:call-next");
  assert.equal(next.ok, true);
  const view = await host.call("room:state");
  assert.deepEqual(view.snapshot.calledNumbers, afterOne.concat([next.number]));
});

// -------------------------------------------------------------------- claims

test("a fabricated claim cannot win or score", async () => {
  const { client: host, session } = await hostRoom("Skeptical");
  const player = await joinRoom(session.roomId, "Cheater");
  await host.call("game:start");
  await settle(120);
  await host.call("game:call-next");

  const bogus = await player.client.call("claim:submit", {
    pattern: "fullHouse",
    won: true,
    points: 100000,
    playerId: session.playerId,
    name: "Skeptical",
    leaderboard: [{ player: "Cheater", points: 100000 }],
  });
  assert.equal(bogus.ok, false);
  assert.match(String(bogus.error), /invalid claim|incomplete/);
  assert.equal(bogus.won, undefined, "the server does not echo a client's winner flag");
  await settle(120);
  assert.equal(host.count("claim:result"), 0, "the room was never told about a win");
  const view = await host.call("room:state");
  for (const entry of view.snapshot.players) assert.equal(entry.points, 0);
  assert.deepEqual(view.snapshot.awards, []);
});

test("an unknown pattern id is refused, and so is a malformed one", async () => {
  const { client: host, session } = await hostRoom("PatternGuard");
  const player = await joinRoom(session.roomId, "Guesser");
  await host.call("game:start");
  const unknown = await player.client.call("claim:submit", { pattern: "notAPattern" });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, ErrorCodes.UNKNOWN_PATTERN);
  for (const bad of [123, "", "a".repeat(40), null, { pattern: "topLine" }]) {
    const rejected = await player.client.call("claim:submit", { pattern: bad });
    assert.equal(rejected.ok, false, "refused " + JSON.stringify(bad));
    assert.equal(rejected.code, ErrorCodes.BAD_PAYLOAD);
  }
});

test("a genuine winner is paid once and the room hears about it", async () => {
  const { client: host, session } = await hostRoom("Paymaster");
  const player = await joinRoom(session.roomId, "Luckey");
  await host.call("game:start");
  await settle(120);
  const ticket = player.client.tickets()[0].flat().filter((cell) => cell !== null);

  // call until this player's early five is really complete
  let hits = 0;
  for (let i = 0; i < 90 && hits < 5; i++) {
    const ack = await host.call("game:call-next");
    if (!ack.ok) break;
    if (ticket.includes(ack.number)) hits += 1;
  }
  assert.ok(hits >= 5, "five of the fifteen were called");

  const result = await player.client.call("claim:submit", { pattern: "earlyFive" });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.won, true);
  assert.equal(result.points, 20);
  assert.equal(result.playerId, player.session.playerId, "credited to the socket's own identity");
  assert.equal(result.name, "Luckey");

  const repeat = await player.client.call("claim:submit", { pattern: "earlyFive" });
  assert.equal(repeat.ok, false);
  assert.equal(repeat.code, ErrorCodes.ALREADY_CLAIMED_BY_YOU);
  const other = await host.call("claim:submit", { pattern: "earlyFive" });
  assert.equal(other.ok, false);
  assert.equal(other.code, ErrorCodes.ALREADY_AWARDED);

  await settle(150);
  assert.equal(host.count("claim:result"), 1, "the room heard exactly one win");
  const view = await host.call("room:state");
  const table = view.snapshot.players;
  assert.equal(table.reduce((sum, entry) => sum + entry.points, 0), 20, "one prize in total");
  assert.equal(view.snapshot.awards.length, 1);
});

test("racing claims for one exclusive prize award exactly once", async () => {
  const rounds = 20;
  for (let round = 0; round < rounds; round++) {
    const { client: host, session } = await hostRoom("Racer" + round);
    const one = await joinRoom(session.roomId, "Sprinter1");
    const two = await joinRoom(session.roomId, "Sprinter2");
    await host.call("game:start");
    await settle(80);

    const ticketOne = one.client.tickets()[0].flat().filter((cell) => cell !== null);
    const ticketTwo = two.client.tickets()[0].flat().filter((cell) => cell !== null);

    // drive the draw until BOTH tickets have five numbers called
    let hitsOne = 0;
    let hitsTwo = 0;
    for (let i = 0; i < 85 && (hitsOne < 5 || hitsTwo < 5); i++) {
      const ack = await host.call("game:call-next");
      if (!ack.ok) break;
      if (ticketOne.includes(ack.number)) hitsOne += 1;
      if (ticketTwo.includes(ack.number)) hitsTwo += 1;
    }
    if (hitsOne < 5 || hitsTwo < 5) {
      // statistically impossible, but do not turn a rare shuffle into a false pass
      assert.fail("round " + round + " could not complete both early fives");
    }

    const [first, second] = await Promise.all([
      one.client.call("claim:submit", { pattern: "earlyFive" }),
      two.client.call("claim:submit", { pattern: "earlyFive" }),
    ]);
    const wins = [first, second].filter((result) => result.ok);
    assert.equal(wins.length, 1, "round " + round + ": exactly one winner, got " + JSON.stringify([first, second]));
    const loser = wins[0] === first ? second : first;
    assert.equal(loser.code, ErrorCodes.ALREADY_AWARDED);

    await settle(60);
    const broadcast = host.history("claim:result").filter((payload) => payload.pattern === "earlyFive");
    assert.equal(broadcast.length, 1, "one win announced");
    const view = await host.call("room:state");
    const paid = view.snapshot.players.reduce((sum, entry) => sum + entry.points, 0);
    assert.equal(paid, 20, "the prize was paid once");
    assert.equal(view.snapshot.awards.filter((award) => award.pattern === "earlyFive").length, 1);

    instance.registry.close(session.roomId, "round teardown");
  }
});

// ---------------------------------------------------------- roster + transport

test("duplicate registration and name collisions are prevented", async () => {
  const { client: host, session } = await hostRoom("Original");
  const first = await joinRoom(session.roomId, "Same Name");

  // the same socket re-joining is idempotent, not a second registration
  const again = await first.client.call("room:join", { roomId: session.roomId, name: "Someone Else" });
  assert.equal(again.ok, true);
  assert.equal(again.resumed, true, "the same socket is not registered twice");
  assert.equal(again.playerId, first.session.playerId);
  assert.equal(again.name, "Same Name", "and it cannot rename itself either");

  const twin = await newClient("Twin");
  const clash = await twin.call("room:join", { roomId: session.roomId, name: "same name" });
  assert.equal(clash.ok, false);
  assert.equal(clash.code, ErrorCodes.NAME_TAKEN);

  const view = await host.call("room:state");
  assert.equal(view.snapshot.players.length, 2, "one host, one player");
});

test("a disconnected player stops being active and is removed after the grace window", async () => {
  const { client: host, session } = await hostRoom("Landlord");
  const staying = await joinRoom(session.roomId, "Staying");
  const leaving = await joinRoom(session.roomId, "Leaving");
  await host.call("game:start");

  await leaving.client.disconnect();
  const flagged = await staying.client.until(
    "room:updated",
    (payload) => payload.players.some((entry) => entry.name === "Leaving" && entry.connected === false)
  );
  const gone = flagged.players.find((entry) => entry.name === "Leaving");
  assert.equal(gone.connected, false, "shown as offline, not silently kept alive");
  assert.equal(gone.points, 0);

  // the game keeps running for everybody else
  assert.equal((await host.call("game:call-next")).ok, true);

  await settle(700); // disconnectGraceMs is 500 in this suite
  const swept = await staying.client.until(
    "room:updated",
    (payload) => !payload.players.some((entry) => entry.name === "Leaving")
  );
  assert.equal(swept.players.length, 2, "host and the staying player");
  assert.equal(instance.registry.get(session.roomId).players.size, 2);

  // an explicit leave works too
  const left = await staying.client.call("room:leave");
  assert.equal(left.ok, true);
  assert.equal(instance.registry.get(session.roomId).players.size, 1);
});

test("a host socket drop does not kill the room", async () => {
  const { client: host, session } = await hostRoom("Fragile");
  const player = await joinRoom(session.roomId, "Remainer");
  await host.call("game:start");
  await host.call("game:call-next");

  await host.disconnect();
  await settle(120);
  const changed = player.client.history("host:changed");
  assert.equal(changed.length, 1);
  assert.equal(changed[0].hostConnected, false);
  assert.equal(player.client.count("room:closed"), 0, "the room survived the refresh");

  const back = await newClient("FragileAgain");
  const resumed = await back.call("session:resume", { roomId: session.roomId, sessionToken: session.sessionToken });
  assert.equal(resumed.ok, true);
  assert.equal((await back.call("game:call-next")).ok, true, "the host is driving again");
  assert.equal(instance.registry.get(session.roomId).players.size, 2);

  // and a player who reconnects keeps their ticket
  const oldTicket = player.client.tickets()[0];
  const playerBack = await newClient("RemainerAgain");
  const playerResumed = await playerBack.call("session:resume", {
    roomId: session.roomId,
    sessionToken: player.session.sessionToken,
  });
  assert.equal(playerResumed.ok, true);
  assert.equal(playerResumed.role, "player", "she comes back as a player, not the host");
  assert.deepEqual(playerResumed.snapshot.ticket, oldTicket, "same ticket after reconnect");
  const wrongCred = await newClient("Hijack").then((c) =>
    c.call("session:resume", { roomId: session.roomId, sessionToken: "e".repeat(48) })
  );
  assert.equal(wrongCred.ok, false, "a forged token cannot take her seat");
  assert.equal(wrongCred.code, "SESSION_UNKNOWN");
});

// ------------------------------------------------------------- chat + limits

test("chat is room scoped, attributed and rate limited", async () => {
  const a = await hostRoom("ChatHost");
  const speaker = await joinRoom(a.session.roomId, "Speaker");
  const b = await hostRoom("OtherHost");
  const neighbour = await joinRoom(b.session.roomId, "Neighbour");

  const sent = await speaker.client.call("chat:send", { text: "hello room" });
  assert.equal(sent.ok, true);
  const heard = await a.client.next("chat:message");
  assert.equal(heard.text, "hello room");
  assert.equal(heard.from, "Speaker");
  assert.equal(heard.playerId, speaker.session.playerId);

  await settle(80);
  assert.equal(neighbour.client.count("chat:message"), 0, "the other room never got it");

  // payload roomId is ignored: identity and room come from the session
  const crossRoom = await neighbour.client.call("chat:send", { roomId: a.session.roomId, text: "try to leak" });
  assert.equal(crossRoom.ok, true);
  await settle(80);
  assert.equal(a.client.count("chat:message"), 1, "it stayed in its own room");
  assert.equal(b.client.history("chat:message").some((m) => m.text === "try to leak"), true);

  const spam = await speaker.client.call("chat:send", { text: "again" });
  assert.equal(spam.ok, false);
  assert.equal(spam.code, ErrorCodes.RATE_LIMITED);
  for (const bad of ["", "   ", "x".repeat(200), 42, null]) {
    const rejected = await speaker.client.call("chat:send", { text: bad });
    assert.equal(rejected.ok, false, "refused " + JSON.stringify(bad));
    assert.equal(rejected.code, ErrorCodes.BAD_PAYLOAD);
  }
});

test("malformed frames are refused without touching the game", async () => {
  const { client: host, session } = await hostRoom("Robust");
  const player = await joinRoom(session.roomId, "Fuzzer");
  await host.call("game:start");
  const before = (await host.call("room:state")).snapshot.calledNumbers.length;

  const wide = { name: "Fuzzer" };
  for (let i = 0; i < 12; i++) wide["extra" + i] = "y".repeat(500);
  const tooBig = await player.client.call("room:join", wide);
  assert.equal(tooBig.ok, false);
  assert.equal(tooBig.code, ErrorCodes.BAD_PAYLOAD);

  for (const args of [
    ["game:call-next", { number: "7" }],
    ["game:set-autocall", { intervalMs: 1 }],
    ["game:set-autocall", { intervalMs: "fast" }],
    ["claim:submit", { pattern: "earlyFive", marks: [1, 2, 3] }],
  ]) {
    const result = await player.client.call(args[0], args[1]);
    assert.equal(result.ok, false, args[0] + " refused");
    assert.ok(result.code, "with a code: " + JSON.stringify(result));
  }

  // A read event does not refuse unknown fields, it ignores them: the room is
  // always taken from the socket's own session, so a spoofed roomId plus a
  // made-up "sudo" flag cannot widen what this socket is allowed to see.
  const spoofed = await player.client.call("room:state", { roomId: "NOPE1234", sudo: true });
  assert.equal(spoofed.ok, true, "still just a normal room:state");
  assert.ok(spoofed.snapshot, "and it got a snapshot");
  assert.equal(
    spoofed.snapshot.players.some((entry) => entry.name === "Fuzzer"),
    true,
    "the snapshot is its own room, never the one it named"
  );

  // a payload that is not an object at all
  const arrayFrame = await newClient("ArrayFrame").then((c) => c.call("room:join", ["ABCD2345", "Hax0r"]));
  assert.equal(arrayFrame.ok, false);
  assert.equal(arrayFrame.code, ErrorCodes.BAD_PAYLOAD);

  await settle(120);
  const after = (await host.call("room:state")).snapshot.calledNumbers.length;
  assert.equal(after, before, "the fuzzing changed nothing");
  assert.equal(player.client.count("number:called"), 0);
});

test("every legacy event from the old client is refused loudly", async () => {
  const { client: host, session } = await hostRoom("LegacyHost");
  const player = await joinRoom(session.roomId, "OldTab");
  await host.call("game:start");
  const before = (await host.call("room:state")).snapshot.calledNumbers.length;

  for (const legacy of LEGACY_EVENTS) {
    const ack = await player.client.call(legacy, { room: session.roomId, no: 7, p: 9999, isAdmin: true });
    assert.equal(ack.ok, false, legacy + " is dead");
    assert.equal(ack.code, "LEGACY_EVENT", legacy);
  }
  await settle(150);
  assert.equal(player.client.count("rm"), 0, "the old score broadcast no longer exists");
  assert.equal(player.client.count("number-announced"), 0);
  assert.equal(player.client.count("claimcome"), 0);
  assert.equal(player.client.history("app:error").length, LEGACY_EVENTS.length);
  const after = (await host.call("room:state")).snapshot.calledNumbers.length;
  assert.equal(after, before, "and none of it changed the game");
});

test("an event budget protects the server from a flooding socket", async () => {
  const strict = await createApp({
    memoryOnly: true,
    origins: [],
    config: { autoCall: false },
    limits: { burst: 6, perSecond: 1 },
    log: () => {},
  });
  const port = await strict.listen(0);
  const floodUrl = `http://127.0.0.1:${port}`;
  try {
    const socket = connectClient(floodUrl, { transports: ["websocket"], forceNew: true, reconnection: false });
    connections.push({ socket });
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
    const results = [];
    for (let i = 0; i < 20; i++) {
      results.push(
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("no ack")), 4000);
          socket.emit("room:state", {}, (response) => {
            clearTimeout(timer);
            resolve(response);
          });
        })
      );
    }
    const limited = results.filter((entry) => entry.code === ErrorCodes.RATE_LIMITED);
    assert.ok(limited.length >= 10, "the burst was cut off after the budget ran out, got " + limited.length);
    assert.equal(results.slice(0, 5).every((entry) => entry.code !== ErrorCodes.RATE_LIMITED), true);
    socket.disconnect();
  } finally {
    await strict.closeServer();
  }
});

test("an unauthorised browser origin is refused at the handshake", async () => {
  const gated = await createApp({ memoryOnly: true, origins: ["http://good.example"], config: { autoCall: false }, log: () => {} });
  const port = await gated.listen(0);
  const endpoint = `http://127.0.0.1:${port}/socket.io/?EIO=4&transport=polling`;
  try {
    const good = await fetch(endpoint, { headers: { Origin: "http://good.example" } });
    assert.equal(good.status, 200, "an allowed origin handshakes");
    const bad = await fetch(endpoint, { headers: { Origin: "http://evil.example" } });
    assert.notEqual(bad.status, 200, "a stranger origin is refused");
    assert.ok(bad.status >= 400, "with an error, got " + bad.status);
    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(health.status, 200);
    const body = await health.json();
    assert.equal(body.ok, true);
    // The probe reports room COUNTS and nothing else: no roster, no draw, no
    // ticket. It is an operational answer, not a game view.
    assert.equal(body.rooms.live, 0, "the health probe does not leak gameplay data");
    assert.equal(body.rooms.frozen, 0);
    assert.equal(body.durable, false, "memory mode says so honestly");
    assert.equal(JSON.stringify(body).includes("draw"), false);
    assert.equal(JSON.stringify(body).includes("DATABASE_URL"), false);
    assert.equal(JSON.stringify(body).includes("postgres"), false);
  } finally {
    await gated.closeServer();
  }
});

test("nothing in a snapshot exposes the future draw", async () => {
  const { client: host, session } = await hostRoom("Secretive");
  const player = await joinRoom(session.roomId, "Curious");
  await host.call("game:start");
  for (let i = 0; i < 10; i++) await host.call("game:call-next");
  await settle(120);

  const room = instance.registry.get(session.roomId);
  const upcoming = room.draw.slice(10);
  const nextSix = JSON.stringify(upcoming.slice(0, 6));
  const views = [
    JSON.stringify((await host.call("room:state")).snapshot),
    JSON.stringify((await player.client.call("room:state")).snapshot),
    ...host.records.map((record) => JSON.stringify(record.payload) || ""),
    ...player.client.records.map((record) => JSON.stringify(record.payload) || ""),
  ];
  for (const blob of views) {
    assert.equal(blob.includes(nextSix), false, "the next six calls are not in there");
    assert.equal(blob.includes('"draw"'), false, "no draw field is ever shipped");
    assert.equal(blob.includes('"shuffle"'), false, "no shuffle field is ever shipped");
  }
  assert.equal(new Set(room.calledNumbers).size, 10);
});
