/* eslint-disable react/prop-types */
import { useState } from "react";
import ConnectionIndicator from "./ConnectionIndicator.jsx";
import { APP_MARK, APP_NAME } from "../brand.js";

/**
 * Compact game header: identity, the room code (selectable + copy), live
 * connection status and the honest opt-in announcement controls.
 *
 * The announcement layer has three independent, honestly-labelled surfaces:
 *   • the master toggle (chime + voice together) — the big round button,
 *   • a voice chip that mutes SPOKEN numbers alone and switches their language,
 *   • a lag dot that appears only while the voice is behind the board, so the
 *     header never implies the current number has been read when it has not.
 */
const GameHeader = ({ roomId, sound, onToggleSound, onToggleSpeech, onToggleSpeechLang }) => {
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    if (!roomId) return;
    try {
      await navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard may be blocked; the code is selectable anyway */
    }
  };

  const soundOn = sound && (sound.speech || sound.chime);
  const speechAvailable = Boolean(sound && sound.available && sound.available.speech);
  const speechOn = Boolean(sound && sound.speech);
  // The engine can die mid-round (autoplay policy, a crashed voice). The chip
  // must not keep claiming "VOICE" while nothing is spoken: it turns into a
  // RETRY that an explicit tap uses to start the queue again.
  const speechDead = Boolean(sound && sound.dead);
  const lang = (sound && sound.speechLang) === "hi" ? "hi" : "en";

  return (
    <header
      className="flex flex-wrap items-center justify-between gap-3"
      style={{ paddingBottom: 12, borderBottom: "1px solid var(--oh-line)" }}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "var(--oh-gold)",
            boxShadow: "0 0 12px 2px rgba(207,171,99,.6)",
          }}
        />
        <div className="leading-tight">
          <div className="oh-display" style={{ fontSize: 18, letterSpacing: ".06em" }}>
            {APP_NAME}
          </div>
          <div className="oh-eyebrow">{APP_MARK}</div>
        </div>
      </div>

      {/* This group must be allowed to wrap on its own: at 390px the chips are
          wider than the viewport, and the header is only as wide as its
          padding. Without the wrap the connection pill was clipped at the edge. */}
      <div className="flex items-center gap-3" style={{ flexWrap: "wrap", justifyContent: "flex-end", rowGap: 8 }}>
        {roomId ? (
          <button
            onClick={copyCode}
            title="Copy room code"
            className="oh-num inline-flex items-center gap-2"
            style={{
              background: "var(--oh-inset)",
              border: "1px solid var(--oh-line)",
              borderRadius: 999,
              padding: "5px 12px",
              color: "var(--oh-ivory)",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            <span className="oh-eyebrow" style={{ letterSpacing: ".18em" }}>
              {copied ? "Copied" : "Room"}
            </span>
            <span style={{ fontWeight: 700, letterSpacing: ".14em" }}>{roomId}</span>
          </button>
        ) : null}

        {speechAvailable ? (
          <div
            className="flex items-center"
            style={{
              border: "1px solid var(--oh-line)",
              borderRadius: 999,
              overflow: "hidden",
              background: "var(--oh-inset)",
            }}
          >
            <button
              onClick={onToggleSpeech}
              aria-pressed={speechOn}
              title={
                speechDead
                  ? "Spoken numbers stopped in this browser — tap to try again"
                  : speechOn
                    ? "Spoken numbers on"
                    : "Spoken numbers muted"
              }
              className="oh-eyebrow"
              style={{
                padding: "6px 9px",
                color: speechDead
                  ? "var(--oh-danger)"
                  : speechOn
                    ? "var(--oh-gold-bright)"
                    : "var(--oh-text-faint)",
                cursor: "pointer",
                background: "transparent",
                letterSpacing: ".12em",
              }}
            >
              {speechDead ? "RETRY" : speechOn ? "VOICE" : "MUTED"}
            </button>
            <button
              onClick={onToggleSpeechLang}
              title={lang === "hi" ? "Announcements in Hindi — switch to English" : "Announcements in English — switch to Hindi"}
              className="oh-eyebrow"
              style={{
                padding: "6px 9px",
                color: "var(--oh-ivory)",
                cursor: "pointer",
                background: "transparent",
                borderLeft: "1px solid var(--oh-line)",
                letterSpacing: ".1em",
              }}
            >
              {lang === "hi" ? "हिं" : "EN"}
            </button>
          </div>
        ) : null}

        {onToggleSound ? (
          <button
            onClick={onToggleSound}
            aria-pressed={Boolean(soundOn)}
            title={soundOn ? "Announcements on" : "Announcements off"}
            className="inline-flex items-center justify-center"
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              border: `1px solid ${soundOn ? "var(--oh-gold)" : "var(--oh-line)"}`,
              background: soundOn ? "rgba(207,171,99,.14)" : "transparent",
              color: soundOn ? "var(--oh-gold-bright)" : "var(--oh-text-faint)",
              cursor: "pointer",
            }}
          >
            <SoundMark on={soundOn} />
          </button>
        ) : null}

        <ConnectionIndicator />
      </div>
    </header>
  );
};

const SoundMark = ({ on }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
    {on ? (
      <path d="M16.5 8.5a5 5 0 010 7M19 6a8 8 0 010 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    ) : (
      <path d="M17 9l5 6M22 9l-5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    )}
  </svg>
);

export default GameHeader;
