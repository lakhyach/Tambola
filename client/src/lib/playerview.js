/**
 * What the game screen should show, and say, derived from the server snapshot.
 *
 * This lives apart from the React components because it is the whole answer to a
 * question the browser proved we had wrong: a seat that joined while a round was
 * already running owns no tickets (the server locks ticket selection at start),
 * and the screen used to invent an empty 3x9 grid to stand in for one. The player
 * saw "YOUR TICKET 0/15 MARKED" above a board with no numbers — a control that
 * looks broken, and claim buttons the server would only refuse.
 *
 * So the rule is stated here, once, and only ever reads server fields:
 *   sheets    the tickets this seat actually owns, exactly as issued; never a
 *             placeholder grid built from nothing
 *   panel     which of the three honest states the ticket area is in:
 *             "tickets"  — the seat owns tickets, draw them
 *             "choose"   — the round has not started, pick a ticket count first
 *             "spectator"— the round is running and this seat has no ticket, so
 *                          it watches this one and plays the next
 *   claimNote the reason a disabled claim control is disabled, per server state
 *   rosterTally how the roster counts its seats, per server state
 *
 * Run: npm test (tests/player-experience.test.js drives this directly).
 */

/** @typedef {"tickets" | "choose" | "spectator"} TicketPanel */

/** A grid is a ticket only if it carries numbers. Three empty rows is not one. */
function hasNumbers(grid) {
  return Array.isArray(grid) && grid.some((row) => Array.isArray(row) && row.some((n) => n != null));
}

/**
 * The tickets the server issued to this seat.
 *
 * Accepts either shape the snapshots use: `tickets` (the multi-ticket list) or
 * the older single `ticket` grid. Returns [] when the server issued nothing —
 * that is a real state, not a gap to paper over.
 */
export function ticketSheets(snap) {
  const list = Array.isArray(snap?.tickets) ? snap.tickets : [];
  const sheets = list
    .filter((t) => t && hasNumbers(t.grid))
    .map((t, i) => ({ no: t.no ?? i + 1, grid: t.grid }));
  if (sheets.length) return sheets.sort((a, b) => a.no - b.no);
  if (hasNumbers(snap?.ticket)) return [{ no: 1, grid: snap.ticket }];
  return [];
}

/** How many of these are actually playable tickets. */
function ownedSheets(sheets) {
  return Array.isArray(sheets) ? sheets.filter((t) => t && hasNumbers(t.grid)) : [];
}

/**
 * Decide what the ticket area shows.
 *
 * @param {{state?: string, sheets?: unknown[]}} input
 * @returns {TicketPanel}
 */
export function ticketPanel({ state = "WAITING", sheets = [] } = {}) {
  if (ownedSheets(sheets).length > 0) return "tickets";
  // No ticket and the round has not started: nothing has gone wrong, the seat
  // simply has not chosen yet, and the picker above is the control that works.
  return state === "WAITING" ? "choose" : "spectator";
}

/**
 * Claim controls are only worth offering to a seat that can win something: the
 * round must be running and the seat must hold a ticket. Anything else is shown
 * as explicitly unavailable, with the reason beside the heading, instead of a
 * button that only earns a refusal. (The host is a seated participant too and
 * claims like anybody else, so the seat's role plays no part here.)
 */
export function canClaim({ state, sheets }) {
  return state === "RUNNING" && ownedSheets(sheets).length > 0;
}

/**
 * Why the claim buttons are unavailable, beside the heading — or nothing when
 * they are live.
 *
 * The one sentence that used to sit here read "claims open while running" in
 * every state, so after a round ended it kept promising claims that this round
 * would never offer again. Each state now says what is true of it. This is text
 * only: the buttons themselves are disabled from `canClaim`, which is the gate
 * the server agrees with.
 *
 * @param {{state?: string, sheets?: unknown[]}} input
 * @returns {string|null}
 */
export function claimNote({ state, sheets } = {}) {
  const owned = ownedSheets(sheets).length > 0;
  if (state === "RUNNING") return owned ? null : "no ticket this round";
  if (state === "WAITING") return "claims open when the round starts";
  if (state === "PAUSED") return owned ? "claims reopen when the host resumes" : "no ticket this round";
  if (state === "COMPLETED") return "this round is finished";
  return "claims are unavailable right now";
}

/**
 * How the roster counts the seats, in words the server state supports.
 *
 * The heading used to say "N playing" on the waiting screen too, before a single
 * number had been called — small, but the same §5 failure as a dead button: text
 * describing an action the room is not taking. Seats are "seated" before a round,
 * "playing" through it (a pause stops the draw, not the game), and had "played"
 * once it is over.
 */
export function rosterTally(state, count) {
  const n = Number.isFinite(count) && count >= 0 ? count : 0;
  const unit = state === "RUNNING" || state === "PAUSED" ? "playing" : state === "COMPLETED" ? "played" : "seated";
  return n + " " + unit;
}

/**
 * What a roster row should show at its right edge - or nothing.
 *
 * Before a round every seat is on zero, so the old unlabelled "0" was a number
 * with no meaning attached: it read as "this player has nothing" rather than
 * "the round has not started". While waiting, the honest figure is how many
 * tickets the seat holds (that is what the host needs to know before starting);
 * once play begins it is points, with the unit spelled out.
 *
 * @param {{points?: number, tickets?: number}} seat
 * @param {string} state
 * @returns {{value: number, unit: string} | null}
 */
export function rosterStatistic(seat = {}, state) {
  if (state === "WAITING") {
    const held = Number.isFinite(seat.tickets) ? seat.tickets : 0;
    return held > 0 ? { value: held, unit: held === 1 ? "ticket" : "tickets" } : null;
  }
  const points = Number.isFinite(seat.points) ? seat.points : 0;
  if (points > 0 || state === "RUNNING" || state === "PAUSED" || state === "COMPLETED") {
    return { value: points, unit: "pts" };
  }
  return null;
}
