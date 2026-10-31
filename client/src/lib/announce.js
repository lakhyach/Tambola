/**
 * Announcement integration point — the browser's speech/chime layer.
 *
 * This is deliberately a *thin, honest* adapter over whatever the visitor's own
 * browser already provides. It adds NO external service and never claims a
 * spoken call happened when it did not:
 *
 *   - `speech` uses the browser's built-in Web Speech API only when it exists
 *     AND the visitor has switched it on (which is always a user gesture, so it
 *     dodges autoplay policy). If the engine is missing, enabling does nothing
 *     audible and we say so.
 *   - `chime` is a tiny synthesised WebAudio blip, again opt-in.
 *
 * Spoken numbers now go through lib/announce-queue.js: one utterance at a
 * time, in call order, never overlapping, never cancelling an in-flight
 * announcement, with a watchdog so a silent or broken engine can never wedge
 * the loop, and a small backlog cap so the voice lags the board by at most two
 * numbers instead of sliding permanently behind. Each device announces for
 * itself; nothing here can change game state or slow the server's clock.
 *
 * Settings (speech on/off, chime on/off, voice language) persist per device
 * in localStorage — speech still only ever STARTS after a user gesture in this
 * session, because the browser's autoplay policy demands it and the toggle is
 * that gesture.
 */

import { createAnnounceQueue } from "./announce-queue.js";
import { speakWord } from "./number-words.js";

const STORE_KEY = "tambola.announce.v1";

let settings = { speech: false, chime: false, speechLang: "en" };
let audioCtx = null;
let cachedVoices = [];

try {
  const raw = typeof localStorage !== "undefined" && localStorage.getItem(STORE_KEY);
  if (raw) {
    const saved = JSON.parse(raw);
    if (saved && typeof saved === "object") {
      settings.speech = Boolean(saved.speech);
      settings.chime = Boolean(saved.chime);
      settings.speechLang = saved.speechLang === "hi" ? "hi" : "en";
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
  speech: typeof window !== "undefined" && "speechSynthesis" in window,
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
 * Voice list, refreshed when the browser loads it late (Chrome does). A
 * missing list is not an error: the utterance falls back to the default voice.
 */
function refreshVoices() {
  if (!available().speech) return [];
  try {
    cachedVoices = window.speechSynthesis.getVoices() || [];
  } catch {
    cachedVoices = [];
  }
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

/** Pick the best available voice for a language; null means "engine default". */
function pickVoice(lang) {
  if (!cachedVoices.length) refreshVoices();
  const want = lang === "hi" ? ["hi-IN", "hi"] : ["en-IN", "en-GB", "en-US", "en"];
  for (const tag of want) {
    const exact = cachedVoices.find((v) => v.lang && v.lang.toLowerCase().replace("_", "-") === tag.toLowerCase());
    if (exact) return exact;
  }
  const family = lang === "hi" ? /^hi/i : /^en/i;
  return cachedVoices.find((v) => v.lang && family.test(v.lang)) || null;
}

/**
 * Start ONE utterance. The queue guarantees no overlap; this never calls
 * cancel() while something is speaking — that was the original defect.
 * Resolves exactly once with { reason: "natural" | "failed" }.
 */
function speakOne(text, meta) {
  if (!available().speech) return null;
  let settled = false;
  const utter = new SpeechSynthesisUtterance(text);
  const langTag = meta.lang === "hi" ? "hi-IN" : "en-IN";
  const voice = pickVoice(meta.lang);
  if (voice) {
    utter.voice = voice;
    utter.lang = voice.lang || langTag;
  } else {
    utter.lang = langTag; // graceful: engine decides with the tag alone
  }
  utter.rate = 1;
  utter.pitch = 1;
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

const queue = createAnnounceQueue({
  speak: speakOne,
  language: () => settings.speechLang,
  toWords: (n, lang) => speakWord(n, lang),
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

// The stored preference must actually ENGAGE the queue: without this a reload
// leaves the chip saying VOICE while the queue is disabled and nothing is ever
// announced. If this document has no gesture yet the browser refuses the first
// utterance, the queue reports itself dead and the chip offers RETRY — one tap.
queue.setEnabled(settings.speech && available().speech);

// A tab hidden with the screen locked pauses/loses speech in some browsers;
// on returning, drop the (possibly stale) backlog instead of reading the last
// three numbers out loud late. The board remains the truth either way.
if (typeof document !== "undefined") {
  document.addEventListener?.("visibilitychange", () => {
    if (document.visibilityState === "hidden") queue.stop();
  });
}

/**
 * Announce a freshly called number. `number` and `seq` come from the server's
 * `number:called` event (seq = the official call index); nothing here generates
 * or predicts one. Duplicate deliveries and old seqs are ignored by the queue.
 */
export function announce(number, seq) {
  return queue.enqueue(number, seq);
}

/** Remember what this page has already seen, so a reload never replays history. */
export function seedAnnouncements(seq) {
  queue.markSeen(seq);
}

/** Stop the voice now (pause/end/unmount/tab hidden). Keeps the replay guard. */
export function stopAnnouncements() {
  queue.stop();
}

/** New round: forget the call-index guard and any backlog. */
export function resetAnnouncements() {
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
  return { ...settings, available: available(), pending: queue.pendingCount(), dead: queue.isDead() };
}

/** Count of announcements waiting behind the current one (for the UI). */
export function getAnnouncePending() {
  return queue.pendingCount();
}

/** Subscribe to pending-count changes; returns an unsubscribe. */
export function onAnnouncePending(fn) {
  return queue.subscribe(fn);
}

/** Voices for the current speech language (may be empty: engine default then). */
export function listSpeechVoices(lang = settings.speechLang) {
  refreshVoices();
  const family = lang === "hi" ? /^hi/i : /^en/i;
  return cachedVoices.filter((v) => v.lang && family.test(v.lang)).map((v) => ({ name: v.name, lang: v.lang }));
}

/** Toggle one setting. Returns the new settings (with availability flags). */
export function setAnnounceSetting(key, value) {
  if (key === "speech") {
    settings.speech = Boolean(value);
    if (!available().speech) settings.speech = false;
    queue.setEnabled(settings.speech);
    save();
  } else if (key === "chime") {
    settings.chime = Boolean(value);
    save();
  } else if (key === "speechLang") {
    settings.speechLang = value === "hi" ? "hi" : "en";
    // changing language mid-utterance: stop what is playing, keep the order
    queue.stop();
    save();
  }
  return getAnnounceSettings();
}
