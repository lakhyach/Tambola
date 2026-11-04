/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import Panel from "./Panel.jsx";
import { bookingCopy, formatBookingNumber } from "../i18n/booking-locale.js";

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
 *  - a bounded numeric input handles large room ceilings without rendering one
 *    DOM control for every possible count;
 *  - the live region says what changed, including "maximum reached", because a
 *    disabled + button on its own is not feedback.
 */
const TicketPicker = ({ value = 1, max = 1, disabled = false, lockedLabel, language = "en", onPick }) => {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState(String(value));

  const ceiling = Math.max(1, Math.floor(Number(max)) || 1);
  const current = Math.min(ceiling, Math.max(1, Math.floor(Number(value)) || 1));
  const atMax = current >= ceiling;
  const t = (key, variables) => bookingCopy(language, key, variables);
  const number = (n) => formatBookingNumber(n, language);

  useEffect(() => setDraft(String(current)), [current]);

  const pick = async (next) => {
    if (disabled) {
      setNote(lockedLabel || t("lockedRound"));
      return;
    }
    if (busy) return;
    const numeric = Number(next);
    if (!Number.isSafeInteger(numeric) || numeric < 1 || numeric > ceiling) {
      setNote(`Choose a whole number from 1 to ${number(ceiling)}.`);
      return;
    }
    const wanted = numeric;
    if (wanted === current) {
      setNote(wanted >= ceiling ? t("ticketCountMax", { count: number(ceiling) }) : "");
      return;
    }
    setBusy(true);
    setNote("");
    try {
      const result = await onPick?.(wanted);
      if (result && result.ok === false) {
        setNote(
          result.code === "TICKET_LIMIT"
            ? t("ticketLimit", { count: number(result.max ?? ceiling) })
            : (language === "hi" ? t("ticketPickFailed") : result.error || t("ticketPickFailed"))
        );
      } else {
        // The status line already recomputes from the new value ("2 of 4
        // selected"); leaving a confirmation note there would keep the live
        // region repeating a sentence the count itself states more precisely.
        setNote("");
      }
    } catch {
      setNote(language === "hi" ? t("ticketPickFailed") : "The server did not answer — try again.");
    } finally {
      setBusy(false);
    }
  };

  const status = disabled
    ? lockedLabel || t("lockedRound")
    : t(atMax ? "ticketsSelectedMax" : "ticketsSelected", { count: number(current), max: number(ceiling) });

  return (
    <Panel className="p-4" data-ticket-picker="true">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="leading-tight">
          <h2 className="oh-display" style={{ fontSize: 15, letterSpacing: ".1em", margin: 0 }}>
            {t("yourTickets")}
          </h2>
          {/* One line by design: a second line here pushes the actual tickets
              below the fold of a 390px phone before the round has even begun. */}
          <p className="oh-eyebrow" style={{ marginTop: 4, color: "var(--oh-text-faint)" }}>
            {disabled ? t("lockedForRound") : t("numbersPerTicket")}
          </p>
        </div>

        <div className="flex items-center gap-2" aria-hidden="true">
          <span className="oh-num" style={{ fontSize: 26, fontWeight: 700, color: "var(--oh-gold-bright)" }}>
            {number(current)}
          </span>
          <span className="oh-num" style={{ fontSize: 14, color: "var(--oh-text-muted)" }}>
            / {number(ceiling)}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="oh-step"
            aria-label={t("fewerTickets")}
            disabled={disabled || busy || current <= 1}
            onClick={() => pick(current - 1)}
          >
            −
          </button>
          <button
            type="button"
            className="oh-step"
            aria-label={t("moreTickets")}
            disabled={disabled || busy || atMax}
            onClick={() => pick(current + 1)}
          >
            +
          </button>
        </div>

        <label className="oh-ticket-count-input">
          <span className="sr-only">{t("ticketsToPlay")}</span>
          <input
            type="number"
            inputMode="numeric"
            min="1"
            max={ceiling}
            step="1"
            value={draft}
            disabled={disabled || busy}
            aria-describedby="ticket-picker-status"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") pick(Number(draft)); }}
          />
          <button type="button" className="oh-btn oh-btn--gold" disabled={disabled || busy || !draft} onClick={() => pick(Number(draft))}>
            {busy ? "Saving…" : "Apply"}
          </button>
        </label>
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
