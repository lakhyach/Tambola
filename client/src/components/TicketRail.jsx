/* eslint-disable react/prop-types */
import { useEffect, useMemo, useRef, useState } from "react";
import TambolaTicket from "./TambolaTicket.jsx";
import { activeTicketNo, readTicketMemory, ticketProgress, writeTicketMemory } from "../lib/ticketview.js";

/**
 * All the tickets one seat owns, with comfortable navigation on a phone.
 *
 * Marking is not a local action: every ticket is marked from the same official
 * called history, so all owned tickets light up together. With one ticket this
 * renders exactly the single-ticket view it always did; with several it adds a
 * real ARIA tablist (roving tabindex, arrow/Home/End keys, `aria-controls` and a
 * tabpanel) whose tabs carry each ticket's progress, so a player can see which
 * ticket is closest to a line without opening it.
 *
 * The active tab is remembered per room in sessionStorage. A refresh therefore
 * comes back to the ticket the player was reading, while the tickets themselves
 * still come only from the server.
 */
const TicketRail = ({ tickets = [], calledNumbers = [], currentNumber = null, playerName, roomId = "", state = "WAITING" }) => {
  const list = useMemo(() => (Array.isArray(tickets) ? tickets.filter((t) => t && t.grid) : []), [tickets]);
  const calledSet = useMemo(() => new Set(Array.isArray(calledNumbers) ? calledNumbers : []), [calledNumbers]);
  const storage = typeof window === "undefined" ? null : window.sessionStorage;

  const [activeNo, setActiveNo] = useState(() => {
    const remembered = readTicketMemory(storage, roomId);
    return activeTicketNo(list, remembered) ?? 1;
  });
  const tabs = useRef([]);

  // A reset, a re-numbering or a ticket count change must never leave the rail
  // pointing at a ticket this seat no longer owns.
  useEffect(() => {
    if (!list.length) return;
    const next = activeTicketNo(list, activeNo);
    if (next !== activeNo) setActiveNo(next);
  }, [list, activeNo]);

  useEffect(() => {
    if (list.length) writeTicketMemory(storage, roomId, activeNo);
  }, [storage, roomId, activeNo, list.length]);

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
        ticketNo={list[0].no}
      />
    );
  }

  const shown = list.find((t) => t.no === activeNo) || list[0];
  const scope = roomId || "room";
  const tabId = (no) => `ticket-tab-${scope}-${no}`;
  const panelId = (no) => `ticket-panel-${scope}-${no}`;

  const move = (index, key) => {
    const count = list.length;
    let target = index;
    if (key === "ArrowRight" || key === "ArrowDown") target = (index + 1) % count;
    else if (key === "ArrowLeft" || key === "ArrowUp") target = (index - 1 + count) % count;
    else if (key === "Home") target = 0;
    else if (key === "End") target = count - 1;
    else return;
    tabs.current[target]?.focus();
    setActiveNo(list[target].no);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="oh-eyebrow" style={{ color: "var(--oh-text-muted)" }}>
          Your tickets · {list.length}
        </span>
        <span className="oh-eyebrow" style={{ color: "var(--oh-text-faint)" }}>
          {state === "WAITING" ? "Change before start" : "Locked for this round"}
        </span>
      </div>

      <div className="oh-ticket-tabs" role="tablist" aria-label="Your tickets" aria-orientation="horizontal">
        {list.map((ticket, index) => {
          const selected = ticket.no === shown.no;
          const progress = ticketProgress(ticket.grid, calledSet);
          return (
            <button
              key={`tk-${ticket.no}`}
              ref={(el) => {
                tabs.current[index] = el;
              }}
              type="button"
              role="tab"
              id={tabId(ticket.no)}
              aria-selected={selected}
              aria-controls={panelId(ticket.no)}
              aria-label={`Ticket ${ticket.no}, ${progress.marked} of ${progress.total} numbers called`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveNo(ticket.no)}
              onKeyDown={(event) => move(index, event.key)}
              className="oh-ticket-tab oh-num"
              data-selected={String(selected)}
            >
              <span aria-hidden="true">Ticket {ticket.no}</span>
              <span className="oh-ticket-tab__count" aria-hidden="true">
                {progress.marked}/{progress.total}
              </span>
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={panelId(shown.no)}
        aria-labelledby={tabId(shown.no)}
        tabIndex={0}
        className="oh-ticket-tabpanel"
      >
        <TambolaTicket
          ticket={shown.grid}
          calledNumbers={calledNumbers}
          currentNumber={currentNumber}
          playerName={playerName}
          ticketNo={shown.no}
          ticketTotal={list.length}
        />
      </div>
    </div>
  );
};

export default TicketRail;
