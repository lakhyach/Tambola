/* eslint-disable react/prop-types */
import { useMemo } from "react";
import TicketCell from "./TicketCell.jsx";
import Panel from "./Panel.jsx";
import { APP_NAME } from "../brand.js";
import { ticketProgress } from "../lib/ticketview.js";

/**
 * The player's actual 3×9, 15-number ticket — exactly as the server issued it.
 *
 * Marking is derived from the official called history (see lib/ticketview.js):
 * a cell is called because the server said so, never because it was tapped.
 * There is deliberately no tap-to-mark, so no local gesture can disagree with
 * the draw or be mistaken for a winning claim.
 *
 * The header carries the two numbers a player actually needs while the board
 * is running: how many of the fifteen are marked, and how many are still to
 * come. The three row chips add the same read-out per line, which is what a
 * line claim depends on. The grid is a real ARIA grid (rows + gridcells), so a
 * screen reader can move cell by cell and hear the row and column.
 */
const TambolaTicket = ({ ticket, calledNumbers = [], currentNumber = null, playerName, ticketNo = null, ticketTotal = null }) => {
  const calledSet = useMemo(() => new Set(calledNumbers), [calledNumbers]);
  const rows = useMemo(() => (ticket && ticket.length === 3 ? ticket : [[], [], []]), [ticket]);
  const progress = useMemo(() => ticketProgress(ticket, calledSet), [ticket, calledSet]);

  const gridLabel =
    ticketNo != null
      ? `Ticket ${ticketNo}${ticketTotal ? " of " + ticketTotal : ""}: ${progress.marked} of ${progress.total} numbers called`
      : `Your ${APP_NAME} ticket: ${progress.marked} of ${progress.total} numbers called`;

  return (
    <Panel className="p-4" data-ticket-no={ticketNo ?? 1}>
      <div
        className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 mb-3"
        style={{
          background: "linear-gradient(180deg, rgba(207,171,99,.16), rgba(207,171,99,.04))",
          border: "1px solid var(--oh-line-gold)",
        }}
      >
        <div className="leading-tight" style={{ minWidth: 0 }}>
          <div className="oh-display" style={{ fontSize: 15, letterSpacing: ".14em" }}>
            {APP_NAME.toUpperCase()}
          </div>
          <div className="oh-eyebrow" style={{ marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {playerName ? `${playerName}'s ticket` : "Your ticket"}
            {ticketNo != null ? ` · No. ${ticketNo}${ticketTotal ? ` of ${ticketTotal}` : ""}` : ""}
          </div>
        </div>
        <div className="oh-num text-right" style={{ flex: "0 0 auto" }}>
          <div style={{ color: "var(--oh-gold-bright)", fontWeight: 700, fontSize: 20, lineHeight: 1.05 }}>
            {progress.marked}
            <span style={{ color: "var(--oh-text-faint)", fontSize: 13, fontWeight: 600 }}>/{progress.total}</span>
          </div>
          <div className="oh-eyebrow" style={{ color: progress.complete ? "var(--oh-gold)" : "var(--oh-text-faint)", marginTop: 2 }}>
            {progress.complete ? "complete" : `${progress.toGo} to go`}
          </div>
        </div>
      </div>

      <div className="oh-ticket-rowstats" role="group" aria-label="Row progress">
        {progress.rows.map((row) => (
          <span key={row.index} className="oh-ticket-rowstat" data-complete={String(row.complete)}>
            <span aria-hidden="true" className="oh-ticket-rowstat__label">R{row.index + 1}</span>
            <span aria-hidden="true" className="oh-num">
              {row.marked}/{row.filled}
            </span>
            <span className="oh-sr-only">{`Row ${row.index + 1}: ${row.marked} of ${row.filled} called`}</span>
          </span>
        ))}
      </div>

      <div className="oh-ticket-grid" role="grid" aria-label={gridLabel} aria-rowcount={3} aria-colcount={9}>
        {rows.map((row, r) => (
          <div key={`r-${r}`} role="row" aria-rowindex={r + 1} className="oh-ticket-row">
            {Array.from({ length: 9 }, (_, c) => {
              const n = row[c] ?? null;
              return (
                <TicketCell
                  key={`c-${r}-${c}`}
                  n={n}
                  row={r}
                  col={c}
                  called={n != null && calledSet.has(n)}
                  current={n != null && n === currentNumber}
                />
              );
            })}
          </div>
        ))}
      </div>
    </Panel>
  );
};

export default TambolaTicket;
