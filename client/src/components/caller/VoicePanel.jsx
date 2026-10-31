/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import Panel from "../Panel.jsx";
import Button from "../Button.jsx";
import { listSpeechVoices } from "../../lib/announce.js";

/**
 * The caller's voice controls for THIS device.
 *
 * Speech is browser-local: every device announces for itself, so these settings
 * change what the host hears and nothing else. They can never delay a draw, and
 * the server's clock does not know they exist.
 *
 * The panel is honest about the three ways speech can be unavailable:
 *   • no speech engine at all (the chime and the board still work),
 *   • a chosen voice this machine does not list (falls back, and says so),
 *   • an engine that stopped mid-round (the console shows RETRY).
 */
const RATES = [0.75, 1, 1.25, 1.5];

const VoicePanel = ({ sound, voice, onChange, onRetry }) => {
  const lang = sound.speechLang === "hi" ? "hi" : "en";
  const [voices, setVoices] = useState(() => listSpeechVoices(lang));

  // Chrome loads its voice list asynchronously (often after first paint). Look
  // again shortly after mount and after a language switch instead of assuming
  // an empty list means "this machine cannot speak".
  useEffect(() => {
    setVoices(listSpeechVoices(lang));
    const timers = [setTimeout(() => setVoices(listSpeechVoices(lang)), 400), setTimeout(() => setVoices(listSpeechVoices(lang)), 1500)];
    return () => timers.forEach(clearTimeout);
  }, [lang]);

  const engine = Boolean(sound.available && sound.available.speech);
  const savedMissing = Boolean(sound.voiceURI) && !voices.some((v) => v.uri === sound.voiceURI);

  return (
    <Panel className="p-4 oh-caller-voicepanel">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h2 className="oh-eyebrow" style={{ margin: 0 }}>
          Voice
        </h2>
        <span className="oh-eyebrow" data-tone={voice.tone} style={{ color: "var(--oh-text-muted)" }}>
          {voice.label}
        </span>
      </div>

      {!engine ? (
        <p className="oh-caller-note" style={{ marginTop: 0 }}>
          This browser has no speech synthesis, so numbers are not read aloud here. The board, the
          chime and every player&apos;s own device are unaffected.
        </p>
      ) : null}

      <div className="oh-voice-row">
        <Button
          variant={sound.speech ? "gold" : "ghost"}
          size="sm"
          disabled={!engine}
          aria-pressed={sound.speech}
          onClick={() => onChange("speech", !sound.speech)}
          title={engine ? "Read each called number aloud on this device" : "No speech engine in this browser"}
        >
          {sound.speech ? "Voice on" : "Voice off"}
        </Button>
        <Button
          variant={sound.chime ? "ghost" : "ghost"}
          size="sm"
          aria-pressed={sound.chime}
          onClick={() => onChange("chime", !sound.chime)}
          title="A short chime with each announcement"
        >
          Chime {sound.chime ? "on" : "off"}
        </Button>
        {sound.dead ? (
          <Button variant="danger" size="sm" onClick={onRetry} title="Restart the spoken numbers">
            Retry voice
          </Button>
        ) : null}
      </div>

      <div className="oh-voice-grid mt-3">
        <div>
          <div className="oh-eyebrow" style={{ marginBottom: 6 }}>
            Language
          </div>
          <div role="group" aria-label="Announcement language" className="oh-seg">
            <button
              type="button"
              className="oh-seg__item"
              data-active={String(lang === "en")}
              onClick={() => onChange("speechLang", "en")}
            >
              English
            </button>
            <button
              type="button"
              className="oh-seg__item"
              data-active={String(lang === "hi")}
              onClick={() => onChange("speechLang", "hi")}
              lang="hi"
            >
              हिंदी
            </button>
          </div>
        </div>

        <div>
          <div className="oh-eyebrow" style={{ marginBottom: 6 }}>
            Rate
          </div>
          <div role="group" aria-label="Speech rate" className="oh-seg">
            {RATES.map((rate) => (
              <button
                key={rate}
                type="button"
                className="oh-seg__item"
                data-active={String(Math.abs(Number(sound.rate) - rate) < 0.001)}
                onClick={() => onChange("rate", rate)}
                title={"Speak at " + rate + "×"}
              >
                {rate}×
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between">
          <label className="oh-eyebrow" htmlFor="oh-volume">
            Volume
          </label>
          <span className="oh-num" style={{ fontSize: 12, color: "var(--oh-text-muted)" }}>
            {Math.round(Number(sound.volume ?? 1) * 100)}%
          </span>
        </div>
        <input
          id="oh-volume"
          className="oh-range"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={Number(sound.volume ?? 1)}
          onChange={(event) => onChange("volume", Number(event.target.value))}
        />
      </div>

      <div className="mt-3">
        <label className="oh-eyebrow" htmlFor="oh-voice">
          Voice
        </label>
        <select
          id="oh-voice"
          className="oh-field"
          value={sound.voiceURI || ""}
          onChange={(event) => onChange("voiceURI", event.target.value || null)}
          disabled={!engine}
          style={{ marginTop: 6, width: "100%" }}
        >
          <option value="">Browser default</option>
          {voices.map((v) => (
            <option key={v.uri} value={v.uri}>
              {v.name} · {v.lang}
            </option>
          ))}
        </select>
        <p className="oh-caller-note" style={{ marginTop: 6 }}>
          {!engine
            ? "No voices are listed because this browser cannot speak."
            : voices.length === 0
              ? "This browser lists no " + (lang === "hi" ? "Hindi" : "English") + " voice; it will use its default voice."
              : savedMissing
                ? "The voice saved earlier is not on this device — the closest match is used instead."
                : "Voice lists differ per operating system; a saved voice falls back gracefully."}
        </p>
      </div>
    </Panel>
  );
};

export default VoicePanel;
