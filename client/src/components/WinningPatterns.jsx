/* eslint-disable react/prop-types */
import Panel from "./Panel.jsx";
import Button from "./Button.jsx";
import PatternDiagram from "./PatternDiagram.jsx";
import { bookingClaimReason, bookingCopy, bookingPatternHint, bookingPatternName, formatBookingNumber } from "../i18n/booking-locale.js";

/**
 * The claim controls, driven entirely by the SERVER's view of this room's
 * prizes (`snapshot.patternViews`). Every row — name, points, explanation, the
 * grid diagram and its coordinates — is what the evaluator itself checks, so a
 * player can never be shown a shape the engine would refuse, nor be offered a
 * claim the engine wouldn't pay. `claimStates` is this seat's own per-prize
 * eligibility, computed from the same verdict the live claim path uses.
 *
 * Claiming only ASKS the server; nothing below declares a win locally. The
 * awarded state — winner and ticket attribution — comes straight back in
 * `snapshot.awards`, which is durable and identical after a reconnect.
 */

// A pattern's ordinal reads as a place (1st/2nd) when a prize has more than one
// winner - the second Full House names a runner-up, not a tied field.
function ordinalWord(n, language = "en") {
  if (language === "hi") return `${formatBookingNumber(n, language)}.`;
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return n ? `${n}th` : "";
}

// Human ticket attribution: one ticket, or the several a seat-level prize names.
function ticketLabel(award, language = "en") {
  const identifier = (value) => typeof value === "string" && !/^\d+$/.test(value) ? value : formatBookingNumber(value, language);
  if (Array.isArray(award.ticketNos) && award.ticketNos.length) {
    return bookingCopy(language, "ticketsLabel", { numbers: award.ticketNos.map(identifier).join(", ") });
  }
  return award.ticketNo != null ? bookingCopy(language, "ticketLabel", { number: identifier(award.ticketNo) }) : "";
}

const WinningPatterns = ({
  patterns = [],
  awards = [],
  example = null,
  claimStates = [],
  note = null,
  canClaim = false,
  pendingPattern = null,
  claimFeedback = null,
  myPlayerId,
  onSubmit,
  language = "en",
}) => {
  const t = (key, variables) => bookingCopy(language, key, variables);
  const stateByPattern = new Map(claimStates.map((s) => [s.pattern, s]));
  const labelById = new Map(patterns.map((p) => [p.id, bookingPatternName(language, p.id, p.label)]));
  const awardsByPattern = new Map();
  for (const a of awards) {
    if (!awardsByPattern.has(a.pattern)) awardsByPattern.set(a.pattern, []);
    awardsByPattern.get(a.pattern).push(a);
  }

  return (
    <Panel className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="oh-eyebrow">{t("winningPatterns")}</h2>
        {note ? (
          <span className="oh-eyebrow" style={{ color: "var(--oh-text-faint)" }}>
            {note}
          </span>
        ) : null}
      </div>
      {canClaim ? (
        <p style={{ margin: "-4px 0 12px", fontSize: 12, color: "var(--oh-text-faint)" }}>
          {t("claimCheckExplanation")}
        </p>
      ) : null}

      {claimFeedback ? (
        <p className={`oh-claim-feedback-note oh-claim-feedback-note--${claimFeedback.state}`} role="status" aria-live="polite" aria-atomic="true">
          <span className="oh-claim-feedback-note__label">{t(`claimState${claimFeedback.state[0].toUpperCase()}${claimFeedback.state.slice(1)}`)}</span>
          <span>{claimFeedback.message}</span>
        </p>
      ) : null}

      <ul className="flex flex-col gap-3" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {patterns.map((view) => {
          const winners = awardsByPattern.get(view.id) || [];
          const awarded = winners.length > 0;
          const state = stateByPattern.get(view.id);
          const eligible = Boolean(state && state.valid);
          const claimLive = canClaim && eligible && !awarded;

          return (
            <li
              key={view.id}
              className="oh-pattern-item"
              data-awarded={String(awarded)}
              data-eligible={String(eligible && !awarded)}
            >
              <div className="oh-pattern-main">
                <div className="oh-pattern-head">
                  <span className="oh-pattern-name">{bookingPatternName(language, view.id, view.label)}</span>
                <span className="oh-num oh-pattern-points">+{formatBookingNumber(view.points, language)}</span>
                </div>
                <p className="oh-pattern-hint">{bookingPatternHint(language, view.id, view.hint)}</p>

                {view.cells ? (
                  <PatternDiagram
                    cells={view.cells}
                    example={example}
                    note={view.diagramNote}
                    label={view.label}
                    language={language}
                  />
                ) : view.kind === "count" ? (
                  <div className="oh-pattern-count">{t("anyTicketNumbers", { need: formatBookingNumber(view.need, language) })}</div>
                ) : null}

                {view.requires ? (
                  <div className="oh-pattern-requires">
                  {t("awardedAfter", { pattern: labelById.get(view.requires.pattern) || view.requires.pattern })}
                  </div>
                ) : null}

                {/* eligibility / claim state, in the server's own words */}
                {!awarded ? (
                  eligible ? (
                    <div className="oh-pattern-elig oh-pattern-elig--ready">
                      {t("completedClaim")}
                    </div>
                  ) : state && state.reason ? (
                    <div className="oh-pattern-elig">{bookingClaimReason(language, state.reason)}</div>
                  ) : null
                ) : null}
              </div>

              <div className="oh-pattern-side">
                {pendingPattern === view.id ? <span className="oh-claim-pending" role="status" aria-live="polite">{t("claimPending")}</span> : null}
                {awarded ? (
                  <ul className="oh-pattern-awards" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {winners.map((w, i) => (
                      <li key={`${w.pattern}-${i}`} className="oh-pattern-award">
                        <span className="oh-pattern-award__who">
                          {w.playerId === myPlayerId ? t("youWon") : w.name}
                        </span>
                        <span className="oh-pattern-award__meta">
                          {Number.isInteger(w.winnerOrdinal) && winners.length > 1
                            ? `${ordinalWord(w.winnerOrdinal, language)} · `
                            : ""}
                          {ticketLabel(w, language)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Button
                    variant={claimLive ? "gold" : "ghost"}
                    size="sm"
                    className="oh-claim"
                    disabled={!claimLive || Boolean(pendingPattern)}
                    onClick={() => onSubmit(view.id)}
                    aria-busy={pendingPattern === view.id}
                    aria-label={t("claimPattern", { pattern: bookingPatternName(language, view.id, view.label) })}
                  >
                    {t("claim")}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
};

export default WinningPatterns;
