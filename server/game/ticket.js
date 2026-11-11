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

const SHEET_SIZE = 6;

function addFlowEdge(graph, from, to, capacity) {
  const forward = { to, capacity, reverse: graph[to].length };
  const backward = { to: from, capacity: 0, reverse: graph[from].length };
  graph[from].push(forward);
  graph[to].push(backward);
  return forward;
}

function fillSheetExtras(base, rng) {
  const rowCount = SHEET_SIZE * ROWS;
  const source = 0;
  const rowStart = 1;
  const ticketColumnStart = rowStart + rowCount;
  const columnStart = ticketColumnStart + SHEET_SIZE * COLS;
  const sink = columnStart + COLS;
  const graph = Array.from({ length: sink + 1 }, () => []);
  const rowEdges = Array.from({ length: rowCount }, () => []);

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const rowNode = rowStart + rowIndex;
    addFlowEdge(graph, source, rowNode, NUMBERS_PER_ROW - 3);
    const ticket = Math.floor(rowIndex / ROWS);
    const row = rowIndex % ROWS;
    const columns = shuffle(Array.from({ length: COLS }, (_, col) => col).filter((col) => !base[ticket][row][col]), rng);
    for (const col of columns) {
      const ticketColumn = ticketColumnStart + ticket * COLS + col;
      rowEdges[rowIndex].push({ col, edge: addFlowEdge(graph, rowNode, ticketColumn, 1) });
    }
  }

  for (let ticket = 0; ticket < SHEET_SIZE; ticket++) {
    for (let col = 0; col < COLS; col++) {
      addFlowEdge(graph, ticketColumnStart + ticket * COLS + col, columnStart + col, MAX_PER_COLUMN - 1);
    }
  }
  let total = 0;
  for (let col = 0; col < COLS; col++) {
    const [min, max] = COLUMN_RANGES[col];
    const remaining = max - min + 1 - SHEET_SIZE;
    addFlowEdge(graph, columnStart + col, sink, remaining);
    total += remaining;
  }
  if (total !== rowCount * (NUMBERS_PER_ROW - 3)) throw new Error("internal: invalid Tambola sheet degree totals");

  let flow = 0;
  while (true) {
    const level = new Array(graph.length).fill(-1);
    const queue = [source];
    level[source] = 0;
    for (let head = 0; head < queue.length; head++) {
      const node = queue[head];
      for (const edge of graph[node]) {
        if (edge.capacity > 0 && level[edge.to] < 0) {
          level[edge.to] = level[node] + 1;
          queue.push(edge.to);
        }
      }
    }
    if (level[sink] < 0) break;
    const cursor = new Array(graph.length).fill(0);
    const send = (node, amount) => {
      if (node === sink) return amount;
      for (; cursor[node] < graph[node].length; cursor[node]++) {
        const edge = graph[node][cursor[node]];
        if (edge.capacity <= 0 || level[edge.to] !== level[node] + 1) continue;
        const pushed = send(edge.to, Math.min(amount, edge.capacity));
        if (!pushed) continue;
        edge.capacity -= pushed;
        graph[edge.to][edge.reverse].capacity += pushed;
        return pushed;
      }
      return 0;
    };
    let pushed;
    do {
      pushed = send(source, Number.MAX_SAFE_INTEGER);
      flow += pushed;
    } while (pushed > 0);
  }

  if (flow !== total) return null;
  const occupancy = base.map((ticket) => ticket.map((row) => row.slice()));
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const ticket = Math.floor(rowIndex / ROWS);
    const row = rowIndex % ROWS;
    for (const { col, edge } of rowEdges[rowIndex]) if (edge.capacity === 0) occupancy[ticket][row][col] = true;
  }
  return occupancy;
}

/**
 * Generate one traditional Tambola sheet: six legal 3x9 tickets that use
 * each number 1-90 exactly once across the strip.
 */
export function generateTicketSheet(rng = cryptoRandomInt) {
  if (typeof rng !== "function") throw new TypeError("rng must be a function");
  let occupancy = null;
  for (let attempt = 0; attempt < 100 && !occupancy; attempt++) {
    const base = Array.from({ length: SHEET_SIZE }, () => Array.from({ length: ROWS }, () => new Array(COLS).fill(false)));
    for (let ticket = 0; ticket < SHEET_SIZE; ticket++) {
      const columns = shuffle(Array.from({ length: COLS }, (_, col) => col), rng);
      for (let row = 0; row < ROWS; row++) for (const col of columns.slice(row * 3, row * 3 + 3)) base[ticket][row][col] = true;
    }
    occupancy = fillSheetExtras(base, rng);
  }
  if (!occupancy) throw new Error("could not construct a valid six-ticket sheet");

  const grids = Array.from({ length: SHEET_SIZE }, () => Array.from({ length: ROWS }, () => new Array(COLS).fill(null)));
  for (let col = 0; col < COLS; col++) {
    const [min, max] = COLUMN_RANGES[col];
    const values = Array.from({ length: max - min + 1 }, (_, index) => min + index);
    const ticketOrder = shuffle(Array.from({ length: SHEET_SIZE }, (_, ticket) => ticket), rng);
    let valueIndex = 0;
    for (let row = 0; row < ROWS; row++) {
      for (const ticket of ticketOrder) {
        if (occupancy[ticket][row][col]) grids[ticket][row][col] = values[valueIndex++];
      }
    }
    if (valueIndex !== values.length) throw new Error("internal: Tambola sheet column allocation is incomplete");
  }
  for (const [index, grid] of grids.entries()) {
    const check = validateTicket(grid);
    if (!check.valid) throw new Error(`internal: generated sheet ticket ${index + 1} is invalid: ${check.errors.join("; ")}`);
  }
  const numbers = grids.flat(2).filter(Number.isInteger).sort((a, b) => a - b);
  if (numbers.length !== 90 || numbers.some((number, index) => number !== index + 1)) throw new Error("internal: Tambola sheet does not contain every number exactly once");
  return grids;
}

/** Generate distinct tickets in six-ticket complementary strips, then singles. */
export function generateTicketSheets(count, rng = cryptoRandomInt) {
  if (!Number.isInteger(count) || count < 0) throw new RangeError("sheet count must be a non-negative integer");
  const sheets = [];
  for (let index = 0; index < count; index++) sheets.push(generateTicketSheet(rng));
  return sheets;
}

/**
 * Generate `count` distinct tickets. Ticket identity is derived from its
 * sorted numbers, so a repeated ticket is regenerated rather than handed out
 * twice inside one batch (nice-to-have fairness, not a rule requirement).
 */
export function generateTickets(count, rng = cryptoRandomInt) {
  if (!Number.isInteger(count) || count < 0) throw new RangeError("ticket count must be a non-negative integer");
  const tickets = [];
  const seen = new Set();
  const sheetCount = Math.floor(count / SHEET_SIZE);
  for (let index = 0; index < sheetCount; index++) {
    let sheet = null;
    for (let attempt = 0; attempt < 100 && !sheet; attempt++) {
      const candidate = generateTicketSheet(rng);
      const fingerprints = candidate.map((grid) => grid.flat().filter(Number.isInteger).sort((a, b) => a - b).join(","));
      if (new Set(fingerprints).size !== SHEET_SIZE || fingerprints.some((fingerprint) => seen.has(fingerprint))) continue;
      fingerprints.forEach((fingerprint) => seen.add(fingerprint));
      sheet = candidate;
    }
    if (!sheet) throw new Error("could not generate a unique six-ticket sheet after 100 attempts");
    tickets.push(...sheet);
  }
  while (tickets.length < count) {
    let grid = null;
    for (let attempt = 0; attempt < 100 && !grid; attempt++) {
      const candidate = generateTicket(rng);
      const fingerprint = candidate.flat().filter(Number.isInteger).sort((a, b) => a - b).join(",");
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      grid = candidate;
    }
    if (!grid) throw new Error("could not generate a unique ticket after 100 attempts");
    tickets.push(grid);
  }
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
