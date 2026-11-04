/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import Panel from "../Panel.jsx";
import Button from "../Button.jsx";
import { listSpeechVoices, onSpeechVoicesChanged, previewVoice } from "../../lib/announce.js";
import { bookingCopy, localizeBookingDigits } from "../../i18n/booking-locale.js";

/**
 * The caller's voice controls for THIS device. Sarvam is the primary voice
 * when configured; a local system voice is used only as a same-language fallback.
 *
 * Every device plays its own announcement, so settings change only local
 * playback and cannot delay a draw or affect the server's clock.
 *
 * The panel is honest about the three ways speech can be unavailable:
 *   • no speech engine at all (the chime and the board still work),
 *   • no voice for the selected language (speech stays silent rather than
 *     using an unrelated default voice),
 *   • an engine that stopped mid-round (the console shows RETRY).
 */
const RATES = [0.75, 1, 1.25, 1.5];
const FESTIVAL_STYLES = [
  ["classic", "Classic", "क्लासिक"], ["diwali", "Diwali", "दिवाली"], ["holi", "Holi", "होली"], ["navratri", "Navratri", "नवरात्रि"],
  ["durga_puja", "Durga Puja", "दुर्गा पूजा"], ["ganesh_chaturthi", "Ganesh Chaturthi", "गणेश चतुर्थी"], ["onam", "Onam", "ओणम"],
  ["pongal", "Pongal", "पोंगल"], ["eid", "Eid", "ईद"], ["christmas", "Christmas", "क्रिसमस"], ["halloween", "Halloween", "हैलोवीन"],
  ["wedding", "Wedding", "शादी"], ["royal", "Royal celebration", "शाही उत्सव"], ["neon", "Neon carnival", "नियॉन कार्निवल"], ["textile", "Textile festival", "वस्त्र उत्सव"],
];

const VoicePanel = ({ sound, voice, onChange, onRetry, language = "en" }) => {
  const t = (key, variables) => bookingCopy(language, key, variables);
  const lang = ["hi", "hinglish"].includes(sound.speechLang) ? sound.speechLang : "en";
  const [voiceInventory, setVoiceInventory] = useState(() => ({ lang, voices: listSpeechVoices(lang) }));
  const voices = voiceInventory.lang === lang ? voiceInventory.voices : [];
  const [previewing, setPreviewing] = useState(false);
  const [previewMessage, setPreviewMessage] = useState("");

  // Chrome loads its voice list asynchronously (often after first paint). Look
  // again shortly after mount and after a language switch instead of assuming
  // an empty list means "this machine cannot speak".
  useEffect(() => {
    const refresh = () => setVoiceInventory({ lang, voices: listSpeechVoices(lang) });
    refresh();
    const timers = [setTimeout(refresh, 400), setTimeout(refresh, 1500)];
    const offVoices = onSpeechVoicesChanged(refresh);
    return () => { timers.forEach(clearTimeout); offVoices(); };
  }, [lang]);

  const engine = Boolean(sound.available && sound.available.speech);
  const languageSupported = Boolean(sound.voiceSupport?.supported);
  const savedMissing = Boolean(sound.voiceURI) && !voices.some((v) => v.uri === sound.voiceURI);
  const selectedVoiceURI = voices.some((v) => v.uri === sound.voiceURI)
    ? sound.voiceURI
    : voices[0]?.uri || "";
  const canPreview = engine && voices.length > 0 && !previewing && sound.speaking == null && !sound.pending;

  async function playVoicePreview() {
    setPreviewMessage("");
    const result = previewVoice();
    if (!result) {
      setPreviewMessage(language === "hi" ? "लाइव कॉल या कतारबद्ध घोषणा पूरी होने पर नमूना चलाएँ।" : "Wait for live announcements to finish before previewing.");
      return;
    }
    setPreviewing(true);
    const completed = await result;
    setPreviewing(false);
    if (!completed) setPreviewMessage(language === "hi" ? "नमूना लाइव नंबर के लिए रोक दिया गया।" : "Preview stopped for a live number.");
  }

  return (
    <Panel className="p-4 oh-caller-voicepanel festival-caller-card">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h2 className="oh-eyebrow" style={{ margin: 0 }}>
          {t("voicePanel")}
        </h2>
        <span className="oh-eyebrow" data-tone={voice.tone} style={{ color: "var(--oh-text-muted)" }}>
          {voice.label}
        </span>
      </div>

      {!engine ? (
        <p className="oh-caller-note" style={{ marginTop: 0 }}>
          {t("noSpeechSynthesis")}
        </p>
      ) : null}

      <div className="oh-voice-row">
        <Button
          variant={sound.speech ? "gold" : "ghost"}
          size="sm"
          disabled={!engine || (!languageSupported && !sound.speech)}
          aria-pressed={sound.speech}
          onClick={() => onChange("speech", !sound.speech)}
          title={t(!engine ? "noSpeechEngineTitle" : languageSupported ? "voiceReadTitle" : "noLanguageVoiceListed", { language: t(lang === "hi" ? "hindiLanguage" : lang === "hinglish" ? "hinglishLanguage" : "englishLanguage") })}
        >
          {sound.speech ? (languageSupported ? t("voiceOn") : "Voice unavailable · on") : t("voiceOff")}
        </Button>
        <Button
          variant={sound.chime ? "ghost" : "ghost"}
          size="sm"
          aria-pressed={sound.chime}
          onClick={() => onChange("chime", !sound.chime)}
          title={t("chimeTitle")}
        >
          {t("chime")} {t(sound.chime ? "chimeOn" : "chimeOff")}
        </Button>
        {sound.dead ? (
          <Button variant="danger" size="sm" onClick={onRetry} title={t("retryVoiceTitle")}>
            {t("retryVoice")}
          </Button>
        ) : null}
      </div>

      <div className="oh-voice-grid mt-3">
        <div>
          <div className="oh-eyebrow" style={{ marginBottom: 6 }}>
            {t("language")}
          </div>
          <div role="group" aria-label={t("announcementLanguage")} className="oh-seg">
            <button
              type="button"
              className="oh-seg__item"
              data-active={String(lang === "en")}
              onClick={() => onChange("speechLang", "en")}
            >
              {t("englishLanguage")}
            </button>
            <button
              type="button"
              className="oh-seg__item"
              data-active={String(lang === "hi")}
              onClick={() => onChange("speechLang", "hi")}
              lang="hi"
            >
              {t("hindiLanguage")}
            </button>
            <button
              type="button"
              className="oh-seg__item"
              data-active={String(lang === "hinglish")}
              onClick={() => onChange("speechLang", "hinglish")}
            >
              {t("hinglishLanguage")}
            </button>
          </div>
        </div>

        <div>
          <div className="oh-eyebrow" style={{ marginBottom: 6 }}>
            {t("speechRate")}
          </div>
          <div role="group" aria-label="Speech rate" className="oh-seg">
            {RATES.map((rate) => (
              <button
                key={rate}
                type="button"
                className="oh-seg__item"
                data-active={String(Math.abs(Number(sound.rate) - rate) < 0.001)}
                onClick={() => onChange("rate", rate)}
                title={t("speakAt", { rate: localizeBookingDigits(language, rate) })}
              >
                {localizeBookingDigits(language, rate)}×
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="festival-callout-settings mt-3">
        <div className="festival-callout-settings__toggle">
          <div>
            <div className="oh-eyebrow">{language === "hi" ? "मज़ेदार कॉलआउट" : "Playful callouts"}</div>
            <p className="oh-caller-note">
              {language === "hi"
                ? "नंबर के साथ छोटी पंक्ति बोलेगी; बोर्ड पर नंबर तुरंत अपडेट होगा।"
                : "Adds one short line before the number. The board updates immediately."}
            </p>
          </div>
          <Button
            variant={sound.callouts ? "gold" : "ghost"}
            size="sm"
            aria-pressed={Boolean(sound.callouts)}
            onClick={() => onChange("callouts", !sound.callouts)}
          >
            {language === "hi"
              ? sound.callouts ? "कॉलआउट चालू" : "कॉलआउट बंद"
              : sound.callouts ? "Callouts on" : "Callouts off"}
          </Button>
        </div>
        <div className="festival-callout-settings__selects">
          <label>
            <span className="oh-eyebrow">{language === "hi" ? "कॉलर का अंदाज़" : "Caller personality"}</span>
            <select
              className="oh-field"
              value={sound.personality === "friendly" ? "friendly" : "playful"}
              onChange={(event) => onChange("personality", event.target.value)}
            >
              <option value="playful">{language === "hi" ? "मज़ेदार" : "Playful"}</option>
              <option value="friendly">{language === "hi" ? "दोस्ताना" : "Friendly"}</option>
            </select>
          </label>
          <label>
            <span className="oh-eyebrow">{language === "hi" ? "उत्सव शैली" : "Festival style"}</span>
            <select
              className="oh-field"
              value={FESTIVAL_STYLES.some(([id]) => id === sound.festival) ? sound.festival : "classic"}
              onChange={(event) => onChange("festival", event.target.value)}
            >
              {FESTIVAL_STYLES.map(([id, english, hindi]) => (
                <option key={id} value={id}>{language === "hi" ? hindi : english}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between">
          <label className="oh-eyebrow" htmlFor="oh-volume">
            {t("volume")}
          </label>
          <span className="oh-num" style={{ fontSize: 12, color: "var(--oh-text-muted)" }}>
            {localizeBookingDigits(language, Math.round(Number(sound.volume ?? 1) * 100))}%
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
        <div className="flex items-center justify-between gap-2">
          <label className="oh-eyebrow" htmlFor="oh-voice">{t("voicePanel")}</label>
        <Button size="sm" variant="ghost" disabled={!canPreview || Boolean(sound.voiceSupport?.provider)} onClick={playVoicePreview}>
            {previewing ? (language === "hi" ? "नमूना चल रहा है…" : "Playing sample…") : (language === "hi" ? "आवाज़ सुनें" : "Preview voice")}
          </Button>
        </div>
        {sound.voiceSupport?.provider ? (
          <p className="oh-caller-note" role="status" style={{ marginTop: 6 }}>
            Sarvam Bulbul v4 Flash · {lang === "en" ? "ashwin_en_sports_energetic" : lang === "hi" ? "shubh_hi_ads" : "shubh_enhi_ads"}
          </p>
        ) : null}
        {sound.voiceSupport?.degraded ? (
          <p className="oh-caller-note" role="status" style={{ marginTop: 6 }}>
            Sarvam is temporarily unavailable; only a matching local-language voice may be used.
          </p>
        ) : null}
        <select
          id="oh-voice"
          className="oh-field"
          value={selectedVoiceURI}
          onChange={(event) => onChange("voiceURI", event.target.value || null)}
          disabled={!engine || voices.length === 0 || Boolean(sound.voiceSupport?.provider)}
          style={{ marginTop: 6, width: "100%" }}
        >
          {voices.map((v) => (
            <option key={v.uri} value={v.uri}>
              {v.name} · {v.lang}
            </option>
          ))}
        </select>
        <p className="oh-caller-note" style={{ marginTop: 6 }}>
          {!engine
            ? t("noVoicesListed")
            : sound.voiceSupport?.provider
              ? "Sarvam is ready. The browser voice list is used only for a same-language fallback."
              : voices.length === 0
              ? (lang === "hi"
                  ? "Hindi speech is unavailable. Configure the Sarvam server voice or select a Hindi-capable local system voice."
                  : t("noLanguageVoiceListed", { language: t("englishLanguage") }))
              : savedMissing
                ? t("savedVoiceUnavailable")
                : t("voiceListsDiffer")}
        </p>
        {previewMessage ? <p className="oh-caller-note" role="status" style={{ marginTop: 5 }}>{previewMessage}</p> : null}
      </div>
    </Panel>
  );
};

export default VoicePanel;
