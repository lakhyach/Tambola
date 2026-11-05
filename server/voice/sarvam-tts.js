import { buildNumberAnnouncement, CALLER_FESTIVALS, SARVAM_CALLOUTS } from "../../client/src/lib/number-callouts.js";
import { speakWord } from "../../client/src/lib/number-words.js";

export const SARVAM_MODEL = "bulbul:v3";
export { CALLER_FESTIVALS };
export const SARVAM_VOICES = Object.freeze({
  en: Object.freeze({ languageCode: "en-IN", speaker: "ratan" }),
  hi: Object.freeze({ languageCode: "hi-IN", speaker: "shubh" }),
  hinglish: Object.freeze({ languageCode: "hi-IN", speaker: "simran" }),
});
// What the status endpoint is allowed to publish: the public Sarvam voice names
// per language, and nothing that could identify an account.
export const SARVAM_VOICE_CATALOG = Object.freeze(Object.fromEntries(
  Object.entries(SARVAM_VOICES).map(([id, voice]) => [id, Object.freeze({ speaker: voice.speaker, languageCode: voice.languageCode })]),
));
export const AUDITIONED_CALLOUTS = Object.freeze({
  en: SARVAM_CALLOUTS.en,
  hi: SARVAM_CALLOUTS.hindi,
  hinglish: SARVAM_CALLOUTS.hinglish,
});

export function buildSarvamAnnouncement(number, { language = "en", includeCallout = true, festival = "classic" } = {}) {
  if (!Number.isInteger(number) || number < 1 || number > 90) return "";
  const selected = Object.hasOwn(SARVAM_VOICES, language) ? language : "en";
  const calloutLanguage = selected === "hi" ? "hindi" : selected;
  if (includeCallout && SARVAM_CALLOUTS[calloutLanguage]?.[number]) return SARVAM_CALLOUTS[calloutLanguage][number];
  if (selected === "hi") return String(number); // hi-IN preprocessing speaks the digit in Hindi.
  if (!includeCallout) return speakWord(number, selected === "hinglish" ? "hi" : "en");
  return buildNumberAnnouncement(number, {
    language: selected === "hinglish" ? "hi" : "en",
    festival,
    includeCallout: true,
  });
}

export function sarvamCacheKey({ text, language }) {
  const selected = SARVAM_VOICES[language];
  if (!selected || typeof text !== "string" || !text) return null;
  return JSON.stringify({
    language,
    model: SARVAM_MODEL,
    speaker: selected.speaker,
    languageCode: selected.languageCode,
    pace: 1,
    temperature: 0.6,
    enablePreprocessing: true,
    speechSampleRate: 24000,
    outputAudioCodec: "wav",
    text,
  });
}

function validPcmWav(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44
    || buffer.subarray(0, 4).toString("ascii") !== "RIFF"
    || buffer.subarray(8, 12).toString("ascii") !== "WAVE") return false;
  const formatAt = buffer.indexOf(Buffer.from("fmt "));
  const dataAt = buffer.indexOf(Buffer.from("data"));
  if (formatAt < 12 || dataAt < formatAt + 24 || formatAt + 24 > buffer.length || dataAt + 8 > buffer.length) return false;
  const formatSize = buffer.readUInt32LE(formatAt + 4);
  const dataSize = buffer.readUInt32LE(dataAt + 4);
  return formatSize >= 16
    && buffer.readUInt16LE(formatAt + 8) === 1
    && buffer.readUInt16LE(formatAt + 10) === 1
    && buffer.readUInt32LE(formatAt + 12) === 24000
    && buffer.readUInt16LE(formatAt + 22) === 16
    && dataSize > 0
    && dataAt + 8 + dataSize <= buffer.length;
}

export function createSarvamTtsService({
  apiKey = process.env.SARVAM_API_KEY || "",
  fetchImpl = globalThis.fetch,
  timeoutMs = 20_000,
  maxCacheBytes = 64 * 1024 * 1024,
} = {}) {
  apiKey = typeof apiKey === "string" ? apiKey.trim() : "";
  const cache = new Map();
  const inFlight = new Map();
  let cacheBytes = 0;
  let requests = 0;

  async function generate({ text, language }) {
    const key = sarvamCacheKey({ text, language });
    if (!key) return { ok: false, code: "VOICE_UNSUPPORTED" };
    if (!apiKey) return { ok: false, code: "VOICE_UNAVAILABLE" };
    if (cache.has(key)) {
      const hit = cache.get(key);
      cache.delete(key);
      cache.set(key, hit);
      return { ok: true, audio: hit, cache: "hit" };
    }
    if (inFlight.has(key)) return { ...(await inFlight.get(key)), cache: "shared" };

    const promise = (async () => {
      const voice = SARVAM_VOICES[language];
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const startedAt = performance.now();
      requests += 1;
      try {
        const response = await fetchImpl("https://api.sarvam.ai/text-to-speech", {
          method: "POST",
          headers: { "api-subscription-key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            model: SARVAM_MODEL,
            language_code: voice.languageCode,
            speaker: voice.speaker,
            speech_sample_rate: 24000,
            output_audio_codec: "wav",
            enable_preprocessing: true,
            pace: 1,
            temperature: 0.6,
          }),
          signal: controller.signal,
        });
        if (!response?.ok) return { ok: false, code: "VOICE_PROVIDER_ERROR", latencyMs: Math.round(performance.now() - startedAt) };
        const payload = await response.json();
        const encoded = Array.isArray(payload?.audios) ? payload.audios[0] : "";
        if (typeof encoded !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return { ok: false, code: "VOICE_INVALID_AUDIO" };
        const audio = Buffer.from(encoded, "base64");
        if (!validPcmWav(audio) || audio.length > 1_000_000) return { ok: false, code: "VOICE_INVALID_AUDIO" };
        const copy = Buffer.from(audio);
        cache.set(key, copy);
        cacheBytes += copy.length;
        while (cacheBytes > maxCacheBytes && cache.size > 1) {
          const oldestKey = cache.keys().next().value;
          const oldest = cache.get(oldestKey);
          cache.delete(oldestKey);
          cacheBytes -= oldest.length;
        }
        return { ok: true, audio: copy, cache: "miss", latencyMs: Math.round(performance.now() - startedAt) };
      } catch (error) {
        return { ok: false, code: error?.name === "AbortError" ? "VOICE_TIMEOUT" : "VOICE_PROVIDER_ERROR" };
      } finally {
        clearTimeout(timeout);
      }
    })();
    inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      inFlight.delete(key);
    }
  }

  return {
    generate,
    // The client must be able to tell the host which voice is actually going to
    // speak, so the model and speaker travel with the status instead of being
    // guessed in the UI. Speaker ids and language codes are public Sarvam names;
    // the api key never appears here.
    status: () => ({
      configured: Boolean(apiKey),
      languages: Object.keys(SARVAM_VOICES),
      model: SARVAM_MODEL,
      voices: SARVAM_VOICE_CATALOG,
    }),
    stats: () => ({ requests, cacheEntries: cache.size, cacheBytes, inFlight: inFlight.size }),
  };
}
