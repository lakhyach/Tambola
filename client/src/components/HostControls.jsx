import Panel from "./Panel.jsx";
import Button from "./Button.jsx";

/**
 * Host-only draw controls. Every action is an INTENT sent over the documented
 * contract (never a number); the server re-checks authority regardless, so this
 * panel is convenience, not the security boundary. Manual "call" is disabled
 * while the auto-caller is running to avoid a double-call race, and the two
 * destructive actions ask for confirmation first.
 */
// eslint-disable-next-line react/prop-types
const HostControls = ({ state, autoCall, busy = false, onAction }) => {
  const running = state === "RUNNING";
  const paused = state === "PAUSED";
  const finished = state === "COMPLETED";

  const confirm = (message) => window.confirm(message);

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
        <Button
          variant="gold"
          disabled={busy || !running || autoCall}
          onClick={() => onAction("game:call-next")}
          title={autoCall ? "The auto-caller is running" : "Call the next number"}
        >
          Call next
        </Button>

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
          disabled={busy || finished || state === "WAITING"}
          onClick={() => onAction("game:set-autocall", { enabled: !autoCall })}
        >
          {autoCall ? "Auto: On" : "Auto: Off"}
        </Button>

        <Button
          variant="danger"
          disabled={busy || finished}
          onClick={() => {
            if (confirm("End the game now? This cannot be undone.")) onAction("game:end");
          }}
        >
          End game
        </Button>

        <Button
          variant="danger"
          disabled={busy || !finished}
          onClick={() => {
            if (confirm("Reset the room for a fresh game? Scores and calls clear."))
              onAction("game:reset");
          }}
        >
          Reset
        </Button>
      </div>
    </Panel>
  );
};

export default HostControls;
