// Public UI descriptions and canonical sample geometry for implemented
// patterns. Keep these diagrams aligned with server/game/pattern-geometry.js.
// The server remains the sole source of truth for evaluation and awards.
export const PATTERN_CATALOG = [
  { id: "earlyFive", title: "Early Five", description: "Any five of the fifteen numbers on one ticket, once called.", kind: "count", count: 5 },
  { id: "topLine", title: "Top Line", description: "All five numbered cells in the top row.", kind: "row", row: 0 },
  { id: "middleLine", title: "Middle Line", description: "All five numbered cells in the middle row.", kind: "row", row: 1 },
  { id: "bottomLine", title: "Bottom Line", description: "All five numbered cells in the bottom row.", kind: "row", row: 2 },
  { id: "corners", title: "Corners", description: "The leftmost and rightmost numbers in the top and bottom rows.", kind: "corners" },
  { id: "fullHouse", title: "Full House", description: "All fifteen numbers on one ticket.", kind: "all" },
  { id: "earlySeven", title: "Early Seven", description: "Any seven of the fifteen numbers on one ticket, once called.", kind: "count", count: 7 },
  { id: "star", title: "Star", description: "The four corner numbers plus the middle row’s third number.", kind: "star" },
  { id: "box", title: "Box", description: "Every numbered cell in columns 30–59 (the three central decade columns).", kind: "box" },
  { id: "secondFullHouse", title: "Second Full House", description: "The next different ticket to complete all fifteen, after the first Full House is awarded.", kind: "all" },
  { id: "halfSheet", title: "Half Sheet", description: "On one seat with at least three tickets: any two called numbers on each of three tickets.", kind: "halfSheet" },
];

export const PATTERN_TICKET = [
  [4, null, 22, null, 41, null, 63, null, 85],
  [null, 15, null, 34, null, 56, null, 77, 88],
  [9, null, 27, 38, null, 59, null, null, 90],
];

const FIXED_PATTERN_CELLS = {
  corners: [[0, 0], [0, 8], [2, 0], [2, 8]],
  star: [[0, 0], [0, 8], [2, 0], [2, 8], [1, 5]],
  box: [[0, 4], [1, 3], [1, 5], [2, 3], [2, 5]],
};

export function getPatternDisplayCells(pattern) {
  const filled = PATTERN_TICKET.flatMap((row, r) => row.flatMap((value, c) => value == null ? [] : [[r, c]]));
  if (pattern.kind === "count") return filled.slice(0, pattern.count);
  if (pattern.kind === "all") return filled;
  if (pattern.kind === "row") return PATTERN_TICKET[pattern.row].flatMap((value, c) => value == null ? [] : [[pattern.row, c]]);
  if (["corners", "star", "box"].includes(pattern.kind)) return FIXED_PATTERN_CELLS[pattern.kind];
  if (pattern.kind === "halfSheet") return filled.slice(0, 2);
  return [];
}

export function getPatternDisplayNote(pattern) {
  if (pattern.kind === "count") return `Example of ${pattern.count} called cells; any ${pattern.count} of the 15 numbers count.`;
  if (pattern.kind === "halfSheet") return "Each of three tickets needs any two called numbers; all three tickets belong to one seat.";
  if (pattern.id === "secondFullHouse") return "The first Full House winner’s ticket cannot also win this prize.";
  return "Highlighted numbered cells must all be called.";
}
