import { useMemo } from "react";
import Panel from "./Panel.jsx";
import { bookingCopy, formatBookingNumber } from "../i18n/booking-locale.js";

/**
 * The last few official calls, newest first, each tagged with its position in
 * the sequence so a player can scan momentum at a glance.
 */
// eslint-disable-next-line react/prop-types
const CallHistory = ({ calledNumbers = [], language = "en" }) => {
  const recent = useMemo(() => {
    const total = calledNumbers.length;
    return calledNumbers
      .slice(-8)
      .reverse()
      .map((n, i) => ({ n, ordinal: total - i }));
  }, [calledNumbers]);

  return (
    <Panel className="p-4 festival-call-history">
      <h2 className="oh-eyebrow mb-3">{bookingCopy(language, "recentCalls")}</h2>
      {recent.length === 0 ? (
        <p style={{ color: "var(--oh-text-faint)", fontSize: 13 }}>{bookingCopy(language, "nothingCalled")}</p>
      ) : (
        <ol className="oh-call-history" aria-label={bookingCopy(language, "recentCalls")}>
          {recent.map(({ n, ordinal }) => (
            <li
              key={`${ordinal}-${n}`}
              className="oh-call-ball"
              data-latest={String(ordinal === calledNumbers.length)}
              aria-label={`${bookingCopy(language, "callOrdinal", { count: formatBookingNumber(ordinal, language), total: formatBookingNumber(calledNumbers.length, language) })}: ${formatBookingNumber(n, language)}`}
            >
              <span className="oh-call-ball__number">{formatBookingNumber(n, language)}</span>
              <span className="oh-call-ball__ordinal">{formatBookingNumber(ordinal, language)}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
};

export default CallHistory;
