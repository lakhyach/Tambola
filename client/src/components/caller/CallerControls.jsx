/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import Panel from "../Panel.jsx";
import Button from "../Button.jsx";
import { disarm, press } from "../../lib/confirmAction.js";
import { INTERVAL_PRESETS, intervalLabel, nextCallHint } from "../../lib/caller.js";
import { bookingCallerText, bookingCopy, localizeBookingDigits } from "../../i18n/booking-locale.js";

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
  language = "en",
  autoCall,
  callIntervalMs,
  actions,
  busy = false,
  pendingCall = false,
  onAction,
  onSetInterval,
}) => {
  const t = (key, variables) => bookingCopy(language, key, variables);
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
    ? { action: "game:start", label: busy ? t("openingHall") : t("startRound"), enabled: actions.start.enabled, reason: bookingCallerText(language, actions.start.reason), hint: bookingCallerText(language, nextCallHint({ state })) }
    : finished
      ? { action: null, label: t("voiceRoundComplete"), enabled: false, reason: t("resetToPlayAgain"), hint: bookingCallerText(language, nextCallHint({ state })) }
      : {
          action: paused ? "game:resume" : "game:call-next",
          label: paused ? t("resumeRound") : pendingCall || busy ? t("callingNumber") : t("callNextNumber"),
          enabled: paused ? actions.resume.enabled : actions.call.enabled,
          reason: bookingCallerText(language, paused ? actions.resume.reason : actions.call.reason),
          hint: bookingCallerText(language, nextCallHint({ state, autoCall, callIntervalMs })),
        };

  const intervalNote = waiting
    ? "firstCallStarts"
    : paused
      ? "intervalOnResume"
      : running
        ? "intervalNextCall"
        : "intervalRoundOver";

  const armedCopy = armed ? {
    armed: t(armed === "game:end" ? "confirmEndLabel" : "confirmResetLabel"),
    confirm: t(armed === "game:end" ? "confirmEndText" : "confirmResetText"),
  } : null;

  return (
    <Panel className="p-4 oh-caller-controls festival-caller-card">
      <div className="flex items-center justify-between mb-3">
        <h2 className="oh-eyebrow">{t("drawControls")}</h2>
        <span className="oh-eyebrow" style={{ color: !finished && autoCall ? "var(--oh-ok)" : "var(--oh-text-faint)" }}>
          {finished ? t("roundClosed") : autoCall ? `${t("autoCallOn")} · ${localizeBookingDigits(language, intervalLabel(callIntervalMs))}` : t("autoCallOff")}
        </span>
      </div>

      <button
        type="button"
        className={"oh-callbtn" + (primary.action === "game:call-next" ? " oh-callbtn--call" : "")}
        data-enabled={String(Boolean(primary.enabled))}
        disabled={!primary.enabled || busy || pendingCall}
        aria-busy={pendingCall}
        onClick={() => primary.action && onAction(primary.action)}
        aria-keyshortcuts={primary.action === "game:call-next" ? "c" : undefined}
        title={primary.reason || primary.hint}
      >
        <span className="oh-callbtn__label">
          {primary.label}
          {primary.action === "game:call-next" ? <span className="oh-kbd oh-kbd--dark">C</span> : null}
        </span>
        <span className={primary.enabled ? "oh-sr-only" : "oh-callbtn__hint"}>{primary.reason || primary.hint}</span>
      </button>

      <div className="oh-caller-transport mt-3">
        {paused ? (
          <Button variant="ghost" size="sm" disabled={!actions.resume.enabled} onClick={() => onAction("game:resume")}>
            {t("resumeRound")}
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            disabled={!actions.pause.enabled}
            onClick={() => onAction("game:pause")}
            aria-keyshortcuts="p"
            title={bookingCallerText(language, actions.pause.reason || "Stop the clock without ending the round")}
          >
            {t("pauseRound")} {actions.pause.enabled ? <span className="oh-kbd">P</span> : null}
          </Button>
        )}

        <Button
          variant="ghost"
          size="sm"
          disabled={!actions.autocall.enabled}
          onClick={() => onAction("game:set-autocall", { enabled: !autoCall })}
          aria-pressed={autoCall}
          title={bookingCallerText(language, actions.autocall.reason || (autoCall ? "Stop the automatic calls" : "Let the server call on the interval"))}
        >
          {autoCall ? t("autoCallOn") : t("autoCallOff")}
        </Button>

        <Button
          variant="danger"
          size="sm"
          disabled={!actions.end.enabled}
          aria-pressed={armed === "game:end"}
          onClick={() => click("game:end")}
          title={bookingCallerText(language, actions.end.reason || "End this round for everybody")}
        >
          {armed === "game:end" ? armedCopy.armed : t("endRound")}
        </Button>

        {finished ? (
          <Button
            variant="danger"
            size="sm"
            disabled={!actions.reset.enabled}
            aria-pressed={armed === "game:reset"}
            onClick={() => click("game:reset")}
          >
            {armed === "game:reset" ? armedCopy.armed : t("resetRoom")}
          </Button>
        ) : null}
      </div>

      {armedCopy ? (
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <p role="alert" style={{ color: "var(--oh-warn)", fontSize: 12, margin: 0, maxWidth: "52ch" }}>
            {armedCopy.confirm}
          </p>
          <Button variant="ghost" size="sm" onClick={() => setArmed(disarm())}>
            {t("cancel")}
          </Button>
        </div>
      ) : null}

      <details className="caller-interval-settings">
      <summary>{t("callingEvery")} <strong>{localizeBookingDigits(language, intervalLabel(callIntervalMs))}</strong></summary>
      <div className="flex items-center justify-between mb-2 mt-3 gap-2 flex-wrap">
        <h3 className="oh-eyebrow" style={{ margin: 0 }}>
          {t("callingEvery")}
        </h3>
        <span className="oh-num" style={{ fontSize: 12, color: "var(--oh-text-muted)" }}>
          {localizeBookingDigits(language, intervalLabel(callIntervalMs))}
        </span>
      </div>
      <div role="group" aria-label={t("intervalCallGroup")} className="oh-seg">
        {INTERVAL_PRESETS.map((ms) => (
          <button
            key={ms}
            type="button"
            className="oh-seg__item"
            data-active={String(ms === callIntervalMs)}
            disabled={!actions.interval.enabled || ms === callIntervalMs}
            onClick={() => onSetInterval(ms)}
            title={bookingCallerText(language, actions.interval.reason || "Call a number every " + intervalLabel(ms))}
          >
                {localizeBookingDigits(language, intervalLabel(ms))}
          </button>
        ))}
      </div>
      <p className="oh-caller-note" style={{ marginTop: 8 }}>
        {actions.interval.enabled ? t(intervalNote) : bookingCallerText(language, actions.interval.reason)}
      </p>
      </details>
    </Panel>
  );
};

export default CallerControls;
