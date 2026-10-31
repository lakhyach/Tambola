/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import Panel from "../Panel.jsx";
import Button from "../Button.jsx";
import { CONFIRM_COPY, disarm, press } from "../../lib/confirmAction.js";
import { INTERVAL_PRESETS, intervalLabel, nextCallHint } from "../../lib/caller.js";

/**
 * The console's control surface. Every button is an INTENT sent over the
 * documented contract — no number, no state, no sequence ever leaves here. The
 * server re-checks authority and state regardless, so this panel is convenience,
 * not the security boundary.
 *
 * Two rules keep a live show from going wrong:
 *   • the primary control is whatever the CURRENT server state permits, so the
 *     host cannot press "Call" on a paused or finished round and wait for a
 *     refusal;
 *   • the destructive pair (End, Reset) needs a second click, with the same
 *     copy and the same 8-second arming as before (lib/confirmAction.js).
 *
 * The calling interval is a room setting sent on `game:set-autocall`. While a
 * round is running the server re-arms the next call from NOW at the new
 * interval — it never re-times a call that is already in flight, and it never
 * calls twice. The note under the chips says which of those applies.
 */
const CallerControls = ({
  state,
  autoCall,
  callIntervalMs,
  actions,
  busy = false,
  pendingCall = false,
  onAction,
  onSetInterval,
}) => {
  const [armed, setArmed] = useState(null);

  // An armed confirmation belongs to the round it was made in.
  useEffect(() => setArmed(disarm()), [state]);
  useEffect(() => {
    if (!armed) return undefined;
    const expiry = setTimeout(() => setArmed(disarm()), 8000);
    return () => clearTimeout(expiry);
  }, [armed]);

  const click = (action) => {
    const next = press(armed, action);
    setArmed(next.armed);
    if (next.fire) onAction(action);
  };

  const waiting = state === "WAITING";
  const running = state === "RUNNING";
  const paused = state === "PAUSED";
  const finished = state === "COMPLETED";

  const primary = waiting
    ? { action: "game:start", label: busy ? "Opening…" : "Start the round", enabled: actions.start.enabled, reason: actions.start.reason, hint: nextCallHint({ state }) }
    : finished
      ? { action: null, label: "Round complete", enabled: false, reason: "reset the room to play again", hint: nextCallHint({ state }) }
      : {
          action: paused ? "game:resume" : "game:call-next",
          label: paused ? "Resume the round" : pendingCall || busy ? "Calling…" : "Call next number",
          enabled: paused ? actions.resume.enabled : actions.call.enabled,
          reason: paused ? actions.resume.reason : actions.call.reason,
          hint: nextCallHint({ state, autoCall, callIntervalMs }),
        };

  const intervalNote = waiting
    ? "Used from the first call of the round."
    : paused
      ? "Applies when you resume."
      : running
        ? "Applies to the next scheduled call — a call already due is never re-timed."
        : "The round is over.";

  const armedCopy = armed ? CONFIRM_COPY[armed] : null;

  return (
    <Panel className="p-4 oh-caller-controls">
      <div className="flex items-center justify-between mb-3">
        <h2 className="oh-eyebrow">Draw Controls</h2>
        <span className="oh-eyebrow" style={{ color: !finished && autoCall ? "var(--oh-ok)" : "var(--oh-text-faint)" }}>
          {finished ? "round closed" : "auto-call " + (autoCall ? "on · " + intervalLabel(callIntervalMs) : "off")}
        </span>
      </div>

      <button
        type="button"
        className={"oh-callbtn" + (primary.action === "game:call-next" ? " oh-callbtn--call" : "")}
        data-enabled={String(Boolean(primary.enabled))}
        disabled={!primary.enabled}
        onClick={() => primary.action && onAction(primary.action)}
        aria-keyshortcuts={primary.action === "game:call-next" ? "c" : undefined}
      >
        <span className="oh-callbtn__label">
          {primary.label}
          {primary.action === "game:call-next" ? <span className="oh-kbd oh-kbd--dark">C</span> : null}
        </span>
        <span className="oh-callbtn__hint">{primary.reason || primary.hint}</span>
      </button>

      <div className="oh-caller-transport mt-3">
        {paused ? (
          <Button variant="ghost" size="sm" disabled={!actions.resume.enabled} onClick={() => onAction("game:resume")}>
            Resume
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            disabled={!actions.pause.enabled}
            onClick={() => onAction("game:pause")}
            aria-keyshortcuts="p"
            title={actions.pause.reason || "Stop the clock without ending the round"}
          >
            Pause {actions.pause.enabled ? <span className="oh-kbd">P</span> : null}
          </Button>
        )}

        <Button
          variant="ghost"
          size="sm"
          disabled={!actions.autocall.enabled}
          onClick={() => onAction("game:set-autocall", { enabled: !autoCall })}
          aria-pressed={autoCall}
          title={actions.autocall.reason || (autoCall ? "Stop the automatic calls" : "Let the server call on the interval")}
        >
          {autoCall ? "Auto: On" : "Auto: Off"}
        </Button>

        <Button
          variant="danger"
          size="sm"
          disabled={!actions.end.enabled}
          aria-pressed={armed === "game:end"}
          onClick={() => click("game:end")}
          title={actions.end.reason || "End this round for everybody"}
        >
          {armed === "game:end" ? CONFIRM_COPY["game:end"].armed : "End round"}
        </Button>

        {finished ? (
          <Button
            variant="danger"
            size="sm"
            disabled={!actions.reset.enabled}
            aria-pressed={armed === "game:reset"}
            onClick={() => click("game:reset")}
          >
            {armed === "game:reset" ? CONFIRM_COPY["game:reset"].armed : "Reset room"}
          </Button>
        ) : null}
      </div>

      {armedCopy ? (
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <p role="alert" style={{ color: "var(--oh-warn)", fontSize: 12, margin: 0, maxWidth: "52ch" }}>
            {armedCopy.confirm}
          </p>
          <Button variant="ghost" size="sm" onClick={() => setArmed(disarm())}>
            Cancel
          </Button>
        </div>
      ) : null}

      <div className="oh-rule" style={{ margin: "16px 0 12px" }} />

      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <h3 className="oh-eyebrow" style={{ margin: 0 }}>
          Calling every
        </h3>
        <span className="oh-num" style={{ fontSize: 12, color: "var(--oh-text-muted)" }}>
          {intervalLabel(callIntervalMs)}
        </span>
      </div>
      <div role="group" aria-label="Call interval" className="oh-seg">
        {INTERVAL_PRESETS.map((ms) => (
          <button
            key={ms}
            type="button"
            className="oh-seg__item"
            data-active={String(ms === callIntervalMs)}
            disabled={!actions.interval.enabled || ms === callIntervalMs}
            onClick={() => onSetInterval(ms)}
            title={actions.interval.reason || "Call a number every " + intervalLabel(ms)}
          >
            {intervalLabel(ms)}
          </button>
        ))}
      </div>
      <p className="oh-caller-note" style={{ marginTop: 8 }}>
        {actions.interval.enabled ? intervalNote : actions.interval.reason}
      </p>
    </Panel>
  );
};

export default CallerControls;
