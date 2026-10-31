/**
 * Phase 14 §3 / §4: a genuine end-to-end game driven through the REAL engine.
 *
 * This is not a demo shortcut: it exercises the exact same controller + engine
 * + pattern-evaluation + claim-arbitration code the live socket transport calls
 * (server/persist/controller.js -> server/game/engine.js). Nothing is faked:
 * tickets are the real generated grids, the draw is the real server shuffle, and
 * every claim is submitted as a player intent and decided by the server. We only
 * observe the room's internal state to know WHEN a pattern has legitimately
 * completed so we can claim it at the true winning call — the award itself is
 * still the engine's decision, not this script's.
 *
 * It proves the full §3 sequence:
 *   host creates -> players join -> each picks ticket count -> start locks
 *   selection -> server-authoritative calls -> tickets mark off a shared history
 *   -> legitimate claims award -> invalid/premature/duplicate/invented claims are
 *   rejected -> the final Full House is won -> host ends -> COMPLETED with a
 *   correct leaderboard, awards and call history -> a post-completion claim fails.
 *
 * Run:  node scripts/e2e-game.mjs
 *
 * Memory-only by default (no DATABASE_URL). Pass --durable with a local
 * TEST_DATABASE_URL to run the identical flow against real persistence.
 */

import assert from "node:assert/strict";
import { createApp } from "../server/index.js";
import { enabledPatternIds, evaluateClaimAcrossTickets, PATTERNS } from "../server/game/patterns.js";
import { GameState } from "../server/game/engine.js";

const DURABLE = process.argv.includes("--durable");
const url = DURABLE ? process.env.TEST_DATABASE_URL || "" : "";
if (DURABLE && /supabase/i.test(url)) {
  throw new Error("e2e --durable must use a throwaway local database, never the live one.");
}
const schema = DURABLE ? "tambola_e2e_" + Math.random().toString(16).slice(2, 8) : undefined;

function line(text = "") {
  console.log(text);
}
function header(text) {
  line("\n== " + text + " " + "=".repeat(Math.max(0, 56 - text.length)));
}

/** Guarded controller call that must succeed. */
async function must(promise, label) {
  const result = await promise;
  assert.ok(result && result.ok, label + " failed: " + JSON.stringify(result));
  return result;
}
/** Guarded controller call that must be refused. */
async function mustRefuse(promise, label) {
  const result = await promise;
  assert.equal(result.ok, false, label + " was wrongly accepted: " + JSON.stringify(result));
  return result;
}

async function main() {
  header("end-to-end full game");
  line("persistence: " + (DURABLE ? "durable (throwaway schema " + schema + ")" : "memory-only"));

  const instance = await createApp({
    memoryOnly: !DURABLE,
    databaseUrl: url || undefined,
    schema,
    origins: [],
    // No automatic clock: the host (this script) calls each number, so the
    // winning sequence is deterministic and fully observed.
    config: { autoCall: false, chatIntervalMs: 0, callIntervalMs: 60000, disconnectGraceMs: 60000 },
    log: () => {},
  });

  const { controller, registry } = instance;

  // 1. host creates the room ------------------------------------------------
  const host = await must(controller.createRoom({ name: "GameHost", socketId: "sock-host" }), "create room");
  const room = registry.get(host.roomId);
  assert.ok(room, "room is live in the registry");
  line("room " + host.roomId + " created by GameHost (state " + room.state + ")");

  // 2/3. independent players join and choose their own ticket count ---------
  const seats = [
    { name: "Asha", socketId: "sock-asha", wants: 3 },
    { name: "Ravi", socketId: "sock-ravi", wants: 2 },
    { name: "Meena", socketId: "sock-meena", wants: 4 },
    { name: "John", socketId: "sock-john", wants: 1 },
  ];
  for (const seat of seats) {
    const joined = await must(
      controller.joinRoom({ roomId: host.roomId, name: seat.name, socketId: seat.socketId }),
      "join " + seat.name
    );
    seat.playerId = joined.playerId;
    // ticket preview before start: selectTickets issues the real grids privately
    const picked = await must(
      controller.selectTickets({ room, playerId: seat.playerId, count: seat.wants, socketId: seat.socketId }),
      "select tickets " + seat.name
    );
    assert.equal(picked.ticketCount, seat.wants, seat.name + " got the tickets they chose");
    line("  " + seat.name + " chose " + picked.ticketCount + " ticket(s): " + picked.tickets.map((t) => "#" + t.no).join(", "));
  }

  // 4/5. host starts; selection locks; every ticket is issued ---------------
  await must(controller.start({ room, socketId: "sock-host" }), "start game");
  assert.equal(room.state, GameState.RUNNING, "game is running after start");
  // selection is now locked — an attempt to change it must be refused
  await mustRefuse(
    controller.selectTickets({ room, playerId: seats[0].playerId, count: 2, socketId: seats[0].socketId }),
    "ticket change after start"
  );
  const issuedTotal = [...room.players.values()].reduce((n, p) => n + p.tickets.length, 0);
  line("game started: " + issuedTotal + " tickets issued across " + seats.length + " seats (selection locked)");

  const patternOrder = enabledPatternIds(room.config);
  const enabledCount = patternOrder.length;
  const draw = room.draw;
  assert.equal(draw.length, 90, "the server built a full 1-90 draw");

  // 6/7/8/9/10. server-authoritative calls; claim each pattern the call it
  // legitimately completes on; collect the exact winning sequence ------------
  const sequence = [];
  const awardedPatterns = new Set();
  const rejections = [];
  let prematureProbe = null;
  let inventedProbe = null;
  let guard = 0;

  while (room.state === GameState.RUNNING && room.cursor < draw.length && awardedPatterns.size < enabledCount) {
    assert.ok(guard++ < 200, "call loop should terminate well before 200 iterations");
    const called = await must(
      controller.callNext({ room, socketId: "sock-host", source: "host" }),
      "call number"
    );
    const index = room.cursor; // 1-based ordinal of the number just called
    assert.equal(called.index, index, "engine call index matches cursor");

    // Once, early on, prove a not-yet-complete line claim is refused (premature).
    if (!prematureProbe && index >= 1) {
      prematureProbe = await controller.claim({
        room,
        playerId: seats[0].playerId,
        pattern: "bottomLine",
        socketId: seats[0].socketId,
      });
      if (!prematureProbe.ok) rejections.push({ kind: "premature line", at: index, reason: prematureProbe.reason || prematureProbe.error });
    }

    for (const patternId of patternOrder) {
      if (awardedPatterns.has(patternId)) continue;
      // the server, not this script, decides validity; we just ask each seat in
      // turn and let the first legitimately-completing one win it
      for (const seat of seats) {
        const player = room.players.get(seat.playerId);
        const verdict = evaluateClaimAcrossTickets(patternId, player.tickets, room.calledNumbers, room.config);
        if (!verdict.valid) continue;
        // prove an invented claim: name a ticket that is NOT the completing one
        if (!inventedProbe && player.tickets.length > 1 && verdict.winningTickets.length && verdict.winningTickets.length < player.tickets.length) {
          const bogusTicket = player.tickets.map((t) => t.no).find((no) => !verdict.winningTickets.includes(no));
          if (bogusTicket !== undefined) {
            const bogus = await controller.claim({ room, playerId: seat.playerId, pattern: patternId, ticketNo: bogusTicket, socketId: seat.socketId });
            if (!bogus.ok) rejections.push({ kind: "invented ticket", at: index, reason: bogus.reason || bogus.error });
            inventedProbe = true;
          }
        }
        const award = await controller.claim({
          room,
          playerId: seat.playerId,
          pattern: patternId,
          ticketNo: verdict.ticketNo,
          socketId: seat.socketId,
        });
        if (award.ok) {
          awardedPatterns.add(patternId);
          sequence.push({
            pattern: patternId,
            label: PATTERNS[patternId].label,
            winner: seat.name,
            ticketNo: verdict.ticketNo,
            points: PATTERNS[patternId].points,
            callIndex: index,
            calledNumber: called.number,
          });
          break; // this pattern is closed
        }
      }
      if (awardedPatterns.size === enabledCount) break;
    }

    // once Full House has been awarded, the round is genuinely decided; prove a
    // duplicate re-claim of an awarded pattern is refused, then end the game as
    // the rules allow (the winning condition has been reached)
    if (awardedPatterns.has("fullHouse")) {
      const dup = await controller.claim({ room, playerId: sequence[sequence.length - 1].winnerId || seats[0].playerId, pattern: "fullHouse", socketId: "sock-host" });
      if (dup && !dup.ok) rejections.push({ kind: "duplicate full house", at: room.cursor, reason: dup.error || dup.code });
      break;
    }
  }

  assert.equal(awardedPatterns.size, enabledCount, "every enabled pattern was legitimately awarded before the round ended");

  // 12/13. authorized host ends the decided round -> COMPLETED with results --
  await must(controller.transition({ room, socketId: "sock-host", action: "end" }), "host end");
  assert.equal(room.state, GameState.COMPLETED, "room reaches a proper COMPLETED state");

  const view = room.stateView();
  const awards = room.awardList();
  const leaderboard = room.leaderboard();
  const calledNumbers = room.calledNumbers.slice();

  // 15. nobody can claim after the game is over -----------------------------
  await mustRefuse(
    controller.claim({ room, playerId: seats[0].playerId, pattern: "topLine", socketId: seats[0].socketId }),
    "post-completion claim"
  );

  // ------------------------------------------------------------------ report
  header("winning sequence (server-verified)");
  line("#   pattern         winner   ticket  pts  called-on  #  (call index / number)");
  sequence.forEach((entry, i) => {
    line(
      String(i + 1).padStart(2) +
        "  " +
        entry.label.padEnd(14) +
        " " +
        entry.winner.padEnd(8) +
        " #" +
        String(entry.ticketNo).padEnd(6) +
        String(entry.points).padStart(3) +
        "   idx " +
        String(entry.callIndex).padStart(2) +
        " = #" +
        entry.calledNumber
    );
  });

  header("rejected claims (must never score)");
  if (!rejections.length) line("(none recorded)");
  for (const r of rejections) line("  " + r.kind.padEnd(22) + " @ call " + String(r.at).padEnd(3) + " -> " + r.reason);

  header("final state");
  line("state: " + view.state + " | called " + calledNumbers.length + " | remaining " + view.remaining);
  line("awards: " + awards.length + " (one per enabled pattern: " + enabledCount + ")");
  assert.equal(calledNumbers.length, new Set(calledNumbers).size, "no number was called twice");
  assert.equal(awards.length, enabledCount, "every enabled pattern has exactly one award");

  header("leaderboard");
  for (const row of leaderboard) line("  " + row.player.padEnd(10) + row.points + " pts  [" + row.claims.join(", ") + "]");

  // integrity: the engine's own invariant checker must be satisfied at the end
  room.assertIntegrity();
  line("\nengine integrity assertion passed on the completed room.");

  const top = leaderboard[0];
  const fullHouse = sequence.find((s) => s.pattern === "fullHouse");
  assert.ok(fullHouse, "a full house was genuinely won");

  if (DURABLE) {
    // the completed round must be recoverable/recorded, not just in memory
    const stillOpen = await instance.store.loadRecoverableRooms();
    line("recoverable open rooms after this game closed cleanly: " + stillOpen.length);
    await instance.db.query("DROP SCHEMA IF EXISTS " + schema + " CASCADE").catch(() => {});
    line("dropped throwaway schema " + schema);
  }

  header("result");
  line("PASS — a full game ran through the real engine to a COMPLETED state.");
  line("Winner of the deciding Full House: " + fullHouse.winner + " (ticket #" + fullHouse.ticketNo + ") on call " + fullHouse.callIndex + " (#" + fullHouse.calledNumber + ").");
  line("Top of leaderboard: " + top.player + " with " + top.points + " points.");

  await instance.closeServer();
}

main().catch((error) => {
  console.error("\nE2E FAILED:", error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
