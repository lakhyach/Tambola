/* eslint-disable react/prop-types */
import { useMemo } from "react";
import TicketCell from "./TicketCell.jsx";
import Panel from "./Panel.jsx";
import { APP_NAME } from "../brand.js";

/**
 * The player's actual 3×9, 15-number ticket — exactly as the server issued it.
 * Marking is derived from the official called history; a tap here never changes
 * the score, it only shows which of the fifteen have been called.
 */
const TambolaTicket = ({ ticket, calledNumbers = [], currentNumber = null, playerName, ticketNo = null, ticketTotal = null }) => {
  const calledSet = useMemo(() => new Set(calledNumbers), [calledNumbers]);
  const rows = useMemo(
    () => (ticket && ticket.length === 3 ? ticket : [[], [], []]),
    [ticket]
  );

  const marked = useMemo(() => {
    let count = 0;
    for (const row of rows) for (const n of row) if (n != null && calledSet.has(n)) count += 1;
    return count;
  }, [rows, calledSet]);

  return (
    <Panel className="p-4">
      <div
        className="flex items-center justify-between rounded-xl px-3 py-2 mb-3"
        style={{
          background: "linear-gradient(180deg, rgba(207,171,99,.16), rgba(207,171,99,.04))",
          border: "1px solid var(--oh-line-gold)",
        }}
      >
        <div className="leading-tight">
          <div className="oh-display" style={{ fontSize: 15, letterSpacing: ".14em" }}>
            {APP_NAME.toUpperCase()}
          </div>
          <div className="oh-eyebrow" style={{ marginTop: 2 }}>
            {playerName ? `${playerName}'s ticket` : "Your ticket"}
            {ticketNo != null
              ? ` · No. ${ticketNo}${ticketTotal ? ` of ${ticketTotal}` : ""}`
              : ""}
          </div>
        </div>
        <div className="oh-num text-right" style={{ color: "var(--oh-gold-bright)", fontWeight: 700 }}>
          <div style={{ fontSize: 20 }}>{marked}/15</div>
          <div className="oh-eyebrow" style={{ color: "var(--oh-text-faint)" }}>
            marked
          </div>
        </div>
      </div>

      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: "repeat(9, minmax(0, 1fr))" }}
        role="table"
        aria-label={
          ticketNo != null
            ? `Ticket ${ticketNo}${ticketTotal ? " of " + ticketTotal : ""}`
            : `Your ${APP_NAME} ticket`
        }
      >
        {rows.flatMap((row, r) =>
          Array.from({ length: 9 }, (_, c) => {
            const n = row[c] ?? null;
            return (
              <TicketCell
                key={`c-${r}-${c}`}
                n={n}
                called={n != null && calledSet.has(n)}
                current={n != null && n === currentNumber}
              />
            );
          })
        )}
      </div>
    </Panel>
  );
};

export default TambolaTicket;
