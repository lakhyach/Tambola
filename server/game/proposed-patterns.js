/**
 * Winning-pattern approval ledger.
 *
 * A name in the registry and a name the client has approved are two different
 * things, and this file keeps them apart. It used to hold a proposed Early Seven
 * predicate that the live registry could not award; the client's instruction to
 * build five new categories moved that rule (and Star, Second Full House, Half
 * Sheet and Box) into `server/game/patterns.js`, switched off by default, so the
 * predicate is gone - one definition, evaluated by the server, drawn for the
 * player, asserted by the same fixtures.
 *
 * What remains is the maturity of every rule name this project has looked at, so
 * a reader cannot mistake "implemented" for "approved for production":
 *
 *   live          approved winning rules, on in every room (the shipped six)
 *   live-optional implemented and exact, but only for rooms that opt in - the
 *                 definition is published by real rule pages yet is not universal,
 *                 so nobody's game pays for it unless its host asks for it
 *   approval      still no written definition. Do NOT implement on a guess; the
 *                 blocker says precisely what is unresolved
 *
 * Evidence, cell coordinates and the sign-off questions are in
 * docs/NEW-WINNING-PATTERNS.md; docs/RULES-DECISIONS.md carries the decisions.
 */

/** States of the ledger, in the order a reviewer should read them. */
export const APPROVAL_STATES = Object.freeze(["live", "live-optional", "approval"]);

export const PROPOSAL_STATUS = Object.freeze({
  earlyFive: { state: "live", blocker: "" },
  topLine: { state: "live", blocker: "" },
  middleLine: { state: "live", blocker: "" },
  bottomLine: { state: "live", blocker: "" },
  corners: { state: "live", blocker: "" },
  fullHouse: { state: "live", blocker: "" },

  // The five this project was asked to add. Implemented, tested, off by default.
  earlySeven: {
    state: "live-optional",
    blocker:
      "definition is unambiguous (seven of the ticket's own numbers); the points weight and whether a room should " +
      "get it without asking are the client's call",
  },
  star: {
    state: "live-optional",
    blocker:
      "built as corners-plus-middle-row-third over the row's filled cells (S1 chart). The alternative reading - the " +
      "literal centre CELL, which can be blank - is rejected because it needs a fallback rule nobody publishes",
  },
  secondFullHouse: {
    state: "live-optional",
    blocker:
      "definition is exact (the next ticket to finish, the first winner's ticket excluded); the prize weight and " +
      "whether the round is held open for it are client decisions",
  },
  halfSheet: {
    state: "live-optional",
    blocker:
      "four published meanings. Implemented as two numbers called on each of three tickets of one seat; a real " +
      "sheet is six tickets, and this game deals independent ones, so the seat stands in for the sheet - the client " +
      "must approve that deviation or replace the rule",
  },
  box: {
    state: "live-optional",
    blocker:
      "built as the middle three columns (the 'Box of 9' block). Some chart pages use 'Box' for the four corners, " +
      "which this game already awards as Corners, so the name is not free - client confirmation needed",
  },

  // Never implemented, never will be on a guess.
  middleNumber: {
    state: "approval",
    blocker:
      "S3 defines Laddu as the middle number of the second line; whether the prize is that VALUE or a CELL, and " +
      "what happens when the cell is blank, is unresolved",
  },
  oneFourThree: {
    state: "approval",
    blocker: "no source explains 1-4-3 beyond row counts; call-order semantics are unknown",
  },
  pyramid: {
    state: "approval",
    blocker: "no source publishes the cell diagram; the old code counted marks only",
  },
});

/** The optional five: registered, and refused until a room asks for them. */
export const OPTIONAL_PATTERN_IDS = Object.freeze([
  "earlySeven",
  "star",
  "secondFullHouse",
  "halfSheet",
  "box",
]);
