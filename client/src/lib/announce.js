/**
 * Announcement integration point — the browser's speech/chime layer.
 *
 * This is a thin adapter over the server-configured Sarvam service, with a
 * strictly language-matched Web Speech fallback:
 *
 *   - Sarvam receives only an authenticated, already-called number/index pair;
 *     the server owns the text, model, speaker and private API key. If that
 *     provider fails, only an installed voice from the selected language may
 *     be used. Hindi and Hinglish never fall back to English.
 *   - `chime` is a tiny synthesised WebAudio blip, again opt-in.
 *
 * Spoken numbers now go through lib/announce-queue.js: one utterance at a
 * time, in call order, never overlapping, never cancelling an in-flight
 * announcement, with a watchdog so a silent or broken engine can never wedge
 * the loop, and a small backlog cap so the voice lags the board by at most two
 * numbers instead of sliding permanently behind. Each device announces for
 * itself; nothing here can change game state or slow the server's clock.
 *
 * Settings persist per device. AudioContext playback is primed from the first
 * trusted interaction to meet browser autoplay rules; a rejected or unavailable
 * voice never affects the board or server-authoritative game state.
 *
 * Nothing here is authoritative about the game. A voice that is slow, silent,
 * missing or dead changes only what this one browser hears; the displayed
 * number, the call history and every player's screen come from the server.
 */

import { createAnnounceQueue } from "./announce-queue.js";
import { buildNumberAnnouncement } from "./number-callouts.js";

const STORE_KEY = "tambola.announce.v1";
const PERSONALITY_PITCH = Object.freeze({ playful: 1.08, friendly: 1 });

/** Spoken numbers are unintelligible outside this range; the UI offers 0.75–1.5. */
export const RATE_MIN = 0.5;
export const RATE_MAX = 2;

export function clampRate(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.round(Math.min(RATE_MAX, Math.max(RATE_MIN, n)) * 100) / 100;
}

export function clampVolume(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;
}

let settings = { speech: true, chime: false, callouts: true, personality: "playful", festival: "classic", speechLang: "en", voiceURI: null, rate: 1, volume: 1 };
let audioCtx = null;
let cachedVoices = [];
const voiceListeners = new Set();
let sarvamStatus = { configured: false, languages: [], model: null, voices: null };
let sarvamDegraded = false;
let sarvamStatusLoaded = typeof window === "undefined";
let resolveSarvamStatus;
const sarvamStatusReady = new Promise((resolve) => { resolveSarvamStatus = resolve; });

function setSarvamDegraded(value) {
  if (sarvamDegraded === Boolean(value)) return;
  sarvamDegraded = Boolean(value);
  voiceListeners.forEach((listener) => listener());
}

if (typeof window !== "undefined") {
  import("../net.js").then(({ SERVER_URL }) => {
    const options = { credentials: "omit", cache: "no-store" };
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") options.signal = AbortSignal.timeout(4000);
    return fetch(`${SERVER_URL}/api/voice/status`, options);
  })
    .then((response) => response.ok ? response.json() : null)
    .then((result) => {
      if (result?.ok) {
        sarvamStatus = {
          configured: Boolean(result.configured),
          languages: Array.isArray(result.languages) ? result.languages : [],
          model: typeof result.model === "string" ? result.model : null,
          voices: result.voices && typeof result.voices === "object" ? result.voices : null,
        };
      }
      sarvamStatusLoaded = true;
      resolveSarvamStatus();
      if (settings.speech && (sarvamStatus.configured || available().speech)) queue.setEnabled(true);
      voiceListeners.forEach((listener) => listener());
    })
    .catch(() => {
      sarvamStatusLoaded = true;
      resolveSarvamStatus();
      if (settings.speech && available().speech) queue.setEnabled(true);
      voiceListeners.forEach((listener) => listener());
    });
} else {
  resolveSarvamStatus();
}

try {
  const raw = typeof localStorage !== "undefined" && localStorage.getItem(STORE_KEY);
  if (raw) {
    const saved = JSON.parse(raw);
    if (saved && typeof saved === "object") {
      settings.speech = saved.speech === undefined ? true : Boolean(saved.speech);
      settings.chime = Boolean(saved.chime);
      settings.callouts = saved.callouts === undefined ? true : Boolean(saved.callouts);
      settings.personality = saved.personality === "friendly" ? "friendly" : "playful";
      settings.festival = typeof saved.festival === "string" && /^[a-z_]{1,32}$/.test(saved.festival) ? saved.festival : "classic";
      // Before the provider selector existed, "hi" represented Romanized
      // Hinglish. Preserve that saved preference; "hi" now means Hindi script.
      settings.speechLang = saved.speechLang === "hi" || saved.speechLang === "hinglish" ? "hinglish"
        : saved.speechLang === "hindi" ? "hi" : "en";
      settings.voiceURI = typeof saved.voiceURI === "string" && saved.voiceURI ? saved.voiceURI : null;
      settings.rate = clampRate(saved.rate);
      settings.volume = clampVolume(saved.volume);
    }
  }
} catch {
  /* private mode / disabled storage: defaults are fine */
}

const save = () => {
  try {
    localStorage?.setItem(STORE_KEY, JSON.stringify(settings));
  } catch {
    /* best effort only */
  }
};

const available = () => ({
  speech: (typeof window !== "undefined" && "speechSynthesis" in window) || sarvamStatus.configured,
  chime:
    typeof window !== "undefined" &&
    ("AudioContext" in window || "webkitAudioContext" in window),
});

function ensureContext() {
  if (audioCtx) return audioCtx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  audioCtx = new Ctor();
  return audioCtx;
}

function playChime() {
  const ctx = ensureContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume?.();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(660, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(990, ctx.currentTime + 0.09);
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.14, ctx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.32);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.34);
}

/** A short rising arpeggio for a confirmed win — opt-in via the same chime. */
function playFanfare() {
  const ctx = ensureContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume?.();
  const t0 = ctx.currentTime;
  [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
    const start = t0 + i * 0.09;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.16, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.26);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.28);
  });
}

// ---------------------------------------------------------------- speech

/**
 * Voice list, refreshed when the browser loads it late (Chrome does). An
 * empty language list is a hard limitation: never silently substitute a
 * voice from another language family.
 */
function refreshVoices() {
  if (!available().speech) return [];
  const before = cachedVoices.map((voice) => `${voice.voiceURI}|${voice.lang}`).join("\n");
  try {
    cachedVoices = window.speechSynthesis.getVoices() || [];
  } catch {
    cachedVoices = [];
  }
  const after = cachedVoices.map((voice) => `${voice.voiceURI}|${voice.lang}`).join("\n");
  if (before !== after) voiceListeners.forEach((listener) => listener());
  return cachedVoices;
}
if (typeof window !== "undefined" && "speechSynthesis" in window) {
  refreshVoices();
  try {
    window.speechSynthesis.addEventListener?.("voiceschanged", refreshVoices);
  } catch {
    /* older engines expose onvoiceschanged only */
    const prev = window.speechSynthesis.onvoiceschanged;
    window.speechSynthesis.onvoiceschanged = (e) => {
      refreshVoices();
      if (typeof prev === "function") prev(e);
    };
  }
}

/**
 * Pick the voice to speak with.
 *
 * A chosen voice is honoured only when the browser still lists it AND it
 * belongs to the language being spoken. There is no cross-language/default
 * fallback: `null` means this device cannot honestly speak this language.
 */
export function matchSpeechVoice(voices, lang, preferredURI = null) {
  const candidates = Array.isArray(voices) ? voices : [];
  const matchesLanguage = (tag) => voiceLanguageMatches(tag, lang);
  if (preferredURI) {
    const chosen = candidates.find(
      (v) => (v.voiceURI === preferredURI || v.name === preferredURI) && matchesLanguage(v.lang)
    );
    if (chosen) return chosen;
  }
  const want = lang === "hi" ? ["hi-IN", "hi"] : ["en-IN", "en-GB", "en-US", "en"];
  for (const tag of want) {
    const exact = candidates.find((v) => v.lang && v.lang.toLowerCase().replace("_", "-") === tag.toLowerCase());
    if (exact) return exact;
  }
  return candidates.find((v) => matchesLanguage(v.lang)) || null;
}

/** Keep the settings panel and audition harness on the same strict language filter. */
export function speechVoicesForLanguage(voices, lang) {
  return (Array.isArray(voices) ? voices : []).filter((voice) => voiceLanguageMatches(voice.lang, lang));
}

function voiceLanguageMatches(tag, lang) {
  const base = lang === "en" ? "en" : "hi";
  return new RegExp(`^${base}(?:-|$)`, "i").test(String(tag || "").replace(/_/g, "-"));
}

function pickVoice(lang, preferredURI = settings.voiceURI) {
  if (!cachedVoices.length) refreshVoices();
  return matchSpeechVoice(cachedVoices, lang, preferredURI);
}

/**
 * Start ONE utterance. The queue guarantees no overlap; this never calls
 * cancel() while something is speaking — that was the original defect.
 * Resolves exactly once with { reason: "natural" | "failed" }.
 */
function speakLocal(text, meta) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  let settled = false;
  let utter;
  try {
    utter = new SpeechSynthesisUtterance(text);
  } catch {
    return { promise: Promise.resolve({ reason: "failed" }) };
  }
  const langTag = meta.lang === "en" ? "en-IN" : "hi-IN";
  const voice = pickVoice(meta.lang === "en" ? "en" : "hi");
  if (!voice) return { promise: Promise.resolve({ reason: "failed" }) };
  if (voice) {
    utter.voice = voice;
    utter.lang = voice.lang || langTag;
  }
  utter.rate = clampRate(settings.rate);
  utter.volume = clampVolume(settings.volume);
  // Give the existing personality control an audible, browser-native effect.
  // Keep the shift subtle: voices differ by OS, and the called number must stay
  // clear before any stylistic change.
  utter.pitch = PERSONALITY_PITCH[settings.personality] ?? 1;
  const promise = new Promise((resolve) => {
    const done = (reason) => {
      if (settled) return;
      settled = true;
      resolve({ reason });
    };
    utter.onend = () => done("natural");
    utter.onerror = () => done("failed");
  });
  try {
    window.speechSynthesis.speak(utter);
  } catch {
    return { promise: Promise.resolve({ reason: "failed" }) };
  }
  return {
    promise,
    kill: () => {
      // Only reached by the queue's watchdog for a stalled utterance.
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* nothing left to stop */
      }
    },
  };
}

function speakSarvam(meta) {
  let settled = false;
  let cancelled = false;
  let source = null;
  let gain = null;
  let localHandle = null;
  let localUtteranceText = "";
  let resolvePromise;
  const promise = new Promise((resolve) => { resolvePromise = resolve; });
  const finish = (reason) => {
    if (settled) return;
    settled = true;
    resolvePromise({ reason });
  };
  const handle = {
    promise,
    kill() {
      cancelled = true;
      try { source?.stop(); } catch { /* source may have ended */ }
      try { localHandle?.kill?.(); } catch { /* voice may have ended */ }
      finish("stopped");
    },
  };

  (async () => {
    await sarvamStatusReady;
    if (cancelled) return;
    let result = { ok: false };
    if (sarvamStatus.configured) {
      try {
        const { call } = await import("../net.js");
        result = await call("voice:audio", {
          number: meta.number,
          index: meta.seq,
          language: meta.lang,
          includeCallout: settings.callouts,
          festival: settings.festival,
        }, 25_000);
      } catch { result = { ok: false }; }
    }
    if (cancelled) return;
    if (result?.ok && typeof result.audio === "string") {
      try {
        const bytes = Uint8Array.from(atob(result.audio), (char) => char.charCodeAt(0));
        const ctx = ensureContext();
        if (!ctx) throw new Error("audio context unavailable");
        if (ctx.state === "suspended") await ctx.resume();
        const decoded = await ctx.decodeAudioData(bytes.buffer.slice(0));
        if (cancelled) return;
        source = ctx.createBufferSource();
        gain = ctx.createGain();
        source.buffer = decoded;
        source.playbackRate.value = clampRate(settings.rate);
        gain.gain.value = clampVolume(settings.volume);
        source.connect(gain).connect(ctx.destination);
        source.onended = () => finish("natural");
        source.start();
        setSarvamDegraded(false);
        return;
      } catch { /* continue with a strictly language-matched browser voice */ }
    }
    if (sarvamStatus.configured) setSarvamDegraded(true);
    if (cancelled) return;
    const voice = pickVoice(meta.lang === "en" ? "en" : "hi");
    if (!voice) return finish("failed");
    localUtteranceText = meta.text;
    localHandle = speakLocal(localUtteranceText, meta);
    if (!localHandle) return finish("failed");
    localHandle.promise.then((outcome) => finish(outcome?.reason === "natural" ? "natural" : "failed"));
  })().catch(() => finish("failed"));
  return handle;
}

function speakOne(text, meta) {
  return speakSarvam({ ...meta, text });
}

const queue = createAnnounceQueue({
  speak: speakOne,
  language: () => settings.speechLang,
  rate: () => settings.rate,
  toWords: (n, lang, seq) => {
    return buildNumberAnnouncement(n, {
      language: lang === "hi" ? "hindi" : lang,
      callIndex: seq,
      festival: settings.festival,
      personality: settings.personality,
      includeCallout: settings.callouts,
    });
  },
  onStart: () => {
    // the chime rides WITH its utterance, so sound and voice stay together
    if (settings.chime && available().chime) {
      try {
        playChime();
      } catch {
        /* audio can be blocked; the visual reveal already happened */
      }
    }
  },
});

// Voice previews share the browser speech engine with live calls. Keep samples
// outside the official sequence and interrupt one as soon as a real call lands.
let previewHandle = null;
function stopVoicePreview() {
  const handle = previewHandle;
  previewHandle = null;
  try { handle?.kill?.(); } catch { /* browser audio may already be gone */ }
}

// The stored preference must actually ENGAGE the queue: without this a reload
// leaves the chip saying VOICE while the queue is disabled and nothing is ever
// announced. If this document has no gesture yet the browser refuses the first
// utterance, the queue reports itself dead and the chip offers RETRY — one tap.
queue.setEnabled(settings.speech && (sarvamStatus.configured || available().speech || !sarvamStatusLoaded));

// Start/retry browser audio from the first trusted interaction. This lets new
// users keep voice enabled by default without pretending autoplay is allowed.
if (typeof document !== "undefined") {
  const unlock = () => {
    try { window.speechSynthesis?.resume?.(); } catch { /* browser may not expose resume */ }
    try { ensureContext()?.resume?.(); } catch { /* user activation may be required */ }
    if (settings.speech && queue.isDead()) queue.setEnabled(true);
  };
  document.addEventListener("pointerdown", unlock, { once: true, passive: true });
  document.addEventListener("keydown", unlock, { once: true });
}

// A tab hidden with the screen locked pauses/loses speech in some browsers;
// on returning, drop the (possibly stale) backlog instead of reading the last
// three numbers out loud late. The board remains the truth either way.
if (typeof document !== "undefined") {
  document.addEventListener?.("visibilitychange", () => {
    if (document.visibilityState === "hidden") { stopVoicePreview(); queue.stop(); }
  });
}

/**
 * Announce a freshly called number. `number` and `seq` come from the server's
 * `number:called` event (seq = the official call index); nothing here generates
 * or predicts one. Duplicate deliveries and old seqs are ignored by the queue.
 */
export function announce(number, seq) {
  stopVoicePreview();
  return queue.enqueue(number, seq);
}

/** Remember what this page has already seen, so a reload never replays history. */
export function seedAnnouncements(seq) {
  queue.markSeen(seq);
}

/** Stop the voice now (pause/end/unmount/tab hidden). Keeps the replay guard. */
export function stopAnnouncements() {
  stopVoicePreview();
  queue.stop();
}

/** New round: forget the call-index guard and any backlog. */
export function resetAnnouncements() {
  stopVoicePreview();
  queue.reset();
}

/**
 * Play the win fanfare for a CONFIRMED, server-verified celebration. Uses the
 * same opt-in `chime` switch as number announcements — no separate autoplay
 * surface, no sound unless the visitor already turned audio on.
 */
export function celebrateSound() {
  if (settings.chime && available().chime) {
    try {
      playFanfare();
    } catch {
      /* audio can be blocked; the visual celebration still happens */
    }
  }
}

export function getAnnounceSettings() {
  return {
    ...settings,
    available: available(),
    voiceSupport: voiceSupport(settings.speechLang),
    pending: queue.pendingCount(),
    speaking: queue.speakNow(),
    dead: queue.isDead(),
    enabled: queue.isEnabled(),
  };
}

/**
 * The voice the server will actually use for this language, straight from the
 * provider status. The panel used to print a hard-coded model and speaker name,
 * which quietly went stale when the server moved to another voice - a host was
 * told one thing and heard another. Nothing is named here that the server did
 * not report.
 */
export function providerVoiceLabel(status = sarvamStatus, lang = settings.speechLang) {
  const speaker = status?.voices?.[lang]?.speaker;
  if (!status?.model && !speaker) return null;
  return [status.model, speaker].filter(Boolean).join(" · ");
}

/**
 * What this browser can actually do for a language, so the console can say
 * "no Hindi voice here" instead of silently reading English. A missing chosen
 * voice never falls back across language families.
 */
export function voiceSupport(lang = settings.speechLang) {
  const provider = sarvamStatus.configured && !sarvamDegraded && sarvamStatus.languages.includes(lang);
  const voices = listSpeechVoices(lang);
  const savedVoiceMissing = Boolean(
    settings.voiceURI && !listSpeechVoices(lang).some((v) => v.uri === settings.voiceURI)
  );
  return {
    engine: available().speech,
    voices: voices.length,
    provider,
    providerLabel: provider ? providerVoiceLabel(sarvamStatus, lang) : null,
    degraded: sarvamStatus.configured && sarvamDegraded,
    supported: provider || voices.length > 0,
    lang,
    savedVoiceMissing,
    selected: settings.voiceURI,
  };
}

/**
 * Say the current number again, on the host's explicit request. Returns false
 * when there is no voice to say it with, or when that number is already being
 * spoken — a repeat must not become a stutter.
 */
export function repeatAnnouncement(number) {
  return queue.replay(number);
}

/** Count of announcements waiting behind the current one (for the UI). */
export function getAnnouncePending() {
  return queue.pendingCount();
}

/** Subscribe to pending-count changes; returns an unsubscribe. */
export function onAnnouncePending(fn) {
  return queue.subscribe(fn);
}

/** Voices for the requested language (an empty list means speech is unavailable). */
export function listSpeechVoices(lang = settings.speechLang) {
  refreshVoices();
  const voices = speechVoicesForLanguage(cachedVoices, lang);
  const preferred = matchSpeechVoice(voices, lang, settings.voiceURI);
  const ordered = preferred ? [preferred, ...voices.filter((voice) => voice !== preferred)] : voices;
  return ordered
    .map((v) => ({ name: v.name, lang: v.lang, uri: v.voiceURI || v.name, local: v.localService !== false }));
}

/** Subscribe to asynchronous system/browser voice inventory changes. */
export function onSpeechVoicesChanged(listener) {
  if (typeof listener !== "function") return () => {};
  voiceListeners.add(listener);
  return () => voiceListeners.delete(listener);
}

/** Speak a short sample with current local preferences without touching the
 * official call sequence. A new server call stops the sample before its
 * announcement enters the normal ordered queue. */
export function previewVoice() {
  if (!available().speech || queue.speakNow() != null || queue.pendingCount() > 0) return null;
  if (!pickVoice(settings.speechLang === "en" ? "en" : "hi")) return null;
  stopVoicePreview();
  const text = buildNumberAnnouncement(42, {
    language: settings.speechLang === "hi" ? "hindi" : settings.speechLang,
    callIndex: 42,
    festival: settings.festival,
    personality: settings.personality,
    includeCallout: settings.callouts,
  });
  const handle = speakLocal(text, { number: 42, lang: settings.speechLang });
  if (!handle) return null;
  previewHandle = handle;
  return handle.promise.then((result) => {
    if (previewHandle === handle) previewHandle = null;
    return result?.reason === "natural";
  });
}

/** Toggle one setting. Returns the new settings (with availability flags). */
export function setAnnounceSetting(key, value) {
  stopVoicePreview();
  if (key === "speech") {
    settings.speech = Boolean(value);
    if (!available().speech) settings.speech = false;
    queue.setEnabled(settings.speech);
    if (settings.speech) {
      try { window.speechSynthesis?.resume?.(); } catch { /* browser may block until a later gesture */ }
    }
    save();
  } else if (key === "chime") {
    settings.chime = Boolean(value);
    save();
  } else if (key === "callouts") {
    settings.callouts = Boolean(value);
    save();
  } else if (key === "personality") {
    settings.personality = value === "friendly" ? "friendly" : "playful";
    save();
  } else if (key === "festival") {
    settings.festival = typeof value === "string" && /^[a-z_]{1,32}$/.test(value) ? value : "classic";
    save();
  } else if (key === "speechLang") {
    settings.speechLang = ["en", "hi", "hinglish"].includes(value) ? value : "en";
    // changing language mid-utterance: stop what is playing, keep the order
    queue.stop();
    save();
  } else if (key === "voiceURI") {
    settings.voiceURI = typeof value === "string" && value ? value : null;
    // the next utterance uses the new voice; the current one finishes
    save();
  } else if (key === "rate") {
    settings.rate = clampRate(value);
    save();
  } else if (key === "volume") {
    settings.volume = clampVolume(value);
    save();
  }
  return getAnnounceSettings();
}
