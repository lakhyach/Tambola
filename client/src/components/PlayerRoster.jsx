import Panel from "./Panel.jsx";

/**
 * The authoritative roster: names, points and live connection state exactly as
 * the server reports them (playersList + leaderboard). Shows who is the host
 * and highlights the viewer.
 */
// eslint-disable-next-line react/prop-types
const PlayerRoster = ({ players = [], leaderboard = [], myPlayerId }) => {
  const pointsById = new Map(leaderboard.map((p) => [p.playerId, p.points]));

  return (
    <Panel className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="oh-eyebrow">In the Hall</h2>
        <span className="oh-num" style={{ color: "var(--oh-text-muted)", fontSize: 12 }}>
          {players.length} playing
        </span>
      </div>

      {players.length === 0 ? (
        <p style={{ color: "var(--oh-text-faint)", fontSize: 13 }}>Waiting for players…</p>
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
                  title={p.connected ? "connected" : "away"}
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
                  {p.id === myPlayerId ? " (you)" : ""}
                </span>
                {p.isHost ? (
                  <span
                    className="oh-eyebrow"
                    style={{ color: "var(--oh-gold)", fontSize: 9, marginLeft: 4 }}
                  >
                    host
                  </span>
                ) : null}
              </span>
              <span className="oh-num" style={{ fontWeight: 700 }}>
                {pointsById.get(p.id) ?? p.points ?? 0}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
};

export default PlayerRoster;
