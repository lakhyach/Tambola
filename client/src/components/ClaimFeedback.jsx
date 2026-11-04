import Panel from "./Panel.jsx";
import { PATTERN_META } from "../brand.js";
import { bookingCopy, bookingPatternName, formatBookingNumber } from "../i18n/booking-locale.js";

/**
 * A truthful winners board. Every line here is an award the server has already
 * settled — it is generated from `snapshot.awards`, never from a client guess.
 * When the game is COMPLETED the final standings are appended from the
 * server's leaderboard.
 */
// eslint-disable-next-line react/prop-types
const ClaimFeedback = ({ awards = [], leaderboard = [], state, language = "en" }) => {
  const completed = state === "COMPLETED";
  const t = (key, variables) => bookingCopy(language, key, variables);
  return (
    <Panel className="p-4 oh-claim-feedback" data-game-state={state}>
      <h2 className="oh-eyebrow mb-3">{t(completed ? "finalResults" : "claimedPrizes")}</h2>

      {awards.length === 0 && !completed ? (
        <p style={{ color: "var(--oh-text-faint)", fontSize: 13 }}>
          {t("noPrizesClaimed")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {awards.map((a, i) => (
            <li
              key={`${a.pattern}-${i}`}
              className="flex items-center justify-between"
              style={{ fontSize: 14 }}
            >
              <span style={{ color: "var(--oh-text-muted)" }}>
                {bookingPatternName(language, a.pattern, a.label || PATTERN_META[a.pattern]?.label || a.pattern)}
              </span>
              <span style={{ color: "var(--oh-gold-bright)", fontWeight: 600 }}>
                {a.name} <span className="oh-num" style={{ color: "var(--oh-text-faint)" }}>+{formatBookingNumber(a.points, language)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {completed && leaderboard.length > 0 ? (
        <>
          <hr className="oh-rule my-3" />
          <h3 className="oh-eyebrow mb-2">{t("standings")}</h3>
          <ol className="flex flex-col gap-1" style={{ padding: 0, margin: 0, listStyle: "none" }}>
            {leaderboard.slice(0, 8).map((p, i) => (
              <li key={p.playerId || i} className="flex items-center justify-between" style={{ fontSize: 14 }}>
                <span style={{ color: i === 0 ? "var(--oh-gold-bright)" : "var(--oh-text)" }}>
                  <span className="oh-num" style={{ color: "var(--oh-text-faint)", marginRight: 8 }}>{formatBookingNumber(i + 1, language)}</span>
                  {p.player}
                </span>
                <span className="oh-num" style={{ fontWeight: 700 }}>{formatBookingNumber(p.points, language)}</span>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </Panel>
  );
};

export default ClaimFeedback;
