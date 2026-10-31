import Panel from "./Panel.jsx";
import Button from "./Button.jsx";
import { PATTERN_META } from "../brand.js";

/**
 * The claim controls. One row per pattern the SERVER enabled for this room
 * (`snapshot.enabledPatterns`), so a player can never be offered a claim the
 * engine wouldn't accept. Claiming only asks the server; it never declares a
 * win locally — the awarded state below comes straight back from server awards.
 */
// eslint-disable-next-line react/prop-types
const WinningPatterns = ({ patterns = [], awards = [], note = null, canClaim = false, myPlayerId, onSubmit }) => {
  const awardedByPattern = new Map(awards.map((a) => [a.pattern, a]));

  return (
    <Panel className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="oh-eyebrow">Winning Patterns</h2>
        {note ? (
          <span className="oh-eyebrow" style={{ color: "var(--oh-text-faint)" }}>
            {note}
          </span>
        ) : null}
      </div>
      {canClaim ? (
        <p style={{ margin: "-4px 0 12px", fontSize: 12, color: "var(--oh-text-faint)" }}>
          A claim is checked against every ticket you hold, and the award names the
          ticket it came from.
        </p>
      ) : null}

      <ul className="flex flex-col gap-2" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {patterns
          .filter((id) => PATTERN_META[id])
          .map((id) => {
            const meta = PATTERN_META[id];
            const award = awardedByPattern.get(id);
            const wonByMe = award && award.playerId === myPlayerId;
            return (
              <li
                key={id}
                className="flex items-center justify-between gap-3 rounded-xl px-3 py-2"
                style={{
                  background: "var(--oh-inset)",
                  border: `1px solid ${award ? "var(--oh-line-gold)" : "var(--oh-line)"}`,
                }}
              >
                <div className="leading-tight">
                  <div style={{ fontWeight: 600, color: "var(--oh-ivory)" }}>{meta.label}</div>
                  <div className="oh-eyebrow" style={{ fontSize: 10, marginTop: 2 }}>
                    {meta.hint} · <span className="oh-num">+{meta.points}</span>
                  </div>
                </div>

                {award ? (
                  <span
                    className="oh-num text-right"
                    style={{
                      fontWeight: 700,
                      fontSize: 12,
                      color: wonByMe ? "var(--oh-gold-bright)" : "var(--oh-text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: ".08em",
                      maxWidth: 140,
                    }}
                  >
                    <span style={{ display: "block" }}>{wonByMe ? "You won" : award.name}</span>
                    {Number.isInteger(award.ticketNo) ? (
                      <span
                        style={{
                          display: "block",
                          marginTop: 2,
                          fontSize: 10,
                          letterSpacing: ".12em",
                          fontWeight: 600,
                          color: wonByMe ? "var(--oh-gold)" : "var(--oh-text-faint)",
                        }}
                      >
                        Ticket {award.ticketNo}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="oh-claim"
                    disabled={!canClaim}
                    onClick={() => onSubmit(id)}
                    aria-label={`Claim ${meta.label}`}
                  >
                    Claim
                  </Button>
                )}
              </li>
            );
          })}
      </ul>
    </Panel>
  );
};

export default WinningPatterns;
