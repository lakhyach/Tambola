/* eslint-disable react/prop-types */
import { useEffect, useRef, useState } from "react";
import { FaChevronLeft, FaChevronRight, FaCog, FaExpand, FaInfoCircle, FaMicrophone, FaTimes, FaVolumeMute, FaVolumeUp } from "react-icons/fa";
import Panel from "./Panel.jsx";
import PatternDiagram from "./PatternDiagram.jsx";
import VoicePanel from "./caller/VoicePanel.jsx";
import { bookingCopy, bookingPatternHint, bookingPatternName, formatBookingNumber } from "../i18n/booking-locale.js";

/** Navigation only changes which configured server pattern is being explained. */
export function PlayerCurrentPattern({ patterns = [], example, language }) {
  const [selectedId, setSelectedId] = useState(null);
  const index = Math.max(0, patterns.findIndex((pattern) => pattern.id === selectedId));
  const pattern = patterns[index];
  const move = (step) => setSelectedId(patterns[(index + step + patterns.length) % patterns.length].id);
  const heading = language === "hi" ? "वर्तमान पैटर्न" : "Current Pattern";
  return (
    <Panel className="player-current-pattern">
      <h2>{heading}</h2>
      {!pattern ? <p>{language === "hi" ? "रूम के पैटर्न का इंतज़ार है।" : "Waiting for the room’s configured patterns."}</p> : (
        <div className="player-current-pattern__body">
          {patterns.length > 1 ? <button type="button" className="player-pattern-arrow" onClick={() => move(-1)} aria-label={language === "hi" ? "पिछला पैटर्न" : "Previous configured pattern"}><FaChevronLeft /></button> : null}
          <div className="player-current-pattern__content" aria-live="polite">
            {pattern.cells ? <PatternDiagram cells={pattern.cells} example={example} label={pattern.label} language={language} /> : <span className="player-current-pattern__count">{pattern.need ? formatBookingNumber(pattern.need, language) : <FaInfoCircle />}</span>}
            <div>
              <h3>{bookingPatternName(language, pattern.id, pattern.label)}</h3>
              <p>{bookingPatternHint(language, pattern.id, pattern.hint)}</p>
            </div>
          </div>
          {patterns.length > 1 ? <button type="button" className="player-pattern-arrow" onClick={() => move(1)} aria-label={language === "hi" ? "अगला पैटर्न" : "Next configured pattern"}><FaChevronRight /></button> : null}
        </div>
      )}
    </Panel>
  );
}

/** These preferences affect this device's existing announcement engine only. */
export function PlayerControlDock({ view, language }) {
  const settingsDialog = useRef(null);
  const helpDialog = useRef(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [notice, setNotice] = useState("");
  const sound = view.sound || {};
  const soundOn = Boolean(sound.chime || sound.speech);
  const hi = language === "hi";
  const t = (key) => bookingCopy(language, key);

  useEffect(() => {
    const sync = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setNotice(hi ? "इस ब्राउज़र में फ़ुलस्क्रीन उपलब्ध नहीं है।" : "Fullscreen is unavailable in this browser.");
    }
  };

  const closeBackdrop = (event) => {
    if (event.target === event.currentTarget) {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close();
    }
  };

  return (
    <>
      <footer className="player-control-dock" aria-label={hi ? "गेम नियंत्रण" : "Game controls"}>
        <button type="button" onClick={() => settingsDialog.current?.showModal()}><FaCog /><span>{hi ? "सेटिंग्स" : "Settings"}</span></button>
        <div className="player-dock-volume">
          <button type="button" onClick={view.onToggleSound} aria-pressed={soundOn} aria-label={t(soundOn ? "announcementsOn" : "announcementsOff")}>{soundOn ? <FaVolumeUp /> : <FaVolumeMute />}</button>
          <label><span className="oh-sr-only">{t("volume")}</span><input type="range" min="0" max="1" step="0.05" value={Number(sound.volume ?? 1)} onChange={(event) => view.onVoiceSetting?.("volume", Number(event.target.value))} /></label>
        </div>
        <label className="player-dock-select"><FaMicrophone /><span>{hi ? "आवाज़" : "Voice"}:</span><select aria-label="Announcement language" value={["hi", "hinglish"].includes(sound.speechLang) ? sound.speechLang : "en"} onChange={(event) => view.onVoiceSetting?.("speechLang", event.target.value)}><option value="en">English</option><option value="hi">Hindi</option><option value="hinglish">Hinglish</option></select></label>
        <label className="player-dock-select player-dock-rate"><span>{hi ? "बोलने की गति" : "Speech speed"}:</span><select aria-label={hi ? "बोलने की गति" : "Speech speed"} value={Number(sound.rate ?? 1)} onChange={(event) => view.onVoiceSetting?.("rate", Number(event.target.value))}>{[0.75, 1, 1.25, 1.5].map((rate) => <option value={rate} key={rate}>{rate}×</option>)}</select></label>
        <button type="button" onClick={() => helpDialog.current?.showModal()}><FaInfoCircle /><span>{hi ? "कैसे खेलें" : "How to Play"}</span></button>
        <button type="button" onClick={toggleFullscreen} aria-pressed={fullscreen} aria-label={hi ? "फ़ुलस्क्रीन" : "Fullscreen"}><FaExpand /></button>
        {notice ? <p className="player-dock-notice" role="status">{notice}</p> : null}
      </footer>
      <dialog ref={settingsDialog} className="player-game-dialog" aria-labelledby="player-settings-heading" onClick={closeBackdrop}>
        <div className="player-game-dialog__heading"><h2 id="player-settings-heading">{hi ? "आपकी ऑडियो सेटिंग्स" : "Your audio settings"}</h2><button type="button" onClick={() => settingsDialog.current.close()} aria-label={hi ? "बंद करें" : "Close settings"}><FaTimes /></button></div>
        <VoicePanel sound={sound} voice={{ tone: sound.dead ? "danger" : sound.speech ? "ok" : "muted", label: hi ? "इस डिवाइस पर" : "On this device" }} language={language} onChange={view.onVoiceSetting} onRetry={view.onToggleSpeech} />
      </dialog>
      <dialog ref={helpDialog} className="player-game-dialog" aria-labelledby="player-help-heading" onClick={closeBackdrop}>
        <div className="player-game-dialog__heading"><h2 id="player-help-heading">{hi ? "कैसे खेलें" : "How to Play"}</h2><button type="button" onClick={() => helpDialog.current.close()} aria-label={hi ? "बंद करें" : "Close help"}><FaTimes /></button></div>
        <ol className="player-help-list">
          <li>{hi ? "राउंड शुरू होने से पहले अपने टिकट चुनें। आपके जारी किए गए टिकट नीचे दिखेंगे।" : "Choose your tickets before the round starts. Your issued tickets appear below the caller."}</li>
          <li>{hi ? "होस्ट द्वारा बुलाए गए नंबर बोर्ड और आपके टिकट पर अपने आप चिह्नित होंगे।" : "Watch the caller. Official numbers automatically mark the board and your tickets."}</li>
          <li>{hi ? "इस रूम के लिए निर्धारित जीतने वाले पैटर्न देखें। पैटर्न पूरा होने पर दावा करें। सर्वर हर दावे की जाँच करता है।" : "Check this room’s configured winning patterns. Claim an eligible pattern when it is complete; the server verifies every claim."}</li>
          <li>{hi ? "कनेक्शन टूटने पर इसी डिवाइस से वापस आएँ। स्क्रीन रूम के वास्तविक डेटा से फिर जुड़ती है।" : "If your connection drops, return on this device. The screen reconnects to the room’s official state."}</li>
        </ol>
        <p>{hi ? "ऑडियो सेटिंग्स केवल इस डिवाइस पर लागू होती हैं।" : "Audio preferences apply only to this device. The host controls the room’s calling speed."}</p>
      </dialog>
    </>
  );
}
