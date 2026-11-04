/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { FaHome, FaTicketAlt, FaCalendarAlt, FaPlay, FaVolumeUp, FaVolumeMute } from "react-icons/fa";
import "./festival-system.css";
import ConnectionIndicator from "./ConnectionIndicator.jsx";
import { assetUrl, usePlatformBranding } from "../platform-branding.js";
import BookingLanguageSelect from "../i18n/BookingLanguageSelect.jsx";
import { bookingCopy, formatBookingNumber } from "../i18n/booking-locale.js";

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
const GameHeader = ({ roomId, sound, state = "WAITING", playerCount = 0, language = "en", onToggleSound, onToggleSpeech, onToggleSpeechLang }) => {
  const t = (key) => bookingCopy(language, key);
  const brand = usePlatformBranding();
  const [copied, setCopied] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const [instanceBrand, setInstanceBrand] = useState(() => {
    const data = typeof document === "undefined" ? {} : document.documentElement.dataset;
    return { active: Boolean(data.instanceName), name: data.instanceName || "", logoUrl: data.instanceLogo || "" };
  });

  useEffect(() => {
    const update = (event) => { setInstanceBrand(event.detail || { active: false, name: "", logoUrl: "" }); setLogoFailed(false); };
    document.addEventListener("instance-branding-change", update);
    return () => document.removeEventListener("instance-branding-change", update);
  }, []);

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
  const languageVoiceAvailable = sound?.voiceSupport?.supported !== false;
  // The engine can die mid-round (autoplay policy, a crashed voice). The chip
  // must not keep claiming "VOICE" while nothing is spoken: it turns into a
  // RETRY that an explicit tap uses to start the queue again.
  const speechDead = Boolean(sound && sound.dead);
  const lang = ["hi", "hinglish"].includes(sound?.speechLang) ? sound.speechLang : "en";
  const voiceUnavailableText = lang === "hi" ? "Hindi voice unavailable" : lang === "hinglish" ? "Hinglish voice unavailable" : "English voice unavailable";
  const logo = instanceBrand.active ? instanceBrand.logoUrl : assetUrl(brand.logo);
  const stateText = t(`state${state}`);

  return (
    <header
      lang={language === "hi" ? "hi" : "en"}
      className="oh-game-header"
      style={{ paddingBottom: 12, borderBottom: "1px solid var(--oh-line)" }}
    >
      <div className="oh-game-brand">
        {!logoFailed && logo ? <img src={logo} alt="" aria-hidden="true" onError={() => setLogoFailed(true)} /> : null}
        <span className="oh-display">{instanceBrand.active ? instanceBrand.name : brand.name}</span>
      </div>

      <nav className="festival-game-nav" aria-label={language === "hi" ? "मुख्य नेविगेशन" : "Main navigation"}>
        <NavLink to="/"><FaHome aria-hidden="true" /><span>{language === "hi" ? "होम" : "Home"}</span></NavLink>
        <a href="#main-content" aria-current="page"><FaPlay aria-hidden="true" /><span>{language === "hi" ? "खेल" : "Play"}</span></a>
        <NavLink to="/games"><FaTicketAlt aria-hidden="true" /><span>{language === "hi" ? "बुकिंग" : "Bookings"}</span></NavLink>
        <NavLink to="/games"><FaCalendarAlt aria-hidden="true" /><span>{language === "hi" ? "कार्यक्रम" : "Events"}</span></NavLink>
      </nav>
      <div className="oh-game-header__event" aria-label={`${stateText}, ${formatBookingNumber(playerCount, language)} ${t(state === "RUNNING" || state === "PAUSED" ? "playersPlaying" : state === "COMPLETED" ? "playersPlayed" : "playersSeated")}`}>
        <span className="oh-game-header__live" data-state={state.toLowerCase()}><i aria-hidden="true" />{stateText}</span>
        {roomId ? <span className="oh-game-header__room">{t("room")} <strong>{roomId}</strong></span> : null}
        <span className="oh-game-header__players">{formatBookingNumber(playerCount, language)} {t(state === "RUNNING" || state === "PAUSED" ? "playersPlaying" : state === "COMPLETED" ? "playersPlayed" : "playersSeated")}</span>
      </div>

      {/* This group must be allowed to wrap on its own: at 390px the chips are
          wider than the viewport, and the header is only as wide as its
          padding. Without the wrap the connection pill was clipped at the edge. */}
      <div className="flex items-center gap-3" style={{ flexWrap: "wrap", justifyContent: "flex-end", rowGap: 8 }}>
        <BookingLanguageSelect />
        {roomId ? <button type="button" onClick={copyCode} title={t("copyRoomCode")} aria-label={`${copied ? t("copied") : t("copyRoomCode")} ${roomId}`} className="oh-game-header__copy">{copied ? t("copied") : t("copyRoomCode")}</button> : null}

        {speechAvailable ? (
          <div
            className="flex items-center game-header-speech"
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
                speechOn && !languageVoiceAvailable
                  ? `${voiceUnavailableText}; no server or same-language local voice is available.`
                  : speechDead
                  ? t("spokenNumbersStopped")
                  : speechOn
                    ? t("spokenNumbersOn")
                    : t("spokenNumbersMuted")
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
              {speechDead ? t("retryVoice") : speechOn && !languageVoiceAvailable ? voiceUnavailableText : speechOn ? t("voice") : t("muted")}
            </button>
            <button
              onClick={onToggleSpeechLang}
              title="Cycle caller voice language"
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
              {lang === "en" ? "EN" : lang === "hi" ? "HI" : "HNG"}
            </button>
          </div>
        ) : null}

        {onToggleSound ? (
          <button
            onClick={onToggleSound}
            aria-pressed={Boolean(soundOn)}
            title={t(soundOn ? "announcementsOn" : "announcementsOff")}
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

const SoundMark = ({ on }) => on ? <FaVolumeUp aria-hidden="true" size={18} /> : <FaVolumeMute aria-hidden="true" size={18} />;

export default GameHeader;
