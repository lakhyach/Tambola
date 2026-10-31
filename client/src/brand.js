/**
 * Product identity, kept in one place so the "OBSIDIAN HALL" direction can be
 * re-branded without touching a single component. These are display strings
 * only — nothing here affects gameplay, which stays entirely server-owned.
 *
 * The three headline strings now come from the configurable client layer (see
 * config.js), so a purchasing client can re-brand via VITE_* env vars without
 * editing this file. The named exports are preserved for every existing import
 * site.
 */
import { config } from "./config.js";

export const APP_NAME = config.brand.name;
export const APP_TAGLINE = config.brand.tagline;
export const APP_SUBTITLE = config.brand.subtitle;

/**
 * The rest of the configurable identity. Every one of these is rendered
 * somewhere — a switch in config.js that nothing reads is worse than no switch,
 * because a purchasing client sets it and then sees nothing happen.
 *
 *   APP_LOGO      brand mark in the header (falls back to the gold dot if the
 *                 path does not resolve, so a wrong VITE_APP_LOGO never leaves a
 *                 broken image)
 *   BRAND_LINKS   terms / privacy / support URLs; an empty string means the link
 *                 is not rendered at all
 *   FOOTER_NOTICE the one-line statement under the landing page (free to play)
 *   APP_MARK      the house label beside the product name in the two headers
 *   INVITE_*      share/invite copy, so it follows the product name
 */
export const APP_LOGO = config.brand.logoPath;
export const APP_MARK = config.brand.mark;
export const BRAND_LINKS = config.links;
export const FOOTER_NOTICE = config.footer.notice;

/** Share/invite copy, so a re-branded build never asks a friend to "join my Tambola room". */
export const INVITE_TITLE = config.brand.name;
export const INVITE_TEXT = `Join my ${config.brand.name} room`;

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
