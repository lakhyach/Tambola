import test from "node:test";
import assert from "node:assert/strict";
import { buildHydrationSource } from "../server/persist/recovery.js";
import { generateTicket } from "../server/game/ticket.js";

function runningBundle(overrides = {}) {
  const startedAt = new Date("2026-10-01T10:00:00.000Z");
  return {
    room: { room_code: "RECOVERY1", status: "RUNNING", game_number: 1, host_player_id: "player-1", config: {} },
    members: [{ player_id: "player-1", display_name: "Recovery player", ticket_count: 1, joined_at: startedAt, left_at: null }],
    game: { game_number: 1, status: "RUNNING", draw_sequence: Array.from({ length: 90 }, (_, index) => index + 1), started_at: startedAt, completed_at: null },
    calls: [],
    tickets: [{ player_id: "player-1", ticket_no: 1, grid: generateTicket() }],
    awards: [],
    bookingAssignments: [],
    ...overrides,
  };
}

test("room recovery requires internally consistent game lifecycle timestamps", () => {
  const running = runningBundle();
  assert.equal(buildHydrationSource(running).state, "RUNNING");

  assert.throws(
    () => buildHydrationSource({ ...running, game: { ...running.game, started_at: null } }),
    /no valid start timestamp/
  );
  assert.throws(
    () => buildHydrationSource({ ...running, game: { ...running.game, completed_at: new Date("2026-10-01T10:01:00.000Z") } }),
    /running game already has a completion timestamp/
  );

  const completedRoom = { room_code: "RECOVERY1", status: "COMPLETED", game_number: 1, host_player_id: "player-1", config: {} };
  const completedGame = { ...running.game, status: "COMPLETED", completed_at: new Date("2026-10-01T10:05:00.000Z") };
  const completedBundle = { ...running, room: completedRoom, game: completedGame };
  assert.equal(buildHydrationSource(completedBundle).state, "COMPLETED");
  assert.throws(
    () => buildHydrationSource({ ...completedBundle, game: { ...completedGame, completed_at: null } }),
    /completed game has no valid completion timestamp/
  );
  assert.throws(
    () => buildHydrationSource({ ...completedBundle, game: { ...completedGame, completed_at: new Date("2026-10-01T09:59:59.000Z") } }),
    /completed before it started/
  );
});

test("recovery refuses malformed room, participant, host, lifecycle and draw references", () => {
  const base = runningBundle();
  const malformed = [
    ["missing room row", (source) => ({ ...source, room: null }), /no room row/],
    ["unknown room state", (source) => ({ ...source, room: { ...source.room, status: "BROKEN" } }), /not a known game state/],
    ["no active participants", (source) => ({ ...source, members: source.members.map((member) => ({ ...member, left_at: new Date() })) }), /no participants left/],
    ["missing current game", (source) => ({ ...source, game: null }), /missing or has a different round number/],
    ["wrong game number", (source) => ({ ...source, game: { ...source.game, game_number: 2 } }), /missing or has a different round number/],
    ["unfinished game in a waiting room", (source) => ({ ...source, room: { ...source.room, status: "WAITING" } }), /unfinished game row/],
    ["wrong game status for a completed room", (source) => ({ ...source, room: { ...source.room, status: "COMPLETED" } }), /lifecycle states do not agree/],
    ["missing live draw", (source) => ({ ...source, game: { ...source.game, draw_sequence: [] } }), /no stored draw to recover/],
    ["short draw", (source) => ({ ...source, game: { ...source.game, draw_sequence: source.game.draw_sequence.slice(0, 89) } }), /holds 89 numbers, expected 90/],
    ["call disagrees with the stored draw", (source) => ({ ...source, calls: [{ call_index: 1, number: 90 }] }), /stored draw says 1/],
    ["call indexes are not a contiguous prefix", (source) => ({ ...source, calls: [{ call_index: 2, number: source.game.draw_sequence[1] }] }), /not contiguous at position 1/],
    ["recorded host is no longer active", (source) => ({
      ...source,
      members: [
        { ...source.members[0], left_at: new Date() },
        { ...source.members[0], player_id: "player-2", display_name: "Active player" },
      ],
      tickets: [{ ...source.tickets[0], player_id: "player-2" }],
    }), /recorded host is no longer a participant/],
    ["running game has no ticketed seat", (source) => ({ ...source, tickets: [] }), /no seat has a stored ticket/],
  ];

  for (const [label, corrupt, expected] of malformed) {
    assert.throws(() => buildHydrationSource(corrupt(structuredClone(base))), expected, label);
  }
});
