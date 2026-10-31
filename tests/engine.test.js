/**
 * Server-authoritative engine: draw, states, host authority, roster, tickets,
 * snapshots, timers and chat.
 * Run with: npm test
 *
 * Everything here runs against the injected rng/clock/timers from helpers.js, so
 * the assertions are deterministic rather than timing dependent.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  createRoom,
  newRoomId,
  TambolaRoom,
  GameState,
  STATE_TRANSITIONS,
  DEFAULT_CONFIG,
  ErrorCodes,
} from "../server/game/engine.js";
import { validateTicket } from "../server/game/ticket.js";
import { PATTERNS } from "../server/game/patterns.js";
import { makeRoom, giveTicket, callThrough, callSpecific, walk, TICKET_A } from "./helpers.js";

const HOST_AUTH = (host) => ({ socketId: host.socketId });

// ------------------------------------------------------------- room identity

test("room codes are 8 unambiguous characters and never repeat", () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const id = newRoomId();
    assert.equal(id.length, 8);
    assert.match(id, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/, "no lookalike characters: " + id);
    seen.add(id);
  }
  assert.equal(seen.size, 500, "500 codes, 500 distinct");
});

test("the host credential is a long hex token, never a guessable value", () => {
  const h = makeRoom();
  assert.match(h.room.hostToken, /^[0-9a-f]{48}$/);
  assert.notEqual(h.room.hostToken, h.room.roomId);
  const other = makeRoom({ roomId: "OTHERROOM" });
  assert.notEqual(other.room.hostToken, h.room.hostToken);
});

test("a room cannot be constructed without an id", () => {
  assert.throws(() => new TambolaRoom({}), /roomId is required/);
});

// -------------------------------------------------------------------- the draw

test("starting builds a private shuffle of exactly 1..90", () => {
  const h = makeRoom();
  const host = h.host();
  h.player("Alice", "sock-a");
  h.room.start(HOST_AUTH(host));
  assert.equal(h.room.draw.length, 90);
  assert.deepEqual([...h.room.draw].sort((a, b) => a - b), Array.from({ length: 90 }, (_, i) => i + 1));
});

test("ninety host intents produce every number once, in order, then stop", () => {
  const h = makeRoom();
  const host = h.host();
  h.room.start(HOST_AUTH(host));
  const expected = h.room.draw.slice();
  const called = callThrough(h.room, host.socketId, 90);
  assert.deepEqual(called, expected, "the engine's order is the official order");
  assert.equal(new Set(called).size, 90, "no number twice");
  for (const n of called) assert.ok(n >= 1 && n <= 90, "in range: " + n);
  assert.deepEqual(h.room.calledNumbers, called);

  const exhausted = h.room.callNext(HOST_AUTH(host));
  assert.equal(exhausted.ok, false);
  assert.equal(exhausted.code, ErrorCodes.INVALID_STATE, "the game already completed, so no more calls");
  assert.equal(h.room.cursor, 90, "the cursor never ran past the deck");

  // the exhaustion guard itself: if completion ever failed to land, a RUNNING
  // room with an empty deck must refuse rather than read draw[90]
  h.room.state = GameState.RUNNING;
  const guard = h.room.callNext(HOST_AUTH(host));
  assert.equal(guard.code, ErrorCodes.DRAW_EXHAUSTED);
  h.room.state = GameState.COMPLETED;

  const events = h.eventsNamed("number:called");
  assert.equal(events.length, 90);
  assert.equal(events[0].payload.index, 1);
  assert.equal(events[0].payload.remaining, 89);
  assert.equal(events[89].payload.remaining, 0);
  assert.equal(h.room.state, GameState.COMPLETED, "auto-completes on the last number");
  assert.equal(h.eventsNamed("game:completed").length, 1);
});

test("two rooms with different entropy call different orders", () => {
  const a = makeRoom({ roomId: "ROOMAAA", seed: 11 });
  const b = makeRoom({ roomId: "ROOMBBB", seed: 999983 });
  a.host("Host One", "sock-a");
  b.host("Host Two", "sock-b");
  a.room.start({ socketId: "sock-a" });
  b.room.start({ socketId: "sock-b" });
  assert.notDeepEqual(a.room.draw, b.room.draw);
  // and they stay independent
  callThrough(a.room, "sock-a", 5);
  assert.equal(b.room.cursor, 0);
  assert.deepEqual(a.room.calledNumbers, a.room.draw.slice(0, 5));
});

test("the default engine uses a cryptographic source, not Math.random", () => {
  const nativeRandom = Math.random;
  let mathRandomCalls = 0;
  Math.random = () => {
    mathRandomCalls += 1;
    return nativeRandom();
  };
  try {
    const room = createRoom({ roomId: "CRYPTOROOM" });
    const host = room.join({ name: "Crypto Host", socketId: "s1" });
    room.setHost({ socketId: "s1", playerId: host.playerId });
    room.start({ socketId: "s1" });
    for (let i = 0; i < 20; i++) room.callNext({ socketId: "s1" });
    assert.equal(room.calledNumbers.length, 20);
    assert.equal(new Set(room.calledNumbers).size, 20);
  } finally {
    Math.random = nativeRandom;
  }
  assert.equal(mathRandomCalls, 0, "a real game must not consume Math.random");
});

test("manual and scheduled calls never double-draw the same number", () => {
  const h = makeRoom({ config: { autoCall: true, callIntervalMs: 1000 } });
  const host = h.host();
  h.room.start(HOST_AUTH(host));
  const expected = h.room.draw.slice();
  h.advance(3500); // scheduler draws 1, 2, 3
  h.room.callNext(HOST_AUTH(host)); // the host taps in between
  h.advance(2000); // scheduler draws 5, 6
  h.room.pause(HOST_AUTH(host));
  h.advance(60000); // must be inert while paused
  const called = h.room.calledNumbers;
  assert.deepEqual(called, expected.slice(0, called.length));
  assert.equal(new Set(called).size, called.length, "no duplicates under interleaving");
  assert.equal(called.length, 6);
});

test("a client cannot choose the official number", () => {
  const h = makeRoom();
  const host = h.host();
  h.room.start(HOST_AUTH(host));
  for (let i = 0; i < 25; i++) {
    const upcoming = h.room.draw[h.room.cursor];
    // extra fields are ignored: callNext() only ever takes an auth envelope
    const result = h.room.callNext({ socketId: host.socketId, number: 42, index: 0, value: upcoming });
    assert.equal(result.ok, true);
    assert.equal(result.number, upcoming, "the server's shuffle decides, call " + (i + 1));
  }
  // structurally: there is no public "set the number" API
  assert.ok(TambolaRoom.prototype.callNext.length <= 1, "callNext takes an auth envelope only");
  for (const forbidden of ["callNumber", "setNumber", "announce", "addCalled", "forceNumber", "setPoints"]) {
    assert.equal(typeof h.room[forbidden], "undefined", "no " + forbidden + "() entry point");
  }
});

test("calls are rejected outside RUNNING, in every direction", () => {
  const h = makeRoom();
  const host = h.host();
  assert.equal(h.room.callNext(HOST_AUTH(host)).code, ErrorCodes.INVALID_STATE);
  assert.equal(h.room.state, GameState.WAITING);

  h.room.start(HOST_AUTH(host));
  h.room.pause(HOST_AUTH(host));
  const paused = h.room.callNext(HOST_AUTH(host));
  assert.equal(paused.ok, false);
  assert.match(paused.error, /paused/);

  h.room.resumeGame(HOST_AUTH(host));
  assert.equal(h.room.callNext(HOST_AUTH(host)).ok, true);
  h.room.end(HOST_AUTH(host));
  assert.equal(h.room.callNext(HOST_AUTH(host)).code, ErrorCodes.INVALID_STATE);
});

// ------------------------------------------------------------------ states

test("the transition table is explicit and complete", () => {
  assert.deepEqual(Object.keys(STATE_TRANSITIONS).sort(), Object.values(GameState).slice().sort());
  assert.deepEqual(STATE_TRANSITIONS[GameState.WAITING], [GameState.RUNNING, GameState.COMPLETED]);
  assert.deepEqual(STATE_TRANSITIONS[GameState.RUNNING], [GameState.PAUSED, GameState.COMPLETED]);
  assert.deepEqual(STATE_TRANSITIONS[GameState.PAUSED], [GameState.RUNNING, GameState.COMPLETED]);
  assert.deepEqual(STATE_TRANSITIONS[GameState.COMPLETED], [GameState.WAITING]);
});

test("legal transitions are accepted and illegal ones refused, cell by cell", () => {
  const cases = [
    [GameState.WAITING, GameState.PAUSED, false],
    [GameState.WAITING, GameState.RUNNING, true],
    [GameState.WAITING, GameState.COMPLETED, true],
    [GameState.WAITING, GameState.WAITING, false],
    [GameState.RUNNING, GameState.WAITING, false],
    [GameState.RUNNING, GameState.PAUSED, true],
    [GameState.RUNNING, GameState.COMPLETED, true],
    [GameState.RUNNING, GameState.RUNNING, false],
    [GameState.PAUSED, GameState.WAITING, false],
    [GameState.PAUSED, GameState.RUNNING, true],
    [GameState.PAUSED, GameState.PAUSED, false],
    [GameState.COMPLETED, GameState.RUNNING, false],
    [GameState.COMPLETED, GameState.PAUSED, false],
    [GameState.COMPLETED, GameState.WAITING, true],
  ];
  for (const [from, to, allowed] of cases) {
    const h = makeRoom();
    const host = h.host();
    h.room.state = from; // exercise the gate itself; the flow tests cover how
    const result = h.room.transition(to); // a room legitimately reaches each state
    assert.equal(result.ok, allowed, `${from} -> ${to} should be ${allowed ? "ok" : "refused"}`);
    if (!allowed) {
      assert.equal(result.code, ErrorCodes.INVALID_TRANSITION);
      assert.equal(h.room.state, from, "a refused transition changes nothing");
    } else {
      assert.equal(h.room.state, to);
    }
    assert.equal(h.room.draw.length, 0, "transition() alone never builds a draw");
  }
});

test("start is idempotent-proof: a second start is refused", () => {
  const h = makeRoom();
  const host = h.host();
  assert.equal(h.room.start(HOST_AUTH(host)).ok, true);
  const twice = h.room.start(HOST_AUTH(host));
  assert.equal(twice.ok, false);
  assert.equal(twice.code, ErrorCodes.INVALID_STATE);
  assert.equal(h.room.draw.length, 90, "the shuffle was not rebuilt");
});

test("pause/resume/end/reset each enforce their own state", () => {
  const h = makeRoom();
  const host = h.host();
  assert.equal(h.room.pause(HOST_AUTH(host)).code, ErrorCodes.INVALID_STATE, "cannot pause WAITING");
  assert.equal(h.room.resumeGame(HOST_AUTH(host)).code, ErrorCodes.INVALID_STATE, "cannot resume WAITING");
  assert.equal(h.room.reset(HOST_AUTH(host)).code, ErrorCodes.INVALID_TRANSITION, "cannot reset WAITING");

  h.room.start(HOST_AUTH(host));
  assert.equal(h.room.reset(HOST_AUTH(host)).code, ErrorCodes.INVALID_TRANSITION, "cannot reset RUNNING");
  h.room.pause(HOST_AUTH(host));
  assert.equal(h.room.pause(HOST_AUTH(host)).code, ErrorCodes.INVALID_STATE, "cannot pause PAUSED");
  h.room.resumeGame(HOST_AUTH(host));
  assert.equal(h.room.state, GameState.RUNNING);

  h.room.end(HOST_AUTH(host));
  assert.equal(h.room.state, GameState.COMPLETED);
  assert.equal(h.room.pause(HOST_AUTH(host)).code, ErrorCodes.INVALID_STATE);
  const reset = h.room.reset(HOST_AUTH(host));
  assert.equal(reset.ok, true);
  assert.equal(h.room.state, GameState.WAITING);
});

test("starting needs at least one connected participant", () => {
  const h = makeRoom();
  const host = h.host();
  h.room.detach(host.socketId);
  // the host participant is still registered but no socket is attached
  assert.equal(h.room.players.get(host.playerId).connected, false);
  const result = h.room.start({ hostToken: h.room.hostToken });
  assert.equal(result.ok, false);
  assert.equal(result.code, ErrorCodes.INVALID_STATE);
  assert.match(result.error, /nobody is connected/);
});

test("reset wipes game state but keeps the room and roster", () => {
  const h = makeRoom();
  const host = h.host();
  const alice = h.player("Alice", "sock-a");
  h.room.start(HOST_AUTH(host));
  giveTicket(h.room, alice.playerId, TICKET_A);
  callSpecific(h.room, [3, 11, 24, 31, 50]);
  h.room.claim({ playerId: alice.playerId, playerToken: alice.playerToken, pattern: "topLine" });
  assert.equal(h.room.players.get(alice.playerId).points, 10);

  h.room.end(HOST_AUTH(host));
  h.room.reset(HOST_AUTH(host));
  assert.deepEqual(h.room.calledNumbers, []);
  assert.equal(h.room.cursor, 0);
  assert.deepEqual(h.room.draw, []);
  assert.equal(h.room.awards.size, 0);
  assert.deepEqual(h.room.claimLog, []);
  for (const player of h.room.players.values()) {
    assert.equal(player.points, 0);
    assert.deepEqual(player.tickets, []);
    assert.deepEqual(player.claims, []);
  }
  assert.equal(h.room.players.size, 2, "same roster");
  assert.equal(h.room.players.get(alice.playerId).name, "Alice");

  // and the room is playable again
  const again = h.room.start(HOST_AUTH(host));
  assert.equal(again.ok, true);
  assert.equal(again.ticketsIssued, 2);
  for (const player of h.room.players.values()) {
    assert.deepEqual(validateTicket(player.tickets[0].grid).errors, [], "fresh legal ticket");
  }
});

test("repeated submissions cannot corrupt state", () => {
  const h = makeRoom();
  const host = h.host();
  const alice = h.player("Alice", "sock-a");
  h.room.start(HOST_AUTH(host));
  const first = h.room.callNext(HOST_AUTH(host));
  const historyAfterOne = h.room.calledNumbers.slice();
  h.room.pause(HOST_AUTH(host));
  for (let i = 0; i < 20; i++) {
    const denied = h.room.callNext(HOST_AUTH(host));
    assert.equal(denied.ok, false);
  }
  assert.deepEqual(h.room.calledNumbers, historyAfterOne, "nothing extra was drawn");
  assert.equal(first.ok, true);

  // repeated join from the same socket is idempotent
  const also = h.room.join({ name: "Alice", socketId: "sock-a" });
  assert.equal(also.ok, true);
  assert.equal(also.resumed, true);
  assert.equal(also.playerId, alice.playerId);
  assert.equal(h.room.players.size, 2);

  // repeated end is stable and only announced once
  h.room.resumeGame(HOST_AUTH(host));
  assert.equal(h.room.end(HOST_AUTH(host)).ok, true);
  const again = h.room.end(HOST_AUTH(host));
  assert.equal(again.ok, true, "already-completed is reported as success, not an error");
  assert.equal(h.room.state, GameState.COMPLETED);
  assert.equal(h.eventsNamed("game:completed").length, 1, "clients were told once");

  // a finished room refuses newcomers until the host resets it
  const late = h.room.join({ name: "Charlie", socketId: "sock-c" });
  assert.equal(late.ok, false);
  assert.equal(late.code, ErrorCodes.ROOM_CLOSED);
  assert.equal(h.room.players.size, 2);
});

// ------------------------------------------------------------- host authority

test("privileged actions need the host, and only the host", () => {
  const h = makeRoom();
  h.host();
  const intruder = h.player("Intruder", "sock-x");
  const privileged = ["start", "callNext", "pause", "resumeGame", "end", "reset", "setAutoCall"];
  for (const method of privileged) {
    const result = h.room[method]({ socketId: intruder.socketId });
    assert.equal(result.ok, false, method + " must not be doable by a player");
    assert.equal(result.code, ErrorCodes.NOT_HOST, method);
  }
  assert.equal(h.room.start({}).code, ErrorCodes.NOT_HOST, "no credentials at all");
  assert.equal(h.room.callNext({ socketId: "ghost-socket" }).code, ErrorCodes.NOT_HOST);
  assert.equal(h.room.state, GameState.WAITING, "the game never started for them");
  assert.equal(h.room.draw.length, 0);
});

test("the host token works from a fresh socket, a wrong token does not", () => {
  const h = makeRoom();
  const host = h.host();
  const token = h.room.hostToken;
  // simulate a refresh: the host reconnects on a new socket
  h.room.detach(host.socketId);
  const resumed = h.room.resume({ hostToken: token, socketId: "sock-new" });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.role, "host");
  assert.equal(h.room.hostSocketId, "sock-new");
  assert.equal(h.room.start({ socketId: "sock-new" }).ok, true);

  for (const bad of [token.slice(0, -1), token.toUpperCase(), "00".repeat(24), token + "ab", "", 42, {}, null]) {
    const denied = h.room.callNext({ socketId: "sock-impostor", hostToken: bad });
    assert.equal(denied.ok, false, "rejected credential " + JSON.stringify(bad));
    assert.equal(denied.code, ErrorCodes.NOT_HOST);
  }
});

test("a player credential cannot resume as the host", () => {
  const h = makeRoom();
  h.host();
  const alice = h.player("Alice", "sock-a");
  h.room.start({ socketId: "sock-host" });
  const denied = h.room.resume({ playerId: alice.playerId, playerToken: "a".repeat(32), socketId: "sock-a2" });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, ErrorCodes.UNKNOWN_PLAYER);
  assert.equal(h.room.players.get(alice.playerId).socketId, "sock-a", "her session was not hijacked");
  assert.equal(h.room.hostPlayerId, h.room.playersList().find((p) => p.isHost).id);

  const allowed = h.room.resume({ playerId: alice.playerId, playerToken: alice.playerToken, socketId: "sock-a2" });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.role, undefined, "she comes back as a player, not the host");
  assert.equal(h.room.players.get(alice.playerId).socketId, "sock-a2");
});

test("host authority survives a socket change but not a player removal", () => {
  const h = makeRoom({ config: { disconnectGraceMs: 1000 } });
  const host = h.host();
  h.room.start(HOST_AUTH(host));
  h.room.detach(host.socketId);
  assert.equal(h.room.hostSocketId, null);
  assert.equal(h.room.callNext({ socketId: host.socketId }).code, ErrorCodes.NOT_HOST, "stale socket has no power");
  const changed = h.eventsNamed("host:changed");
  assert.equal(changed.length, 1);
  assert.equal(changed[0].payload.hostConnected, false);
  assert.equal(h.room.players.size, 1, "the room survives the blip");
  assert.equal(h.room.callNext({ hostToken: h.room.hostToken }).ok, true, "the token still drives the game");

  h.advance(1500); // grace expires, the host PARTICIPANT is removed
  assert.equal(h.room.players.size, 0);
  assert.equal(h.timers.size, 0, "no timer left dangling");
});

test("isHostSocket is the transport's only host gate", () => {
  const h = makeRoom();
  const host = h.host();
  const alice = h.player("Alice", "sock-a");
  assert.equal(h.room.isHostSocket(host.socketId), true);
  assert.equal(h.room.isHostSocket(alice.socketId), false);
  assert.equal(h.room.isHostSocket("sock-ghost"), false);
  assert.equal(h.room.isHostSocket(undefined), false);
  assert.equal(h.room.isHostSocket(""), false);
  assert.equal(h.room.isHostSocket(null), false);
  h.room.detach(host.socketId);
  assert.equal(h.room.isHostSocket(host.socketId), false, "a dropped host socket loses privilege");
});

test("the engine ignores every field a client invents about itself", () => {
  const h = makeRoom();
  const host = h.host();
  const sneaky = h.room.join({
    name: "Sneaky",
    socketId: "sock-s",
    points: 99999,
    isAdmin: true,
    isHost: true,
    ticket: TICKET_A,
    claims: ["fullHouse"],
  });
  assert.equal(sneaky.ok, true);
  const player = h.room.players.get(sneaky.playerId);
  assert.equal(player.points, 0);
  assert.deepEqual(player.tickets, []);
  assert.deepEqual(player.claims, []);
  assert.equal(player.isAdmin, undefined);
  assert.equal(h.room.hostPlayerId, host.playerId, "the host is still the host");
  h.room.start(HOST_AUTH(host));
  assert.equal(h.room.players.get(sneaky.playerId).points, 0, "start does not honour claimed points");
  assert.notDeepEqual(h.room.players.get(sneaky.playerId).tickets[0].grid, TICKET_A, "the server issues the ticket");
});

test("a fabricated claim cannot award unearned points", () => {
  const h = makeRoom();
  const host = h.host();
  const alice = h.player("Alice", "sock-a");
  h.room.start(HOST_AUTH(host));
  giveTicket(h.room, alice.playerId, TICKET_A);
  callSpecific(h.room, [3]);
  const fake = h.room.claim({
    playerId: alice.playerId,
    playerToken: alice.playerToken,
    pattern: "fullHouse",
    won: true,
    points: 100000,
    leaderboard: [{ player: "Alice", points: 100000 }],
  });
  assert.equal(fake.ok, false);
  assert.equal(h.room.players.get(alice.playerId).points, 0);
  assert.equal(h.room.awards.size, 0);
  assert.equal(fake.leaderboard, undefined, "a refusal does not pretend to be a result");
  assert.equal(h.room.leaderboard()[0].points, 0, "the real board is unaffected");
});

// -------------------------------------------------------------------- tickets

test("tickets are assigned privately, one socket each", () => {
  const h = makeRoom();
  const host = h.host();
  const players = [h.player("Alice", "sock-a"), h.player("Bob", "sock-b"), h.player("Carol", "sock-c")];
  h.room.start(HOST_AUTH(host));
  assert.equal(h.direct.length, 4, "one private ticket push per participant, host included");
  const targets = h.direct.map((entry) => entry.socketId).sort();
  assert.deepEqual(targets, ["sock-a", "sock-b", "sock-c", "sock-host"]);
  for (const entry of h.direct) {
    assert.equal(entry.event, "ticket:assigned");
    assert.deepEqual(validateTicket(entry.payload.ticket).errors, []);
  }
  for (const p of players) {
    assert.deepEqual(validateTicket(h.room.players.get(p.playerId).tickets[0].grid).errors, []);
  }
  // no room-wide broadcast ever carried a ticket
  for (const event of h.events) {
    assert.equal(JSON.stringify(event.payload).includes('"ticket"'), false, event.event + " leaked a ticket");
  }
});

test("a player snapshot only ever contains the requester's own ticket", () => {
  const h = makeRoom();
  const host = h.host();
  const alice = h.player("Alice", "sock-a");
  const bob = h.player("Bob", "sock-b");
  h.room.start(HOST_AUTH(host));
  const aliceView = h.room.playerSnapshot(alice.playerId);
  assert.deepEqual(aliceView.ticket, h.room.players.get(alice.playerId).tickets[0].grid);
  const bobView = h.room.playerSnapshot(bob.playerId);
  assert.notDeepEqual(bobView.ticket, aliceView.ticket, "two different tickets");
  const publicView = h.room.publicSnapshot();
  assert.equal(publicView.ticket, undefined, "the broadcast view carries no ticket at all");
  for (const entry of publicView.players) {
    assert.equal(entry.ticket, undefined, "the roster never ships a ticket");
    assert.equal(entry.grid, undefined, "nor a grid under any other name");
    assert.equal(typeof entry.tickets, "number", "only the count a seat holds");
    assert.equal(Object.keys(entry).sort().join(","), "connected,id,isHost,name,points,tickets");
  }
});

test("no snapshot reveals the future draw", () => {
  const h = makeRoom();
  const host = h.host();
  const alice = h.player("Alice", "sock-a");
  h.room.start(HOST_AUTH(host));
  callThrough(h.room, host.socketId, 12);
  const future = h.room.draw.slice(12);
  const forbiddenKeys = ["draw", "shuffle", "tail", "rng", "rngState", "futureNumbers", "undrawn", "deck"];

  const views = {
    public: h.room.publicSnapshot(),
    player: h.room.playerSnapshot(alice.playerId),
    host: h.room.hostSnapshot(),
    state: h.room.stateView(),
    startResult: h.room.start({ hostToken: h.room.hostToken }),
    claimResult: h.room.claim({ playerId: alice.playerId, playerToken: alice.playerToken, pattern: "topLine" }),
  };
  for (const [label, view] of Object.entries(views)) {
    if (!view) continue;
    const keys = new Set();
    walk(view, keys, []);
    for (const key of forbiddenKeys) {
      assert.equal(keys.has(key), false, `${label} must not expose a "${key}" field`);
    }
    const json = JSON.stringify(view);
    assert.equal(json.includes(JSON.stringify(future.slice(0, 6))), false, `${label} contains the next six calls`);
    assert.equal(json.includes(JSON.stringify(h.room.draw)), false, `${label} leaked the whole shuffle`);
  }

  // what IS exposed: exactly the called prefix plus a count
  const snap = h.room.publicSnapshot();
  assert.equal(snap.calledNumbers.length, 12);
  assert.equal(snap.remaining, 78);
  assert.equal(snap.state, GameState.RUNNING);
  assert.deepEqual(Object.keys(h.room.stateView()).sort(), [
    "autoCall",
    "callIntervalMs",
    "calledCount",
    "enabledPatterns",
    "lastCall",
    "remaining",
    "roomId",
    "state",
  ]);
});

test("the audit trail is host-only and bounded", () => {
  const h = makeRoom();
  const host = h.host();
  h.room.start(HOST_AUTH(host));
  callThrough(h.room, host.socketId, 3);
  const playerView = h.room.playerSnapshot(host.playerId);
  const hostView = h.room.hostSnapshot();
  assert.equal(playerView.recentEvents, undefined, "a player does not get the log");
  assert.equal(playerView.claimLog, undefined);
  assert.ok(hostView.recentEvents.length > 0);
  assert.ok(hostView.claimLog);
  assert.equal(hostView.hostConnected, true);
  for (let i = 0; i < 700; i++) h.room.record({ type: "noise", i });
  assert.ok(h.room.audit.length <= 500, "the log is bounded, got " + h.room.audit.length);
});

// ---------------------------------------------------------------- auto-call

test("the server timer drives the draw at the configured interval", () => {
  const h = makeRoom({ config: { autoCall: true, callIntervalMs: 1000 } });
  const host = h.host();
  h.room.start(HOST_AUTH(host));
  assert.equal(h.timers.size, 1, "one scheduled call");
  assert.equal(h.room.cursor, 0, "the first tick has not happened yet");

  h.advance(1000);
  assert.equal(h.room.cursor, 1);
  h.advance(3000);
  assert.equal(h.room.cursor, 4);
  assert.deepEqual(h.room.calledNumbers, h.room.draw.slice(0, 4));
});

test("pause stops the scheduler, resume restarts it", () => {
  const h = makeRoom({ config: { autoCall: true, callIntervalMs: 1000 } });
  const host = h.host();
  h.room.start(HOST_AUTH(host));
  h.advance(2500);
  assert.equal(h.room.cursor, 2);

  h.room.pause(HOST_AUTH(host));
  assert.equal(h.timers.size, 0, "the timer was cancelled, not just ignored");
  const frozen = h.room.calledNumbers.slice();
  h.advance(30000);
  assert.deepEqual(h.room.calledNumbers, frozen, "nothing was drawn while paused");

  h.room.resumeGame(HOST_AUTH(host));
  assert.equal(h.timers.size, 1);
  h.advance(1000);
  assert.equal(h.room.cursor, 3);
});

test("auto-call can be switched at runtime and its interval validated", () => {
  const h = makeRoom({ config: { autoCall: false, callIntervalMs: 1000 } });
  const host = h.host();
  h.room.start(HOST_AUTH(host));
  h.advance(10000);
  assert.equal(h.room.cursor, 0, "manual mode stays quiet");

  assert.equal(h.room.setAutoCall({ enabled: true, socketId: host.socketId }).ok, true);
  assert.equal(h.timers.size, 1);
  h.advance(1000);
  assert.equal(h.room.cursor, 1);

  assert.equal(h.room.setAutoCall({ enabled: false, socketId: host.socketId }).ok, true);
  assert.equal(h.timers.size, 0);
  const before = h.room.cursor;
  h.advance(10000);
  assert.equal(h.room.cursor, before);

  const retuned = h.room.setAutoCall({ enabled: true, intervalMs: 500, socketId: host.socketId });
  assert.equal(retuned.ok, true);
  assert.equal(retuned.callIntervalMs, 500);
  h.advance(500);
  assert.equal(h.room.cursor, before + 1);

  for (const bad of [100, 499, 120001, 1000.5, "1000", null]) {
    const rejected = h.room.setAutoCall({ intervalMs: bad, socketId: host.socketId });
    assert.equal(rejected.ok, false, "interval " + JSON.stringify(bad) + " refused");
    assert.equal(rejected.code, ErrorCodes.BAD_PAYLOAD);
  }
  assert.equal(h.room.setAutoCall({ intervalMs: undefined, socketId: host.socketId }).ok, true);
  assert.equal(h.room.setAutoCall({ enabled: "yes", socketId: host.socketId }).ok, true, "junk flags ignored");
});

test("the scheduler stops itself when the draw runs out", () => {
  const h = makeRoom({ config: { autoCall: true, callIntervalMs: 500 } });
  const host = h.host();
  h.room.start(HOST_AUTH(host));
  h.advance(500 * 90);
  assert.equal(h.room.cursor, 90);
  assert.equal(h.room.state, GameState.COMPLETED);
  assert.equal(h.timers.size, 0, "no orphan timer after the last number");
  assert.equal(h.eventsNamed("game:completed").length, 1);
  assert.equal(h.eventsNamed("number:called").length, 90);
  h.advance(5000);
  assert.equal(h.room.cursor, 90, "and it never advances past 90");
});

test("ending or resetting cancels any pending call", () => {
  const h = makeRoom({ config: { autoCall: true, callIntervalMs: 1000 } });
  const host = h.host();
  h.room.start(HOST_AUTH(host));
  h.room.end(HOST_AUTH(host));
  assert.equal(h.timers.size, 0);
  const drawn = h.room.cursor;
  h.advance(10000);
  assert.equal(h.room.cursor, drawn);

  h.room.reset(HOST_AUTH(host));
  h.room.start(HOST_AUTH(host));
  h.room.destroy();
  assert.equal(h.timers.size, 0, "destroy clears the scheduler and the grace timers");
  h.room.destroy();
});

test("an absurd configured interval disables the scheduler instead of spinning", () => {
  const h = makeRoom({ config: { autoCall: true, callIntervalMs: 1 } });
  const host = h.host();
  h.room.start(HOST_AUTH(host));
  assert.equal(h.timers.size, 0, "below the 500ms floor nothing is scheduled");
  h.advance(60000);
  assert.equal(h.room.cursor, 0);
});

// --------------------------------------------------------------------- chat

test("chat is attributed by the server and rate limited per player", () => {
  const h = makeRoom({ config: { chatIntervalMs: 1000 } });
  h.host();
  const alice = h.player("Alice", "sock-a");
  const bob = h.player("Bob", "sock-b");

  const first = h.room.chat({ playerId: alice.playerId, playerToken: alice.playerToken, text: "hello there" });
  assert.equal(first.ok, true);
  const pushed = h.lastEvent("chat:message");
  assert.equal(pushed.from, "Alice");
  assert.equal(pushed.playerId, alice.playerId);
  assert.equal(pushed.text, "hello there");

  const spam = h.room.chat({ playerId: alice.playerId, playerToken: alice.playerToken, text: "again" });
  assert.equal(spam.ok, false);
  assert.equal(spam.code, ErrorCodes.RATE_LIMITED);
  assert.equal(h.eventsNamed("chat:message").length, 1, "the spam never reached the room");

  // a different player is not punished for Alice's flood
  assert.equal(h.room.chat({ playerId: bob.playerId, playerToken: bob.playerToken, text: "hi" }).ok, true);
  assert.equal(h.eventsNamed("chat:message").length, 2);

  h.advance(1200);
  assert.equal(h.room.chat({ playerId: alice.playerId, playerToken: alice.playerToken, text: "again" }).ok, true);

  assert.equal(h.room.chat({ playerId: alice.playerId, text: "no credential" }).ok, false, "credential checked first");
  assert.equal(h.room.chat({ playerId: "cafe1234", text: "hi" }).code, ErrorCodes.NOT_PLAYER);
  assert.equal(h.room.chat({ playerId: alice.playerId, text: "   " }).code, ErrorCodes.BAD_PAYLOAD);
  assert.equal(h.room.chat({ playerId: alice.playerId, text: 42 }).code, ErrorCodes.BAD_PAYLOAD);
});

test("chat text is stripped of control characters and capped", () => {
  const h = makeRoom({ config: { chatIntervalMs: 0, maxChatLength: 20 } });
  h.host();
  const alice = h.player("Alice", "sock-a");
  const result = h.room.chat({ playerId: alice.playerId, text: "hi\u0000\u001b[2J\u0007 there" });
  assert.equal(result.ok, true);
  assert.equal(result.text, "hi[2J there", "escape sequences are gone");
  assert.equal(h.lastEvent("chat:message").text, "hi[2J there");

  const long = h.room.chat({ playerId: alice.playerId, text: "x".repeat(500) });
  assert.equal(long.ok, true);
  assert.equal(long.text.length, 20, "capped at maxChatLength");
});

// -------------------------------------------------------------------- misc

test("the default config is a frozen template, rooms get copies", () => {
  assert.equal(Object.isFrozen(DEFAULT_CONFIG), true);
  const h = makeRoom();
  h.room.config.callIntervalMs = 1234;
  assert.equal(DEFAULT_CONFIG.callIntervalMs, 8000, "the shared default was not mutated");
  assert.equal(h.room.config.maxPlayers, DEFAULT_CONFIG.maxPlayers);
  const other = makeRoom({ roomId: "OTHERROOM" });
  assert.equal(other.room.config.callIntervalMs, 8000, "another room is unaffected");
});

test("the state view advertises only the enabled patterns", () => {
  const h = makeRoom({ config: { patterns: { corners: false } } });
  const enabled = h.room.stateView().enabledPatterns;
  assert.equal(enabled.includes("corners"), false);
  assert.equal(enabled.includes("fullHouse"), true);
  assert.deepEqual(enabled.slice().sort(), Object.keys(PATTERNS).filter((id) => id !== "corners").sort());
});

test("claimability is a read-only preview of the real verdict", () => {
  const h = makeRoom();
  const host = h.host();
  const alice = h.player("Alice", "sock-a");
  h.room.start(HOST_AUTH(host));
  giveTicket(h.room, alice.playerId, TICKET_A);
  callSpecific(h.room, [3, 11, 24, 31]);
  const preview = h.room.claimability(alice.playerId, "topLine");
  assert.equal(preview.valid, false);
  callSpecific(h.room, [50]);
  assert.equal(h.room.claimability(alice.playerId, "topLine").valid, true);
  // the preview must not have awarded anything
  assert.equal(h.room.awards.size, 0);
  assert.equal(h.room.players.get(alice.playerId).points, 0);
  assert.equal(h.room.claimability("deadbeef", "topLine").valid, false);
});

test("unknown ids and stray sockets are handled quietly", () => {
  const h = makeRoom();
  const host = h.host();
  assert.equal(h.room.players.get("nope"), undefined);
  assert.equal(h.room.playersList().length, 1);
  assert.equal(h.room.leave({ playerId: "nope", playerToken: "a".repeat(32) }).ok, false);
  assert.equal(h.room.dropPlayer("nope", "test"), false);
  assert.equal(h.room.detach("never-joined"), null, "a socket with no session detaches quietly");
  assert.equal(h.room.resume({ playerId: "nope", playerToken: "a".repeat(32), socketId: "sock-x" }).ok, false);
  assert.equal(h.room.setHost({ socketId: host.socketId, playerId: "nope" }).code, ErrorCodes.UNKNOWN_PLAYER);
  assert.equal(h.room.playersList().length, 1, "nothing was mutated by the probes");
});
