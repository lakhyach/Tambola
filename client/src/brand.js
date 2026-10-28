/**
 * Product identity, kept in one place so the "OBSIDIAN HALL" direction can be
 * re-branded without touching a single component. These are display strings
 * only — nothing here affects gameplay, which stays entirely server-owned.
 */
export const APP_NAME = "Tambola";
export const APP_TAGLINE = "The Obsidian Hall of Ninety Numbers";
export const APP_SUBTITLE =
  "A free, fast, real-time multiplayer game of Tambola / Housie.";

/**
 * Winning-pattern display metadata. The *rules* live only on the server
 * (server/game/patterns.js); this map is purely cosmetic and is filtered
 * against the snapshot's `enabledPatterns`, so it can never offer a claim the
 * engine would reject.
 */
export const PATTERN_META = {
  earlyFive: { label: "Early Five", points: 20, hint: "First five of your numbers called" },
  topLine: { label: "Top Line", points: 10, hint: "All five numbers in the top row" },
  middleLine: { label: "Middle Line", points: 10, hint: "All five numbers in the middle row" },
  bottomLine: { label: "Bottom Line", points: 10, hint: "All five numbers in the bottom row" },
  corners: { label: "Corners", points: 20, hint: "The four corner numbers" },
  fullHouse: { label: "Full House", points: 30, hint: "All fifteen numbers on the ticket" },
};
