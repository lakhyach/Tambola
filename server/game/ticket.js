/**
 * Traditional Indian 90-number Tambola/Housie ticket generation.
 *
 * A legal ticket is a 3x9 grid that satisfies ALL of:
 *   1. exactly 3 rows and 9 columns
 *   2. exactly 15 numbered cells
 *   3. exactly 5 numbers in every row
 *   4. 1..3 numbers in every column (no empty column, never 4+)
 *   5. every number sits in its correct decade column
 *      (1-9, 10-19, 20-29, 30-39, 40-49, 50-59, 60-69, 70-79, 80-90)
 *   6. no duplicate numbers anywhere
 *   7. numbers strictly ascending top -> bottom inside each column
 *   8. every number in 1..90
 *
 * The generator is CONSTRUCTIVE: it first decides a legal occupancy matrix
 * (row/column counts) using a bipartite degree-sequence argument, then places
 * numbers into that skeleton. It never repairs a partially built ticket and
 * it never discards values through destructive shifting, so no retry loop is
 * required and every call returns a legal ticket.
 *
 * Occupancy legality proof sketch: column counts are chosen so each is in
 * 1..3 and the total is 15 = 3 rows x 5. With all row degrees equal to 5 the
 * Gale-Ryser conditions hold (k=1: 5 <= 9 filled columns; k=2: 10 <= 15 - x3
 * where x3 <= 3; k=3: 15 <= 15), so a 0/1 matrix with those row and column
 * sums always exists, and the Havel-Hakimi style greedy used below finds it.
 *
 * All randomness is injected and defaults to node:crypto, so the server uses
 * a cryptographically secure source and tests can use a deterministic one.
 */

import { randomInt } from "node:crypto";

export const ROWS = 3;
export const COLS = 9;
export const NUMBERS_PER_TICKET = 15;
export const NUMBERS_PER_ROW = 5;
export const MIN_PER_COLUMN = 1;
export const MAX_PER_COLUMN = 3;
export const MIN_NUMBER = 1;
export const MAX_NUMBER = 90;

/** Decade pool for each of the nine columns, left to right. */
export const COLUMN_RANGES = Object.freeze([
  [1, 9],
  [10, 19],
  [20, 29],
  [30, 39],
  [40, 49],
  [50, 59],
  [60, 69],
  [70, 79],
  [80, 90],
]);

/** Expected number of cells for the given column index, or null if invalid. */
export function columnRange(col) {
  return col >= 0 && col < COLS ? COLUMN_RANGES[col] : null;
}

/** Default CSPRNG-backed integer source: [0, max) */
function cryptoRandomInt(max) {
  return randomInt(max);
}

/** Fisher-Yates shuffle in place, driven by the injected rng. */
function shuffle(items, rng) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/**
 * Column counts: every column starts with its mandatory single number, then
 * the remaining 6 cells are spread over the 9 columns with a hard cap of 2
 * extra per column. Picking 6 slots out of a shuffled 18-slot pool (two slots
 * per column) makes the cap impossible to breach and keeps the total at 15.
 */
function buildColumnCounts(rng) {
  const slots = [];
  for (let col = 0; col < COLS; col++) {
    slots.push(col, col);
  }
  shuffle(slots, rng);
  const counts = new Array(COLS).fill(MIN_PER_COLUMN);
  for (let i = 0; i < NUMBERS_PER_TICKET - COLS * MIN_PER_COLUMN; i++) {
    counts[slots[i]] += 1;
  }
  return counts;
}

/**
 * Row occupancy: which of the three rows each column fills.
 * Havel-Hakimi style greedy - handle the most demanding column first and give
 * its cells to the rows with the most remaining capacity (ties broken
 * randomly, which is what produces the visual variety between tickets).
 * Returns a 9 x 3 boolean matrix.
 */
function buildOccupancy(columnCounts, rng) {
  const order = columnCounts.map((count, col) => ({ count, col, key: rng(1 << 30) }));
  order.sort((a, b) => b.count - a.count || a.key - b.key);

  const occupancy = Array.from({ length: COLS }, () => [false, false, false]);
  const remaining = new Array(ROWS).fill(NUMBERS_PER_ROW);

  for (const { count, col } of order) {
    const candidates = remaining
      .map((cap, row) => ({ cap, row, key: rng(1 << 30) }))
      .filter((entry) => entry.cap > 0)
      .sort((a, b) => b.cap - a.cap || a.key - b.key);

    if (candidates.length < count) {
      throw new Error("internal: no legal row occupancy remains for column " + col);
    }
    for (let i = 0; i < count; i++) {
      occupancy[col][candidates[i].row] = true;
      remaining[candidates[i].row] -= 1;
    }
  }

  if (remaining.some((cap) => cap !== 0)) {
    throw new Error("internal: occupancy left rows unbalanced");
  }
  return occupancy;
}

/** Pick `count` distinct numbers from a column's decade pool, ascending. */
function pickColumnNumbers(col, count, rng) {
  const [min, max] = COLUMN_RANGES[col];
  const pool = [];
  for (let n = min; n <= max; n++) pool.push(n);
  shuffle(pool, rng);
  return pool.slice(0, count).sort((a, b) => a - b);
}

/**
 * Build one random legal ticket.
 * @param {() => number} [rng] integer source returning [0, max)
 * @returns {Array<Array<number|null>>} 3 rows x 9 columns, empty cells null
 */
export function generateTicket(rng = cryptoRandomInt) {
  if (typeof rng !== "function") throw new TypeError("rng must be a function");

  const columnCounts = buildColumnCounts(rng);
  const occupancy = buildOccupancy(columnCounts, rng);

  const grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(null));
  for (let col = 0; col < COLS; col++) {
    const chosen = pickColumnNumbers(col, columnCounts[col], rng);
    let at = 0;
    for (let row = 0; row < ROWS; row++) {
      if (!occupancy[col][row]) continue;
      const value = chosen[at++];
      grid[row][col] = value;
    }
  }

  // Defensive self-check: the constructor is provably correct, so this can
  // only fire if someone edits it into an invalid shape.
  const check = validateTicket(grid);
  if (!check.valid) {
    throw new Error("internal: generator produced an invalid ticket: " + check.errors.join("; "));
  }
  return grid;
}

/**
 * Generate `count` distinct tickets. Ticket identity is derived from its
 * sorted numbers, so a repeated ticket is regenerated rather than handed out
 * twice inside one batch (nice-to-have fairness, not a rule requirement).
 */
export function generateTickets(count, rng = cryptoRandomInt) {
  const tickets = [];
  const seen = new Set();
  for (let guard = 0; tickets.length < count && guard < count * 50; guard++) {
    const grid = generateTicket(rng);
    const fingerprint = grid.flat().filter((n) => n !== null).sort((a, b) => a - b).join(",");
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    tickets.push(grid);
  }
  while (tickets.length < count) tickets.push(generateTicket(rng));
  return tickets;
}

/** Flatten a grid's numbers, ignoring empty cells. Returns null when malformed. */
function collectNumbers(grid) {
  const values = [];
  for (const row of grid) {
    if (!Array.isArray(row) || row.length !== COLS) return null;
    for (const cell of row) {
      if (cell === null || cell === undefined) continue;
      if (!Number.isInteger(cell)) return null;
      values.push(cell);
    }
  }
  return values;
}

/**
 * Independent validator. It inspects only the submitted grid - it never
 * consults generator internals - and reports every rule it can find broken.
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateTicket(ticket) {
  const errors = [];

  if (!Array.isArray(ticket) || ticket.length !== ROWS) {
    return { valid: false, errors: ["ticket must have exactly " + ROWS + " rows"] };
  }
  for (const row of ticket) {
    if (!Array.isArray(row) || row.length !== COLS) {
      return { valid: false, errors: ["every row must have exactly " + COLS + " columns"] };
    }
  }

  const values = collectNumbers(ticket);
  if (values === null) {
    return { valid: false, errors: ["cells must be null or integers"] };
  }

  if (values.length !== NUMBERS_PER_TICKET) {
    errors.push("expected " + NUMBERS_PER_TICKET + " numbers, found " + values.length);
  }
  if (new Set(values).size !== values.length) {
    errors.push("duplicate numbers on ticket");
  }
  for (const value of values) {
    if (value < MIN_NUMBER || value > MAX_NUMBER) {
      errors.push("number " + value + " outside 1..90");
      break;
    }
  }

  ticket.forEach((row, rowIndex) => {
    const filled = row.filter((cell) => cell !== null && cell !== undefined).length;
    if (filled !== NUMBERS_PER_ROW) {
      errors.push("row " + (rowIndex + 1) + " has " + filled + " numbers, expected " + NUMBERS_PER_ROW);
    }
  });

  for (let col = 0; col < COLS; col++) {
    const [min, max] = COLUMN_RANGES[col];
    const column = [];
    for (let row = 0; row < ROWS; row++) {
      const cell = ticket[row][col];
      if (cell === null || cell === undefined) continue;
      column.push(cell);
      if (cell < min || cell > max) {
        errors.push("number " + cell + " is in column " + (col + 1) + " but belongs to " + min + "-" + max);
      }
    }
    if (column.length < MIN_PER_COLUMN || column.length > MAX_PER_COLUMN) {
      errors.push("column " + (col + 1) + " holds " + column.length + " numbers, expected " + MIN_PER_COLUMN + "-" + MAX_PER_COLUMN);
    }
    for (let i = 1; i < column.length; i++) {
      if (column[i - 1] >= column[i]) {
        errors.push("column " + (col + 1) + " is not strictly ascending");
        break;
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Row cells of a ticket as numbers, empty cells omitted, left to right. */
export function rowNumbers(ticket, rowIndex) {
  return ticket[rowIndex].filter((cell) => cell !== null && cell !== undefined);
}

/** All 15 numbers of a ticket, left to right, top to bottom. */
export function ticketNumbers(ticket) {
  const out = [];
  for (let row = 0; row < ROWS; row++) out.push(...rowNumbers(ticket, row));
  return out;
}
