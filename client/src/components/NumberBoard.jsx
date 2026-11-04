import { useMemo } from "react";
import NumberTile from "./NumberTile.jsx";
import Panel from "./Panel.jsx";
import { bookingCopy, formatBookingNumber } from "../i18n/booking-locale.js";

const ALL = Array.from({ length: 90 }, (_, i) => i + 1);

/**
 * The complete 1–90 board. Read-only: it mirrors the server's called history
 * and never accepts a tap that could change the game.
 */
// eslint-disable-next-line react/prop-types
const NumberBoard = ({ calledNumbers = [], currentNumber = null, language = "en" }) => {
  const calledSet = useMemo(() => new Set(calledNumbers), [calledNumbers]);
  const recentNumber = calledNumbers.length > 1 ? calledNumbers[calledNumbers.length - 2] : null;
  const t = (key, variables) => bookingCopy(language, key, variables);

  return (
    <Panel className="p-4 festival-number-board">
      <div className="flex items-center justify-between mb-3">
        <h2 className="oh-eyebrow">{t("masterBoard")}</h2>
        <span className="oh-num" style={{ color: "var(--oh-text-muted)", fontSize: 12 }}>
          {t("numbersCalled", { count: formatBookingNumber(calledSet.size, language) })}
        </span>
      </div>
      <div
        className="grid gap-1.5 festival-number-grid"
        style={{ gridTemplateColumns: "repeat(10, minmax(0, 1fr))" }}
        role="list"
        aria-label={t("calledNumbersBoard")}
      >
        {ALL.map((n) => (
          <NumberTile
            key={n}
            n={n}
            called={calledSet.has(n)}
            current={n === currentNumber}
            recent={n === recentNumber}
            language={language}
          />
        ))}
      </div>
    </Panel>
  );
};

export default NumberBoard;
