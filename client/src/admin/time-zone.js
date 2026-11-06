const partsFor = (date, timeZone) => Object.fromEntries(
  new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
);

/** Format an instant as a datetime-local wall time in the requested IANA zone. */
export function localInput(value, timeZone = "UTC") {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  try {
    const parts = partsFor(date, timeZone);
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  } catch {
    return "";
  }
}

/** Convert a datetime-local wall time to an ISO instant in its selected zone.
 * DST gaps return null; repeated DST times resolve consistently to the earlier
 * matching instant that the offset iteration reaches.
 */
export function toIso(value, timeZone = "UTC") {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(target);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59) return null;
  let guess = target;
  const seen = new Set();
  try {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (seen.has(guess)) return null;
      seen.add(guess);
      const parts = partsFor(new Date(guess), timeZone);
      const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
      const delta = target - represented;
      if (delta === 0) return new Date(guess).toISOString();
      guess += delta;
    }
  } catch {
    return null;
  }
  return null;
}

export function validTimeZone(value) {
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; }
  catch { return false; }
}
