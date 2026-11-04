import test from "node:test";
import assert from "node:assert/strict";
import { HAS_DB, openDurableSchema } from "./pattern-harness.js";
import { ticketNumbers } from "../server/game/ticket.js";
import { drawLeadingWith } from "./pattern-harness.js";

const tenants = ["regular", "bumper", "legacy"];

test("durable Regular, Bumper and Legacy game records stay scoped to their room identity", { skip: !HAS_DB }, async () => {
  const env = await openDurableSchema({ prefix: "tenantids" });
  try {
    const process = env.newProcess();
    const fixtures = new Map();

    for (const instanceId of tenants) {
      if (instanceId === "legacy") {
        await env.db.query("UPDATE game_instances SET status='active' WHERE instance_id='legacy'");
      }

      const hostSocket = `host-${instanceId}`;
      const created = await process.controller.createRoom({
        name: `${instanceId} host`, socketId: hostSocket, instanceId,
      });
      assert.equal(created.ok, true, `${instanceId} room creation: ${JSON.stringify(created)}`);
      const room = process.registry.get(created.roomId);
      const playerSocket = `player-${instanceId}`;
      const joined = await process.controller.joinRoom({
        roomId: created.roomId, name: `${instanceId} player`, socketId: playerSocket,
      });
      assert.equal(joined.ok, true, `${instanceId} player join: ${JSON.stringify(joined)}`);
      const selected = await process.controller.selectTickets({ room, playerId: joined.playerId, count: 2, socketId: playerSocket });
      assert.equal(selected.ok, true, `${instanceId} ticket selection: ${JSON.stringify(selected)}`);
      const started = await process.controller.start({ room, socketId: hostSocket });
      assert.equal(started.ok, true, `${instanceId} game start: ${JSON.stringify(started)}`);

      const ticketRows = await env.db.query(
        "SELECT ticket_id,player_id,game_number,grid FROM tickets WHERE room_code=$1 AND player_id=$2 ORDER BY ticket_id",
        [created.roomId, joined.playerId],
      );
      assert.equal(ticketRows.rows.length, 2, `${instanceId} player holds two tickets`);
      const leading = ticketNumbers(ticketRows.rows[0].grid).slice(0, 5);
      await env.setDraw({ room, sequence: leading });
      for (const expected of leading) {
        const called = await process.controller.callNext({ room, socketId: hostSocket, source: "host" });
        assert.equal(called.ok, true, `${instanceId} call: ${JSON.stringify(called)}`);
        assert.equal(called.number, expected);
      }
      const claim = await process.controller.claim({
        room, playerId: joined.playerId, pattern: "earlyFive", ticketNo: 1, socketId: playerSocket,
      });
      assert.equal(claim.ok, true, `${instanceId} valid ticket claim: ${JSON.stringify(claim)}`);

      fixtures.set(instanceId, {
        roomId: created.roomId,
        hostPlayerId: created.playerId,
        hostSessionId: created.sessionId,
        hostToken: created.sessionToken,
        playerId: joined.playerId,
        playerSessionId: joined.sessionId,
        playerToken: joined.sessionToken,
      });
    }

    // All persisted game records resolve to exactly one persisted room tenant.
    // These joins deliberately use the authoritative room_code/game_number keys.
    for (const table of ["room_members", "sessions", "games", "tickets", "draw_calls", "claims", "awards", "audit_events"]) {
      for (const instanceId of tenants) {
        const result = await env.db.query(
          `SELECT count(*)::int AS n FROM ${table} e JOIN rooms r USING(room_code) WHERE r.game_instance_id=$1`,
          [instanceId],
        );
        assert.ok(result.rows[0].n > 0, `${table} has records in ${instanceId}`);
      }
    }

    const ownership = await env.db.query(
      `SELECT r.game_instance_id, r.room_code, count(DISTINCT g.game_number)::int AS games,
              count(DISTINCT t.ticket_id)::int AS tickets, count(DISTINCT d.call_index)::int AS calls,
              count(DISTINCT c.claim_id)::int AS claims, count(DISTINCT a.award_id)::int AS awards
         FROM rooms r LEFT JOIN games g USING(room_code) LEFT JOIN tickets t USING(room_code)
         LEFT JOIN draw_calls d USING(room_code) LEFT JOIN claims c USING(room_code)
         LEFT JOIN awards a USING(room_code)
        WHERE r.game_instance_id=ANY($1::text[]) GROUP BY r.game_instance_id,r.room_code`,
      [tenants],
    );
    assert.equal(ownership.rowCount, 3);
    for (const row of ownership.rows) {
      assert.deepEqual(
        { games: row.games, tickets: row.tickets, calls: row.calls, claims: row.claims, awards: row.awards },
        { games: 1, tickets: 3, calls: 5, claims: 1, awards: 1 },
        `${row.game_instance_id} record bundle remains inside its room`,
      );
    }

    // Server-issued host and player sessions can resume in their own room.
    for (const fixture of fixtures.values()) {
      for (const [role, token] of [["host", fixture.hostToken], ["player", fixture.playerToken]]) {
        const resumed = await env.newProcess().controller.resume({
          roomId: fixture.roomId, sessionToken: token, socketId: `resume-${role}-${fixture.roomId}`,
        });
        assert.equal(resumed.ok, true, `${role} owns the resumed seat in ${fixture.roomId}`);
      }
    }

    // Every valid cross-tenant host/player session substitution fails without
    // materializing a room in the recipient process.
    for (const sourceId of tenants) {
      for (const targetId of tenants) {
        if (sourceId === targetId) continue;
        const source = fixtures.get(sourceId);
        const target = fixtures.get(targetId);
        for (const [role, token] of [["host", source.hostToken], ["player", source.playerToken]]) {
          const candidate = env.newProcess();
          const result = await candidate.controller.resume({
            roomId: target.roomId, sessionToken: token, socketId: `cross-${role}-${sourceId}-${targetId}`,
          });
          assert.equal(result.ok, false, `${sourceId} ${role} session cannot resume ${targetId}`);
          assert.equal(candidate.registry.get(target.roomId), null, "denial did not load recipient room data");
        }
      }
    }

    // Probe every cross-tenant player/room pair against every durable record
    // type that combines an instance-bound game with a player identifier.
    // This exercises the actual database composite foreign keys, not a model
    // of what the application layer is expected to reject.
    const beforeCounts = {};
    for (const table of ["tickets", "claims", "awards"]) {
      beforeCounts[table] = Number((await env.db.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
    }
    for (const sourceId of tenants) {
      for (const targetId of tenants) {
        if (sourceId === targetId) continue;
        const source = fixtures.get(sourceId);
        const target = fixtures.get(targetId);
        const cases = [
          ["tickets", `INSERT INTO tickets(room_code,game_number,player_id,ticket_no,grid)
            VALUES($1,1,$2,99,'[[1,2,3],[4,5,6],[7,8,9]]'::jsonb)`],
          ["claims", `INSERT INTO claims(room_code,game_number,player_id,pattern,status,reason,call_index)
            VALUES($1,1,$2,'earlyFive','REJECTED','identifier substitution probe',5)`],
          ["awards", `INSERT INTO awards(room_code,game_number,player_id,pattern,points,call_index,winner_ordinal)
            VALUES($1,1,$2,'identifier-probe',0,5,99)`],
        ];
        for (const [table, sql] of cases) {
          await assert.rejects(
            env.db.query(sql, [target.roomId, source.playerId]),
            /foreign key/i,
            `${sourceId} player identifier cannot be attached to ${targetId} ${table}`,
          );
        }
      }
    }
    for (const table of ["tickets", "claims", "awards"]) {
      const after = Number((await env.db.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
      assert.equal(after, beforeCounts[table], `cross-tenant ${table} probes persisted no records`);
    }
  } finally {
    await env.close();
  }
});
