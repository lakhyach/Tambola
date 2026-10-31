/**
 * Server refusal codes -> something a player can read.
 *
 * Kept out of the component so the wording is testable in the plain node suite
 * (same reason celebration.js exists): a refusal message is a promise about
 * server behaviour, and a wrong one makes a working game look broken.
 */

export const REFUSAL = {
  ALREADY_AWARDED: "someone else already won that one",
  ALREADY_CLAIMED_BY_YOU: "you already claimed that",
  CLAIM_TOO_LATE: "too late — the next number was already called",
  INVALID_STATE: "the game is not running right now",
  INVALID_TRANSITION: "that is not possible in this state",
  UNKNOWN_PATTERN: "that pattern is not part of this game",
  NOT_HOST: "only the host may do that",
  NOT_PLAYER: "you are not in this room any more",
  BAD_PAYLOAD: "the server did not accept that",
  RATE_LIMITED: "slow down a moment",
  DRAW_EXHAUSTED: "all 90 numbers have been called",
};

/**
 * A refused claim comes back with the server's own reason ("line incomplete",
 * "early five window of 20 calls already passed", "no ticket number 4 belongs to
 * you"). That code is INVALID_STATE, which on its own maps to "the game is not
 * running right now" - true of a paused room, false of a claim that simply did
 * not verify. The specific answer always wins over the generic one.
 */
export function refusalText(result) {
  if (!result) return "the server said no";
  const reason = typeof result.reason === "string" ? result.reason.trim() : "";
  if (reason) return "Not this time - " + reason;
  return REFUSAL[result.code] || result.error || "the server said no";
}
