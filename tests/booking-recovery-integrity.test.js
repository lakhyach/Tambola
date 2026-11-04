import test from "node:test";
import assert from "node:assert/strict";
import { HAS_DB, openDurableSchema } from "./pattern-harness.js";
import { createBookingService } from "../server/bookings/service.js";
import { buildHydrationSource } from "../server/persist/recovery.js";

test("room recovery validates every persisted reservation-to-seat link", () => {
  const roomId = "RECOV123";
  const playerId = "booked-player";
  const reservationId = "reservation-1";
  const valid = {
    room: { room_code: roomId, status: "WAITING", game_number: 0, host_player_id: playerId, config: {} },
    members: [{ player_id: playerId, display_name: "Booked player", ticket_count: 2, joined_at: new Date(), left_at: null, booking_reservation_id: reservationId }],
    bookingAssignments: [{
      reservation_id: reservationId,
      player_id: playerId,
      room_code: roomId,
      status: "confirmed",
      ticket_count: 2,
      member_player_id: playerId,
      member_room_code: roomId,
      member_ticket_count: 2,
    }],
    game: null,
    calls: [],
    tickets: [],
    awards: [],
    schedule: null,
  };

  assert.equal(buildHydrationSource(valid).players[0].ticketSelectionLocked, true);
  const corruptions = [
    ["reservation points at another room", { room_code: "FOREIGN1" }],
    ["reservation has no player", { player_id: null }],
    ["reservation is no longer confirmed", { status: "cancelled" }],
    ["member link points at another player", { member_player_id: "other-player" }],
    ["member link points at another room", { member_room_code: "FOREIGN1" }],
    ["locked ticket count changed", { member_ticket_count: 3 }],
  ];

  for (const [label, patch] of corruptions) {
    const bundle = {
      ...valid,
      bookingAssignments: [{ ...valid.bookingAssignments[0], ...patch }],
    };
    assert.throws(
      () => buildHydrationSource(bundle),
      /booked seat no longer matches/,
      label
    );
  }
});

test("room recovery freezes when a booked seat's durable ticket lock disagrees with its reservation", { skip: !HAS_DB }, async () => {
  const env = await openDurableSchema({ prefix: "booking_recovery_integrity" });
  const service = createBookingService({ db: env.db });
  const live = env.newProcess({ autoCall: false });
  let roomId;
  try {
    const future = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();
    const created = await live.controller.createRoom({ name: "Recovery Host", socketId: "recovery-host", instanceId: "regular" });
    assert.equal(created.ok, true);
    roomId = created.roomId;

    const session = await service.createSession({
      instanceId: "regular", actor: "recovery-test", title: "Booked recovery check",
      startsAt: future(40), bookingOpensAt: future(-2), bookingClosesAt: future(35), capacity: 8, roomCode: roomId,
    });
    assert.ok(session.session);
    assert.equal((await service.updateSession({
      instanceId: "regular", sessionId: session.session.sessionId, actor: "recovery-test", patch: { status: "open" },
    })).session.status, "open");

    const held = await service.reserve({ sessionId: session.session.sessionId, displayName: "Booked Recovery", ticketCount: 2 });
    assert.ok(held.reservation);
    assert.equal((await service.lookupOrTransition({
      reservationId: held.reservation.reservationId, bookingToken: held.reservation.bookingToken, action: "confirm",
    })).reservation.status, "confirmed");
    const joined = await live.controller.joinRoom({
      roomId, name: "ignored", socketId: "recovery-player", instanceSlug: "regular",
      reservationId: held.reservation.reservationId, bookingToken: held.reservation.bookingToken,
    });
    assert.equal(joined.ok, true, JSON.stringify(joined));
    assert.equal(joined.ticketCount, 2);

    // Simulate durable corruption that database FKs cannot detect: the seat's
    // stored ticket count no longer matches its immutable booking quantity.
    await env.db.query("UPDATE room_members SET ticket_count=3 WHERE room_code=$1 AND player_id=$2", [roomId, joined.playerId]);
    const cold = env.newProcess({ autoCall: false });
    const recovered = await cold.controller.ensureRoom({ roomId });
    assert.equal(recovered.ok, false);
    assert.equal(recovered.code, "RECOVERY_REQUIRED");
    assert.equal(cold.registry.get(roomId), null, "the inconsistent room is never added to the live registry");

    const frozen = await env.db.query("SELECT recovery_error FROM rooms WHERE room_code=$1", [roomId]);
    assert.match(frozen.rows[0].recovery_error, /booked seat no longer matches/);
    const stillBroken = await cold.controller.retryRecovery({ roomId });
    assert.equal(stillBroken.ok, false, "retry does not bypass an unrepaired integrity failure");
    assert.equal(stillBroken.code, "RECOVERY_REQUIRED");
    assert.equal(cold.registry.get(roomId), null);
    const stillFrozen = await env.db.query("SELECT recovery_error FROM rooms WHERE room_code=$1", [roomId]);
    assert.match(stillFrozen.rows[0].recovery_error, /booked seat no longer matches/);

    const reservation = await env.db.query("SELECT player_id,room_code,status,ticket_count FROM ticket_reservations WHERE reservation_id=$1", [held.reservation.reservationId]);
    assert.deepEqual(reservation.rows[0], { player_id: joined.playerId, room_code: roomId, status: "confirmed", ticket_count: 2 });
    const audit = await env.db.query("SELECT action FROM ticket_reservation_audit WHERE reservation_id=$1 ORDER BY event_id", [held.reservation.reservationId]);
    assert.deepEqual(audit.rows.map((row) => row.action), ["hold.create", "hold.confirm", "hold.assign"], "recovery adds no fabricated booking transitions");

    await env.db.query("UPDATE room_members SET ticket_count=2 WHERE room_code=$1 AND player_id=$2", [roomId, joined.playerId]);
    const repaired = await cold.controller.retryRecovery({ roomId });
    assert.equal(repaired.ok, true, JSON.stringify(repaired));
    assert.equal(repaired.recovered, true);
    assert.equal(repaired.room.players.get(joined.playerId).ticketCount, 2);
    assert.equal(repaired.room.players.get(joined.playerId).ticketSelectionLocked, true);
    assert.equal((await env.db.query("SELECT recovery_error FROM rooms WHERE room_code=$1", [roomId])).rows[0].recovery_error, null);
    const recoveryAudit = await env.db.query("SELECT type,detail FROM audit_events WHERE room_code=$1 AND type LIKE 'recovery-%' ORDER BY event_id", [roomId]);
    assert.deepEqual(recoveryAudit.rows.map((row) => row.type), ["recovery-failed", "recovery-cleared", "recovery-failed", "recovery-cleared"], "both retries leave a durable audit trail");
  } finally {
    for (const process of [live]) for (const id of process.registry.rooms.keys()) process.registry.close(id, "test finished");
    await env.close();
  }
});
