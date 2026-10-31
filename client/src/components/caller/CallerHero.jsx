/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import Panel from "../Panel.jsx";
import Button from "../Button.jsx";
import CurrentNumberReveal from "../CurrentNumberReveal.jsx";
import { elapsedAt, formatClock, nextCallPreview } from "../../lib/caller.js";

/**
 * The console's focal point: the number the server has just called, what it
 * replaced, and the sealed slot where the next one will appear.
 *
 * The hero never predicts. Everything numeric here arrives in the snapshot:
 * `lastCall`, `calledNumbers[calledNumbers.length - 2]` and `remaining`. The
 * "next" slot is deliberately a count with a sealed face, because the server
 * draws the next number only when the call is committed — see
 * lib/caller.js:nextCallPreview.
 *
 * The elapsed clock is a local tick over the server's `elapsedMs` anchor. While
 * the round is paused or over the ticker stops, so the console never counts time
 * the server is not counting; a refresh re-anchors from the same snapshot.
 */
const CallerHero = ({
  state,
  gameNumber,
  lastCall,
  previous,
  calledCount,
  remaining,
  elapsedMs,
  receivedAt,
  voice,
  speaking,
  onRepeat,
  repeatEnabled,
}) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (state !== "RUNNING") return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state, receivedAt]);

  const clock = formatClock(elapsedAt({ state, elapsedMs, receivedAt, now }));
  const preview = nextCallPreview({ remaining, state });
  const waiting = state === "WAITING";

  return (
    <Panel className="p-4 oh-caller-hero">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="oh-eyebrow" style={{ color: "var(--oh-gold)", letterSpacing: ".2em" }}>
            Caller Console
          </div>
          <div className="oh-display" style={{ fontSize: 20, marginTop: 2 }}>
            {waiting ? "Ready to open the hall" : state === "COMPLETED" ? "Round complete" : "The call is live"}
          </div>
        </div>
        <span className="oh-statechip" data-tone={state.toLowerCase()}>
          {state}
        </span>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap mt-3">
        <CurrentNumberReveal number={lastCall} callIndex={calledCount} total={90} />
        <div className="oh-caller-aside">
          <div className="oh-eyebrow">Round</div>
          <div className="oh-num" style={{ fontSize: 15, color: "var(--oh-ivory)" }}>
            {gameNumber ? "#" + gameNumber : "—"}
          </div>
          <div className="oh-eyebrow" style={{ marginTop: 10 }}>
            Elapsed
          </div>
          <div className="oh-num oh-caller-clock" aria-label={`Elapsed ${clock}`}>
            {clock}
          </div>
        </div>
      </div>

      <div className="oh-caller-strip mt-3">
        <div className="oh-caller-cell">
          <div className="oh-eyebrow">Previous</div>
          <div className="oh-num oh-caller-cell__value" data-empty={String(previous == null)}>
            {previous == null ? "—" : previous}
          </div>
        </div>

        <div className="oh-caller-cell oh-caller-cell--sealed" aria-label={state === "COMPLETED" ? "The round is complete" : "Next number, not yet drawn"}>
          <div className="oh-eyebrow">Next</div>
          <div className="oh-num oh-caller-cell__value oh-sealed" aria-hidden="true">
            {state === "COMPLETED" ? "—" : "?"}
          </div>
        </div>

        <div className="oh-caller-cell">
          <div className="oh-eyebrow">Left in the bag</div>
          <div className="oh-num oh-caller-cell__value">{preview.remaining == null ? 90 : preview.remaining}</div>
        </div>

        <div className="oh-caller-cell">
          <div className="oh-eyebrow">Called</div>
          <div className="oh-num oh-caller-cell__value">
            {calledCount}
            <span style={{ fontSize: 12, color: "var(--oh-text-faint)" }}> / 90</span>
          </div>
        </div>
      </div>

      <div className="oh-caller-voice mt-3">
        <span className="oh-dot" data-tone={voice.tone} aria-hidden="true" />
        <div style={{ minWidth: 0, flex: "1 1 auto" }}>
          <div className="oh-eyebrow" style={{ color: "var(--oh-text-muted)" }}>
            {voice.label}
            {Number.isInteger(speaking) ? " · " + speaking : ""}
          </div>
          <p className="oh-caller-note">{voice.detail}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={!repeatEnabled}
          onClick={onRepeat}
          aria-keyshortcuts="r"
          title={
            repeatEnabled
              ? "Say the current number again on this device"
              : "Nothing to repeat yet, or the voice is off"
          }
        >
          Repeat number <span className="oh-kbd">R</span>
        </Button>
      </div>
    </Panel>
  );
};

export default CallerHero;
