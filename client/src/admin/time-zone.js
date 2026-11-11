const partsFor = (date, timeZone, formatter = null) => Object.fromEntries(
  (formatter || new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  })).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
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
  try {
    const formatter = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    const candidates = new Set();
    for (let delta = -72; delta <= 72; delta += 3) {
      const sample = target + delta * 3_600_000;
      const parts = partsFor(new Date(sample), timeZone, formatter);
      const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
      const candidate = sample + (target - represented);
      const actual = partsFor(new Date(candidate), timeZone, formatter);
      if (Number(actual.year) === year && Number(actual.month) === month && Number(actual.day) === day && Number(actual.hour) === hour && Number(actual.minute) === minute) candidates.add(candidate);
    }
    const first = [...candidates].sort((a, b) => a - b)[0];
    return first === undefined ? null : new Date(first).toISOString();
  } catch {
    return null;
  }
}

export function validTimeZone(value) {
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; }
  catch { return false; }
}

/** Client-side counterpart to the authoritative server schedule validation. */
export function validateSchedule({ startsAt, bookingOpensAt, bookingClosesAt, timeZone }) {
  const errors = {};
  if (!validTimeZone(timeZone)) errors.timeZone = "Choose a valid IANA timezone.";
  const instants = {
    bookingOpensAt: toIso(bookingOpensAt, timeZone),
    bookingClosesAt: toIso(bookingClosesAt, timeZone),
    startsAt: toIso(startsAt, timeZone),
  };
  for (const field of ["bookingOpensAt", "bookingClosesAt", "startsAt"]) {
    if (!instants[field]) errors[field] = `Enter a valid local date and time in ${timeZone || "the selected timezone"}. Check that this time exists.`;
  }
  if (!Object.keys(errors).length) {
    if (instants.bookingOpensAt >= instants.bookingClosesAt) {
      errors.bookingOpensAt = "Booking must open before it closes.";
      errors.bookingClosesAt = "Choose a closing time later than booking opening.";
    }
    if (instants.bookingClosesAt >= instants.startsAt) {
      errors.bookingClosesAt = "Booking must close before the game starts.";
      errors.startsAt = "Choose a game start later than booking closing.";
    }
  }
  return { errors, instants, valid: Object.keys(errors).length === 0 };
}
