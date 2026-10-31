/* eslint-disable react/prop-types */
import { useState } from "react";
import Panel from "./Panel.jsx";

/**
 * Choose how many tickets this seat wants before the round begins.
 *
 * The control only asks; the server decides. `max` is the room's per-seat
 * ceiling from the snapshot, so the + button never offers more than the room
 * allows, and a race where the host changes the rule is still caught server
 * side (TICKET_LIMIT) and surfaced back through onPick's returned result.
 */
const TicketPicker = ({ value = 1, max = 1, disabled = false, onPick }) => {
  const [busy, setBusy] = useState(false);
  const current = Math.max(1, Number(value) || 1);
  const ceiling = Math.max(1, Number(max) || 1);

  const pick = async (next) => {
    if (busy || disabled) return;
    const wanted = Math.min(ceiling, Math.max(1, next));
    if (wanted === current) return;
    setBusy(true);
    try {
      await onPick(wanted);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel className="p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="leading-tight">
          <div className="oh-display" style={{ fontSize: 15, letterSpacing: ".1em" }}>
            Your Tickets
          </div>
          <div className="oh-eyebrow" style={{ marginTop: 2, color: "var(--oh-text-faint)" }}>
            {disabled
              ? "Locked — the round has started"
              : `Pick 1–${ceiling}. Each is a fresh set of 15 numbers.`}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="oh-num"
            aria-label="Fewer tickets"
            disabled={disabled || busy || current <= 1}
            onClick={() => pick(current - 1)}
            style={{
              width: 40, height: 40, borderRadius: 12, fontSize: 20, fontWeight: 700, cursor: "pointer",
              color: "var(--oh-ivory)", background: "var(--oh-inset)", border: "1px solid var(--oh-line)",
              opacity: disabled || busy || current <= 1 ? 0.4 : 1,
            }}
          >
            −
          </button>
          <span
            className="oh-num"
            role="spinbutton"
            aria-valuenow={current}
            aria-valuemin={1}
            aria-valuemax={ceiling}
            style={{ minWidth: 64, textAlign: "center", fontSize: 22, fontWeight: 700, color: "var(--oh-gold-bright)" }}
          >
            {current}
          </span>
          <button
            type="button"
            className="oh-num"
            aria-label="More tickets"
            disabled={disabled || busy || current >= ceiling}
            onClick={() => pick(current + 1)}
            style={{
              width: 40, height: 40, borderRadius: 12, fontSize: 20, fontWeight: 700, cursor: "pointer",
              color: "var(--oh-ivory)", background: "var(--oh-inset)", border: "1px solid var(--oh-line)",
              opacity: disabled || busy || current >= ceiling ? 0.4 : 1,
            }}
          >
            +
          </button>
        </div>
      </div>
    </Panel>
  );
};

export default TicketPicker;
