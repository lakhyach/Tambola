// Keep the moderator workspace navigation derived from the same grants the
// server enforces. Each tab may still expose narrower actions within it.
const TAB_RULES = Object.freeze([
  Object.freeze({ id: "settings", anyOf: ["instance.settings.update"] }),
  Object.freeze({ id: "rooms", anyOf: ["room.read", "room.create", "room.start", "room.pause", "room.end", "room.reset", "players.manage"] }),
  Object.freeze({ id: "players", anyOf: ["players.read"] }),
  Object.freeze({ id: "bookings", anyOf: ["bookings.read", "bookings.assign"] }),
  Object.freeze({ id: "history", anyOf: ["history.read"] }),
  Object.freeze({ id: "reports", anyOf: ["reports.read"] }),
]);

export function moderatorWorkspaceTabIds(permissions = []) {
  const grants = new Set(Array.isArray(permissions) ? permissions : []);
  return TAB_RULES.filter((tab) => tab.anyOf.some((permission) => grants.has(permission))).map((tab) => tab.id);
}

export function preferredModeratorTab(permissions = []) {
  return moderatorWorkspaceTabIds(permissions)[0] || "";
}
