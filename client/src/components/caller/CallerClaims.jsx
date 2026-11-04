/* eslint-disable react/prop-types */
import { FaTrophy } from "react-icons/fa";
import Panel from "../Panel.jsx";
import Button from "../Button.jsx";
import PatternDiagram from "../PatternDiagram.jsx";
import { canClaim } from "../../lib/playerview.js";
import { bookingClaimReason, bookingCopy, bookingPatternHint, bookingPatternName, formatBookingNumber } from "../../i18n/booking-locale.js";

/** Compact caller prize list. Expanding a row reveals the same server-owned
 * diagram, eligibility and dependencies as the player's complete prize card. */
export default function CallerClaims({ view, language = "en" }) {
  const t = (key, variables) => bookingCopy(language, key, variables);
  const ticketLabel = (value) => typeof value === "string" && !/^\d+$/.test(value) ? value : formatBookingNumber(value, language);
  const patterns = view.patternViews || [];
  const awards = view.awards || [];
  const eligibility = new Map((view.claimStates || []).map((state) => [state.pattern, state]));
  const names = new Map(patterns.map((pattern) => [pattern.id, bookingPatternName(language, pattern.id, pattern.label)]));
  const mayClaim = Boolean(view.playerId && view.onClaim && canClaim({ state: view.state, sheets: view.tickets || [] }));
  return (
    <Panel className="caller-claims festival-caller-card">
      <h2><FaTrophy aria-hidden="true" />{language === "hi" ? "जीतने के पैटर्न और दावे" : "Winning Patterns & Claims"}</h2>
      {view.claimFeedback ? <p className={`oh-claim-feedback-note oh-claim-feedback-note--${view.claimFeedback.state}`} role="status" aria-live="polite">{view.claimFeedback.message}</p> : null}
      <ul className="caller-claims-list">
        {patterns.map((pattern) => {
          const winners = awards.filter((award) => award.pattern === pattern.id);
          const state = eligibility.get(pattern.id);
          const awarded = winners.length > 0;
          const eligible = Boolean(state?.valid);
          const enabled = mayClaim && eligible && !awarded;
          const label = names.get(pattern.id);
          return (
            <li key={pattern.id} data-awarded={String(awarded)} data-eligible={String(eligible && !awarded)}>
              <div className="caller-claim-row">
                <details className="caller-claim-detail">
                  <summary><FaTrophy aria-hidden="true" /><span>{label}</span><strong>+{formatBookingNumber(pattern.points, language)}</strong></summary>
                  <div className="caller-claim-explanation">
                    <p>{bookingPatternHint(language, pattern.id, pattern.hint)}</p>
                    {pattern.cells ? <PatternDiagram cells={pattern.cells} example={view.patternExample} note={pattern.diagramNote} label={pattern.label} language={language} /> : pattern.kind === "count" ? <p>{t("anyTicketNumbers", { need: formatBookingNumber(pattern.need, language) })}</p> : null}
                    {pattern.requires ? <p>{t("awardedAfter", { pattern: names.get(pattern.requires.pattern) || pattern.requires.pattern })}</p> : null}
                    {!awarded ? <p>{eligible ? t("completedClaim") : state?.reason ? bookingClaimReason(language, state.reason) : t("claimCheckExplanation")}</p> : null}
                  </div>
                </details>
                {!awarded ? <Button variant={enabled ? "gold" : "ghost"} size="sm" className="oh-claim" disabled={!enabled || Boolean(view.claimPending)} onClick={() => view.onClaim(pattern.id)} aria-busy={view.claimPending === pattern.id} aria-label={t("claimPattern", { pattern: label })}>{view.claimPending === pattern.id ? t("claimPending") : t("claim")}</Button> : <span className="caller-claim-awarded">{t("claimStateApproved")}</span>}
              </div>
              {winners.length ? <ul className="caller-claim-winners">{winners.map((winner, index) => <li key={`${pattern.id}-${index}`}><strong>{winner.playerId === view.playerId ? t("youWon") : winner.name}</strong><span>{winner.winnerOrdinal && winners.length > 1 ? `${formatBookingNumber(winner.winnerOrdinal, language)}. · ` : ""}{Array.isArray(winner.ticketNos) && winner.ticketNos.length ? t("ticketsLabel", { numbers: winner.ticketNos.map(ticketLabel).join(", ") }) : winner.ticketNo != null ? t("ticketLabel", { number: ticketLabel(winner.ticketNo) }) : ""}</span></li>)}</ul> : null}
            </li>
          );
        })}
      </ul>
      {!patterns.length ? <p className="oh-caller-note">{language === "hi" ? "इस राउंड के पैटर्न अभी उपलब्ध नहीं हैं।" : "Round patterns are not available yet."}</p> : null}
    </Panel>
  );
}
