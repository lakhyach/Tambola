/**
 * What the ticket area shows, derived only from server data.
 *
 * Two rules shape this module:
 *
 * 1. A mark is not a local fact. The only numbers that count as called are the
 *    ones the server put in `calledNumbers`; nothing here reads a click, a
 *    stored mark or a client clock. That is why `ticketProgress` takes the
 *    called history as its input and never a "marked" flag.
 * 2. Nothing here invents a ticket. `sheetsOf` only reads what the server
 *    issued, and a grid with no numbers is not a ticket.
 *
 * The active tab is remembered per room in sessionStorage so a refresh lands a
 * player back on the ticket they were watching. That is a view preference, not
 * game state: if it is missing or stale the first owned ticket is shown, and a
 * ticket number the seat does not own is ignored.
 *
 * Run: npm test (tests/ticket-view.test.js).
 */

/** Key holding `{ [roomId]: ticketNo }` for this tab. */
export const TICKET_MEMORY_KEY = "tambola.ticket.v1";

const hasNumbers = (grid) =>
  Array.isArray(grid) && grid.some((row) => Array.isArray(row) && row.some((n) => n != null));

/** The tickets the server issued, sorted by their own number. */
export function sheetsOf(snap) {
  const list = Array.isArray(snap?.tickets) ? snap.tickets : [];
  const sheets = list
    .filter((t) => t && hasNumbers(t.grid))
    .map((t, i) => ({ no: Number.isInteger(t.no) ? t.no : i + 1, grid: t.grid }));
  if (sheets.length) return sheets.sort((a, b) => a.no - b.no);
  if (hasNumbers(snap?.ticket)) return [{ no: 1, grid: snap.ticket }];
  return [];
}

/**
 * How far one ticket has been marked by the official history.
 *
 * @param {unknown} grid   the server's 3x9 grid
 * @param {unknown} calledNumbers the room's called history (array or Set)
 * @returns {{rows: {index: number, marked: number, filled: number, complete: boolean}[], marked: number, total: number, toGo: number, complete: boolean}}
 */
export function ticketProgress(grid, calledNumbers) {
  const called = calledNumbers instanceof Set ? calledNumbers : new Set(Array.isArray(calledNumbers) ? calledNumbers : []);
  const rows = [];
  let marked = 0;
  let total = 0;

  const list = Array.isArray(grid) ? grid : [];
  for (let index = 0; index < list.length; index++) {
    const row = Array.isArray(list[index]) ? list[index] : [];
    let rowMarked = 0;
    let rowFilled = 0;
    for (const cell of row) {
      if (cell == null) continue;
      rowFilled += 1;
      if (called.has(cell)) rowMarked += 1;
    }
    total += rowFilled;
    marked += rowMarked;
    rows.push({ index, marked: rowMarked, filled: rowFilled, complete: rowFilled > 0 && rowMarked === rowFilled });
  }

  return { rows, marked, total, toGo: Math.max(0, total - marked), complete: total > 0 && marked === total };
}

/** Progress per ticket, in the order the rail shows them. */
export function ticketSummaries(sheets, calledNumbers) {
  return (Array.isArray(sheets) ? sheets : []).map((sheet) => ({
    no: sheet.no,
    ...ticketProgress(sheet.grid, calledNumbers),
  }));
}

/**
 * Which ticket the rail should show. `wanted` is a ticket NUMBER (not an
 * index) so a remembered tab survives a re-numbering only when it still names
 * an owned ticket; otherwise the first one is shown.
 */
export function activeTicketNo(sheets, wanted) {
  const list = Array.isArray(sheets) ? sheets : [];
  if (!list.length) return null;
  const match = list.find((sheet) => sheet.no === wanted);
  return (match || list[0]).no;
}

/** The tab that should take focus for a keyboard move inside a tablist. */
export function tabTarget(list, fromIndex, key) {
  const count = Array.isArray(list) ? list.length : 0;
  if (!count) return 0;
  const at = Number.isInteger(fromIndex) ? Math.min(Math.max(0, fromIndex), count - 1) : 0;
  if (key === "ArrowRight" || key === "ArrowDown") return (at + 1) % count;
  if (key === "ArrowLeft" || key === "ArrowUp") return (at - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return at;
}

/** "1st", "2nd", "3rd", "4th", ... */
export function ordinal(n) {
  const value = Math.abs(Math.trunc(Number(n) || 0));
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return value + "th";
  const last = value % 10;
  if (last === 1) return value + "st";
  if (last === 2) return value + "nd";
  if (last === 3) return value + "rd";
  return value + "th";
}

/** Where this seat finished in the server's standings, 1-based, or null. */
export function placeOf(leaderboard, playerId) {
  const list = Array.isArray(leaderboard) ? leaderboard : [];
  const index = list.findIndex((entry) => entry && entry.playerId === playerId);
  return index >= 0 ? index + 1 : null;
}

/** The awards this seat actually holds, each already carrying its ticket no. */
export function myAwards(awards, playerId) {
  return (Array.isArray(awards) ? awards : []).filter((award) => award && award.playerId === playerId);
}

/* ------------------------------------------------------------ tab memory */

function readMemory(storage) {
  if (!storage) return {};
  try {
    const raw = JSON.parse(storage.getItem(TICKET_MEMORY_KEY));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

/** The ticket number this tab last showed for `roomId`, or null. */
export function readTicketMemory(storage, roomId) {
  if (!storage || !roomId) return null;
  const saved = readMemory(storage)[roomId];
  return Number.isInteger(saved) && saved > 0 ? saved : null;
}

/** Remember `ticketNo` for `roomId`; storage failures stay silent. */
export function writeTicketMemory(storage, roomId, ticketNo) {
  if (!storage || !roomId || !Number.isInteger(ticketNo)) return;
  try {
    const next = { ...readMemory(storage), [roomId]: ticketNo };
    storage.setItem(TICKET_MEMORY_KEY, JSON.stringify(next));
  } catch {
    /* private mode or quota: the tab simply reopens on ticket 1 */
  }
}

/** Announce a call in one sentence, for the screen-reader status region. */
export function callAnnouncement(number, remaining) {
  if (!Number.isInteger(number)) return "";
  const tail = Number.isInteger(remaining) ? " " + remaining + " numbers left." : "";
  return "Number " + number + " called." + tail;
}
