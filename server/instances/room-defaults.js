const LIMITS = Object.freeze({
  maxPlayers: [2, 500],
  callIntervalMs: [1000, 120000],
});

/** Validate the instance-scoped defaults used only when a new room is created. */
export function validateRoomDefaults(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "INVALID_INSTANCE_SETTINGS" };
  }
  const defaults = {};
  for (const [key, item] of Object.entries(value)) {
    // Older instance configs carried a per-player cap. Keep accepting and
    // discarding that stale setting so existing instances can create rooms.
    if (key === "maxTicketsPerPlayer") continue;
    if (key === "autoCall") {
      if (typeof item !== "boolean") return { error: "INVALID_INSTANCE_SETTINGS" };
      defaults.autoCall = item;
      continue;
    }
    const range = LIMITS[key];
    if (!range || !Number.isInteger(item) || item < range[0] || item > range[1]) {
      return { error: "INVALID_INSTANCE_SETTINGS" };
    }
    defaults[key] = item;
  }
  return { roomDefaults: defaults };
}
