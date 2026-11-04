/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import { FaCrown } from "react-icons/fa";
import Panel from "../Panel.jsx";
import Button from "../Button.jsx";
import CurrentNumberReveal from "../CurrentNumberReveal.jsx";
import { elapsedAt, formatClock, nextCallPreview } from "../../lib/caller.js";
import { getNumberCallout } from "../../lib/number-callouts.js";
import { bookingCopy, formatBookingNumber, localizeBookingDigits } from "../../i18n/booking-locale.js";

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
  language = "en",
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
  callouts = false,
  calloutLanguage = "en",
  calloutPersonality = "playful",
  calloutFestival = "classic",
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
  const t = (key, variables) => bookingCopy(language, key, variables);
  const callout = !callouts || lastCall == null ? "" : getNumberCallout(lastCall, {
    language: calloutLanguage,
    callIndex: calledCount,
    festival: calloutFestival,
    personality: calloutPersonality,
  });

  return (
    <Panel className="oh-caller-hero festival-caller-hero">
      <div className="caller-stage-heading">
        <div>
          <h2><FaCrown aria-hidden="true" />{language === "hi" ? "लाइव कॉलर कंसोल" : "Live Caller Console"}</h2>
          <p>
            {waiting ? t("readyToOpenHall") : state === "COMPLETED" ? t("voiceRoundComplete") : state === "PAUSED" ? (language === "hi" ? "राउंड रुका हुआ है" : "Round paused") : t("roundLive")}
          </p>
        </div>
        <span className="oh-statechip" data-tone={state.toLowerCase()}>
          {t(`state${state}`)}
        </span>
      </div>

      <div className="festival-caller-hero__stage">
        <img className="caller-stage-art" src="/brand/festival-caller-portrait-v2.webp" alt="" aria-hidden="true" decoding="async" />
        <div className="festival-caller-hero__ball-wrap">
          <CurrentNumberReveal number={lastCall} callIndex={calledCount} total={90} language={language} />
          {callout ? <p className="festival-caller-callout">{callout}</p> : null}
        </div>
        <div className="oh-caller-aside">
          <div className="oh-eyebrow">{t("round")}</div>
          <div className="oh-num" style={{ fontSize: 15, color: "var(--oh-ivory)" }}>
            {Number(gameNumber) > 0 ? "#" + formatBookingNumber(gameNumber, language) : "—"}
          </div>
          <div className="oh-eyebrow" style={{ marginTop: 10 }}>
            {t("elapsed")}
          </div>
          <div className="oh-num oh-caller-clock" role="timer" aria-label={`${t("elapsed")} ${localizeBookingDigits(language, clock)}`}>
            {localizeBookingDigits(language, clock)}
          </div>
        </div>
      </div>

      <div className="oh-caller-strip mt-3">
        <div className="oh-caller-cell">
          <div className="oh-eyebrow">{t("previousCall")}</div>
          <div className="oh-num oh-caller-cell__value" data-empty={String(previous == null)}>
            {previous == null ? "—" : formatBookingNumber(previous, language)}
          </div>
        </div>

        <div className="oh-caller-cell oh-caller-cell--current">
          <div className="oh-eyebrow">{t("numberCurrent")}</div>
          <div className="oh-num oh-caller-cell__value" data-empty={String(lastCall == null)}>{lastCall == null ? "—" : formatBookingNumber(lastCall, language)}</div>
        </div>

        <div className="oh-caller-cell oh-caller-cell--sealed" role="group" aria-label={state === "COMPLETED" ? t("voiceRoundComplete") : t("nextNotDrawn")}>
          <div className="oh-eyebrow">{t("nextCall")}</div>
          <div className="oh-num oh-caller-cell__value oh-sealed" aria-hidden="true">
            {state === "COMPLETED" ? "—" : "?"}
          </div>
        </div>

        <div className="oh-caller-cell">
          <div className="oh-eyebrow">{t("leftInBag")}</div>
          <div className="oh-num oh-caller-cell__value">{formatBookingNumber(preview.remaining == null ? 90 : preview.remaining, language)}</div>
        </div>

      </div>

      <div className="oh-caller-voice mt-3">
        <span className="oh-dot" data-tone={voice.tone} aria-hidden="true" />
        <details className="caller-voice-status" style={{ minWidth: 0, flex: "1 1 auto" }}>
          <summary className="oh-eyebrow" style={{ color: "var(--oh-text-muted)" }}>
            {voice.label}
            {Number.isInteger(speaking) ? " · " + formatBookingNumber(speaking, language) : ""}
          </summary>
          <p className="oh-caller-note">{voice.detail}</p>
        </details>
        <Button
          variant="ghost"
          size="sm"
          disabled={!repeatEnabled}
          onClick={onRepeat}
          aria-keyshortcuts="r"
          title={
            repeatEnabled
              ? t("voiceRepeatTitle")
              : t("voiceNothingToRepeat")
          }
        >
          {t("repeatNumber")} <span className="oh-kbd">R</span>
        </Button>
      </div>
    </Panel>
  );
};

export default CallerHero;
