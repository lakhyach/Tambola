import { validTimeZone } from "../themes/service.js";

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const OFFSET_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/i;

function partsFor(date, formatter) {
  const parts = formatter.formatToParts(date);
  return Object.fromEntries(parts.filter(({ type }) => type !== "literal").map(({ type, value }) => [type, Number(value)]));
}

function validFields(year, month, day, hour, minute, second = 0) {
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return false;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    && date.getUTCHours() === hour && date.getUTCMinutes() === minute && date.getUTCSeconds() === second;
}

function parseOffsetInstant(value) {
  const match = OFFSET_DATE_TIME.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, ss = "0", fraction = "0", offset] = match;
  const year = Number(y); const month = Number(mo); const day = Number(d);
  const hour = Number(h); const minute = Number(mi); const second = Number(ss);
  if (!validFields(year, month, day, hour, minute, second)) return null;
  let offsetMinutes = 0;
  if (offset.toUpperCase() !== "Z") {
    const offsetHour = Number(offset.slice(1, 3));
    const offsetMinute = Number(offset.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return null;
    offsetMinutes = (offsetHour * 60 + offsetMinute) * (offset[0] === "+" ? 1 : -1);
  }
  const ms = Number(fraction.padEnd(3, "0"));
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms) - offsetMinutes * 60_000);
}

/** Interpret datetime-local wall time on the server in the selected IANA zone.
 * Ambiguous fall-back times choose the earlier instant; nonexistent spring
 * forward times are rejected. Offset-bearing ISO timestamps remain accepted as
 * exact instants for API compatibility with existing clients.
 */
export function parseScheduleInstant(value, timeZone) {
  if (!validTimeZone(timeZone)) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null;
  if (typeof value !== "string") return null;
  const instant = parseOffsetInstant(value);
  if (instant) return instant;
  const match = LOCAL_DATE_TIME.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if (!validFields(year, month, day, hour, minute)) return null;

  const target = Date.UTC(year, month - 1, day, hour, minute);
  const candidates = new Set();
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  // Gather the zone offsets around the target wall time. A three-day window
  // covers the largest practical civil offset and both sides of DST changes.
  for (let delta = -72; delta <= 72; delta += 3) {
    const sample = target + delta * 3_600_000;
    const p = partsFor(new Date(sample), formatter);
    const rendered = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const candidate = sample + (target - rendered);
    const actual = partsFor(new Date(candidate), formatter);
    if (actual.year === year && actual.month === month && actual.day === day && actual.hour === hour && actual.minute === minute) {
      candidates.add(candidate);
    }
  }
  const first = [...candidates].sort((a, b) => a - b)[0];
  return first === undefined ? null : new Date(first);
}

export function validateSessionSchedule({ bookingOpensAt, bookingClosesAt, startsAt, timeZone }) {
  if (!validTimeZone(timeZone)) return { error: "INVALID_TIME_ZONE" };
  const opens = parseScheduleInstant(bookingOpensAt, timeZone);
  const closes = parseScheduleInstant(bookingClosesAt, timeZone);
  const starts = parseScheduleInstant(startsAt, timeZone);
  if (!opens || !closes || !starts) return { error: "INVALID_SCHEDULE_TIME" };
  if (opens >= closes) return { error: "BOOKING_OPENS_NOT_BEFORE_CLOSES" };
  if (closes >= starts) return { error: "BOOKING_CLOSES_NOT_BEFORE_START" };
  return { opens, closes, starts };
}
