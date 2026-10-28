/**
 * Ticket generation and validation.
 * Run with: npm test   (node --test, no external framework)
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  generateTicket,
  generateTickets,
  validateTicket,
  rowNumbers,
  ticketNumbers,
  COLUMN_RANGES,
  ROWS,
  COLS,
  NUMBERS_PER_TICKET,
  NUMBERS_PER_ROW,
} from "../server/game/ticket.js";

/** Deterministic integer source in [0, max) so failures are reproducible. */
function makeRng(seed = 1) {
  let state = seed >>> 0 || 1;
  return function next(max) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state % max;
  };
}

function columnValues(ticket, col) {
  const out = [];
  for (let row = 0; row < ROWS; row++) {
    const cell = ticket[row][col];
    if (cell !== null && cell !== undefined) out.push(cell);
  }
  return out;
}

function assertLegal(ticket, label) {
  const check = validateTicket(ticket);
  assert.deepEqual(check.errors, [], label + " should be legal");
  assert.equal(check.valid, true, label);
}

test("shape: 3 rows of 9 cells, empty cells are null", () => {
  const ticket = generateTicket(makeRng(7));
  assert.equal(ticket.length, ROWS);
  for (const row of ticket) {
    assert.equal(row.length, COLS);
    for (const cell of row) {
      assert.ok(cell === null || Number.isInteger(cell), "cell is null or an integer");
    }
  }
});

test("20000 generated tickets all pass the independent validator", () => {
  const rng = makeRng(2024);
  for (let i = 0; i < 20000; i++) {
    const ticket = generateTicket(rng);
    const check = validateTicket(ticket);
    if (!check.valid) {
      assert.fail("ticket " + i + " invalid: " + check.errors.join("; ") + "\n" + JSON.stringify(ticket));
    }
  }
});

test("every invariant holds across 5000 tickets, counted separately", () => {
  const rng = makeRng(99);
  const count = 5000;
  const columnSizeHistogram = { 1: 0, 2: 0, 3: 0 };
  for (let i = 0; i < count; i++) {
    const ticket = generateTicket(rng);
    const flat = ticketNumbers(ticket);

    assert.equal(flat.length, NUMBERS_PER_TICKET, "exactly 15 numbers");
    assert.equal(new Set(flat).size, NUMBERS_PER_TICKET, "no duplicates");
    for (const value of flat) {
      assert.ok(value >= 1 && value <= 90, "value in range: " + value);
    }
    for (let row = 0; row < ROWS; row++) {
      assert.equal(rowNumbers(ticket, row).length, NUMBERS_PER_ROW, "row " + (row + 1) + " has 5 numbers");
    }
    for (let col = 0; col < COLS; col++) {
      const values = columnValues(ticket, col);
      const [min, max] = COLUMN_RANGES[col];
      assert.ok(values.length >= 1 && values.length <= 3, "column " + (col + 1) + " holds 1-3, got " + values.length);
      columnSizeHistogram[values.length] += 1;
      for (const value of values) {
        assert.ok(value >= min && value <= max, value + " belongs to column " + col);
      }
      for (let k = 1; k < values.length; k++) {
        assert.ok(values[k - 1] < values[k], "column " + (col + 1) + " ascending");
      }
    }
  }
  // mixed layouts really are being produced, not one degenerate shape
  assert.ok(columnSizeHistogram[1] > 0 && columnSizeHistogram[2] > 0 && columnSizeHistogram[3] > 0,
    "all three column sizes occur: " + JSON.stringify(columnSizeHistogram));
});

test("row occupancy is balanced across the three rows over many tickets", () => {
  const rng = makeRng(5);
  const patterns = new Set();
  for (let i = 0; i < 400; i++) {
    const ticket = generateTicket(rng);
    const occupancy = ticket.map((row) => row.map((cell) => (cell === null ? 0 : 1)).join(""));
    patterns.add(occupancy.join("|"));
  }
  assert.ok(patterns.size > 20, "expected plenty of distinct layouts, got " + patterns.size);
});

test("tickets can be generated without an injected rng (CSPRNG path)", () => {
  for (let i = 0; i < 200; i++) assertLegal(generateTicket(), "crypto-backed ticket " + i);
});

test("generateTickets returns the requested number of distinct tickets", () => {
  const batch = generateTickets(40, makeRng(11));
  assert.equal(batch.length, 40);
  for (const ticket of batch) assertLegal(ticket, "batch ticket");
  const fingerprints = batch.map((t) => ticketNumbers(t).sort((a, b) => a - b).join(","));
  assert.equal(new Set(fingerprints).size, 40, "no two tickets identical");
});

test("generator rejects a non-function rng", () => {
  assert.throws(() => generateTicket("nope"), TypeError);
});

// ---------------------------------------------------------------- validator

test("validator catches duplicate numbers", () => {
  const ticket = generateTicket(makeRng(3));
  // find a column with >=2 numbers and turn the lower one into a copy of the
  // upper one: still 15 numbers, still 5 per row, still 1-3 per column, so the
  // ONLY rule that can fire is uniqueness (plus ascending)
  for (let col = 0; col < COLS; col++) {
    const values = columnValues(ticket, col);
    if (values.length < 2) continue;
    const rows = [];
    for (let row = 0; row < ROWS; row++) if (ticket[row][col] !== null) rows.push(row);
    ticket[rows[1]][col] = values[0];
    const check = validateTicket(ticket);
    assert.equal(check.valid, false);
    assert.match(check.errors.join(" "), /duplicate numbers on ticket/);
    assert.ok(!/expected 15 numbers/.test(check.errors.join(" ")), "cell count unchanged");
    return;
  }
  assert.fail("no column with two numbers found");
});

test("validator catches a missing number (14 cells)", () => {
  const ticket = generateTicket(makeRng(4));
  const [row, col] = findFilledCell(ticket);
  ticket[row][col] = null;
  const check = validateTicket(ticket);
  assert.equal(check.valid, false);
  assert.match(check.errors.join(" "), /expected 15 numbers, found 14/);
  assert.match(check.errors.join(" "), /row .* has 4 numbers/);
});

test("validator catches an extra number (16 cells)", () => {
  const ticket = generateTicket(makeRng(4));
  const empty = findEmptyCell(ticket);
  if (!empty) {
    assert.fail("sanity: a legal ticket always has empty cells");
  }
  ticket[empty[0]][empty[1]] = 91 - empty[1];
  const check = validateTicket(ticket);
  assert.equal(check.valid, false);
  assert.match(check.errors.join(" "), /found 16/);
});

test("validator catches a number in the wrong decade column", () => {
  const ticket = generateTicket(makeRng(8));
  const [row, col] = findFilledCell(ticket);
  ticket[row][col] = col === 0 ? 40 : 1;
  const check = validateTicket(ticket);
  assert.equal(check.valid, false);
  assert.match(check.errors.join(" "), /belongs to/);
});

test("validator catches a row with too few and too many numbers", () => {
  // 15 numbers, every column legal, but rows are 6 / 5 / 4
  const unbalanced = [
    [1, 10, 20, 30, 40, 50, null, null, null],
    [2, 11, 21, null, null, null, 60, 70, null],
    [3, 12, 22, null, null, null, null, null, 80],
  ];
  const check = validateTicket(unbalanced);
  assert.equal(check.valid, false);
  assert.match(check.errors.join(" "), /row 1 has 6 numbers/);
  assert.match(check.errors.join(" "), /row 3 has 4 numbers/);
  assert.ok(!/expected 15 numbers/.test(check.errors.join(" ")), "still 15 numbers in total");
});

test("a column can never exceed 3 cells, so only the empty-column rule bites", () => {
  // 15 numbers, 5 per row, one completely empty column
  const hole = [
    [1, 10, 20, 30, null, 50, null, null, null],
    [2, 11, 21, null, null, null, 60, 70, null],
    [null, null, null, 31, null, 51, 61, 71, 80],
  ];
  const check = validateTicket(hole);
  assert.deepEqual(check.errors, ["column 5 holds 0 numbers, expected 1-3"]);
  assert.equal(check.valid, false);
});

test("validator catches a column that is not ascending", () => {
  const ticket = generateTicket(makeRng(21));
  for (let col = 0; col < COLS; col++) {
    const values = columnValues(ticket, col);
    if (values.length < 2) continue;
    // swap the two values between their rows
    const rows = [];
    for (let row = 0; row < ROWS; row++) if (ticket[row][col] !== null) rows.push(row);
    ticket[rows[0]][col] = values[1];
    ticket[rows[1]][col] = values[0];
    const check = validateTicket(ticket);
    assert.equal(check.valid, false, "swapped column " + (col + 1) + " must be rejected");
    assert.match(check.errors.join(" "), /not strictly ascending/);
    return;
  }
  assert.fail("no column with two numbers found");
});

test("validator rejects out-of-range and non-integer cells", () => {
  const base = generateTicket(makeRng(31));
  const zero = base.map((row) => row.slice());
  zero[0][0] = 0;
  assert.match(validateTicket(zero).errors.join(" "), /outside 1\.\.90|belongs to/);

  const ninetyOne = generateTicket(makeRng(31)).map((row) => row.slice());
  ninetyOne[2][8] = 91;
  assert.match(validateTicket(ninetyOne).errors.join(" "), /belongs to 80-90/);

  const stringy = generateTicket(makeRng(31)).map((row) => row.slice());
  stringy[0][findFilledColumnInRow(stringy, 0)] = "7";
  assert.match(validateTicket(stringy).errors.join(" "), /integers/);

  const floaty = generateTicket(makeRng(31)).map((row) => row.slice());
  floaty[1][findFilledColumnInRow(floaty, 1)] = 7.5;
  assert.equal(validateTicket(floaty).valid, false);
});

test("validator rejects corrupted structures", () => {
  const malformed = [
    [null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null],
  ];
  assert.deepEqual(validateTicket(malformed).errors, ["ticket must have exactly 3 rows"]);

  const shortRow = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
  assert.match(validateTicket(shortRow).errors.join(" "), /9 columns/);

  for (const junk of [undefined, null, "ticket", 42, [], {}, [null, null, null], [1, 2, 3].map(() => "x")]) {
    const check = validateTicket(junk);
    assert.equal(check.valid, false, "rejected " + JSON.stringify(junk));
  }
});

test("validator does not trust the generator: a hand-built legal ticket passes", () => {
  // built by hand, nothing to do with generateTicket
  // column counts 2,2,2,2,1,2,2,1,1 = 15; rows 5/5/5; every value in its decade
  const hand = [
    [3, 11, 24, 31, null, 50, null, null, null],
    [7, 15, 28, null, 42, null, 61, null, null],
    [null, null, null, 36, null, 57, 66, 74, 85],
  ];
  const check = validateTicket(hand);
  assert.deepEqual(check.errors, [], check.errors.join("; "));
  assert.equal(check.valid, true);
});

// ------------------------------------------------------------------- helpers

function findFilledCell(ticket) {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (ticket[row][col] !== null) return [row, col];
    }
  }
  return null;
}

function findEmptyCell(ticket) {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (ticket[row][col] === null) return [row, col];
    }
  }
  return null;
}

function findFilledColumnInRow(ticket, row) {
  for (let col = 0; col < COLS; col++) {
    if (ticket[row][col] !== null) return col;
  }
  return -1;
}
