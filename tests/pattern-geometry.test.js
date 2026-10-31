/**
 * Ticket-cell geometry: one source of coordinates for every pattern.
 *
 * The claim these fixtures protect is the one the brief makes explicit: the
 * diagram a player claims from and the cells the server checks must be the same
 * cells. So each assertion is made twice - against the published chart
 * coordinates on the example ticket, and against the registry's own view of the
 * pattern - and the near-miss cases are enumerated cell by cell, not sampled.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { generateTicket, validateTicket, ticketNumbers } from "../server/game/ticket.js";
import {
  BOX_COLUMNS,
  EXAMPLE_TICKET,
  boxCells,
  cellValues,
  columnWindowCells,
  cornerCells,
  filledColumns,
  middleRowCentreCell,
  rowCells,
  starCells,
} from "../server/game/pattern-geometry.js";
import { PATTERNS, evaluateClaim, patternCatalog, patternExampleTicket, patternViews } from "../server/game/patterns.js";
import { makeRng, TICKET_A, TICKET_PACKED, TICKET_SHALLOW } from "./helpers.js";

/** Every optional prize switched on, so a diagram can be evaluated. */
const ALL_ON = { patterns: { earlySeven: true, star: true, box: true, secondFullHouse: true, halfSheet: true } };

const STAR_VALUES = [4, 85, 9, 90, 56];
const BOX_VALUES = [34, 38, 41, 56, 59];

test("the example ticket is a legal ticket and matches the published chart", () => {
  assert.deepEqual(EXAMPLE_TICKET.map((row) => row.slice()), [
    [4, null, 22, null, 41, null, 63, null, 85],
    [null, 15, null, 34, null, 56, null, 77, 88],
    [9, null, 27, 38, null, 59, null, null, 90],
  ]);
  const check = validateTicket(EXAMPLE_TICKET);
  assert.equal(check.valid, true, check.errors.join("; "));
  assert.deepEqual(ticketNumbers(EXAMPLE_TICKET), [4, 22, 41, 63, 85, 15, 34, 56, 77, 88, 9, 27, 38, 59, 90]);
  assert.deepEqual(patternExampleTicket(), EXAMPLE_TICKET.map((row) => row.slice()));
  assert.equal(Object.isFrozen(EXAMPLE_TICKET), true, "a shared fixture must not be editable by a caller");
  // the copy handed to a snapshot is a copy: drawing a diagram cannot mutate the
  // ticket every other diagram is drawn on
  patternExampleTicket()[0][0] = 999;
  assert.equal(EXAMPLE_TICKET[0][0], 4, "the example ticket survives a careless client");
});

test("the middle row's third number counts filled cells, not the third column", () => {
  // row 2 of the example ticket holds 15, 34, 56, 77, 88 in columns 1, 3, 5, 7, 8.
  // Its third number is therefore 56 - the cell in column 5 - while the literal
  // third cell of the row (column 2, 0-based) is empty. Charts word it the same
  // way, and it is what makes Star well defined on every ticket.
  assert.deepEqual(filledColumns(EXAMPLE_TICKET, 1), [1, 3, 5, 7, 8]);
  assert.deepEqual(rowCells(EXAMPLE_TICKET, 1, [3]), [[1, 5]]);
  assert.deepEqual(middleRowCentreCell(EXAMPLE_TICKET), [1, 5]);
  assert.deepEqual(cellValues(EXAMPLE_TICKET, rowCells(EXAMPLE_TICKET, 1, [1, 2, 3, 4, 5])), [15, 34, 56, 77, 88]);

  // the convention is not a lucky property of this one ticket: a row of a legal
  // ticket always holds exactly five numbers, so an ordinal inside it exists
  const rng = makeRng(31);
  for (let i = 0; i < 200; i++) {
    const grid = generateTicket(rng);
    assert.deepEqual(filledColumns(grid, 1).length, 5, "the middle row holds five numbers");
    const centre = middleRowCentreCell(grid);
    assert.equal(centre[0], 1);
    assert.equal(Number.isInteger(grid[centre[0]][centre[1]]), true, "and its third cell always holds one");
  }
});

test("a row that does not hold five numbers is refused, not approximated", () => {
  assert.throws(() => rowCells([[1, 2, 3, 4, 5], [1, 2, 3], [1, 2, 3, 4, 5]], 1, [3]), /holds 3 numbers/);
  assert.throws(() => rowCells(EXAMPLE_TICKET, 1, [6]), /outside 1-5/);
  assert.throws(() => rowCells(EXAMPLE_TICKET, 1, [0]), /outside 1-5/);
});

test("corners are the outermost NUMBERED cells, never a blank edge", () => {
  assert.deepEqual(cornerCells(EXAMPLE_TICKET), [[0, 0], [0, 8], [2, 0], [2, 8]]);
  assert.deepEqual(cellValues(EXAMPLE_TICKET, cornerCells(EXAMPLE_TICKET)), [4, 85, 9, 90]);
  // TICKET_A's top row ends in column 5 and its bottom row starts in column 3,
  // so its corners are not the grid edges: a fixed four-corner guess would have
  // asked for cells holding nothing.
  assert.deepEqual(cornerCells(TICKET_A), [[0, 0], [0, 5], [2, 3], [2, 8]]);
  assert.deepEqual(cellValues(TICKET_A, cornerCells(TICKET_A)), [3, 50, 36, 85]);

  const rng = makeRng(77);
  for (let i = 0; i < 200; i++) {
    const grid = generateTicket(rng);
    const cells = cornerCells(grid);
    assert.equal(cells.length, 4);
    assert.deepEqual(new Set(cells.map((c) => c.join("-"))).size, 4, "four different cells");
    for (const value of cellValues(grid, cells)) assert.equal(Number.isInteger(value), true);
  }
});

test("star is corners plus the middle row's third number - five cells, five values", () => {
  assert.deepEqual(starCells(EXAMPLE_TICKET), [[0, 0], [0, 8], [2, 0], [2, 8], [1, 5]]);
  assert.deepEqual(cellValues(EXAMPLE_TICKET, starCells(EXAMPLE_TICKET)), STAR_VALUES);
  assert.equal(new Set(starCells(EXAMPLE_TICKET).map((c) => c.join(","))).size, 5, "no cell is counted twice");

  const onStar = { patterns: { star: true } };
  assert.equal(evaluateClaim("star", EXAMPLE_TICKET, [4, 85, 9, 90], onStar).valid, false, "four corners alone are Corners, not Star");
  const centreOnly = evaluateClaim("star", EXAMPLE_TICKET, [56], onStar);
  assert.equal(centreOnly.valid, false, "and the centre alone is Laddu, not Star");
  const complete = evaluateClaim("star", EXAMPLE_TICKET, STAR_VALUES, onStar);
  assert.equal(complete.valid, true);
  assert.equal(complete.completedOnCall, 5, "the fifth required number completes it");

  // every required coordinate, one at a time: drop it and the claim must refuse
  // while naming exactly that number
  for (const cell of starCells(EXAMPLE_TICKET)) {
    const value = EXAMPLE_TICKET[cell[0]][cell[1]];
    const verdict = evaluateClaim("star", EXAMPLE_TICKET, STAR_VALUES.filter((n) => n !== value), onStar);
    assert.equal(verdict.valid, false, "star cell " + cell.join(",") + " (" + value + ") is required");
    assert.deepEqual(verdict.missing, [value]);
    assert.equal(centreOnly.missing.length > 0, true);
  }

  // numbers outside the pattern never fill a gap: fourteen of the ticket's
  // fifteen numbers, minus one corner, is still not a Star
  const almostEverything = ticketNumbers(EXAMPLE_TICKET).filter((n) => n !== 90);
  const refused = evaluateClaim("star", EXAMPLE_TICKET, almostEverything, onStar);
  assert.equal(refused.valid, false);
  assert.deepEqual(refused.missing, [90]);
});

test("box is the middle three columns, and its depth follows the ticket", () => {
  assert.deepEqual(BOX_COLUMNS, [3, 4, 5]);
  assert.deepEqual(boxCells(EXAMPLE_TICKET), [[1, 3], [2, 3], [0, 4], [1, 5], [2, 5]]);
  assert.deepEqual(cellValues(EXAMPLE_TICKET, boxCells(EXAMPLE_TICKET)), BOX_VALUES);
  assert.notDeepEqual(boxCells(EXAMPLE_TICKET), cornerCells(EXAMPLE_TICKET), "Box is not the four corners under another name");

  const onBox = { patterns: { box: true } };
  const missingTop = evaluateClaim("box", EXAMPLE_TICKET, [34, 38, 56, 59], onBox);
  assert.equal(missingTop.valid, false);
  assert.deepEqual(missingTop.missing, [41], "the 40-49 column is part of the block");
  assert.equal(evaluateClaim("box", EXAMPLE_TICKET, BOX_VALUES, onBox).valid, true);
  for (const cell of boxCells(EXAMPLE_TICKET)) {
    const value = EXAMPLE_TICKET[cell[0]][cell[1]];
    const verdict = evaluateClaim("box", EXAMPLE_TICKET, BOX_VALUES.filter((n) => n !== value), onBox);
    assert.equal(verdict.valid, false, "box cell " + cell.join(",") + " is required");
    assert.deepEqual(verdict.missing, [value]);
  }

  // the block is whatever the ticket actually holds in the 30-39, 40-49 and
  // 50-59 columns: never empty, never more than nine, nothing outside them
  const rng = makeRng(90210);
  const sizes = new Set();
  for (let i = 0; i < 200; i++) {
    const grid = generateTicket(rng);
    assert.equal(validateTicket(grid).valid, true, "the fixture generates legal tickets");
    const cells = boxCells(grid);
    assert.ok(cells.length >= 3 && cells.length <= 9, "the block is three to nine cells, saw " + cells.length);
    for (const [row, col] of cells) {
      assert.ok(BOX_COLUMNS.includes(col), "column " + col + " is inside the block");
      assert.equal(Number.isInteger(grid[row][col]), true, "and the cell holds a number");
    }
    sizes.add(cells.length);
    // near-miss on a real ticket: the block minus its own deepest cell
    const drop = grid[cells[cells.length - 1][0]][cells[cells.length - 1][1]];
    const verdict = evaluateClaim("box", grid, ticketNumbers(grid).filter((n) => n !== drop), onBox);
    assert.equal(verdict.valid, false, "a block with " + drop + " missing does not pay");
    assert.deepEqual(verdict.missing, [drop]);
  }
  assert.ok(sizes.size >= 3, "the fixtures saw blocks of different depths: " + [...sizes].sort().join(","));
});

test("the block window only ever names numbered cells, at either extreme", () => {
  assert.deepEqual(columnWindowCells(EXAMPLE_TICKET, [0, 4]), [[0, 0], [2, 0], [0, 4]]);
  assert.deepEqual(columnWindowCells(EXAMPLE_TICKET, []), []);

  // the shallowest box a legal ticket can hold: one number per middle column
  assert.equal(validateTicket(TICKET_SHALLOW).valid, true);
  assert.deepEqual(boxCells(TICKET_SHALLOW), [[0, 3], [1, 4], [2, 5]]);
  assert.deepEqual(cellValues(TICKET_SHALLOW, boxCells(TICKET_SHALLOW)), [35, 45, 55]);

  // and the deepest: a ticket that fills all three middle columns to three
  assert.equal(validateTicket(TICKET_PACKED).valid, true);
  const packed = boxCells(TICKET_PACKED);
  assert.equal(packed.length, 9, "a ticket that packs the centre is the full Box of 9");
  assert.deepEqual(cellValues(TICKET_PACKED, packed), [30, 31, 39, 40, 41, 49, 50, 51, 59]);
  for (const [row, col] of packed) assert.equal(Number.isInteger(TICKET_PACKED[row][col]), true);
});

test("every diagram the server publishes is the pattern the server evaluates", () => {
  const views = patternViews(ALL_ON);
  assert.equal(views.length, Object.keys(PATTERNS).length, "all eleven prizes are visible when all are opted into");
  let diagramsChecked = 0;
  for (const view of views) {
    const pattern = PATTERNS[view.id];
    if (!view.cells || pattern.requires || pattern.scope === "seat") continue;
    diagramsChecked += 1;
    const values = cellValues(EXAMPLE_TICKET, view.cells);
    assert.equal(new Set(values).size, values.length, view.id + " names distinct cells");
    const complete = evaluateClaim(view.id, EXAMPLE_TICKET, values, ALL_ON);
    assert.equal(complete.valid, true, view.id + " pays for exactly the cells it draws: " + (complete.reason || ""));
    if (view.kind === "cells") {
      for (const value of values) {
        const near = evaluateClaim(view.id, EXAMPLE_TICKET, values.filter((n) => n !== value), ALL_ON);
        assert.equal(near.valid, false, view.id + " needs " + value);
        assert.deepEqual(near.missing, [value], view.id + " says which cell was short");
      }
    }
  }
  assert.equal(diagramsChecked, 7, "corners, three lines, full house, star and box all carry a checked diagram");
});

test("the catalogue and the claim panel never describe a pattern differently", () => {
  const catalog = patternCatalog(ALL_ON);
  const views = patternViews(ALL_ON);
  assert.equal(catalog.length, views.length);
  for (const entry of catalog) {
    const view = views.find((item) => item.id === entry.id);
    assert.deepEqual(entry.cells, view.cells, entry.id + " draws the same cells off as on");
    assert.deepEqual(entry, { ...view, enabled: true }, "and says the same thing about points and shape");
  }
  for (const entry of patternCatalog({})) {
    assert.equal(entry.enabled, !entry.optional, "by default the approved six are on and the optional five are off");
  }
});
