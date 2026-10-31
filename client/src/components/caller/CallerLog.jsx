/* eslint-disable react/prop-types */
import { useMemo } from "react";
import Panel from "../Panel.jsx";
import { callRows } from "../../lib/caller.js";

/**
 * The complete call sheet for the round: every official call, newest first,
 * tagged with its position in the sequence. It is built from the server's own
 * `calledNumbers` history — no local tally, no gap-filling — so the log and the
 * board can never disagree.
 *
 * Newest first is the order a caller reads it in (the last call is at the top),
 * while the ordinal keeps the round's direction legible.
 */
const CallerLog = ({ calledNumbers = [] }) => {
  const rows = useMemo(() => callRows(calledNumbers), [calledNumbers]);

  return (
    <Panel className="p-4 oh-caller-log">
      <div className="flex items-center justify-between mb-3">
        <h2 className="oh-eyebrow">Call Log</h2>
        <span className="oh-num" style={{ color: "var(--oh-text-muted)", fontSize: 12 }}>
          {rows.length} called
        </span>
      </div>

      {rows.length === 0 ? (
        <p style={{ color: "var(--oh-text-faint)", fontSize: 13, margin: 0 }}>
          Nothing called yet. The first number appears here the moment the server draws it.
        </p>
      ) : (
        <ol className="oh-log" aria-label="Called numbers, newest first">
          {rows.map((row, i) => (
            <li key={row.ordinal} className="oh-log__row" data-current={String(i === 0)}>
              <span className="oh-log__ordinal oh-num">{row.ordinal}</span>
              <span className="oh-log__number oh-num">{row.number}</span>
              {i === 0 ? <span className="oh-eyebrow oh-log__tag">now</span> : null}
              {i === 1 ? <span className="oh-eyebrow oh-log__tag">prev</span> : null}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
};

export default CallerLog;
