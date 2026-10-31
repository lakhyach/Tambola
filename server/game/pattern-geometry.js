/**
 * Ticket-cell geometry for the winning patterns, in ONE place.
 *
 * A pattern that is drawn on the ticket must be evaluated on the ticket. Before
 * this module the diagram lived in the browser (client/src/brand.js) and the
 * rule lived in the registry (server/game/patterns.js), so a player could be
 * shown one shape and be paid for another. Here the server turns a ticket into
 * the exact list of [row, column] cells a pattern needs; the client only draws
 * what it is handed, and the evaluator uses the same helpers.
 *
 * Coordinates are 0-based: row 0-1-2 top to bottom, column 0..8 left to right,
 * exactly as server/game/ticket.js lays a ticket out (nine decade columns,
 * 1-9, 10-19, 20-29, 30-39, 40-49, 50-59, 60-69, 70-79, 80-90).
 *
 * "The nth number of a row" counts the FIVE FILLED CELLS of that row from left
 * to right, never column n: every row of a legal ticket holds exactly five
 * numbers, so an ordinal inside a row always exists even when the column under
 * it is blank. Published rule pages use the same wording (docs/NEW-WINNING-
 * PATTERNS.md §2), and it is what makes patterns like Star well defined.
 */

import { COLS, ROWS, NUMBERS_PER_ROW } from "./ticket.js";

/**
 * A legal example ticket, printed on the same grid the evaluator reads. It is
 * the ticket the published pattern charts use, so a diagram drawn on it can be
 * checked against those charts cell for cell.
 *
 *   row 1:  4  .  22  .  41  .  63  .  85
 *   row 2:  .  15  .  34  .  56  .  77  88
 *   row 3:  9  .  27  38   .  59  .   .  90
 */
export const EXAMPLE_TICKET = Object.freeze([
  Object.freeze([4, null, 22, null, 41, null, 63, null, 85]),
  Object.freeze([null, 15, null, 34, null, 56, null, 77, 88]),
  Object.freeze([9, null, 27, 38, null, 59, null, null, 90]),
]);

/** Columns of the numbered cells of one row, left to right. Always five. */
export function filledColumns(ticket, rowIndex) {
  const cols = [];
  for (let col = 0; col < COLS; col++) {
    const v = ticket[rowIndex] && ticket[rowIndex][col];
    if (v !== null && v !== undefined) cols.push(col);
  }
  return cols;
}

/**
 * Cells holding the 1-based ordinals `ordinals` of a row's own five numbers.
 * `rowCells(ticket, 1, [3])` is therefore "the 3rd number of the middle row".
 */
export function rowCells(ticket, rowIndex, ordinals) {
  const cols = filledColumns(ticket, rowIndex);
  if (cols.length !== NUMBERS_PER_ROW) {
    throw new Error("row " + (rowIndex + 1) + " of the ticket holds " + cols.length + " numbers, expected " + NUMBERS_PER_ROW);
  }
  return ordinals.map((ordinal) => {
    if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > NUMBERS_PER_ROW) {
      throw new Error("row ordinal " + ordinal + " is outside 1-" + NUMBERS_PER_ROW);
    }
    return [rowIndex, cols[ordinal - 1]];
  });
}

/** The four corners: outermost numbered cell of the top row and of the bottom row. */
export function cornerCells(ticket) {
  const top = filledColumns(ticket, 0);
  const bottom = filledColumns(ticket, ROWS - 1);
  return [
    [0, top[0]],
    [0, top[top.length - 1]],
    [ROWS - 1, bottom[0]],
    [ROWS - 1, bottom[bottom.length - 1]],
  ];
}

/** The centre of the middle row: its 3rd number. Always exists on a legal ticket. */
export function middleRowCentreCell(ticket) {
  return rowCells(ticket, 1, [3])[0];
}

/**
 * Star: the four corners plus the centre of the middle row. Five cells, and
 * they are always five DIFFERENT cells - the corners live in rows 1 and 3, the
 * centre in row 2 - so the pattern needs exactly five called numbers.
 */
export function starCells(ticket) {
  return [...cornerCells(ticket), middleRowCentreCell(ticket)];
}

/** Every numbered cell inside a window of columns (the vertical "block"). */
export function columnWindowCells(ticket, columns) {
  const cells = [];
  for (const col of columns) {
    for (let row = 0; row < ROWS; row++) {
      const v = ticket[row] && ticket[row][col];
      if (v !== null && v !== undefined) cells.push([row, col]);
    }
  }
  return cells;
}

/** Values sitting on a list of [row, column] cells. */
export function cellValues(ticket, cells) {
  return cells.map(([row, col]) => ticket[row][col]);
}

/**
 * The middle three columns: the 30-39, 40-49 and 50-59 decade columns, i.e.
 * the central block of the ticket with the first three and last three columns
 * left out. Three columns x three rows is at most nine cells, which is why the
 * published callers name it the Box of 9. A legal ticket never leaves a column
 * empty, so the block always holds at least three numbers.
 */
export const BOX_COLUMNS = Object.freeze([3, 4, 5]);
export function boxCells(ticket) {
  return columnWindowCells(ticket, BOX_COLUMNS);
}
