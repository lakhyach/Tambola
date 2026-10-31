/* eslint-disable react/prop-types */
import Panel from "../Panel.jsx";
import { roomSummary } from "../../lib/caller.js";
import { rosterStatistic, rosterTally } from "../../lib/playerview.js";

/**
 * Who is in the hall, as the server reports them.
 *
 * The counts come from the roster the server sends (`players`) and the room's
 * own capacity (`maxPlayers`); no number here is estimated. Only what a seat
 * already shows on every player's screen is displayed — name, host mark,
 * connection state, ticket count, points. No session token, no credential, no
 * private field is read or shown.
 *
 * There is deliberately no kick/remove here: the authorization model has no
 * host-moderation event, so inventing a control that the server would refuse (or
 * worse, that nobody audited) is not an option. A host who needs a seat removed
 * closes the room with End; see docs/CALLER-CONSOLE.md.
 */
const RoomOverview = ({ players = [], leaderboard = [], state = "WAITING", maxPlayers = null }) => {
  const summary = roomSummary({ players, maxPlayers });
  const pointsById = new Map(leaderboard.map((p) => [p.playerId, p.points]));

  return (
    <Panel className="p-4 oh-caller-room">
      <div className="flex items-center justify-between mb-3">
        <h2 className="oh-eyebrow">The Hall</h2>
        <span className="oh-num" style={{ color: "var(--oh-text-muted)", fontSize: 12 }}>
          {rosterTally(state, summary.seated)}
        </span>
      </div>

      <div className="oh-stats">
        <div className="oh-stat">
          <div className="oh-eyebrow">Seated</div>
          <div className="oh-num oh-stat__value">
            {summary.seated}
            {summary.capacity ? <span className="oh-stat__unit"> / {summary.capacity}</span> : null}
          </div>
        </div>
        <div className="oh-stat">
          <div className="oh-eyebrow">In the hall</div>
          <div className="oh-num oh-stat__value" data-tone={summary.away ? "warn" : "ok"}>
            {summary.connected}
          </div>
        </div>
        <div className="oh-stat">
          <div className="oh-eyebrow">Away</div>
          <div className="oh-num oh-stat__value" data-tone={summary.away ? "warn" : undefined}>
            {summary.away}
          </div>
        </div>
        <div className="oh-stat">
          <div className="oh-eyebrow">Tickets</div>
          <div className="oh-num oh-stat__value">{summary.tickets}</div>
        </div>
      </div>

      {players.length === 0 ? (
        <p style={{ color: "var(--oh-text-faint)", fontSize: 13, margin: "10px 0 0" }}>
          Nobody has taken a seat yet. Share the room code to fill the hall.
        </p>
      ) : (
        <ul className="oh-seats" aria-label="Seated participants">
          {players.map((p) => {
            const stat = rosterStatistic({ ...p, points: pointsById.get(p.id) ?? p.points }, state);
            return (
              <li key={p.id} className="oh-seat" data-away={String(p.connected === false)}>
                <span
                  className="oh-dot"
                  data-tone={p.connected === false ? "off" : "ok"}
                  aria-hidden="true"
                />
                <span className="oh-seat__name" title={p.name}>
                  {p.name}
                  {p.isHost ? <span className="oh-seat__host">host</span> : null}
                </span>
                {stat ? (
                  <span className="oh-num oh-seat__stat">
                    {stat.value}
                    <span className="oh-eyebrow oh-seat__unit">{stat.unit}</span>
                  </span>
                ) : null}
                <span className="oh-sr-only">{p.connected === false ? "away" : "connected"}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
};

export default RoomOverview;
