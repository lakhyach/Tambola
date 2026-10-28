/**
 * Announcement integration point.
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
 * The server still owns every number; this module only reacts to the reveal a
 * client has already been shown. Turning it on/off has zero effect on gameplay.
 */

let settings = { speech: false, chime: false };
let audioCtx = null;

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

/**
 * Announce a freshly called number. `number` comes from the server snapshot;
 * nothing here generates or predicts one.
 */
export function announce(number) {
  if (number == null) return;
  if (settings.chime && available().chime) {
    try {
      playChime();
    } catch {
      /* audio can be blocked; the visual reveal already happened */
    }
  }
  if (settings.speech && available().speech) {
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(String(number));
      utter.rate = 1;
      utter.pitch = 1;
      window.speechSynthesis.speak(utter);
    } catch {
      /* speech is a nicety, never a requirement */
    }
  }
}

export function getAnnounceSettings() {
  return { ...settings, available: available() };
}

/** Toggle one channel. Returns the new settings (with availability flags). */
export function setAnnounceSetting(key, value) {
  if (key in settings) settings[key] = Boolean(value);
  if (!available().speech) settings.speech = false;
  return getAnnounceSettings();
}
