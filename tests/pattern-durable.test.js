/**
 * The five optional patterns on the durable path.
 *
 * The in-memory suites prove what a rule MEANS. These prove the same answers
 * after the process that computed them is gone: the opt-in lives in the room's
 * config row, the award lives in the awards row with the ticket and ordinal that
 * make it re-judgable, a refusal lives in claims and audit, and two servers
 * sharing one database still produce exactly one winner.
 */

import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { ticketNumbers } from "../server/game/ticket.js";
import { EXAMPLE_TICKET } from "../server/game/pattern-geometry.js";
import { ErrorCodes, GameState } from "../server/game/engine.js";
import { HAS_DB, NEEDS_DB, giveTickets, openDurableSchema, winners } from "./pattern-harness.js";
import { TICKET_A, TICKET_B, TICKET_STAR } from "./helpers.js";

const A15 = ticketNumbers(TICKET_A);
const B15 = ticketNumbers(TICKET_B);
/** Star on the published example ticket: four corners plus the middle row's third number. */
const STAR_EXAMPLE = [4, 85, 9, 90, 56];
/** Box on the published example ticket: everything it holds in the 30s, 40s and 50s columns. */
const BOX_EXAMPLE = [34, 38, 41, 56, 59];
/** The two seats' own Star numbers, called together so both complete on the same call. */
const STAR_A = [3, 50, 36, 85, 28];
const STAR_B = [5, 50, 36, 85, 28];

const FIVE = { star: true, box: true, earlySeven: true, secondFullHouse: true, halfSheet: true };

let env = null;

before(async () => {
  if (!HAS_DB) return;
  env = await openDurableSchema({ prefix: "five" });
});

after(async () => {
  if (env) await env.close();
});

/** Host + seats, opted in through the controller, started with exact grids. */
async function round({ patterns = FIVE, seats = [], overrides = {}, draw = null, hostSocket = "s-host" } = {}) {
  const proc = env.newProcess();
  const created = await proc.controller.createRoom({ name: "Hostess", socketId: hostSocket, overrides });
  assert.equal(created.ok, true, JSON.stringify(created));
  const room = proc.registry.get(created.roomId);
  if (patterns) {
    const opted = await proc.controller.setPatterns({ room, socketId: hostSocket, patterns });
    assert.equal(opted.ok, true, JSON.stringify(opted));
  }
  const players = [];
  for (const [index, seat] of seats.entries()) {
    const joined = await proc.controller.joinRoom({
      roomId: created.roomId,
      name: seat.name || "Seat" + (index + 1),
      socketId: "s-seat" + index,
    });
    assert.equal(joined.ok, true, JSON.stringify(joined));
    giveTickets(room, joined.playerId, seat.grids);
    players.push({ ...joined, socketId: "s-seat" + index });
  }
  const started = await proc.controller.start({ room, socketId: hostSocket });
  assert.equal(started.ok, true, JSON.stringify(started));
  if (draw) await env.setDraw({ room, sequence: draw });
  return { ...proc, controller: proc.controller, room, roomId: created.roomId, hostSocket, hostToken: created.sessionToken, players };
}

/** Call exactly these numbers through the host's own call path, and check the database served them. */
async function call(r, numbers) {
  const seen = [];
  for (const expected of numbers) {
    const result = await r.controller.callNext({ room: r.room, socketId: r.hostSocket, source: "host" });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.number, expected, "the stored draw plan decides what gets called");
    seen.push(result.number);
  }
  return seen;
}

async function claim(r, player, pattern, extra = {}) {
  return r.controller.claim({ room: r.room, playerId: player.playerId, pattern, socketId: player.socketId, ...extra });
}

/** Cold-start the same room in a new process, the way a reconnect does it. */
async function restart(r, socketId = "s-host-next") {
  const proc = env.newProcess();
  assert.equal(proc.registry.get(r.roomId), null, "this process held nothing before");
  const resumed = await proc.controller.resume({ roomId: r.roomId, sessionToken: r.hostToken, socketId });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  // the returned object is a round: a test can keep calling and claiming through
  // the rebuilt process exactly as it did through the original one
  return {
    controller: proc.controller,
    room: proc.registry.get(r.roomId),
    roomId: r.roomId,
    hostSocket: socketId,
    hostToken: r.hostToken,
    players: r.players,
  };
}

describe("the optional patterns survive a restart (PostgreSQL)", { skip: HAS_DB ? false : NEEDS_DB }, () => {
  test("a host's opt-in is stored, and a rebuilt room offers the same five prizes", async () => {
    const r = await round({ seats: [{ name: "Asha", grids: [EXAMPLE_TICKET] }], draw: STAR_EXAMPLE });
    const started = r.room.stateView();
    for (const id of Object.keys(FIVE)) assert.equal(started.enabledPatterns.includes(id), true, id + " is on");
    assert.equal(started.enabledPatterns.includes("corners"), true, "and the approved rules were never touched");

    const fresh = await restart(r);
    const rebuilt = fresh.room.stateView();
    assert.deepEqual(rebuilt.enabledPatterns, started.enabledPatterns, "the same set, from the row, not from memory");
    const views = fresh.room.publicSnapshot().patternViews.map((view) => view.id);
    for (const id of Object.keys(FIVE)) assert.equal(views.includes(id), true, id + " is still displayed");
    // the diagram the rebuilt server publishes is byte-identical to the one it
    // started with, so a player before and after the restart sees the same rule
    const beforeView = r.room.publicSnapshot().patternViews.find((v) => v.id === "star");
    const afterView = fresh.room.publicSnapshot().patternViews.find((v) => v.id === "star");
    assert.deepEqual(afterView, beforeView);
  });

  test("a room that never opted in stays closed to these claims after a restart", async () => {
    const r = await round({ patterns: null, seats: [{ name: "Asha", grids: [EXAMPLE_TICKET] }], draw: STAR_EXAMPLE });
    await call(r, STAR_EXAMPLE);
    assert.equal((await claim(r, r.players[0], "star")).code, ErrorCodes.UNKNOWN_PATTERN);

    const fresh = await restart(r);
    const cold = await fresh.controller.claim({ room: fresh.room, playerId: r.players[0].playerId, pattern: "star" });
    assert.equal(cold.code, ErrorCodes.UNKNOWN_PATTERN, "the rebuilt room did not acquire a prize nobody approved");
    assert.deepEqual((await env.awardRows({ roomId: r.roomId })).length, 0);
  });

  test("a paid Star is one award row with the ticket that won it, and it survives the restart", async () => {
    const r = await round({ seats: [{ name: "Asha", grids: [EXAMPLE_TICKET] }], draw: STAR_EXAMPLE });
    await call(r, STAR_EXAMPLE);
    const paid = await claim(r, r.players[0], "star");
    assert.equal(paid.ok, true, JSON.stringify(paid));
    assert.equal(paid.points, 25);
    assert.equal(paid.ticketNo, 1);

    const rows = await env.awardRows({ roomId: r.roomId });
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], {
      player_id: r.players[0].playerId,
      pattern: "star",
      points: 25,
      call_index: 5,
      winner_ordinal: 1,
      ticket_no: 1,
      ticket_nos: null,
    });

    const again = await claim(r, r.players[0], "star");
    assert.equal(again.code, ErrorCodes.ALREADY_CLAIMED_BY_YOU);
    assert.deepEqual((await env.awardRows({ roomId: r.roomId })).length, 1, "a repeat claim writes nothing");

    const fresh = await restart(r);
    assert.deepEqual(winners(fresh.room, "star"), winners(r.room, "star"), "ticket and ordinal came back from the row");
    const afterRestart = await fresh.controller.claim({ room: fresh.room, playerId: r.players[0].playerId, pattern: "star" });
    assert.equal(afterRestart.code, ErrorCodes.ALREADY_CLAIMED_BY_YOU, "and the rebuilt room remembers who won");
  });

  test("a Star that is one corner short is refused, and the refusal is kept", async () => {
    const r = await round({ seats: [{ name: "Asha", grids: [EXAMPLE_TICKET] }], draw: [4, 85, 9, 56] });
    await call(r, [4, 85, 9, 56]);
    const refused = await claim(r, r.players[0], "star");
    assert.equal(refused.ok, false);
    assert.equal(refused.code, ErrorCodes.INVALID_STATE);
    assert.deepEqual(refused.missing, [90], "and it says which of the player's own numbers is short");
    assert.deepEqual((await env.awardRows({ roomId: r.roomId })).length, 0, "no points were paid");

    const rejected = await env.claimRows({ roomId: r.roomId, status: "REJECTED" });
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].pattern, "star");
    assert.equal(rejected[0].call_index, 4);
    const audit = await env.auditRows({ roomId: r.roomId, type: "claim-rejected" });
    assert.equal(audit.some((detail) => detail.pattern === "star"), true, "the audit trail holds the attempt");
  });

  test("Box and Star are separate rows and one seat can be paid for both", async () => {
    const draw = [4, 85, 9, 90, 56, 34, 38, 41, 59];
    const r = await round({ seats: [{ name: "Asha", grids: [EXAMPLE_TICKET] }], draw });
    await call(r, STAR_EXAMPLE);
    assert.equal((await claim(r, r.players[0], "star")).ok, true);
    await call(r, [34, 38, 41, 59]);
    const box = await claim(r, r.players[0], "box");
    assert.equal(box.ok, true, JSON.stringify(box));
    assert.equal(box.points, 25);
    assert.equal(box.ticketNo, 1);

    const rows = await env.awardRows({ roomId: r.roomId });
    assert.deepEqual(
      rows.map((row) => [row.pattern, row.winner_ordinal, row.ticket_no, row.call_index]),
      [
        ["star", 1, 1, 5],
        ["box", 1, 1, 9],
      ],
      "two prizes, two rows, each pinned to the call that landed it"
    );
    const fresh = await restart(r);
    assert.equal(fresh.room.players.get(r.players[0].playerId).points, 50, "the seat's total rebuilds to 25 + 25");
  });

  test("Early 7: six is refused, seven pays, and an eighth cannot duplicate it", async () => {
    const six = A15.slice(0, 6);
    const r = await round({ seats: [{ name: "Asha", grids: [TICKET_A] }], draw: [...six, A15[6], 74] });
    await call(r, six);
    const short = await claim(r, r.players[0], "earlySeven");
    assert.equal(short.ok, false);
    assert.equal(short.code, ErrorCodes.INVALID_STATE);
    assert.equal(short.needed, 1, "the refusal says how many more marks the seat needs");
    assert.deepEqual((await env.awardRows({ roomId: r.roomId })).length, 0);

    await call(r, [A15[6]]);
    const paid = await claim(r, r.players[0], "earlySeven");
    assert.equal(paid.ok, true, JSON.stringify(paid));
    assert.equal(paid.points, 25);
    assert.equal(paid.ticketNo, 1);

    // the ticket is now eight numbers in. The award is already paid, so a later
    // claim cannot create a second one, and the row keeps its seventh-call date
    await call(r, [74]);
    const after = await claim(r, r.players[0], "earlySeven");
    assert.equal(after.code, ErrorCodes.ALREADY_CLAIMED_BY_YOU);
    const rows = await env.awardRows({ roomId: r.roomId });
    assert.equal(rows.length, 1, "eight called numbers never make two awards");
    assert.equal(rows[0].call_index, 7, "and the record still names the seventh call, not the moment it was claimed");

    const fresh = await restart(r);
    assert.equal(winners(fresh.room, "earlySeven")[0].callIndex, 7);
    assert.equal(winners(fresh.room, "earlySeven")[0].winnerOrdinal, 1);
  });

  test("Second Full House keeps its exclusion after the process that paid the first one is gone", async () => {
    const draw = [...A15, ...B15];
    const r = await round({
      seats: [
        { name: "Asha", grids: [TICKET_A] },
        { name: "Ravi", grids: [TICKET_B] },
      ],
      draw,
    });
    await call(r, A15);
    const first = await claim(r, r.players[0], "fullHouse");
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(first.points, 30, "first place pays its own 30");
    assert.equal(r.room.state, GameState.RUNNING, "the round does not end at the first Full House while second place is live");
    assert.deepEqual((await env.awardRows({ roomId: r.roomId })).map((row) => [row.pattern, row.winner_ordinal, row.ticket_no]), [
      ["fullHouse", 1, 1],
    ]);

    // Asha's one ticket is the ticket that took first place. Cold process, same
    // database: the exclusion can only still work because ticket_no was stored.
    const fresh = await restart(r);
    const ashaAgain = await fresh.controller.claim({
      room: fresh.room,
      playerId: r.players[0].playerId,
      pattern: "secondFullHouse",
    });
    assert.equal(ashaAgain.ok, false, "the winning ticket is still spent in the rebuilt room");
    assert.equal(ashaAgain.reason, "your ticket 1 already won the first Full House, so it cannot win the second");
    assert.deepEqual((await env.awardRows({ roomId: r.roomId })).filter((row) => row.pattern === "secondFullHouse"), [], "and nothing was paid for it");

    // second place is still open, and the other seat's own ticket 1 is not the
    // excluded one - the exclusion is per ticket of the seat that won
    await call(fresh, B15);
    const coldWinner = await claim(fresh, fresh.players[1], "secondFullHouse");
    assert.equal(coldWinner.ok, true, JSON.stringify(coldWinner));
    assert.equal(coldWinner.points, 15);
    assert.equal(coldWinner.ticketNo, 1, "Ravi's own ticket 1, which is not Asha's ticket 1");
    assert.deepEqual(
      (await env.awardRows({ roomId: r.roomId })).map((row) => [row.pattern, row.player_id, row.winner_ordinal, row.ticket_no, row.points]),
      [
        ["fullHouse", r.players[0].playerId, 1, 1, 30],
        ["secondFullHouse", r.players[1].playerId, 1, 1, 15],
      ],
      "two awards, two seats, in the order they landed"
    );
    assert.deepEqual(winners(fresh.room, "secondFullHouse")[0], {
      playerId: r.players[1].playerId,
      name: "Ravi",
      ticketNo: 1,
      ticketNos: null,
      winnerOrdinal: 1,
      points: 15,
      callIndex: 30,
    });
    // and the same seat is not paid twice for second place in the cold process
    const repeat = await claim(fresh, fresh.players[1], "secondFullHouse");
    assert.equal(repeat.code, ErrorCodes.ALREADY_CLAIMED_BY_YOU);
    assert.equal((await env.awardRows({ roomId: r.roomId })).filter((row) => row.pattern === "secondFullHouse").length, 1);
  });

  test("a seat may take first on one ticket and second on another, durably", async () => {
    const draw = [...A15, ...B15];
    const r = await round({ seats: [{ name: "Asha", grids: [TICKET_A, TICKET_B] }], draw });
    await call(r, A15);
    assert.equal((await claim(r, r.players[0], "fullHouse")).ticketNo, 1);
    await call(r, B15);
    const pointing = await claim(r, r.players[0], "secondFullHouse", { ticketNo: 1 });
    assert.equal(pointing.ok, false, "the claim cannot point at the ticket that already won");
    const second = await claim(r, r.players[0], "secondFullHouse");
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.equal(second.ticketNo, 2);

    const rows = await env.awardRows({ roomId: r.roomId });
    assert.deepEqual(
      rows.map((row) => [row.pattern, row.ticket_no, row.points]),
      [
        ["fullHouse", 1, 30],
        ["secondFullHouse", 2, 15],
      ]
    );
    const fresh = await restart(r);
    assert.equal(fresh.room.players.get(r.players[0].playerId).points, 45, "30 + 15, never 30 + 30");
  });

  test("an unclaimed Second Full House never keeps a finished round open", async () => {
    const r = await round({ seats: [{ name: "Asha", grids: [TICKET_A] }], draw: A15 });
    await call(r, A15);
    assert.equal((await claim(r, r.players[0], "fullHouse")).ok, true);
    // nobody else is close to a full house and second place was never claimed
    const ended = await r.controller.transition({ room: r.room, socketId: r.hostSocket, action: "end" });
    assert.equal(ended.ok, true, JSON.stringify(ended));

    const fresh = await restart(r);
    assert.equal(fresh.room.state, GameState.COMPLETED, "an optional prize that went unclaimed does not re-open the round");
    const late = await fresh.controller.claim({ room: fresh.room, playerId: r.players[0].playerId, pattern: "secondFullHouse" });
    assert.equal(late.ok, false, "and it takes no claims afterwards");
    assert.equal(late.code, ErrorCodes.INVALID_STATE);
  });

  test("Half Sheet pays on three named tickets and the names outlive the process", async () => {
    const draw = [3, 11, 4, 12, 13, 5];
    const r = await round({ seats: [{ name: "Asha", grids: [TICKET_A, TICKET_B, TICKET_STAR] }], draw });
    await call(r, draw);
    const paid = await claim(r, r.players[0], "halfSheet");
    assert.equal(paid.ok, true, JSON.stringify(paid));
    assert.equal(paid.points, 20);
    assert.deepEqual(paid.ticketNos, [1, 2, 3]);
    assert.equal(paid.ticketNo, 1);

    const rows = await env.awardRows({ roomId: r.roomId });
    assert.deepEqual(rows[0].ticket_nos.map(Number), [1, 2, 3], "the array column holds exactly the three tickets it was judged on");
    assert.equal(rows[0].winner_ordinal, 1);

    const fresh = await restart(r);
    assert.deepEqual(winners(fresh.room, "halfSheet")[0].ticketNos, [1, 2, 3], "and a rebuild still names all three");
    assert.deepEqual(winners(fresh.room, "halfSheet"), winners(r.room, "halfSheet"));

    // the seat-scoped claim path refuses the same way in the cold process
    const again = await fresh.controller.claim({ room: fresh.room, playerId: r.players[0].playerId, pattern: "halfSheet" });
    assert.equal(again.code, ErrorCodes.ALREADY_CLAIMED_BY_YOU);
  });

  test("two servers sharing one database still pay one Star", async () => {
    // Both seats complete - Asha on call 5, Ravi on call 6 - and the grace window
    // is only there to keep the claim timely, so what is being measured is the
    // arbitration: two live copies, neither of which has seen the other's award.
    const both = [...new Set([...STAR_A, ...STAR_B])];
    const r = await round({
      seats: [
        { name: "Asha", grids: [TICKET_A] },
        { name: "Ravi", grids: [TICKET_STAR] },
      ],
      draw: both,
      overrides: { claimWindowCalls: 4 },
    });
    await call(r, both);
    const rival = env.newProcess();
    const loaded = await rival.controller.ensureRoom({ roomId: r.roomId });
    assert.equal(loaded.ok, true, JSON.stringify(loaded));
    assert.equal(loaded.recovered, true, "a second live copy of the same room, rebuilt from rows");
    const rivalRoom = rival.registry.get(r.roomId);
    assert.equal(rivalRoom.cursor, 6, "rebuilt to the same history");

    const [firstResult, secondResult] = await Promise.all([
      claim(r, r.players[0], "star"),
      rival.controller.claim({ room: rivalRoom, playerId: r.players[1].playerId, pattern: "star" }),
    ]);
    const accepted = [firstResult, secondResult].filter((result) => result.ok);
    const refused = [firstResult, secondResult].filter((result) => !result.ok);
    assert.equal(accepted.length, 1, "exactly one claim was paid: " + JSON.stringify([firstResult, secondResult]));
    assert.equal(refused[0].code, ErrorCodes.ALREADY_AWARDED);

    const rows = await env.awardRows({ roomId: r.roomId });
    assert.equal(rows.length, 1, "one awards row, no matter which copy asked first");
    assert.equal(rows[0].player_id, accepted[0].playerId);
    const fresh = await restart(r);
    assert.deepEqual(winners(fresh.room, "star").map((award) => award.playerId), [accepted[0].playerId]);
  });

  test("a claim that lands after the round is closed is refused on the durable path", async () => {
    const r = await round({ seats: [{ name: "Asha", grids: [EXAMPLE_TICKET] }], draw: STAR_EXAMPLE });
    await call(r, STAR_EXAMPLE);
    const ended = await r.controller.transition({ room: r.room, socketId: r.hostSocket, action: "end" });
    assert.equal(ended.ok, true, JSON.stringify(ended));
    const late = await claim(r, r.players[0], "star");
    assert.equal(late.code, ErrorCodes.INVALID_STATE);
    assert.deepEqual((await env.awardRows({ roomId: r.roomId })).length, 0, "a closed round pays nothing");
    const rejected = await env.claimRows({ roomId: r.roomId, status: "REJECTED" });
    assert.equal(rejected.length, 1, "but the attempt is on the record");
  });
});
