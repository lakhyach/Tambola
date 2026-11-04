/* eslint-disable react/prop-types */
import { useMemo } from "react";
import Panel from "../Panel.jsx";
import { callRows } from "../../lib/caller.js";
import { bookingCopy, formatBookingNumber } from "../../i18n/booking-locale.js";

/**
 * The complete call sheet for the round: every official call, newest first,
 * tagged with its position in the sequence. It is built from the server's own
 * `calledNumbers` history — no local tally, no gap-filling — so the log and the
 * board can never disagree.
 *
 * Newest first is the order a caller reads it in (the last call is at the top),
 * while the ordinal keeps the round's direction legible.
 */
const CallerLog = ({ calledNumbers = [], language = "en" }) => {
  const rows = useMemo(() => callRows(calledNumbers), [calledNumbers]);
  const t = (key, variables) => bookingCopy(language, key, variables);

  return (
    <Panel className="p-4 oh-caller-log festival-caller-card">
      <div className="flex items-center justify-between mb-3">
        <h2 className="caller-history-heading">{language === "hi" ? "बुलाए गए नंबर" : "Called Numbers"} <span>({formatBookingNumber(rows.length, language)})</span></h2>
        <span className="oh-num" style={{ color: "var(--oh-text-muted)", fontSize: 12 }}>
          {t("calledCountShort", { count: formatBookingNumber(rows.length, language) })}
        </span>
      </div>

      {rows.length === 0 ? (
        <p style={{ color: "var(--oh-text-faint)", fontSize: 13, margin: 0 }}>
          {t("nothingCalledYet")}
        </p>
      ) : (
        <ol className="oh-log caller-history-strip" aria-label={t("calledNumbersNewestFirst")} tabIndex="0">
          {rows.map((row, i) => (
            <li key={row.ordinal} className="oh-log__row" data-current={String(i === 0)}>
              <span className="oh-log__ordinal oh-num oh-sr-only">{formatBookingNumber(row.ordinal, language)}</span>
              <span className="oh-log__number oh-num">{formatBookingNumber(row.number, language)}</span>
              {i === 0 ? <span className="oh-log__tag oh-sr-only">{t("now")}</span> : null}
              {i === 1 ? <span className="oh-log__tag oh-sr-only">{t("prev")}</span> : null}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
};

export default CallerLog;
