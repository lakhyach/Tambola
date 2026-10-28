/* eslint-disable react/prop-types */
import { useState } from "react";
import ConnectionIndicator from "./ConnectionIndicator.jsx";
import { APP_NAME } from "../brand.js";

/**
 * Compact game header: identity, the room code (selectable + copy), live
 * connection status and an honest opt-in announcement toggle.
 */
const GameHeader = ({ roomId, sound, onToggleSound }) => {
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
          <div className="oh-eyebrow">Obsidian Hall</div>
        </div>
      </div>

      <div className="flex items-center gap-3">
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
