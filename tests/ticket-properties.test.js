/**
 * Phase 18: property-based validation of the ticket generator.
 *
 * The phase-6 suite proved 20,000 generated tickets pass the validator. This
 * suite turns the eight rules into properties that must hold for *any* rng
 * stream, and then proves the validator is not a rubber stamp by mutating a
 * legal ticket in every way the rules forbid. It also pins determinism, so a
 * reported failure is reproducible from its seed.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  COLUMN_RANGES,
  COLS,
  NUMBERS_PER_ROW,
  NUMBERS_PER_TICKET,
  ROWS,
  generateTicket,
  generateTickets,
  rowNumbers,
  ticketNumbers,
  validateTicket,
} from "../server/game/ticket.js";
import { TICKET_A, makeRng } from "./helpers.js";

/* ------------------------------------------------------------------ helpers */

const cells = (grid) => grid.flat();
const filled = (grid) => cells(grid).filter((n) => n !== null);

function columnOf(grid, col) {
  const out = [];
  for (let row = 0; row < ROWS; row++) {
    const cell = grid[row][col];
    if (cell !== null) out.push(cell);
  }
  return out;
}

function clone(grid) {
  return grid.map((row) => row.slice());
}

/* ---------------------------------------------------------------- generation */

test("property: every generated ticket satisfies all eight rules", () => {
  // 3,000 tickets from a reproducible stream; each is checked independently
  const rng = makeRng(0x18_0001);
  for (let i = 0; i < 3000; i++) {
    const grid = generateTicket(rng);
    const check = validateTicket(grid);
    assert.deepEqual(check.errors, [], "ticket " + i + " is invalid");

    assert.equal(grid.length, ROWS);
    for (const row of grid) assert.equal(row.length, COLS);

    const numbers = filled(grid);
    assert.equal(numbers.length, NUMBERS_PER_TICKET);
    assert.equal(new Set(numbers).size, NUMBERS_PER_TICKET, "no duplicates");

    grid.forEach((_, row) => assert.equal(rowNumbers(grid, row).length, NUMBERS_PER_ROW));

    for (let col = 0; col < COLS; col++) {
      const [min, max] = COLUMN_RANGES[col];
      const column = columnOf(grid, col);
      assert.ok(column.length >= 1 && column.length <= 3, "column " + col + " holds " + column.length);
      for (const value of column) {
        assert.ok(value >= min && value <= max, value + " outside decade " + min + "-" + max);
      }
      for (let i = 1; i < column.length; i++) {
        assert.ok(column[i - 1] < column[i], "column " + col + " is not ascending");
      }
    }

    // empty cells are null, never 0/undefined/"" - the renderer depends on it
    for (const cell of cells(grid)) {
      assert.ok(cell === null || Number.isInteger(cell), "cells are null or integers");
    }
  }
});

test("property: row sums are always five and column sums one to three", () => {
  const rng = makeRng(0x18_0002);
  const seenCounts = new Set();
  const columnTotals = new Array(COLS).fill(0);

  for (let i = 0; i < 900; i++) {
    const grid = generateTicket(rng);
    for (let row = 0; row < ROWS; row++) assert.equal(filled([grid[row]]).length, NUMBERS_PER_ROW);

    let total = 0;
    for (let col = 0; col < COLS; col++) {
      const count = columnOf(grid, col).length;
      seenCounts.add(count);
      columnTotals[col] += count;
      total += count;
    }
    assert.equal(total, NUMBERS_PER_TICKET);
  }

  // over 900 tickets the generator reaches every legal column size...
  assert.deepEqual([...seenCounts].sort(), [1, 2, 3]);
  // ...and no column is starved, which an always-1 spread would reveal
  for (const total of columnTotals) assert.ok(total > 900 / COLS / 2, "column " + total + " was starved");
});

test("property: the same seed reproduces the same ticket", () => {
  const first = generateTicket(makeRng(4242));
  const second = generateTicket(makeRng(4242));
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, generateTicket(makeRng(4243)), "a different seed is a different ticket");
});

test("property: a batch of the maximum tickets is distinct and legal", () => {
  const batch = generateTickets(12, makeRng(0x18_0003));
  assert.equal(batch.length, 12);
  const fingerprints = new Set(batch.map((grid) => filled(grid).slice().sort((a, b) => a - b).join(",")));
  assert.equal(fingerprints.size, 12, "no two tickets share the same 15 numbers");
  for (const grid of batch) assert.deepEqual(validateTicket(grid).errors, []);
});

test("property: a hand-authored legal ticket passes", () => {
  assert.deepEqual(validateTicket(TICKET_A), { valid: true, errors: [] });
  // empty cells may be undefined as well as null (a JSON round-trip drops null
  // to undefined only if a writer does; the validator treats both as empty)
  const loose = TICKET_A.map((row) => row.map((cell) => (cell === null ? undefined : cell)));
  assert.deepEqual(validateTicket(loose), { valid: true, errors: [] });
});

/* ------------------------------------------------------- validator mutations */

/** Each mutation must be rejected, with a message matching `pattern`. */
const MUTATIONS = [
  {
    name: "too few rows",
    pattern: /exactly 3 rows/,
    mutate: (grid) => grid.slice(0, 2),
  },
  {
    name: "too many rows",
    pattern: /exactly 3 rows/,
    mutate: (grid) => [...clone(grid), new Array(COLS).fill(null)],
  },
  {
    name: "a short row",
    pattern: /exactly 9 columns/,
    mutate: (grid) => [grid[0].slice(0, 8), ...grid.slice(1).map((r) => r.slice())],
  },
  {
    name: "a non-integer cell",
    pattern: /null or integers/,
    mutate: (grid) => {
      const out = clone(grid);
      out[0][0] = "3";
      return out;
    },
  },
  {
    name: "fourteen numbers",
    pattern: /expected 15 numbers, found 14/,
    mutate: (grid) => {
      const out = clone(grid);
      out[2][8] = null;
      return out;
    },
  },
  {
    name: "sixteen numbers",
    pattern: /expected 15 numbers, found 16/,
    mutate: (grid) => {
      const out = clone(grid);
      out[0][4] = 40; // column 5 was [null, 42, null]; 40 keeps it ascending
      return out;
    },
  },
  {
    name: "a duplicate number",
    pattern: /duplicate numbers/,
    mutate: (grid) => {
      const out = clone(grid);
      out[1][4] = out[0][0];
      out[1][7] = null; // keep the count at 15 so the duplicate is the only fault
      return out;
    },
  },
  {
    name: "a number above 90",
    pattern: /outside 1\.\.90|belongs to/,
    mutate: (grid) => {
      const out = clone(grid);
      out[2][8] = 91;
      return out;
    },
  },
  {
    name: "a number below 1",
    pattern: /outside 1\.\.90|belongs to/,
    mutate: (grid) => {
      const out = clone(grid);
      out[2][8] = 0;
      return out;
    },
  },
  {
    name: "a column with no numbers",
    pattern: /column 9 holds 0/,
    mutate: (grid) => {
      const out = clone(grid);
      out[2][8] = null; // column 9 held only the 85
      return out;
    },
  },
  {
    name: "a number in the wrong decade",
    pattern: /belongs to 1-9/,
    mutate: (grid) => {
      const out = clone(grid);
      out[0][0] = 62;
      return out;
    },
  },
  {
    name: "a descending column",
    pattern: /not strictly ascending/,
    mutate: (grid) => {
      const out = clone(grid);
      const first = out[0][0]; // 3
      const second = out[1][0]; // 7
      out[0][0] = second;
      out[1][0] = first;
      return out;
    },
  },
  {
    name: "a row with six numbers",
    pattern: /row 1 has 6 numbers/,
    mutate: (grid) => {
      const out = clone(grid);
      out[0][4] = out[2][8]; // 85 into an empty cell of row 1
      out[2][8] = null;
      return out;
    },
  },
];

for (const { name, pattern, mutate } of MUTATIONS) {
  test("validator rejects " + name, () => {
    const broken = mutate(TICKET_A);
    const check = validateTicket(broken);
    assert.equal(check.valid, false, name + " was accepted");
    assert.ok(check.errors.length > 0);
    assert.match(check.errors.join(" | "), pattern);
  });
}

test("the validator never throws, whatever it is handed", () => {
  const junk = [null, undefined, 42, "ticket", {}, [], [[1, 2]], new Array(3), [[null, null, null]]];
  for (const value of junk) {
    const check = validateTicket(value);
    assert.equal(check.valid, false);
    assert.ok(Array.isArray(check.errors) && check.errors.length > 0);
  }
});

test("every ticket number is unique across a large generation run", () => {
  // A single ticket may not repeat a number; across tickets a repeat is legal,
  // so the property is per-ticket and checked with the same independent code
  // the recovery path uses.
  const rng = makeRng(0x18_0004);
  for (let i = 0; i < 500; i++) {
    const grid = generateTicket(rng);
    const numbers = ticketNumbers(grid);
    assert.equal(numbers.length, NUMBERS_PER_TICKET);
    assert.equal(new Set(numbers).size, NUMBERS_PER_TICKET);
    const check = validateTicket(grid);
    assert.equal(check.valid, true, "ticket " + i + ": " + check.errors.join("; "));
  }
});
