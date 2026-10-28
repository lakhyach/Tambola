import { useMemo } from "react";
import Panel from "./Panel.jsx";

/**
 * The last few official calls, newest first, each tagged with its position in
 * the sequence so a player can scan momentum at a glance.
 */
// eslint-disable-next-line react/prop-types
const CallHistory = ({ calledNumbers = [] }) => {
  const recent = useMemo(() => {
    const total = calledNumbers.length;
    return calledNumbers
      .slice(-8)
      .reverse()
      .map((n, i) => ({ n, ordinal: total - i }));
  }, [calledNumbers]);

  return (
    <Panel className="p-4">
      <h2 className="oh-eyebrow mb-3">Recent Calls</h2>
      {recent.length === 0 ? (
        <p style={{ color: "var(--oh-text-faint)", fontSize: 13 }}>Nothing called yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {recent.map(({ n, ordinal }) => (
            <div
              key={`${ordinal}-${n}`}
              className="oh-num flex flex-col items-center"
              style={{
                minWidth: 44,
                padding: "6px 8px",
                borderRadius: 12,
                background: "var(--oh-inset)",
                border: "1px solid var(--oh-line)",
              }}
            >
              <span style={{ fontSize: 18, fontWeight: 700, color: "var(--oh-gold-bright)" }}>{n}</span>
              <span className="oh-eyebrow" style={{ fontSize: 9 }}>{ordinal}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
};

export default CallHistory;
