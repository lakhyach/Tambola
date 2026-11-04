import test from "node:test";
import assert from "node:assert/strict";
import { HAS_DB, openDurableSchema } from "./pattern-harness.js";
import { recoverRooms } from "../server/persist/recovery.js";
import { createAdminQueries } from "../server/admin/queries.js";
import { validateRoomDefaults } from "../server/instances/room-defaults.js";

test("instance room defaults enforce bounded, non-gameplay operational settings", () => {
  assert.deepEqual(validateRoomDefaults({ maxPlayers: 50, maxTicketsPerPlayer: 8, callIntervalMs: 15000, autoCall: false }), {
    roomDefaults: { maxPlayers: 50, callIntervalMs: 15000, autoCall: false },
  });
  assert.deepEqual(validateRoomDefaults({}), { roomDefaults: {} });
  for (const invalid of [
    null,
    { maxPlayers: 1 },
    { maxPlayers: 501 },
    { callIntervalMs: 999 },
    { autoCall: "false" },
    { multipleWinnersPerPattern: true },
  ]) assert.equal(validateRoomDefaults(invalid).error, "INVALID_INSTANCE_SETTINGS");
});

test("game instances seed independently, own rooms, enforce pause and protect active room ownership", { skip: !HAS_DB }, async () => {
  const env = await openDurableSchema({ prefix: "instances" });
  try {
    const seeded = await env.db.query("SELECT instance_id,slug,status FROM game_instances ORDER BY instance_id");
    assert.deepEqual(seeded.rows.map((row) => row.instance_id), ["bumper", "legacy", "regular"]);
    const queries = createAdminQueries({ db: env.db });
    const initialPlatform = await queries.platformCounts();
    assert.equal(initialPlatform.total_instances, 3);
    assert.equal(initialPlatform.active_instances, 2);
    assert.equal(initialPlatform.archived_instances, 1);
    assert.equal(initialPlatform.total_moderators, 0);
    await env.db.query(`INSERT INTO moderator_accounts(moderator_id,username,password_hash,status,created_by) VALUES
      ('stats-active','stats.active','unused','active','test'),('stats-invited','stats.invited','unused','invited','test'),('stats-suspended','stats.suspended','unused','suspended','test')`);
    await env.db.query(`INSERT INTO moderator_instance_grants(moderator_id,instance_id,permissions,granted_by) VALUES
      ('stats-active','regular',ARRAY['room.read'],'test'),('stats-invited','bumper',ARRAY['room.read'],'test'),('stats-suspended','bumper',ARRAY['room.read'],'test')`);
    await env.db.query(`INSERT INTO moderator_sessions(session_id,moderator_id,token_hash,expires_at,absolute_expires_at)
      VALUES('00000000-0000-4000-8000-000000000009','stats-active',$1,now()+interval '1 hour',now()+interval '1 day')`, ["a".repeat(64)]);
    const securedPlatform = await queries.platformCounts();
    assert.equal(securedPlatform.active_moderators, 1);
    assert.equal(securedPlatform.invited_moderators, 1);
    assert.equal(securedPlatform.suspended_moderators, 1);
    assert.equal(securedPlatform.active_moderator_grants, 1);
    assert.equal(securedPlatform.active_moderator_sessions, 1);
    await env.db.query("UPDATE game_instances SET config=jsonb_build_object('roomDefaults',$1::jsonb) WHERE instance_id='bumper'", [JSON.stringify({ maxPlayers: 25, maxTicketsPerPlayer: 7, callIntervalMs: 15000, autoCall: false })]);
    const process = env.newProcess();
    const bumper = await process.controller.createManagedRoom({ hostName: "Operator", instanceId: "bumper" });
    assert.equal(bumper.ok, true, JSON.stringify(bumper));
    const bumperState = process.registry.get(bumper.roomId);
    assert.deepEqual(
      { maxPlayers: bumperState.config.maxPlayers, ticketCeiling: bumperState.ticketCeiling(), callIntervalMs: bumperState.config.callIntervalMs, autoCall: bumperState.config.autoCall },
      { maxPlayers: 25, ticketCeiling: 10001, callIntervalMs: 15000, autoCall: false },
      "the Bumper instance applies its persisted defaults to a new room"
    );
    const ownership = await env.db.query("SELECT game_instance_id FROM rooms WHERE room_code=$1", [bumper.roomId]);
    assert.equal(ownership.rows[0].game_instance_id, "bumper");

    const publicBumperHost = await process.controller.createRoom({ name: "Public Bumper Host", socketId: "public-bumper-host", instanceSlug: "bumper" });
    assert.equal(publicBumperHost.ok, true, JSON.stringify(publicBumperHost));
    assert.equal((await env.db.query("SELECT game_instance_id FROM rooms WHERE room_code=$1", [publicBumperHost.roomId])).rows[0].game_instance_id, "bumper");
    const hiddenLegacyHost = await process.controller.createRoom({ name: "Hidden Hall Host", socketId: "hidden-legacy-host", instanceSlug: "legacy" });
    assert.equal(hiddenLegacyHost.code, "INSTANCE_UNAVAILABLE", "public hosting cannot reveal or attach to the hidden Legacy instance");
    await env.db.query("UPDATE game_instances SET public_visible=false WHERE instance_id='bumper'");
    const privateBumperHost = await process.controller.createRoom({ name: "Private Hall Host", socketId: "private-bumper-host", instanceSlug: "bumper" });
    assert.equal(privateBumperHost.code, "INSTANCE_UNAVAILABLE", "public hosting refuses a hall after it is made private");
    await env.db.query("UPDATE game_instances SET public_visible=true WHERE instance_id='bumper'");
    await process.controller.closeRoom({ roomId: publicBumperHost.roomId, reason: "test complete" });

    await env.db.query("UPDATE game_instances SET status='active' WHERE instance_id='legacy'");
    const legacyRoom = await process.controller.createManagedRoom({ hostName: "Legacy Host", instanceId: "legacy" });
    assert.equal(legacyRoom.ok, true, JSON.stringify(legacyRoom));
    await env.db.query("UPDATE game_instances SET config=jsonb_build_object('roomDefaults',$1::jsonb) WHERE instance_id='regular'", [JSON.stringify({ maxPlayers: 60, maxTicketsPerPlayer: 2, callIntervalMs: 9000, autoCall: true })]);
    const regularRoom = await process.controller.createManagedRoom({ hostName: "Regular Host", instanceId: "regular" });
    assert.equal(regularRoom.ok, true, JSON.stringify(regularRoom));
    const regularState = process.registry.get(regularRoom.roomId);
    assert.deepEqual(
      { maxPlayers: regularState.config.maxPlayers, maxTicketsPerPlayer: regularState.config.maxTicketsPerPlayer, callIntervalMs: regularState.config.callIntervalMs, autoCall: regularState.config.autoCall },
    { maxPlayers: 60, maxTicketsPerPlayer: undefined, callIntervalMs: 9000, autoCall: true },
      "the Regular instance has independent room defaults"
    );
    const regularStarted = await process.controller.start({ room: regularState, socketId: regularState.hostSocketId });
    assert.equal(regularStarted.ok, true, JSON.stringify(regularStarted));
    await env.db.query(`INSERT INTO platform_audit(actor,actor_role,instance_id,room_code,action,result,metadata) VALUES
      ('regular.mod','moderator','regular',$1,'ROOM_START','success','{"source":"fixture"}'::jsonb),
      ('other.mod','moderator','bumper',$2,'ROOM_START','success','{}'::jsonb)`, [regularRoom.roomId, bumper.roomId]);
    await env.db.query(`INSERT INTO admin_audit(actor,action,target_type,target_id,room_code,metadata) VALUES
      ('owner','INSTANCE_UPDATE','instance','regular',NULL,'{"field":"branding"}'::jsonb),
      ('owner','ROOM_CLOSE','room',$1,$1,'{}'::jsonb)`, [bumper.roomId]);
    const regularOverview = await queries.instanceOverview("regular");
    assert.equal(regularOverview.instance.instanceId, "regular");
    assert.equal(regularOverview.counts.rooms, 1);
    assert.equal(regularOverview.counts.open_rooms, 1);
    assert.equal(regularOverview.counts.games, 1);
    assert.equal(regularOverview.rooms.length, 1);
    assert.equal(regularOverview.rooms[0].roomId, regularRoom.roomId);
    assert.equal(regularOverview.games.length, 1);
    assert.equal(regularOverview.games[0].roomId, regularRoom.roomId);
    assert.deepEqual(regularOverview.players.map((player) => player.displayName), ["Regular Host"]);
    assert.deepEqual(regularOverview.moderators.map((mod) => mod.username), ["stats.active"]);
    assert.equal(regularOverview.moderators[0].activeSessions, 1);
    assert.deepEqual(new Set(regularOverview.audit.map((event) => event.actor)), new Set(["regular.mod", "owner"]));
    assert.equal(await queries.instanceOverview("unknown-instance"), null);

    await env.db.query("UPDATE game_instances SET status='paused' WHERE instance_id='bumper'");
    const join = await env.newProcess().controller.joinRoom({ roomId: bumper.roomId, name: "Late guest", socketId: "late-guest" });
    assert.equal(join.code, "INSTANCE_UNAVAILABLE");

    const room = process.registry.get(bumper.roomId);
    const started = await process.controller.start({ room, socketId: room.hostSocketId });
    assert.equal(started.ok, true, "pausing the instance does not freeze its running games");
    await assert.rejects(
      env.db.query("UPDATE rooms SET game_instance_id='regular' WHERE room_code=$1", [bumper.roomId]),
      /cannot change instance/
    );

    // Create the Legacy fixture while active, then archive the tenant. Existing
    // rooms remain recoverable even when their instance is no longer accepting
    // new rooms or players.
    await env.db.query("UPDATE game_instances SET status='archived' WHERE instance_id='legacy'");

    // Simulate a process restart with a fresh in-memory registry. Recovery reads
    // each room's own room_code bundle; ownership remains associated with the
    // original instance and no neighboring tenant's rows are combined.
    const restarted = env.newProcess();
    const recovery = await recoverRooms({ store: env.store, registry: restarted.registry, log: () => {} });
    assert.deepEqual(recovery.frozen, []);
    assert.deepEqual(new Set(recovery.recovered.map((recovered) => recovered.roomId)), new Set([bumper.roomId, regularRoom.roomId, legacyRoom.roomId]));
    const recoveredOwnership = await env.db.query(
      "SELECT room_code, game_instance_id FROM rooms WHERE room_code = ANY($1::text[])",
      [[bumper.roomId, regularRoom.roomId, legacyRoom.roomId]]
    );
    assert.deepEqual(Object.fromEntries(recoveredOwnership.rows.map((row) => [row.room_code, row.game_instance_id])), {
      [bumper.roomId]: "bumper",
      [regularRoom.roomId]: "regular",
      [legacyRoom.roomId]: "legacy",
    });
    for (const recoveredRoom of recovery.recovered) restarted.registry.close(recoveredRoom.roomId, "test teardown");
  } finally {
    await env.close();
  }
});
