import { useEffect, useMemo, useState } from "react";
import { getNumberCallout } from "../../lib/number-callouts.js";
import { speakWord } from "../../lib/number-words.js";
import { matchSpeechVoice, speechVoicesForLanguage } from "../../lib/announce.js";

const SAMPLE_NUMBERS = [1, 7, 11, 27, 44, 55, 77, 90];

/** Development-only manual audit surface. Speech starts only from its Play click. */
export default function VoiceAudition() {
  const [language, setLanguage] = useState("en");
  const [voiceInventory, setVoiceInventory] = useState({ language: "en", voices: [] });
  const voices = useMemo(() => voiceInventory.language === language ? voiceInventory.voices : [], [voiceInventory, language]);
  const [voiceURI, setVoiceURI] = useState("");
  const [events, setEvents] = useState([]);
  const [active, setActive] = useState(null);
  const [status, setStatus] = useState("Ready; choose Play to grant a trusted user gesture.");
  const [selectedNumber, setSelectedNumber] = useState(1);
  const [completedSample, setCompletedSample] = useState(null);
  const selectedVoice = useMemo(() => voices.find((voice) => (voice.voiceURI || voice.name) === voiceURI) || null, [voices, voiceURI]);

  useEffect(() => {
    if (!window.speechSynthesis) return undefined;
    const refresh = () => {
      const matching = speechVoicesForLanguage(window.speechSynthesis.getVoices(), language);
      setVoiceInventory({ language, voices: matching });
      setVoiceURI((current) => matching.some((voice) => (voice.voiceURI || voice.name) === current)
        ? current
        : (matchSpeechVoice(matching, language)?.voiceURI || matchSpeechVoice(matching, language)?.name || ""));
    };
    refresh();
    window.speechSynthesis.addEventListener?.("voiceschanged", refresh);
    const timer = setTimeout(refresh, 800);
    return () => {
      clearTimeout(timer);
      window.speechSynthesis.removeEventListener?.("voiceschanged", refresh);
    };
  }, [language]);

  useEffect(() => () => {
    try { window.speechSynthesis?.cancel(); } catch { /* no-op */ }
  }, []);

  const addEvent = (record) => setEvents((previous) => [{ at: new Date().toISOString(), ...record }, ...previous].slice(0, 100));
  function switchLanguage(next) {
    if (next === language) return;
    addEvent({ event: "language_switch", from: language, to: next });
    stop();
    setCompletedSample(null);
    setLanguage(next);
    setStatus(`Language switched to ${next === "hi" ? "Hindi / Romanized Hinglish" : "English"}.`);
  }
  function stop() {
    if (active) addEvent({ number: active.number, language, event: "stop_requested", voice: selectedVoice ? `${selectedVoice.name} (${selectedVoice.lang})` : null });
    window.speechSynthesis?.cancel();
    setActive(null);
    setCompletedSample(null);
    setStatus("Stopped.");
  }
  function play(number) {
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      setStatus("SpeechSynthesis is unavailable in this browser.");
      addEvent({ number, language, event: "unavailable", error: "SpeechSynthesis API missing" });
      return;
    }
    const chosenVoice = selectedVoice && matchSpeechVoice([selectedVoice], language, voiceURI);
    if (!chosenVoice) {
      setStatus(`No ${language === "hi" ? "Hindi" : "English"}-language voice is listed. Nothing was played.`);
      addEvent({ number, language, event: "not_played", error: "No language-matched voice" });
      return;
    }
    window.speechSynthesis.cancel();
    setCompletedSample(null);
    const utterance = new SpeechSynthesisUtterance(`${speakWord(number, language)}. ${getNumberCallout(number, { language })}`);
    utterance.voice = chosenVoice;
    utterance.lang = chosenVoice.lang;
    utterance.rate = language === "hi" ? 0.86 : 0.94;
    utterance.pitch = language === "hi" ? 1.04 : 1.1;
    utterance.volume = 1;
    setActive({ number, utterance });
    setStatus(`Speaking ${number} with ${chosenVoice.name} (${chosenVoice.lang})…`);
    const meta = { number, language, voiceName: chosenVoice.name, voiceLang: chosenVoice.lang, voiceURI: chosenVoice.voiceURI || chosenVoice.name, local: chosenVoice.localService, text: utterance.text };
    addEvent({ ...meta, event: "queued" });
    utterance.onstart = () => { addEvent({ ...meta, event: "start" }); setStatus(`Speech started for ${number}. Listen for accurate number and natural delivery.`); };
    utterance.onend = (event) => { addEvent({ ...meta, event: "end", elapsedTime: event.elapsedTime }); setStatus(`Speech ended for ${number}. Verify the number and pronunciation by listening.`); setCompletedSample(meta); setActive(null); };
    utterance.onerror = (event) => { addEvent({ ...meta, event: "error", error: event.error }); setStatus(`Speech failed: ${event.error || "unknown error"}`); setCompletedSample(null); setActive(null); };
    try { window.speechSynthesis.speak(utterance); }
    catch (error) { addEvent({ ...meta, event: "error", error: String(error) }); setStatus(`Speech failed: ${String(error)}`); setActive(null); }
  }

  return <main style={{ maxWidth: 980, margin: "32px auto", padding: 24, color: "#fff", background: "#21152e", borderRadius: 20 }}>
    <h1>Internal voice audition</h1>
    <p>Development-only manual test. Browser speech is local and voice quality must be judged by listening. “end” means synthesis ended, not that pronunciation was correct.</p>
    <p><strong>Browser:</strong> {navigator.userAgent}</p>
    <label>Speech language <select value={language} onChange={(event) => switchLanguage(event.target.value)}><option value="en">English</option><option value="hi">Hindi / Romanized Hinglish</option></select></label>
    <p><strong>Available voices:</strong> {voices.length ? voices.map((voice) => `${voice.name} · ${voice.lang}`).join("; ") : `No ${language === "hi" ? "Hindi" : "English"} voice listed`}</p>
    {language === "hi" && voices.length === 0 ? <p role="note">Windows voice setup: try Settings → Time &amp; language → Speech → Manage voices → Add voices and check whether Hindi (India) is offered. Narrator settings also links to Add legacy voices. This PC reports Home Single Language; its language-pack restrictions may apply. A Hindi keyboard/profile entry alone does not install a TTS voice. Restart Chrome and return here to check the browser’s actual voice list.</p> : null}
    <label>Selected voice <select value={voiceURI} onChange={(event) => setVoiceURI(event.target.value)} disabled={!voices.length}>{voices.map((voice) => <option value={voice.voiceURI || voice.name} key={voice.voiceURI || voice.name}>{voice.name} · {voice.lang} · {voice.localService ? "local" : "remote"}</option>)}</select></label>
    <p role="status" aria-live="polite">{status}</p>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>{SAMPLE_NUMBERS.map((number) => <button key={number} type="button" onClick={() => { setSelectedNumber(number); play(number); }}>Play {number}</button>)} <button type="button" onClick={stop} disabled={!active}>Stop</button></div>
    <label style={{ display: "block", marginTop: 16 }}>Sample number <select value={selectedNumber} onChange={(event) => setSelectedNumber(Number(event.target.value))}>{SAMPLE_NUMBERS.map((number) => <option value={number} key={number}>{number}</option>)}</select></label>
    <h2>Callout preview</h2><p><strong>Number:</strong> {selectedNumber} · <strong>spoken form:</strong> {speakWord(selectedNumber, language)}</p><p>{getNumberCallout(selectedNumber, { language })}</p>
    {completedSample ? <section aria-label="Manual listening verification"><h2>Listener verification · {completedSample.number} · {completedSample.language === "hi" ? "Hindi" : "English"}</h2><p>After listening to the completed sample, record whether the number was correct and how natural the delivery sounded. This is a human listening judgement; browser events cannot prove pronunciation.</p><button type="button" onClick={() => addEvent({ ...completedSample, event: "listener_judgement", numberCorrect: true, naturalness: "natural_and_clear" })}>Correct number · natural and clear</button> <button type="button" onClick={() => addEvent({ ...completedSample, event: "listener_judgement", numberCorrect: false, naturalness: "mispronounced_or_unclear" })}>Wrong number or unclear</button> <button type="button" onClick={() => addEvent({ ...completedSample, event: "listener_judgement", numberCorrect: true, naturalness: "robotic_or_unnatural" })}>Correct number · robotic or unnatural</button></section> : null}
    <h2>Audition log</h2><button type="button" onClick={() => setEvents([])}>Clear log</button><pre style={{ whiteSpace: "pre-wrap", maxHeight: 360, overflow: "auto" }}>{JSON.stringify(events, null, 2)}</pre>
  </main>;
}
