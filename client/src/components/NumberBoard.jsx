import { useMemo } from "react";
import NumberTile from "./NumberTile.jsx";
import Panel from "./Panel.jsx";

const ALL = Array.from({ length: 90 }, (_, i) => i + 1);

/**
 * The complete 1–90 board. Read-only: it mirrors the server's called history
 * and never accepts a tap that could change the game.
 */
// eslint-disable-next-line react/prop-types
const NumberBoard = ({ calledNumbers = [], currentNumber = null }) => {
  const calledSet = useMemo(() => new Set(calledNumbers), [calledNumbers]);

  return (
    <Panel className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="oh-eyebrow">Master Board · 1 – 90</h2>
        <span className="oh-num" style={{ color: "var(--oh-text-muted)", fontSize: 12 }}>
          {calledSet.size} called
        </span>
      </div>
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: "repeat(10, minmax(0, 1fr))" }}
        role="grid"
        aria-label="Called numbers board"
      >
        {ALL.map((n) => (
          <NumberTile
            key={n}
            n={n}
            called={calledSet.has(n)}
            current={n === currentNumber}
          />
        ))}
      </div>
    </Panel>
  );
};

export default NumberBoard;
