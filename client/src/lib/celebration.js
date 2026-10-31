/**
 * Celebration event mapping (§4) — PURE, no DOM, no socket.
 *
 * Turns already-verified server events into a small display model the overlay
 * renders. Kept side-effect free and browser-agnostic so it is unit-testable in
 * the plain node suite. It NEVER decides who won — it only formats the payload
 * the server already committed (a `claim:result` with `won: true`, or a
 * `game:completed`). Trust boundary: `won: true` from `commitClaim` means the
 * award was verified and written server-side, i.e. a CONFIRMED win, not a client
 * guess. An accepted-but-not-yet-awarded claim never reaches here (the engine
 * only emits `claim:result` after committing the award).
 */

import { celebrate } from "../i18n/messages.js";

/**
 * Map a `claim:result` payload to a pattern-win celebration event, or null when
 * the payload is not a confirmed win (so nothing ever celebrates a lost/invalid
 * claim). `roomId` scopes the idempotency key.
 */
export function patternEvent(claim, roomId, lang) {
  if (!claim || claim.won !== true) return null;
  const ticketPart = claim.ticketNo == null ? "na" : claim.ticketNo;
  return {
    id: `pat:${roomId}:${claim.pattern}:${claim.playerId}:${ticketPart}`,
    kind: "pattern",
    name: claim.name,
    label: claim.label,
    points: claim.points,
    ticketNo: claim.ticketNo ?? null,
    message: celebrate(lang, "patternWin", { name: claim.name, label: claim.label }),
  };
}

/** Top-of-leaderboard outcome: single winner, an explicit tie, or nobody scored. */
export function finalOutcome(leaderboard = []) {
  if (!leaderboard.length) return { kind: "none", winners: [], top: 0 };
  const top = leaderboard[0].points ?? 0;
  if (top <= 0) return { kind: "none", winners: [], top: 0 };
  const winners = leaderboard.filter((p) => (p.points ?? 0) === top);
  return { kind: winners.length > 1 ? "tie" : "single", winners, top };
}

/**
 * Map a `game:completed` payload to the finale celebration event. Includes the
 * full standings so the overlay can show the final results. `reason` is the
 * server's own completion cause.
 */
export function finalEvent(completed, roomId, lang) {
  const leaderboard = Array.isArray(completed?.leaderboard) ? completed.leaderboard : [];
  const outcome = finalOutcome(leaderboard);
  const names = outcome.winners.map((w) => w.player).join(", ");
  const message =
    outcome.kind === "single"
      ? celebrate(lang, "finalWinner", { name: names })
      : outcome.kind === "tie"
        ? celebrate(lang, "tiedWinner", { names })
        : celebrate(lang, "noWinner", {});
  return {
    id: `final:${roomId}`,
    kind: "final",
    outcome,
    reason: completed?.reason || "",
    leaderboard,
    awards: completed?.awards || [],
    message,
  };
}
