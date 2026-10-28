/**
 * Winning-pattern rule registry.
 *
 * Every supported pattern is a pure predicate over (ticket, calledNumbers).
 * The server is the only place that evaluates them; browsers submit an intent
 * ("I claim <pattern>") and receive a verdict. Nothing here reads client
 * supplied marks, points, or winner flags.
 *
 * Definitions are deliberately explicit because the previous implementation
 * approximated several patterns with "count of manually marked cells", which
 * is not the traditional rule. See DEFERRED_PATTERNS for the ones we refused
 * to guess at.
 *
 * Award policy: every supported pattern is EXCLUSIVE - the first valid claim
 * wins it and the pattern closes. `multipleWinnersPerPattern` in the room
 * config can relax this later if the product ever wants split prizes; it is
 * off by default and documented as a rules decision, not a bug.
 */

import { ROWS, COLS, NUMBERS_PER_ROW, rowNumbers, ticketNumbers } from "./ticket.js";

/** Called-set helper: numbers the server has officially called. */
function calledSet(calledNumbers) {
  return new Set(calledNumbers);
}

/** Index (1-based call ordinal) at which a number was called, or Infinity. */
function callOrdinal(calledNumbers, value) {
  const at = calledNumbers.indexOf(value);
  return at === -1 ? Infinity : at + 1;
}

/** Filled cell columns of a row, left to right (rows always hold exactly 5). */
function filledColumns(ticket, rowIndex) {
  const cols = [];
  for (let col = 0; col < COLS; col++) {
    if (ticket[rowIndex][col] !== null && ticket[rowIndex][col] !== undefined) cols.push(col);
  }
  return cols;
}

function lineChecker(rowIndex) {
  return function checkLine(ticket, calledNumbers) {
    const line = rowNumbers(ticket, rowIndex);
    if (line.length !== NUMBERS_PER_ROW) {
      throw new Error("pattern check needs a legal ticket, row " + (rowIndex + 1) + " has " + line.length + " numbers");
    }
    const called = calledSet(calledNumbers);
    const complete = line.every((n) => called.has(n));
    if (!complete) {
      const missing = line.filter((n) => !called.has(n));
      return { valid: false, reason: "line incomplete", missing };
    }
    // "First to complete" is enforced by exclusive arbitration, not here.
    return { valid: true };
  };
}

export const PATTERNS = Object.freeze({
  earlyFive: {
    id: "earlyFive",
    label: "Early Five",
    points: 20,
    exclusive: true,
    enabledByDefault: true,
    definition:
      "The first five numbers on the player's ticket to be called. A claim is valid as soon as five of the " +
      "fifteen ticket numbers have been called, regardless of how many the player has tapped, so it can never " +
      "become unclaimable because a sixth number was marked or called first.",
    check(ticket, calledNumbers) {
      const called = calledSet(calledNumbers);
      const hits = ticketNumbers(ticket).filter((n) => called.has(n));
      if (hits.length < 5) {
        return { valid: false, reason: "fewer than five ticket numbers called", needed: 5 - hits.length };
      }
      // the moment the pattern COMPLETED is the ordinal of the fifth ticket
      // number to be called - later calls and extra hits never move it, which is
      // what keeps the prize claimable (and window-checked) once it is earned
      const ordinals = hits.map((n) => callOrdinal(calledNumbers, n)).sort((a, b) => a - b);
      return { valid: true, completedOnCall: ordinals[4], hits: hits.length };
    },
  },

  topLine: {
    id: "topLine",
    label: "Top Line",
    points: 10,
    exclusive: true,
    enabledByDefault: true,
    definition: "All five numbered cells of the top row have been called.",
    check: lineChecker(0),
  },

  middleLine: {
    id: "middleLine",
    label: "Middle Line",
    points: 10,
    exclusive: true,
    enabledByDefault: true,
    definition: "All five numbered cells of the middle row have been called.",
    check: lineChecker(1),
  },

  bottomLine: {
    id: "bottomLine",
    label: "Bottom Line",
    points: 10,
    exclusive: true,
    enabledByDefault: true,
    definition: "All five numbered cells of the bottom row have been called.",
    check: lineChecker(2),
  },

  corners: {
    id: "corners",
    label: "Corners",
    points: 20,
    exclusive: true,
    enabledByDefault: true,
    definition:
      "The four corner cells of the ticket. On a 3x9 Tambola layout the outer columns can be empty, so the " +
      "corners are defined as the leftmost and rightmost numbered cell of the top row and the leftmost and " +
      "rightmost numbered cell of the bottom row - all four must be called.",
    check(ticket, calledNumbers) {
      const top = filledColumns(ticket, 0);
      const bottom = filledColumns(ticket, ROWS - 1);
      const needed = [
        ticket[0][top[0]],
        ticket[0][top[top.length - 1]],
        ticket[ROWS - 1][bottom[0]],
        ticket[ROWS - 1][bottom[bottom.length - 1]],
      ];
      const called = calledSet(calledNumbers);
      const missing = needed.filter((n) => !called.has(n));
      if (missing.length) {
        return { valid: false, reason: "corners incomplete", missing };
      }
      return { valid: true };
    },
  },

  fullHouse: {
    id: "fullHouse",
    label: "Full House",
    points: 30,
    exclusive: true,
    enabledByDefault: true,
    definition: "All fifteen numbers on the ticket have been called.",
    check(ticket, calledNumbers) {
      const needed = ticketNumbers(ticket);
      const called = calledSet(calledNumbers);
      const missing = needed.filter((n) => !called.has(n));
      if (missing.length) {
        return { valid: false, reason: "full house incomplete", missing };
      }
      return { valid: true };
    },
  },
});

/**
 * Patterns the old UI offered but whose rules could not be pinned down from
 * the code or the README. Left unimplemented on purpose rather than guessed
 * at - each entry states the exact ambiguity to be resolved before building.
 */
export const DEFERRED_PATTERNS = Object.freeze({
  earlySeven: {
    label: "Early Seven",
    reason:
      "Mirrors Early Five, but the traditional variants differ on whether it is seven of the ticket's numbers " +
      "within a fixed call window or simply the seventh hit. Needs a product decision on the window.",
  },
  star: {
    label: "Star",
    reason:
      "The old code used line2[Math.floor(len/2)] - the middle VALUE of a sorted row - while the pattern is " +
      "normally the centre CELL (row 2, column 5) plus the four corners. Column 5 can be empty on a legal " +
      "ticket, so the fallback rule must be specified.",
  },
  middleNumber: {
    label: "Middle Number",
    reason: "Same value-versus-cell ambiguity as Star, and the centre cell is not guaranteed to exist.",
  },
  oneFourThree: {
    label: "1 2 3 / 143",
    reason:
      "The old check was l1>=1 && l2>=4 && l3>=3 on marked counts. 143 conventionally means one number in the " +
      "first row, four in the second, three in the third of a specific arrangement, in call order. Requires a " +
      "written definition.",
  },
  pyramid: {
    label: "Pyramid",
    reason:
      "The old check compared marked counts only. A pyramid needs an explicit set of cell positions per row.",
  },
});

/** Pattern ids the server will actually accept claims for. */
export function enabledPatternIds(config = {}) {
  const overrides = config.patterns || {};
  return Object.values(PATTERNS)
    .filter((pattern) => {
      const override = overrides[pattern.id];
      return override === undefined ? pattern.enabledByDefault : Boolean(override);
    })
    .map((pattern) => pattern.id);
}

export function getPattern(patternId, config = {}) {
  const pattern = PATTERNS[patternId];
  if (!pattern) return null;
  if (!enabledPatternIds(config).includes(patternId)) return null;
  return pattern;
}

/**
 * Evaluate one claim. Pure: given the authoritative ticket and called history
 * it returns whether the pattern is genuinely complete right now.
 */
export function evaluateClaim(patternId, ticket, calledNumbers, config = {}) {
  const pattern = getPattern(patternId, config);
  if (!pattern) return { valid: false, reason: "unknown or disabled pattern: " + patternId };
  if (!Array.isArray(ticket) || ticket.length !== ROWS) {
    return { valid: false, reason: "claimant has no legal ticket" };
  }
  const result = pattern.check(ticket, calledNumbers);
  const window = config.earlyFiveMaxCalls;
  if (result.valid && patternId === "earlyFive" && Number.isInteger(window) && window > 0) {
    if (result.completedOnCall > window) {
      return { valid: false, reason: "early five window of " + window + " calls already passed" };
    }
  }
  return { ...result, pattern: patternId, points: pattern.points, label: pattern.label };
}
