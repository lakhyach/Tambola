import Panel from "./Panel.jsx";
import { rosterStatistic } from "../lib/playerview.js";
import { bookingCopy, formatBookingNumber } from "../i18n/booking-locale.js";

/**
 * The right edge of a seat row: tickets before a round, points during it, and
 * nothing when the number would carry no meaning. See lib/playerview.js.
 */
// eslint-disable-next-line react/prop-types
const SeatStatistic = ({ seat, state, language = "en" }) => {
  const stat = rosterStatistic(seat, state);
  if (!stat) return null;
  const unitKey = stat.unit === "pts" ? "pointsUnit" : stat.unit === "ticket" ? "oneTicket" : "manyTickets";
  return (
    <span className="oh-num" style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
      {formatBookingNumber(stat.value, language)}
      <span
        className="oh-eyebrow"
        style={{ marginLeft: 5, fontSize: 9, color: "var(--oh-text-faint)" }}
      >
        {bookingCopy(language, unitKey)}
      </span>
    </span>
  );
};

/**
 * The authoritative roster: names, points and live connection state exactly as
 * the server reports them (playersList + leaderboard). Shows who is the host
 * and highlights the viewer. `state` is the server's game state, so the count
 * reads "seated" before a round and "playing" during one rather than claiming
 * numbers are being called when they are not.
 */
// eslint-disable-next-line react/prop-types
const PlayerRoster = ({ players = [], leaderboard = [], myPlayerId, state = "WAITING", language = "en", onRemovePlayer, removalBusy = false }) => {
  const pointsById = new Map(leaderboard.map((p) => [p.playerId, p.points]));
  const t = (key, variables) => bookingCopy(language, key, variables);
  const stateKey = state === "RUNNING" || state === "PAUSED" ? "playing" : state === "COMPLETED" ? "played" : "seated";

  return (
    <Panel className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="oh-eyebrow">{t("inTheHall")}</h2>
        <span className="oh-num" style={{ color: "var(--oh-text-muted)", fontSize: 12 }}>
          {formatBookingNumber(players.length, language)} {t(stateKey)}
        </span>
      </div>

      {players.length === 0 ? (
        <p style={{ color: "var(--oh-text-faint)", fontSize: 13 }}>{t("waitingPlayers")}</p>
      ) : (
        <ul className="flex flex-col gap-2" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {players.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between rounded-xl px-3 py-2"
              style={{
                background: p.id === myPlayerId ? "rgba(207,171,99,.08)" : "var(--oh-inset)",
                border: `1px solid ${p.id === myPlayerId ? "var(--oh-line-gold)" : "var(--oh-line)"}`,
                opacity: p.connected === false ? 0.5 : 1,
              }}
            >
              <span className="flex items-center gap-2" style={{ minWidth: 0 }}>
                <span
                  aria-hidden="true"
                  title={t(p.connected ? "connected" : "away")}
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    flex: "0 0 auto",
                    background: p.connected ? "var(--oh-ok)" : "var(--oh-text-faint)",
                  }}
                />
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: "var(--oh-ivory)",
                  }}
                >
                  {p.name}
                  {p.id === myPlayerId ? ` ${t("you")}` : ""}
                </span>
                {p.isHost ? (
                  <span
                    className="oh-eyebrow"
                    style={{ color: "var(--oh-gold)", fontSize: 9, marginLeft: 4 }}
                  >
                    {t("host")}
                  </span>
                ) : null}
              </span>
              <div className="flex items-center gap-2" style={{ flex: "0 0 auto" }}>
                <SeatStatistic seat={{ ...p, points: pointsById.get(p.id) ?? p.points }} state={state} language={language} />
                {state === "WAITING" && !p.isHost && onRemovePlayer ? (
                  <button
                    type="button"
                    className="oh-seat__remove"
                    aria-label={t("removeParticipantLabel", { name: p.name })}
                    disabled={removalBusy}
                    onClick={() => {
                      if (window.confirm(t("removeParticipantConfirm", { name: p.name }))) onRemovePlayer(p.id);
                    }}
                  >
                    {t("removeParticipant")}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
};

export default PlayerRoster;
