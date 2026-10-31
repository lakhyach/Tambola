/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import TambolaTicket from "./TambolaTicket.jsx";

/**
 * All the tickets one seat owns, with comfortable navigation on a phone.
 *
 * Marking is not a local action: every ticket is marked from the same official
 * called history, so all owned tickets light up together. With one ticket this
 * renders exactly the single-ticket view it always did; with several it adds a
 * tab strip so a player can move between them without losing sight of any.
 */
const TicketRail = ({ tickets = [], calledNumbers = [], currentNumber = null, playerName }) => {
  const list = tickets.filter((t) => t && t.grid);
  const [active, setActive] = useState(0);

  // if the set of tickets changes size (a reset, or new tickets before start),
  // keep the index in range rather than pointing at a ticket that is gone
  useEffect(() => {
    setActive((i) => Math.min(i, Math.max(0, list.length - 1)));
  }, [list.length]);

  if (list.length === 0) {
    return (
      <TambolaTicket
        ticket={null}
        calledNumbers={calledNumbers}
        currentNumber={currentNumber}
        playerName={playerName}
      />
    );
  }

  if (list.length === 1) {
    return (
      <TambolaTicket
        ticket={list[0].grid}
        calledNumbers={calledNumbers}
        currentNumber={currentNumber}
        playerName={playerName}
      />
    );
  }

  const shown = list[Math.min(active, list.length - 1)];

  return (
    <div className="flex flex-col gap-3">
      <div
        className="flex gap-2"
        role="tablist"
        aria-label="Your tickets"
        style={{ overflowX: "auto", paddingBottom: 2 }}
      >
        {list.map((t, i) => {
          const selected = i === active;
          return (
            <button
              key={`tk-${t.no}`}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(i)}
              className="oh-num"
              style={{
                flex: "0 0 auto",
                padding: "6px 14px",
                borderRadius: 12,
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                color: selected ? "var(--oh-gold-bright)" : "var(--oh-text-muted)",
                background: selected ? "rgba(207,171,99,.14)" : "var(--oh-inset)",
                border: `1px solid ${selected ? "var(--oh-line-gold)" : "var(--oh-line)"}`,
              }}
            >
              Ticket {t.no}
            </button>
          );
        })}
      </div>

      <TambolaTicket
        ticket={shown.grid}
        calledNumbers={calledNumbers}
        currentNumber={currentNumber}
        playerName={playerName}
        ticketNo={shown.no}
        ticketTotal={list.length}
      />
    </div>
  );
};

export default TicketRail;
