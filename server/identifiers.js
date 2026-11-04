const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_PATH_IDENTIFIER_RE = /^[A-Za-z0-9_-]{1,80}$/;

/** Accept canonical RFC UUIDs used for persisted moderator and booking IDs. */
export function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Accept bounded ASCII database identifiers from URL path segments. */
export function isSafePathIdentifier(value) {
  return typeof value === "string" && SAFE_PATH_IDENTIFIER_RE.test(value);
}
