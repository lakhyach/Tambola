/**
 * What the player join page should do the moment it opens.
 *
 * Three situations look identical from the outside and are not the same thing:
 *
 *   1. this tab already holds a seat  — the player refreshed, or came back to the
 *      tab they were playing in. Resume it; that is the promise on the landing
 *      page and losing it mid-round is worse than any convenience.
 *   2. this tab holds nothing, but the browser remembers a seat from somebody who
 *      last sat down here — a NEW TAB. The device copy is a recovery fallback for
 *      a phone that dropped and rebuilt its tab, and it cannot tell that apart
 *      from a second player opening a link. So the page asks: one tap reclaims
 *      the remembered seat, one tap joins fresh. Silently adopting it would mean
 *      N tabs are not N players, which is how a family playing on one laptop
 *      loses a seat.
 *   3. nothing remembered anywhere — the ordinary join form.
 *
 * An invite link carrying a room code is always case 3 with the code prefilled:
 * the host sharing a link expects the person who opens it to become a new player,
 * not to be logged in as the host.
 *
 * Run: npm test (tests/seat-credential.test.js drives these cases).
 */
import { isSeat } from "./seatStore.js";

/** Routes under /player that need a seat: they resume for themselves. */
const JOIN_PATH = "/player";

/**
 * @param {{pathname?: string, searchTerm?: string|null, own?: object, pending?: object}} input
 *   `own` is this tab's seat (no device fallback), `pending` is the device copy
 *   seen only because this tab has nothing of its own.
 * @returns {{action: "none" | "resume" | "offer", seat?: object, code?: string}}
 *   `resume` — take this tab straight back to its room;
 *   `offer`  — show the choice for `seat` and stay on the join form;
 *   `none`   — show the join form, with `code` prefilled when an invite gave one.
 */
export function planJoinEntry({ pathname = JOIN_PATH, searchTerm = null, own = null, pending = null } = {}) {
  if (pathname !== JOIN_PATH) return { action: "none" };

  const code = typeof searchTerm === "string" && searchTerm.trim() ? searchTerm.trim().toUpperCase() : "";
  if (code) return { action: "none", code };

  // This tab's own seat may be resumed without asking — with one exception: a
  // host tab that wanders onto the player join page belongs on the host route.
  // Bouncing it into /player/room would show "You're Seated" to the person
  // holding the draw controls, so leave them the form and let /host resume.
  if (isSeat(own) && own.role !== "host") return { action: "resume", seat: own };

  // Only a remembered PLAYER seat is worth offering here. A host seat belongs to
  // the host tab; offering it on the join page would invite a stranger into the
  // draw controls, and the host route resumes its own seat anyway.
  if (isSeat(pending) && pending.role === "player") return { action: "offer", seat: pending };

  return { action: "none" };
}

/** Plain-language label for the seat being offered, from what the browser holds. */
export function offeredSeatLabel(seat) {
  const name = seat && typeof seat.name === "string" && seat.name.trim() ? seat.name.trim() : "a player";
  const room = seat && typeof seat.roomId === "string" ? seat.roomId.trim().toUpperCase() : "";
  return room ? `${name} · room ${room}` : name;
}
