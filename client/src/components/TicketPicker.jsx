/* eslint-disable react/prop-types */
import { useRef, useState } from "react";
import Panel from "./Panel.jsx";

/**
 * How many tickets this seat plays. The control only asks; the server decides.
 *
 * Everything here reads from the snapshot: `max` is the room's own ceiling, and
 * a pick that the server refuses (a host changing the rule mid-wait) comes back
 * through onPick and is shown under the controls rather than silently undone.
 *
 * Three details matter more than the look:
 *  - the count always reads as "3 of 4", never a bare "3", so the limit is
 *    visible before it is hit;
 *  - every count is a real radio, so a keyboard or screen-reader user picks a
 *    number directly instead of pressing + four times;
 *  - the live region says what changed, including "maximum reached", because a
 *    disabled + button on its own is not feedback.
 */
const TicketPicker = ({ value = 1, max = 1, disabled = false, onPick }) => {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const radios = useRef([]);

  const ceiling = Math.max(1, Math.floor(Number(max)) || 1);
  const current = Math.min(ceiling, Math.max(1, Math.floor(Number(value)) || 1));
  const atMax = current >= ceiling;

  const pick = async (next) => {
    if (disabled) {
      setNote("The round has started, so your tickets are locked.");
      return;
    }
    if (busy) return;
    const wanted = Math.min(ceiling, Math.max(1, next));
    if (wanted === current) {
      setNote(wanted >= ceiling ? `That is the room maximum: ${ceiling} tickets.` : "");
      return;
    }
    setBusy(true);
    setNote("");
    try {
      const result = await onPick?.(wanted);
      if (result && result.ok === false) {
        setNote(
          result.code === "TICKET_LIMIT"
            ? `This room allows at most ${result.max ?? ceiling} tickets.`
            : result.error || "The server did not accept that count."
        );
      } else {
        // The status line already recomputes from the new value ("2 of 4
        // selected"); leaving a confirmation note there would keep the live
        // region repeating a sentence the count itself states more precisely.
        setNote("");
      }
    } catch {
      setNote("The server did not answer — try again.");
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event, index) => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    let target = null;
    if (Object.prototype.hasOwnProperty.call(keys, event.key)) {
      target = (index + keys[event.key] + ceiling) % ceiling;
    } else if (event.key === "Home") {
      target = 0;
    } else if (event.key === "End") {
      target = ceiling - 1;
    }
    if (target === null) return;
    event.preventDefault();
    radios.current[target]?.focus();
    pick(target + 1);
  };

  const status = disabled
    ? "Locked — the round has started"
    : `${current} of ${ceiling} selected${atMax ? " · room maximum" : ""}`;

  return (
    <Panel className="p-4" data-ticket-picker="true">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="leading-tight">
          <h2 className="oh-display" style={{ fontSize: 15, letterSpacing: ".1em", margin: 0 }}>
            Your Tickets
          </h2>
          {/* One line by design: a second line here pushes the actual tickets
              below the fold of a 390px phone before the round has even begun. */}
          <p className="oh-eyebrow" style={{ marginTop: 4, color: "var(--oh-text-faint)" }}>
            {disabled ? "Locked for this round" : "15 numbers per ticket"}
          </p>
        </div>

        <div className="flex items-center gap-2" aria-hidden="true">
          <span className="oh-num" style={{ fontSize: 26, fontWeight: 700, color: "var(--oh-gold-bright)" }}>
            {current}
          </span>
          <span className="oh-num" style={{ fontSize: 14, color: "var(--oh-text-muted)" }}>
            / {ceiling}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="oh-step"
            aria-label="Fewer tickets"
            disabled={disabled || busy || current <= 1}
            onClick={() => pick(current - 1)}
          >
            −
          </button>
          <button
            type="button"
            className="oh-step"
            aria-label="More tickets"
            disabled={disabled || busy || atMax}
            onClick={() => pick(current + 1)}
          >
            +
          </button>
        </div>

        <div
          className="oh-ticket-choice"
          role="radiogroup"
          aria-label="Tickets to play"
          aria-describedby="ticket-picker-status"
        >
          {Array.from({ length: ceiling }, (_, i) => {
            const count = i + 1;
            const selected = count === current;
            return (
              <button
                key={count}
                ref={(el) => {
                  radios.current[i] = el;
                }}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={`${count} ${count === 1 ? "ticket" : "tickets"}`}
                tabIndex={selected ? 0 : -1}
                disabled={disabled || busy}
                onClick={() => pick(count)}
                onKeyDown={(event) => onKeyDown(event, i)}
                className="oh-ticket-choice__item oh-num"
                data-selected={String(selected)}
              >
                {count}
              </button>
            );
          })}
        </div>
      </div>

      <p
        id="ticket-picker-status"
        role="status"
        aria-live="polite"
        className="mt-3"
        style={{ fontSize: 12, margin: 0, color: atMax && !disabled ? "var(--oh-gold)" : "var(--oh-text-muted)" }}
      >
        {note || status}
      </p>
    </Panel>
  );
};

export default TicketPicker;
