/* eslint-disable react/prop-types */
import Panel from "./Panel.jsx";
import Button from "./Button.jsx";
import PatternDiagram from "./PatternDiagram.jsx";

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
function ordinalWord(n) {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return n ? `${n}th` : "";
}

// Human ticket attribution: one ticket, or the several a seat-level prize names.
function ticketLabel(award) {
  if (Array.isArray(award.ticketNos) && award.ticketNos.length) {
    return `Tickets ${award.ticketNos.join(", ")}`;
  }
  return Number.isInteger(award.ticketNo) ? `Ticket ${award.ticketNo}` : "";
}

const WinningPatterns = ({
  patterns = [],
  awards = [],
  example = null,
  claimStates = [],
  note = null,
  canClaim = false,
  myPlayerId,
  onSubmit,
}) => {
  const stateByPattern = new Map(claimStates.map((s) => [s.pattern, s]));
  const labelById = new Map(patterns.map((p) => [p.id, p.label]));
  const awardsByPattern = new Map();
  for (const a of awards) {
    if (!awardsByPattern.has(a.pattern)) awardsByPattern.set(a.pattern, []);
    awardsByPattern.get(a.pattern).push(a);
  }

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
                  <span className="oh-pattern-name">{view.label}</span>
                  <span className="oh-num oh-pattern-points">+{view.points}</span>
                </div>
                <p className="oh-pattern-hint">{view.hint}</p>

                {view.cells ? (
                  <PatternDiagram
                    cells={view.cells}
                    example={example}
                    note={view.diagramNote}
                    label={view.label}
                  />
                ) : view.kind === "count" ? (
                  <div className="oh-pattern-count">Any {view.need} of the ticket&rsquo;s 15 numbers</div>
                ) : null}

                {view.requires ? (
                  <div className="oh-pattern-requires">
                    awarded only after the {labelById.get(view.requires.pattern) || view.requires.pattern} is settled
                  </div>
                ) : null}

                {/* eligibility / claim state, in the server's own words */}
                {!awarded ? (
                  eligible ? (
                    <div className="oh-pattern-elig oh-pattern-elig--ready">
                      You&rsquo;ve completed this — claim it
                    </div>
                  ) : state && state.reason ? (
                    <div className="oh-pattern-elig">{state.reason}</div>
                  ) : null
                ) : null}
              </div>

              <div className="oh-pattern-side">
                {awarded ? (
                  <ul className="oh-pattern-awards" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {winners.map((w, i) => (
                      <li key={`${w.pattern}-${i}`} className="oh-pattern-award">
                        <span className="oh-pattern-award__who">
                          {w.playerId === myPlayerId ? "You won" : w.name}
                        </span>
                        <span className="oh-pattern-award__meta">
                          {Number.isInteger(w.winnerOrdinal) && winners.length > 1
                            ? `${ordinalWord(w.winnerOrdinal)} · `
                            : ""}
                          {ticketLabel(w)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Button
                    variant={claimLive ? "gold" : "ghost"}
                    size="sm"
                    className="oh-claim"
                    disabled={!claimLive}
                    onClick={() => onSubmit(view.id)}
                    aria-label={`Claim ${view.label}`}
                  >
                    Claim
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
