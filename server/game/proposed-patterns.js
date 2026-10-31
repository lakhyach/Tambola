/**
 * Proposed winning patterns - evaluated, tested, and deliberately NOT registered.
 *
 * Nothing here can award a prize. A claim is only accepted for an id in
 * `PATTERNS` (server/game/patterns.js), and none of these ids is in it, so the
 * live engine answers "unknown or disabled pattern" exactly as before. This
 * module exists so that the day a client approves one of these rules, enabling
 * it is a two-line change with fixtures already proven, instead of a rewrite
 * done under deadline pressure against a live game.
 *
 * Why a separate module rather than a flag on PATTERNS:
 *   the admin console derives its pattern toggles from the client's metadata
 *   map, and the room form defaults to "every pattern we know". Registering a
 *   pattern - even with `enabledByDefault: false` - would make it one checkbox
 *   away from paying points in a game whose owner never asked for it. Phase 16B
 *   had no client approval for that, so the rules stay outside the registry
 *   until they are approved (docs/RULES-DECISIONS.md carries the sign-off).
 *
 * Evidence for `earlySeven` (see docs/MARKET-BENCHMARK.md §4a):
 *   S3 (nLife dividends) defines the sibling dividend "Jaldi 5" as any five
 *   called numbers, and S2/S4 both name an "Early 7 / Early Seven" milestone.
 *   No source publishes a call WINDOW for it, and none makes it positional.
 *   "Seven of the ticket's fifteen numbers have been called" is therefore the
 *   only reading consistent with every published sibling definition, and it is
 *   unambiguous: no cell layout, no column, no arrangement.
 */

import { ticketNumbers } from "./ticket.js";

/** Index (1-based call ordinal) at which a number was called, or Infinity. */
function callOrdinal(calledNumbers, value) {
  const at = calledNumbers.indexOf(value);
  return at === -1 ? Infinity : at + 1;
}

export const PROPOSED_PATTERNS = Object.freeze({
  earlySeven: {
    id: "earlySeven",
    label: "Early Seven",
    /** Proposed weight; a product decision, not a rule decision. */
    proposedPoints: 25,
    exclusive: true,
    definition:
      "Seven of the fifteen numbers on the player's own ticket have been called. Position on the ticket never " +
      "matters - it is the seventh of that ticket's numbers to be called. Completing it cannot be undone by an " +
      "eighth call, so the prize stays claimable within the room's claim window.",
    evidence: "S3 Jaldi 5 definition (any five called) + S2/S4 'Early 7 / Early Seven' dividend names",
    check(ticket, calledNumbers) {
      const called = new Set(calledNumbers);
      const hits = ticketNumbers(ticket).filter((n) => called.has(n));
      if (hits.length < 7) {
        return { valid: false, reason: "fewer than seven ticket numbers called", needed: 7 - hits.length };
      }
      // the ordinal of the SEVENTH hit: later calls never move it, which is what
      // makes the claim window (config.claimWindowCalls) measurable at all
      const ordinals = hits.map((n) => callOrdinal(calledNumbers, n)).sort((a, b) => a - b);
      return { valid: true, completedOnCall: ordinals[6], hits: hits.length };
    },
  },
});

/**
 * Maturity of each proposal, so a reader cannot mistake "tested" for "approved".
 *   defined   : the rule is unambiguous and covered by fixtures
 *   points    : the rule is exact; the prize weight still needs the client
 *   approval  : a written definition is still missing; do not implement
 */
export const PROPOSAL_STATUS = Object.freeze({
  earlySeven: { state: "points", blocker: "client sign-off on the points value and whether it is enabled by default" },
  star: { state: "approval", blocker: "whether the centre is a CELL (row 2, col 5, may be blank) or a VALUE" },
  middleNumber: { state: "approval", blocker: "S3 defines Laddu as the middle number of the second line; cell vs value is unresolved" },
  oneFourThree: { state: "approval", blocker: "no source explains 1-4-3 beyond row counts; call-order semantics are unknown" },
  pyramid: { state: "approval", blocker: "no source publishes the cell diagram; the old code counted marks only" },
});
