/**
 * Strict, dependency-free validation of every inbound Socket.IO payload,
 * plus a per-connection event budget.
 *
 * Rules of the road:
 *  - nothing from a browser is ever used as an identifier of somebody else;
 *  - a payload that is not exactly what we expect is rejected, not coerced;
 *  - room scoping comes from server-side socket bookkeeping, never from a
 *    `roomId` field on a gameplay event.
 */

export const ROOM_ID_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6,12}$/;
export const TOKEN_PATTERN = /^[0-9a-f]{12,64}$/;
export const NAME_MIN = 3;
export const NAME_MAX = 20;
export const CHAT_MAX = 120;

/** Events the previous build accepted. Kept as an explicit deny list so a
 *  stale browser tab gets a clear error instead of a silent security hole. */
export const LEGACY_EVENTS = Object.freeze([
  "create-room",
  "join-room",
  "start-game",
  "generate-number",
  "claimfromplayer",
  "sm",
]);

function isPlainObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Reject prototypes, huge objects and non-JSON junk before we touch it. */
export function sanePayload(payload, { maxBytes = 4096 } = {}) {
  if (payload === undefined || payload === null) return { ok: true, value: {} };
  if (!isPlainObject(payload)) return { ok: false, error: "payload must be a plain object" };
  if (Object.keys(payload).length > 12) return { ok: false, error: "payload has too many fields" };
  try {
    const size = JSON.stringify(payload).length;
    if (size > maxBytes) return { ok: false, error: "payload too large" };
  } catch {
    return { ok: false, error: "payload is not serialisable" };
  }
  return { ok: true, value: payload };
}

export function asName(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (trimmed.length < NAME_MIN || trimmed.length > NAME_MAX) return null;
  return trimmed;
}

export function asRoomId(value) {
  if (typeof value !== "string") return null;
  const candidate = value.trim().toUpperCase();
  return ROOM_ID_PATTERN.test(candidate) ? candidate : null;
}

export function asToken(value) {
  if (typeof value !== "string") return null;
  const candidate = value.trim().toLowerCase();
  return TOKEN_PATTERN.test(candidate) ? candidate : null;
}

export function asPatternId(value) {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  return /^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(candidate) ? candidate : null;
}

export function asChatText(value, max = CHAT_MAX) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

export function asBoolean(value) {
  return typeof value === "boolean" ? value : undefined;
}

export function asInteger(value, { min, max }) {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

/**
 * Small token bucket: `burst` capacity, refilled at `perSecond`.
 * Returns true when the event is allowed to proceed.
 */
export function createBudget({ burst = 24, perSecond = 12 } = {}) {
  let tokens = burst;
  let last = Date.now();
  return function take(cost = 1) {
    const now = Date.now();
    tokens = Math.min(burst, tokens + ((now - last) / 1000) * perSecond);
    last = now;
    if (tokens < cost) return false;
    tokens -= cost;
    return true;
  };
}
