import test from "node:test";
import assert from "node:assert/strict";
import { HAS_DB, openDurableSchema } from "./pattern-harness.js";

test("public instance joins enforce the room's persisted instance before issuing a seat", { skip: !HAS_DB }, async () => {
  const env = await openDurableSchema({ prefix: "publicjoin" });
  try {
    const process = env.newProcess();
    const regular = await process.controller.createManagedRoom({ instanceId: "regular" });
    const bumper = await process.controller.createManagedRoom({ instanceId: "bumper" });
    await env.db.query("UPDATE game_instances SET status='active' WHERE instance_id='legacy'");
    const legacy = await process.controller.createManagedRoom({ instanceId: "legacy" });

    const mismatch = await process.controller.joinRoom({
      roomId: bumper.roomId,
      name: "Foreign visitor",
      socketId: "foreign-visitor",
      instanceSlug: "regular",
    });
    assert.equal(mismatch.code, "ROOM_NOT_FOUND", "a public instance link must not reveal a room under another instance");
    assert.equal((await env.db.query("SELECT count(*)::int AS n FROM room_members WHERE room_code=$1", [bumper.roomId])).rows[0].n, 1, "a failed substitution creates no seat");

    const own = await process.controller.joinRoom({
      roomId: regular.roomId,
      name: "Regular visitor",
      socketId: "regular-visitor",
      instanceSlug: "regular",
    });
    assert.equal(own.ok, true, JSON.stringify(own));

    await env.db.query("UPDATE game_instances SET status='archived' WHERE instance_id='legacy'");
    const archived = await process.controller.joinRoom({
      roomId: legacy.roomId,
      name: "Legacy visitor",
      socketId: "legacy-visitor",
      instanceSlug: "legacy",
    });
    assert.equal(archived.code, "INSTANCE_UNAVAILABLE");

    // Existing room-code invitations remain compatible when no public instance
    // context is present; the existing socket/session checks still apply.
    const legacyStyle = await process.controller.joinRoom({ roomId: regular.roomId, name: "Returning style", socketId: "legacy-style" });
    assert.equal(legacyStyle.ok, true, JSON.stringify(legacyStyle));
  } finally {
    await env.close();
  }
});
