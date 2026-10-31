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
 *
 * The five OPTIONAL patterns (`optional: true`, `enabledByDefault: false`) are
 * the categories whose market definitions are published but not universal:
 * Star, Second Full House, Early Seven, Half Sheet and Box. They are in the
 * registry so the server can evaluate them at all, and switched off so that no
 * room pays for a rule its owner never opted into. Enabling one is a per-room
 * decision the host makes before the round starts (docs/NEW-WINNING-PATTERNS.md
 * §6 carries the evidence and the approval state for each).
 */

import { ROWS, NUMBERS_PER_ROW, rowNumbers, ticketNumbers } from "./ticket.js";
import {
  EXAMPLE_TICKET,
  boxCells,
  cellValues,
  cornerCells,
  filledColumns,
  rowCells,
  starCells,
} from "./pattern-geometry.js";

/** Called-set helper: numbers the server has officially called. */
function calledSet(calledNumbers) {
  return new Set(calledNumbers);
}

/** Index (1-based call ordinal) at which a number was called, or Infinity. */
function callOrdinal(calledNumbers, value) {
  const at = calledNumbers.indexOf(value);
  return at === -1 ? Infinity : at + 1;
}

/**
 * The call ordinal that COMPLETED a pattern: the last of its required numbers
 * to be called. Every pattern can therefore answer "when did I become claimable",
 * which is what the late-claim window needs (see config.claimWindowCalls).
 */
function completionOrdinal(calledNumbers, needed) {
  let last = 0;
  for (const n of needed) {
    const at = callOrdinal(calledNumbers, n);
    if (at === Infinity) return Infinity;
    if (at > last) last = at;
  }
  return last;
}

/** Every numbered cell of a ticket, as [row, column] coordinates. */
function allCells(ticket) {
  const cells = [];
  for (let row = 0; row < ROWS; row++) {
    for (const col of filledColumns(ticket, row)) cells.push([row, col]);
  }
  return cells;
}

/**
 * A pattern defined as a fixed set of ticket cells: claimable when every cell
 * in the diagram has been called. Star and Box are built from it, so the cells
 * the player is shown are exactly the cells the server checks.
 */
function cellChecker(cellsFor, reason) {
  return function checkCells(ticket, calledNumbers) {
    const cells = cellsFor(ticket);
    const needed = cellValues(ticket, cells);
    const called = calledSet(calledNumbers);
    const missing = needed.filter((n) => !called.has(n));
    if (missing.length) return { valid: false, reason, missing };
    return { valid: true, completedOnCall: completionOrdinal(calledNumbers, needed) };
  };
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
    return { valid: true, completedOnCall: completionOrdinal(calledNumbers, line) };
  };
}

export const PATTERNS = Object.freeze({
  earlyFive: {
    id: "earlyFive",
    label: "Early Five",
    points: 20,
    exclusive: true,
    enabledByDefault: true,
    kind: "count",
    need: 5,
    hint: "Any five of the ticket's fifteen numbers called",
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
    kind: "cells",
    hint: "All five numbers in the top row",
    diagram: (ticket) => rowCells(ticket, 0, [1, 2, 3, 4, 5]),
    definition: "All five numbered cells of the top row have been called.",
    check: lineChecker(0),
  },

  middleLine: {
    id: "middleLine",
    label: "Middle Line",
    points: 10,
    exclusive: true,
    enabledByDefault: true,
    kind: "cells",
    hint: "All five numbers in the middle row",
    diagram: (ticket) => rowCells(ticket, 1, [1, 2, 3, 4, 5]),
    definition: "All five numbered cells of the middle row have been called.",
    check: lineChecker(1),
  },

  bottomLine: {
    id: "bottomLine",
    label: "Bottom Line",
    points: 10,
    exclusive: true,
    enabledByDefault: true,
    kind: "cells",
    hint: "All five numbers in the bottom row",
    diagram: (ticket) => rowCells(ticket, 2, [1, 2, 3, 4, 5]),
    definition: "All five numbered cells of the bottom row have been called.",
    check: lineChecker(2),
  },

  corners: {
    id: "corners",
    label: "Corners",
    points: 20,
    exclusive: true,
    enabledByDefault: true,
    kind: "cells",
    hint: "The outermost numbers of the top and bottom rows",
    diagram: cornerCells,
    definition:
      "The four corner cells of the ticket. On a 3x9 Tambola layout the outer columns can be empty, so the " +
      "corners are defined as the leftmost and rightmost numbered cell of the top row and the leftmost and " +
      "rightmost numbered cell of the bottom row - all four must be called.",
    check: cellChecker(cornerCells, "corners incomplete"),
  },

  fullHouse: {
    id: "fullHouse",
    label: "Full House",
    points: 30,
    exclusive: true,
    enabledByDefault: true,
    kind: "all",
    hint: "All fifteen numbers on the ticket",
    diagram: allCells,
    definition: "All fifteen numbers on the ticket have been called.",
    check(ticket, calledNumbers) {
      const needed = ticketNumbers(ticket);
      const called = calledSet(calledNumbers);
      const missing = needed.filter((n) => !called.has(n));
      if (missing.length) {
        return { valid: false, reason: "full house incomplete", missing };
      }
      return { valid: true, completedOnCall: completionOrdinal(calledNumbers, needed) };
    },
  },

  // ------------------------------------------------------- optional patterns
  //
  // Registered so the server CAN evaluate them, switched off so that no room
  // pays for a rule its owner never chose. Each carries its evidence and its
  // approval state in docs/NEW-WINNING-PATTERNS.md.

  earlySeven: {
    id: "earlySeven",
    label: "Early Seven",
    points: 25,
    exclusive: true,
    enabledByDefault: false,
    optional: true,
    kind: "count",
    need: 7,
    hint: "Any seven of the ticket's fifteen numbers called",
    definition:
      "Seven of the fifteen numbers on the player's ticket have been called. Position never matters - it is the " +
      "seventh of that ticket's numbers to be called. An eighth call can neither un-earn it nor duplicate it, " +
      "because the completion stays pinned to the ordinal of the seventh hit.",
    check(ticket, calledNumbers) {
      const called = calledSet(calledNumbers);
      const hits = ticketNumbers(ticket).filter((n) => called.has(n));
      if (hits.length < 7) {
        return { valid: false, reason: "fewer than seven ticket numbers called", needed: 7 - hits.length };
      }
      const ordinals = hits.map((n) => callOrdinal(calledNumbers, n)).sort((a, b) => a - b);
      return { valid: true, completedOnCall: ordinals[6], hits: hits.length };
    },
  },

  star: {
    id: "star",
    label: "Star",
    points: 25,
    exclusive: true,
    enabledByDefault: false,
    optional: true,
    kind: "cells",
    hint: "The four corners plus the middle row's third number",
    definition:
      "The four corner cells plus the centre number of the middle row - that row's third number, counted over its " +
      "five filled cells. The cell always exists on a legal ticket, so no fallback rule is needed. It is not the " +
      "Laddu prize, which is the middle row's third number alone, and not the decorative star some chart pages " +
      "picture without naming its cells.",
    diagram: starCells,
    check: cellChecker(starCells, "star incomplete"),
  },

  box: {
    id: "box",
    label: "Box",
    points: 25,
    exclusive: true,
    enabledByDefault: false,
    optional: true,
    kind: "cells",
    hint: "Every number in the middle three columns",
    definition:
      "Every numbered cell of the three middle columns (30-39, 40-49 and 50-59): the central block left after the " +
      "first three and the last three columns are set aside. Three columns by three rows is at most nine cells, " +
      "which is why callers name it the Box of 9, and a legal ticket always holds at least one number per column, " +
      "so the block always holds at least three. It is not the four corners - this game already awards those as " +
      "Corners - and it is not a fixed count of cells, because the block's depth depends on the ticket.",
    diagram: boxCells,
    check: cellChecker(boxCells, "box incomplete"),
  },

  secondFullHouse: {
    id: "secondFullHouse",
    label: "Second Full House",
    points: 15,
    exclusive: true,
    enabledByDefault: false,
    optional: true,
    kind: "all",
    hint: "The next ticket to finish all fifteen, after the first Full House",
    definition:
      "The next ticket to have all fifteen numbers called AFTER the first Full House has been awarded. The ticket " +
      "that won the first Full House can never win this one, so no ticket is paid twice for the same position, while " +
      "a different ticket of the same player may still take it. A claim made before the first Full House is settled " +
      "is refused. Enabling this prize does not change when the round ends.",
    requires: {
      pattern: "fullHouse",
      excludeWinningTicket: true,
      notYet: "the first Full House has not been claimed yet, so there is no second place to claim",
      takenTicket: "already won the first Full House, so it cannot win the second",
    },
    diagram: allCells,
    check(ticket, calledNumbers) {
      const needed = ticketNumbers(ticket);
      const called = calledSet(calledNumbers);
      const missing = needed.filter((n) => !called.has(n));
      if (missing.length) {
        return { valid: false, reason: "full house incomplete", missing };
      }
      return { valid: true, completedOnCall: completionOrdinal(calledNumbers, needed) };
    },
  },

  halfSheet: {
    id: "halfSheet",
    label: "Half Sheet",
    points: 20,
    exclusive: true,
    enabledByDefault: false,
    optional: true,
    scope: "seat",
    kind: "seat",
    seat: { tickets: 3, perTicket: 2 },
    hint: "Two numbers called on each of three of your tickets",
    definition:
      "A seat holding at least three tickets wins once two of a ticket's own numbers have been called on each of " +
      "three tickets - three partial lines instead of one finished ticket. Printed Tambola comes in sheets of six " +
      "and this prize is traditionally shared across half of one; this game deals independent tickets, so the rule " +
      "counts the tickets one seat holds instead of tickets that share a sheet. Other publishers describe the same " +
      "name as one number on each of three tickets, or as a complete half of a single ticket, which is exactly why " +
      "it stays switched off until the client approves one wording.",
    diagram: (ticket) => rowCells(ticket, 0, [1, 2]),
    diagramNote: "Any two cells of a ticket count; the diagram marks its first two as an example.",
    // Guarded so that a single-ticket evaluation asks for the seat view instead
    // of throwing: this pattern has no answer for one ticket on its own.
    check() {
      return { valid: false, reason: "half sheet is judged across three of your tickets, not on one" };
    },
    checkSeat(tickets, calledNumbers) {
      const called = calledSet(calledNumbers);
      if (tickets.length < 3) {
        return { valid: false, reason: "half sheet needs three tickets, this seat holds " + tickets.length };
      }
      const scored = tickets
        .map((t) => {
          const hits = ticketNumbers(t.grid).filter((n) => called.has(n));
          const ordinals = hits.map((n) => callOrdinal(calledNumbers, n)).sort((a, b) => a - b);
          return { ticketNo: t.no, hits: hits.length, secondHit: ordinals.length >= 2 ? ordinals[1] : Infinity };
        })
        .filter((entry) => entry.hits >= 2)
        .sort((a, b) => a.secondHit - b.secondHit || a.ticketNo - b.ticketNo);
      if (scored.length < 3) {
        return {
          valid: false,
          reason: "only " + scored.length + " of your tickets have two numbers called",
          needed: 3 - scored.length,
        };
      }
      // the three EARLIEST tickets to reach two marks decide the seat, and the
      // pattern completes when the last of those three got its second number
      const chosen = scored.slice(0, 3);
      return {
        valid: true,
        completedOnCall: chosen[chosen.length - 1].secondHit,
        ticketNos: chosen.map((entry) => entry.ticketNo).sort((a, b) => a - b),
      };
    },
  },
});

/**
 * Patterns the old UI offered but whose rules could not be pinned down from
 * the code or the README. Left unimplemented on purpose rather than guessed
 * at - each entry states the exact ambiguity to be resolved before building.
 *
 * earlySeven and star moved out of this list into the registry when the client
 * authorised the five new categories: both have definitions published by
 * multiple independent rule pages (docs/NEW-WINNING-PATTERNS.md §2), so they
 * are implemented, switched off by default, and no longer guessed at.
 */
export const DEFERRED_PATTERNS = Object.freeze({
  middleNumber: {
    label: "Middle Number",
    reason:
      "Same value-versus-cell ambiguity as Star, and the centre cell is not guaranteed to exist. Chart pages call " +
      "the middle row's third number Laddu or Ladoo; the client has not asked for it under either name.",
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
  const late = windowVerdict(patternId, pattern, result, calledNumbers, config);
  if (late) return late;
  return { ...result, pattern: patternId, points: pattern.points, label: pattern.label };
}

/**
 * The two time limits, applied identically to a single ticket and to a seat
 * that spans several: Early Five's optional call ceiling and the late-claim
 * window. `0` is the traditional rule ("claim before the next number"); `N`
 * allows N further calls of grace for slow phones and networks; a negative or
 * non-integer value turns the rule off. Measured here, at the moment of the
 * claim, against the server's own call history - never against a timestamp the
 * client reports.
 *
 * Returns null when nothing refuses the claim.
 */
function windowVerdict(patternId, pattern, result, calledNumbers, config) {
  if (!result.valid) return null;
  const earlyFiveWindow = config.earlyFiveMaxCalls;
  if (patternId === "earlyFive" && Number.isInteger(earlyFiveWindow) && earlyFiveWindow > 0) {
    if (result.completedOnCall > earlyFiveWindow) {
      return {
        valid: false,
        reason: "early five window of " + earlyFiveWindow + " calls already passed",
        pattern: patternId,
        points: pattern.points,
        label: pattern.label,
      };
    }
  }

  const claimWindow = config.claimWindowCalls;
  if (Number.isInteger(claimWindow) && claimWindow >= 0 && Number.isInteger(result.completedOnCall)) {
    const lateBy = calledNumbers.length - result.completedOnCall;
    if (lateBy > claimWindow) {
      return {
        valid: false,
        late: true,
        lateBy,
        reason:
          "claim too late: " + lateBy + " call" + (lateBy === 1 ? "" : "s") + " went out after the pattern completed",
        pattern: patternId,
        points: pattern.points,
        label: pattern.label,
      };
    }
  }
  return null;
}

/**
 * Evaluate one claim across a seat's multiple tickets.
 *
 * A player holding several tickets completes a ticket-scoped pattern on ANY of
 * them, but the award itself is still per seat (a seat wins a pattern once).
 * Each ticket is verified with the single-ticket rule above - so Early Five's
 * call window and the completion ordinal still apply - and the server, never
 * the client, picks which ticket won: the earliest completion, breaking ties by
 * ticket number.
 *
 * Two kinds of pattern need more than one ticket's grids:
 *   scope "seat"   - Half Sheet, judged on the seat's tickets together
 *   requires       - Second Full House, which may only be claimed after another
 *                    award exists and never on the ticket that already won it
 * Both are checked here, from server-owned data, so a claim can never be
 * talked into paying twice.
 *
 * @param {Array<{no:number, grid}|[]>} tickets the seat's own tickets
 * @param {{ticketNo?: number, claimantId?: string|null, awards?: Array<{pattern:string, playerId:string, ticketNo:number|null}>}} [options]
 *        restrict to one named ticket, name the seat making the claim, and supply
 *        the awards already on the board
 */
export function evaluateClaimAcrossTickets(
  patternId,
  tickets,
  calledNumbers,
  config = {},
  { ticketNo, awards = [], claimantId = null } = {}
) {
  const pattern = getPattern(patternId, config);
  if (!pattern) return { valid: false, reason: "unknown or disabled pattern: " + patternId };
  if (!Array.isArray(tickets) || !tickets.length) return { valid: false, reason: "claimant has no tickets" };
  const meta = { pattern: patternId, points: pattern.points, label: pattern.label };

  let candidates = tickets.map((t, i) => ({ no: (t && t.no) || i + 1, grid: (t && t.grid) || t }));
  if (ticketNo !== undefined && ticketNo !== null) {
    const wanted = Number(ticketNo);
    const picked = candidates.filter((c) => c.no === wanted);
    if (!picked.length) return { valid: false, reason: "no ticket number " + wanted + " belongs to you", ...meta };
    candidates = picked;
  }

  if (pattern.requires) {
    const requirement = pattern.requires;
    const prior = (Array.isArray(awards) ? awards : []).filter((a) => a && a.pattern === requirement.pattern);
    if (!prior.length) return { valid: false, reason: requirement.notYet, ...meta };
    if (requirement.excludeWinningTicket) {
      // Ticket numbers are per seat, so "ticket 1 won the first Full House" only
      // bars ticket 1 OF THAT SEAT. Excluding by number alone would disqualify
      // every other player's first ticket, which is how a second place award
      // would silently become unclaimable. With no claimant named the filter stays
      // conservative rather than permissive: nothing is ever paid twice.
      const own = claimantId === null ? prior : prior.filter((a) => a.playerId === claimantId);
      const taken = new Set(own.map((a) => a.ticketNo).filter(Number.isInteger));
      const eligible = candidates.filter((c) => !taken.has(c.no));
      if (!eligible.length) {
        return { valid: false, reason: "your ticket " + candidates.map((c) => c.no).join(" and ") + " " + requirement.takenTicket, ...meta };
      }
      candidates = eligible;
    }
  }

  if (pattern.scope === "seat") {
    const verdict = pattern.checkSeat(candidates, calledNumbers);
    const late = windowVerdict(patternId, pattern, verdict, calledNumbers, config);
    if (!verdict.valid || late) {
      return {
        valid: false,
        reason: (late || verdict).reason,
        ...(late ? { late: true } : {}),
        // how many more tickets the seat still needs two marks on, when the rule
        // can answer that - it is the clearest refusal this pattern can give
        ...(!late && Number.isInteger(verdict.needed) ? { needed: verdict.needed } : {}),
        ...meta,
      };
    }
    return {
      valid: true,
      ...meta,
      ticketNo: verdict.ticketNos[0],
      ticketNos: verdict.ticketNos,
      seatScope: true,
      completedOnCall: verdict.completedOnCall,
      winningTickets: verdict.ticketNos,
    };
  }

  const winners = [];
  let firstReason = null;
  let firstMissing = null;
  let firstNeeded = null;
  let firstLate = false;
  for (const c of candidates) {
    const verdict = evaluateClaim(patternId, c.grid, calledNumbers, config);
    if (verdict.valid) winners.push({ ticketNo: c.no, completedOnCall: verdict.completedOnCall });
    else {
      if (firstReason == null) {
        firstReason = verdict.reason;
        // which cells were still short, or how many marks the seat needs next:
        // passed on so a refusal can say more than "no". These are the claimant's
        // own numbers, nothing else.
        firstMissing = Array.isArray(verdict.missing) && verdict.missing.length ? verdict.missing : null;
        firstNeeded = Number.isInteger(verdict.needed) ? verdict.needed : null;
      }
      if (verdict.late) firstLate = true;
    }
  }
  if (!winners.length) {
    return {
      valid: false,
      reason: firstReason || "none of your tickets completes this pattern",
      ...(firstLate ? { late: true } : {}),
      ...(firstMissing ? { missing: firstMissing } : {}),
      ...(firstNeeded !== null ? { needed: firstNeeded } : {}),
      ...meta,
    };
  }
  winners.sort((a, b) => {
    const ac = a.completedOnCall ?? Infinity;
    const bc = b.completedOnCall ?? Infinity;
    if (ac !== bc) return ac - bc;
    return a.ticketNo - b.ticketNo;
  });
  const chosen = winners[0];
  return {
    valid: true,
    ...meta,
    ticketNo: chosen.ticketNo,
    completedOnCall: chosen.completedOnCall,
    winningTickets: winners.map((w) => w.ticketNo),
  };
}

/**
 * The prize charts. Coordinates come from the server because they are the cells
 * the evaluator checks - the browser draws what it is told and adds no rule of
 * its own. `cells` is the pattern drawn on EXAMPLE_TICKET, which is why the
 * picture a player claims from and the verdict that pays them cannot disagree.
 */
function patternView(pattern) {
  const view = {
    id: pattern.id,
    label: pattern.label,
    points: pattern.points,
    kind: pattern.kind || "cells",
    hint: pattern.hint || "",
    optional: Boolean(pattern.optional),
    exclusive: pattern.exclusive !== false,
  };
  if (pattern.diagram) view.cells = pattern.diagram(EXAMPLE_TICKET).map((cell) => cell.slice());
  if (pattern.diagramNote) view.diagramNote = pattern.diagramNote;
  if (Number.isInteger(pattern.need)) view.need = pattern.need;
  if (pattern.seat) view.seat = { tickets: pattern.seat.tickets, perTicket: pattern.seat.perTicket };
  if (pattern.requires) view.requires = { pattern: pattern.requires.pattern };
  return view;
}

/** The patterns this room actually plays, in registry order. */
export function patternViews(config = {}) {
  return enabledPatternIds(config).map((id) => patternView(PATTERNS[id]));
}

/**
 * Every pattern the server knows, switched on or off. The host's prize picker
 * reads this: an optional prize that is off still has to be describable, or a
 * host would be ticking a label with no idea which cells it means.
 */
export function patternCatalog(config = {}) {
  const enabled = new Set(enabledPatternIds(config));
  return Object.values(PATTERNS).map((pattern) => ({
    ...patternView(pattern),
    enabled: enabled.has(pattern.id),
  }));
}

/** The ticket every diagram above is drawn on. */
export function patternExampleTicket() {
  return EXAMPLE_TICKET.map((row) => row.slice());
}

/** The patterns that exist but are off unless a room asks for them. */
export function optionalPatternIds() {
  return Object.values(PATTERNS)
    .filter((pattern) => pattern.optional)
    .map((pattern) => pattern.id);
}
