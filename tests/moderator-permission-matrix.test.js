import test from "node:test";
import assert from "node:assert/strict";
import { MODERATOR_PERMISSIONS } from "../server/moderator/authorization.js";
import { moderatorWorkspaceTabIds, preferredModeratorTab } from "../client/src/moderator-permissions.js";

const tabRules = [
  ["settings", ["instance.settings.update"]],
  ["rooms", ["room.read", "room.create", "room.start", "room.pause", "room.end", "room.reset", "players.manage"]],
  ["players", ["players.read"]],
  ["bookings", ["bookings.read", "bookings.assign"]],
  ["history", ["history.read"]],
  ["reports", ["reports.read"]],
];

test("moderator workspace tabs and default selection are correct for all grant combinations", () => {
  assert.equal(MODERATOR_PERMISSIONS.length, 16);
  assert.equal(new Set(MODERATOR_PERMISSIONS).size, MODERATOR_PERMISSIONS.length);

  const combinations = 2 ** MODERATOR_PERMISSIONS.length;
  for (let mask = 0; mask < combinations; mask += 1) {
    const grants = MODERATOR_PERMISSIONS.filter((_, bit) => (mask & (2 ** bit)) !== 0);
    const expected = tabRules
      .filter(([, anyOf]) => anyOf.some((permission) => grants.includes(permission)))
      .map(([id]) => id);
    const actual = moderatorWorkspaceTabIds(grants);

    assert.deepEqual(actual, expected, `visible tabs for permission mask ${mask}`);
    assert.equal(preferredModeratorTab(grants), expected[0] || "", `default tab for permission mask ${mask}`);
    assert.equal(new Set(actual).size, actual.length, `unique tabs for permission mask ${mask}`);
  }

  assert.deepEqual(moderatorWorkspaceTabIds(null), []);
  assert.deepEqual(moderatorWorkspaceTabIds(["unknown.permission"]), []);
  assert.deepEqual(moderatorWorkspaceTabIds(["bookings.assign"]), ["bookings"]);
  assert.deepEqual(moderatorWorkspaceTabIds(["players.manage"]), ["rooms"]);
  assert.deepEqual(moderatorWorkspaceTabIds(["tickets.manage", "bookings.manage", "instance.read"]), []);
});
