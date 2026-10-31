import { useEffect, useState } from "react";
import Panel from "./Panel.jsx";
import Button from "./Button.jsx";
import { CONFIRM_COPY, disarm, press } from "../lib/confirmAction.js";

/**
 * Host-only draw controls. Every action is an INTENT sent over the documented
 * contract (never a number); the server re-checks authority regardless, so this
 * panel is convenience, not the security boundary. Manual "call" is disabled
 * while the auto-caller is running to avoid a double-call race.
 *
 * The two destructive actions ask for a second click instead of a native
 * `window.confirm()` dialog: the button re-labels to "Confirm: …", the room says
 * what will be lost, and the arm expires on its own or the moment the server
 * reports a different state (a round that already ended is not worth ending).
 * See lib/confirmAction.js for the rule.
 *
 * The primary button is whatever the current server state actually permits:
 * "Start game" before a round — including the WAITING room a reset returns to,
 * which is where a host would otherwise be stuck with no way to begin again —
 * and "Call next" once numbers are being drawn.
 */
// eslint-disable-next-line react/prop-types
const HostControls = ({ state, autoCall, busy = false, onAction }) => {
  const waiting = state === "WAITING";
  const running = state === "RUNNING";
  const paused = state === "PAUSED";
  const finished = state === "COMPLETED";
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

  const armedCopy = armed ? CONFIRM_COPY[armed] : null;

  return (
    <Panel className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="oh-eyebrow">Host Controls</h2>
        <span
          className="oh-eyebrow"
          style={{ color: autoCall ? "var(--oh-ok)" : "var(--oh-text-faint)" }}
        >
          auto-call {autoCall ? "on" : "off"}
        </span>
      </div>

      <div className="flex flex-wrap gap-2" style={{ opacity: busy ? 0.6 : 1 }}>
        {waiting ? (
          <Button variant="gold" disabled={busy} onClick={() => onAction("game:start")} title="Begin the round">
            Start game
          </Button>
        ) : (
          <Button
            variant="gold"
            disabled={busy || !running || autoCall}
            onClick={() => onAction("game:call-next")}
            title={autoCall ? "The auto-caller is running" : "Call the next number"}
          >
            Call next
          </Button>
        )}

        {paused ? (
          <Button variant="ghost" disabled={busy} onClick={() => onAction("game:resume")}>
            Resume
          </Button>
        ) : (
          <Button
            variant="ghost"
            disabled={busy || !running}
            onClick={() => onAction("game:pause")}
          >
            Pause
          </Button>
        )}

        <Button
          variant="ghost"
          disabled={busy || finished || waiting}
          onClick={() => onAction("game:set-autocall", { enabled: !autoCall })}
        >
          {autoCall ? "Auto: On" : "Auto: Off"}
        </Button>

        <Button
          variant="danger"
          disabled={busy || finished}
          aria-pressed={armed === "game:end"}
          onClick={() => click("game:end")}
        >
          {armed === "game:end" ? CONFIRM_COPY["game:end"].armed : "End game"}
        </Button>

        <Button
          variant="danger"
          disabled={busy || !finished}
          aria-pressed={armed === "game:reset"}
          onClick={() => click("game:reset")}
        >
          {armed === "game:reset" ? CONFIRM_COPY["game:reset"].armed : "Reset"}
        </Button>
      </div>

      {armedCopy ? (
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <p
            role="alert"
            style={{ color: "var(--oh-warn)", fontSize: 12, margin: 0, maxWidth: "52ch" }}
          >
            {armedCopy.confirm}
          </p>
          <Button variant="ghost" size="sm" onClick={() => setArmed(disarm())}>
            Cancel
          </Button>
        </div>
      ) : null}
    </Panel>
  );
};

export default HostControls;
