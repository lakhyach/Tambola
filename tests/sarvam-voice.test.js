import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { io as connectClient } from "socket.io-client";
import { createApp } from "../server/index.js";
import {
  AUDITIONED_CALLOUTS,
  SARVAM_MODEL,
  SARVAM_VOICES,
  buildSarvamAnnouncement,
  createSarvamTtsService,
  sarvamCacheKey,
} from "../server/voice/sarvam-tts.js";

function sampleWav() {
  const data = Buffer.alloc(48);
  data.write("RIFF", 0, "ascii");
  data.writeUInt32LE(data.length - 8, 4);
  data.write("WAVEfmt ", 8, "ascii");
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(24000, 24);
  data.writeUInt32LE(48000, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36, "ascii");
  data.writeUInt32LE(4, 40);
  return data;
}

const responseWithAudio = (audio = sampleWav()) => ({
  ok: true,
  json: async () => ({ audios: [audio.toString("base64")] }),
});

test("reviewed callout text and configured Bulbul v3 speakers match the voice contract", () => {
  assert.deepEqual(Object.keys(AUDITIONED_CALLOUTS.en).map(Number), [1, 7, 11, 27, 44, 55, 77, 90]);
  assert.deepEqual(Object.keys(AUDITIONED_CALLOUTS.hi).map(Number), [1, 7, 11, 27, 44, 55, 77, 90]);
  assert.deepEqual(Object.keys(AUDITIONED_CALLOUTS.hinglish).map(Number), [1, 7, 11, 27, 44, 55, 77, 90]);
  assert.equal(AUDITIONED_CALLOUTS.en[1], "Number one! The game woke up; even the chai sat up straight.");
  assert.equal(AUDITIONED_CALLOUTS.hi[90], "नब्बे नंबर! आख़िरी पुकार, मामा जी की टिकट जाँच अभी भी जारी!");
  assert.equal(AUDITIONED_CALLOUTS.hinglish[55], "Pachpan number! Double five aaya, luck bhi filmi andaaz mein!");
  assert.equal(SARVAM_MODEL, "bulbul:v3");
  assert.deepEqual(SARVAM_VOICES, {
    en: { languageCode: "en-IN", speaker: "ratan" },
    hi: { languageCode: "hi-IN", speaker: "shubh" },
    hinglish: { languageCode: "hi-IN", speaker: "simran" },
  });
  assert.equal(buildSarvamAnnouncement(7, { language: "en" }), AUDITIONED_CALLOUTS.en[7]);
  assert.equal(buildSarvamAnnouncement(7, { language: "hi" }), AUDITIONED_CALLOUTS.hi[7]);
  assert.equal(buildSarvamAnnouncement(7, { language: "hinglish" }), AUDITIONED_CALLOUTS.hinglish[7]);
  assert.equal(buildSarvamAnnouncement(46, { language: "en" }), "Forty-six entered without a plot twist. The room has requested a refund.");
  assert.equal(buildSarvamAnnouncement(46, { language: "hinglish" }), "Chhiyalis ke baad kambal ne officially ghar ka lease le liya.");
  assert.equal(buildSarvamAnnouncement(46, { language: "hi" }), "46");
});

test("the panel names the voice the server will really use instead of a hard-coded label", async () => {
  const service = createSarvamTtsService({ apiKey: "key-for-shape", fetchImpl: async () => responseWithAudio() });
  const status = service.status();
  assert.equal(status.model, SARVAM_MODEL, "status reports the model that is actually called");
  assert.deepEqual(status.voices, {
    en: { speaker: "ratan", languageCode: "en-IN" },
    hi: { speaker: "shubh", languageCode: "hi-IN" },
    hinglish: { speaker: "simran", languageCode: "hi-IN" },
  });
  assert.equal(JSON.stringify(status).includes("key-for-shape"), false, "status never echoes the key");

  const { providerVoiceLabel } = await import("../client/src/lib/announce.js");
  assert.equal(providerVoiceLabel(status, "hi"), "bulbul:v3 · shubh");
  assert.equal(providerVoiceLabel(status, "hinglish"), "bulbul:v3 · simran");
  assert.equal(providerVoiceLabel({ model: null, voices: null }, "hi"), null, "nothing is claimed when the server reports nothing");
  assert.equal(providerVoiceLabel({ model: SARVAM_MODEL, voices: {} }, "fr"), SARVAM_MODEL, "an unknown language still names the model it will use");

  const panel = readFileSync(new URL("../client/src/components/caller/VoicePanel.jsx", import.meta.url), "utf8");
  for (const stale of ["Bulbul v4", "ashwin_en_sports_energetic", "shubh_hi_ads", "shubh_enhi_ads"]) {
    assert.equal(panel.includes(stale), false, `the panel must not hard-code ${stale}, which goes stale silently`);
  }
  assert.match(panel, /providerLabel/, "the panel renders the label the server reported");
});

test("cache key includes language, fixed model, speaker, parameters, and exact text", () => {
  const en = sarvamCacheKey({ text: "hello", language: "en" });
  assert.ok(en);
  assert.notEqual(en, sarvamCacheKey({ text: "hello!", language: "en" }));
  assert.notEqual(en, sarvamCacheKey({ text: "hello", language: "hi" }));
  assert.equal(sarvamCacheKey({ text: "hello", language: "invalid" }), null);
});

test("missing key refuses synthesis without making a provider request", async () => {
  let calls = 0;
  const service = createSarvamTtsService({ apiKey: "", fetchImpl: async () => { calls += 1; } });
  assert.equal(service.status().configured, false);
  assert.deepEqual(await service.generate({ text: "hello", language: "en" }), { ok: false, code: "VOICE_UNAVAILABLE" });
  assert.equal(calls, 0);
});

test("default service reads the server environment key but status never returns it", () => {
  if (!process.env.SARVAM_API_KEY) return;
  const status = createSarvamTtsService().status();
  assert.equal(status.configured, true);
  assert.deepEqual(status.languages, ["en", "hi", "hinglish"]);
  assert.equal(JSON.stringify(status).includes(process.env.SARVAM_API_KEY), false);
});

test("provider configuration is fixed, valid WAV is cached, and cache hits avoid requests", async () => {
  const seen = [];
  const service = createSarvamTtsService({
    apiKey: "test-secret-do-not-report",
    fetchImpl: async (url, options) => {
      seen.push({ url, headers: options.headers, body: JSON.parse(options.body) });
      return responseWithAudio();
    },
  });
  const first = await service.generate({ text: "नंबर एक!", language: "hi" });
  const second = await service.generate({ text: "नंबर एक!", language: "hi" });
  assert.equal(first.ok, true);
  assert.equal(first.cache, "miss");
  assert.equal(second.cache, "hit");
  assert.deepEqual(second.audio, first.audio);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://api.sarvam.ai/text-to-speech");
  assert.equal(seen[0].headers["api-subscription-key"], "test-secret-do-not-report");
  assert.equal(seen[0].body.model, "bulbul:v3");
  assert.equal(seen[0].body.language_code, "hi-IN");
  assert.equal(seen[0].body.speaker, "shubh");
  assert.equal(seen[0].body.pace, 1);
  assert.equal(seen[0].body.temperature, 0.6);
  assert.equal("pitch" in seen[0].body, false);
  assert.equal("loudness" in seen[0].body, false);
  assert.equal(seen[0].body.enable_preprocessing, true);
  assert.deepEqual(service.stats(), { requests: 1, cacheEntries: 1, cacheBytes: sampleWav().length, inFlight: 0 });
});

test("each language sends its audited language tag and speaker", async () => {
  const sent = [];
  const service = createSarvamTtsService({
    apiKey: "configured",
    fetchImpl: async (_url, options) => { sent.push(JSON.parse(options.body)); return responseWithAudio(); },
  });
  for (const language of ["en", "hi", "hinglish"]) {
    await service.generate({ text: `sample-${language}`, language });
  }
  assert.deepEqual(sent.map(({ language_code, speaker }) => [language_code, speaker]), [
    ["en-IN", "ratan"],
    ["hi-IN", "shubh"],
    ["hi-IN", "simran"],
  ]);
});

test("concurrent identical requests share one provider generation", async () => {
  let calls = 0;
  const service = createSarvamTtsService({
    apiKey: "configured",
    fetchImpl: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return responseWithAudio();
    },
  });
  const results = await Promise.all([
    service.generate({ text: "same", language: "en" }),
    service.generate({ text: "same", language: "en" }),
    service.generate({ text: "same", language: "en" }),
  ]);
  assert.equal(calls, 1);
  assert.ok(results.every((result) => result.ok));
  assert.ok(results.some((result) => result.cache === "shared"));
});

test("invalid audio, provider errors, and timeout fail safely and are not cached", async () => {
  const invalid = createSarvamTtsService({ apiKey: "configured", fetchImpl: async () => responseWithAudio(Buffer.from("not-wav")) });
  assert.deepEqual(await invalid.generate({ text: "bad", language: "en" }), { ok: false, code: "VOICE_INVALID_AUDIO" });
  assert.equal(invalid.stats().cacheEntries, 0);

  const providerError = createSarvamTtsService({ apiKey: "configured", fetchImpl: async () => ({ ok: false, status: 503 }) });
  const failed = await providerError.generate({ text: "fail", language: "en" });
  assert.equal(failed.ok, false);
  assert.equal(failed.code, "VOICE_PROVIDER_ERROR");
  assert.equal(Number.isFinite(failed.latencyMs), true);

  const timeout = createSarvamTtsService({
    apiKey: "configured",
    timeoutMs: 3,
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(Object.assign(new Error("timeout"), { name: "AbortError" })));
    }),
  });
  assert.deepEqual(await timeout.generate({ text: "slow", language: "en" }), { ok: false, code: "VOICE_TIMEOUT" });
});

test("voice audio socket requires a room and only synthesizes an exact official call", async (t) => {
  const audio = sampleWav();
  const generated = [];
  const sarvamTts = {
    status: () => ({ configured: true, languages: ["en", "hi", "hinglish"] }),
    generate: async (request) => { generated.push(request); return { ok: true, audio, cache: "miss", latencyMs: 1 }; },
  };
  const app = await createApp({
    memoryOnly: true,
    allowPublicHosting: true,
    origins: [],
    sarvamTts,
    config: { autoCall: false, callIntervalMs: 60_000 },
    log: () => {},
  });
  const port = await app.listen(0);
  const url = `http://127.0.0.1:${port}`;
  const clients = [];
  t.after(async () => {
    clients.forEach((client) => client.disconnect());
    await app.closeServer({ closeRoomsDurably: false });
  });
  const connect = async () => {
    const client = connectClient(url, { transports: ["websocket"], forceNew: true, reconnection: false });
    clients.push(client);
    await new Promise((resolve, reject) => {
      client.once("connect", resolve);
      client.once("connect_error", reject);
    });
    return client;
  };
  const request = (client, event, payload = {}) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`No acknowledgement for ${event}`)), 5000);
    client.emit(event, payload, (result) => { clearTimeout(timeout); resolve(result); });
  });
  const statusResponse = await fetch(`${url}/api/voice/status`);
  const status = await statusResponse.json();
  assert.deepEqual(status, {
    ok: true,
    configured: true,
    languages: ["en", "hi", "hinglish"],
    model: SARVAM_MODEL,
    voices: {
      en: { speaker: "ratan", languageCode: "en-IN" },
      hi: { speaker: "shubh", languageCode: "hi-IN" },
      hinglish: { speaker: "simran", languageCode: "hi-IN" },
    },
  });
  assert.equal(JSON.stringify(status).includes("test-secret-do-not-report"), false);
  const host = await connect();
  const outsider = await connect();
  const created = await request(host, "room:create", { name: "Host" });
  assert.equal(created.ok, true, JSON.stringify(created));
  const started = await request(host, "game:start", {});
  assert.equal(started.ok, true, JSON.stringify(started));
  const called = await request(host, "game:call-next", {});
  assert.equal(called.ok, true, JSON.stringify(called));
  const audioReply = await request(host, "voice:audio", { number: called.number, index: called.index, language: "hinglish" });
  assert.equal(audioReply.ok, true);
  assert.equal(audioReply.contentType, "audio/wav");
  assert.equal(Buffer.from(audioReply.audio, "base64").compare(audio), 0);
  assert.deepEqual(generated, [{ text: buildSarvamAnnouncement(called.number, { language: "hinglish" }), language: "hinglish" }]);
  assert.equal((await request(host, "voice:audio", { number: called.number === 90 ? 89 : called.number + 1, index: called.index, language: "en" })).code, "CALL_NOT_FOUND");
  assert.equal((await request(outsider, "voice:audio", { number: called.number, index: called.index, language: "en" })).code, "NOT_PLAYER");
  assert.equal(generated.length, 1);
});
