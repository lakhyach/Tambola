/* eslint-disable react/prop-types */
import Panel from "../Panel.jsx";
import { FaUsers } from "react-icons/fa";
import { roomSummary } from "../../lib/caller.js";
import { rosterStatistic } from "../../lib/playerview.js";
import { bookingCopy, formatBookingNumber } from "../../i18n/booking-locale.js";

/**
 * Who is in the hall, as the server reports them.
 *
 * The counts come from the roster the server sends (`players`) and the room's
 * own capacity (`maxPlayers`); no number here is estimated. Only what a seat
 * already shows on every player's screen is displayed — name, host mark,
 * connection state, ticket count, points. No session token, no credential, no
 * private field is read or shown.
 */
const RoomOverview = ({ players = [], leaderboard = [], state = "WAITING", maxPlayers = null, language = "en" }) => {
  const t = (key, variables) => bookingCopy(language, key, variables);
  const summary = roomSummary({ players, maxPlayers });
  const pointsById = new Map(leaderboard.map((p) => [p.playerId, p.points]));

  return (
    <Panel className="p-4 oh-caller-room festival-caller-card">
      <div className="flex items-center justify-between mb-3">
        <h2 className="caller-roster-heading"><FaUsers aria-hidden="true" />{language === "hi" ? "खिलाड़ी" : "Players"} <span>({formatBookingNumber(summary.seated, language)})</span></h2>
      </div>
      <div className="caller-roster-summary">
        <span className="oh-num" style={{ color: "var(--oh-text-muted)", fontSize: 12 }}>
          {formatBookingNumber(summary.seated, language)} {t(state === "RUNNING" || state === "PAUSED" ? "playersPlaying" : state === "COMPLETED" ? "playersPlayed" : "playersSeated")}
        </span>
      </div>

      <div className="oh-stats oh-sr-only">
        <div className="oh-stat">
          <div className="oh-eyebrow">{t("seatedCount")}</div>
          <div className="oh-num oh-stat__value">
            {formatBookingNumber(summary.seated, language)}
            {summary.capacity ? <span className="oh-stat__unit"> / {formatBookingNumber(summary.capacity, language)}</span> : null}
          </div>
        </div>
        <div className="oh-stat">
          <div className="oh-eyebrow">{t("callerHallLabel")}</div>
          <div className="oh-num oh-stat__value" data-tone={summary.away ? "warn" : "ok"}>
            {formatBookingNumber(summary.connected, language)}
          </div>
        </div>
        <div className="oh-stat">
          <div className="oh-eyebrow">{t("callerAwayLabel")}</div>
          <div className="oh-num oh-stat__value" data-tone={summary.away ? "warn" : undefined}>
            {formatBookingNumber(summary.away, language)}
          </div>
        </div>
        <div className="oh-stat">
          <div className="oh-eyebrow">{t("tickets")}</div>
          <div className="oh-num oh-stat__value">{formatBookingNumber(summary.tickets, language)}</div>
        </div>
      </div>

      {players.length === 0 ? (
        <p style={{ color: "var(--oh-text-faint)", fontSize: 13, margin: "10px 0 0" }}>
          {t("nobodySeated")}
        </p>
      ) : (
        <ul className="oh-seats" aria-label={t("seatedParticipants")}>
          {players.map((p, index) => {
            const stat = rosterStatistic({ ...p, points: pointsById.get(p.id) ?? p.points }, state);
            return (
              <li key={p.id} className="oh-seat" data-away={String(p.connected === false)}>
                <span className="caller-seat-position oh-num" aria-hidden="true">{formatBookingNumber(index + 1, language)}</span>
                <span className="caller-seat-avatar" aria-hidden="true">{String(p.name || "").trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join("").toLocaleUpperCase(language)}</span>
                <span
                  className="oh-dot"
                  data-tone={p.connected === false ? "off" : "ok"}
                  aria-hidden="true"
                />
                <span className="oh-seat__name" title={p.name}>
                  {p.name}
                  {p.isHost ? <span className="oh-seat__host">{t("participantHost")}</span> : null}
                </span>
                {stat ? (
                  <span className="oh-num oh-seat__stat">
                    {formatBookingNumber(stat.value, language)}
                    <span className="oh-eyebrow oh-seat__unit">{stat.unit === "pts" ? t("pointsUnit") : t(stat.unit === "ticket" ? "oneTicket" : "manyTickets")}</span>
                  </span>
                ) : null}
                <span className="oh-sr-only">{t(p.connected === false ? "away" : "connected")}</span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="caller-roster-footer"><span className="oh-dot" data-tone={summary.away ? "warn" : "ok"} aria-hidden="true" />{formatBookingNumber(summary.connected, language)} {t("connected")} · {formatBookingNumber(summary.away, language)} {t("away")}</p>
    </Panel>
  );
};

export default RoomOverview;
