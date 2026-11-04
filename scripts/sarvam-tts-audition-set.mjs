import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildNumberAnnouncement } from "../client/src/lib/number-callouts.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(root, ".tmp-sarvam-audition-set");
const manifestPath = path.join(outputDirectory, "manifest.json");
const apiKey = process.env.SARVAM_API_KEY;
const numbers = [1, 7, 11, 27, 44, 55, 77, 90];
const hindiCallouts = {
  1: "एक! अरे, चाय की प्याली भी बोल पड़ी: पहले मेरी हाज़िरी लगाओ!",
  7: "सात! सातवीं गेंद पर गेंदबाज़ ने हौसला बढ़ाया; विकेट बोली, पहले टिकट तो देखो!",
  11: "ग्यारह! ग्यारह लोग सेल्फ़ी में आ गए; फ़ोटोग्राफ़र अभी भी अपना फ़ोन ढूँढ रहा है।",
  27: "सत्ताईस! सत्ताईस तारीख़ को बजट ने कैलेंडर से कहा: आज हम एक-दूसरे को नहीं जानते।",
  44: "चवालीस! चवालीस का फ़ोन साइलेंट था; घरवालों ने फिर भी उसे तीन बार कॉल किया।",
  55: "पचपन! पचपन मिनट से पार्सल रास्ते में है; नक्शे पर वो छुट्टी मना रहा है।",
  77: "सतहत्तर! सतहत्तर का डांस स्टेप देखा; सोफ़े ने ख़ुद सुरक्षा दूरी बना ली।",
  90: "नब्बे! मिठाई का डिब्बा खुला; डाइट बोली, मैं अगले दौर से जुड़ूँगी।",
};

function pcmWavMetadata(audio) {
  if (audio.length < 44 || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("invalid_wav_file");
  }
  const format = audio.readUInt16LE(20);
  const channels = audio.readUInt16LE(22);
  const sampleRate = audio.readUInt32LE(24);
  const byteRate = audio.readUInt32LE(28);
  const dataOffset = audio.indexOf("data", 12, "ascii");
  if (format !== 1 || channels < 1 || sampleRate < 1 || byteRate < 1 || dataOffset < 0 || dataOffset + 8 > audio.length) {
    throw new Error("unsupported_wav_metadata");
  }
  const audioBytes = audio.readUInt32LE(dataOffset + 4);
  if (!audioBytes || dataOffset + 8 + audioBytes > audio.length) throw new Error("truncated_wav_data");
  return {
    format: "WAV PCM",
    channels,
    sampleRate,
    durationSeconds: Math.round((audioBytes / byteRate) * 1000) / 1000,
  };
}

if (!apiKey?.trim()) {
  console.error("Sarvam audition set failed: SARVAM_API_KEY is not set. Run with Node's --env-file=.env option.");
  process.exitCode = 2;
} else {
  await mkdir(outputDirectory, { recursive: true });
  const manifest = [];
  const plans = numbers.flatMap((number) => [
    {
      number,
      kind: "english",
      text: buildNumberAnnouncement(number, { language: "en", includeCallout: true }),
      languageCode: "en-IN",
      speaker: "ashwin_en_sports_energetic",
    },
    {
      number,
      kind: "hindi-script",
      text: `${number === 1 ? "एक" : number === 7 ? "सात" : number === 11 ? "ग्यारह" : number === 27 ? "सत्ताईस" : number === 44 ? "चवालीस" : number === 55 ? "पचपन" : number === 77 ? "सतहत्तर" : "नब्बे"}! ${hindiCallouts[number]}`,
      languageCode: "hi-IN",
      speaker: "shubh_hi_ads",
    },
    {
      number,
      kind: "romanized-hinglish",
      text: buildNumberAnnouncement(number, { language: "hi", includeCallout: true }),
      languageCode: "hi-IN",
      speaker: "shubh_enhi_ads",
    },
  ]);

  for (const sample of plans) {
    const outputPath = path.join(outputDirectory, `${sample.kind}-${String(sample.number).padStart(2, "0")}.wav`);
    const startedAt = performance.now();
    try {
      const response = await fetch("https://api.sarvam.ai/text-to-speech", {
        method: "POST",
        headers: { "api-subscription-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: sample.text,
          model: "bulbul:v4-flash",
          language_code: sample.languageCode,
          speaker: sample.speaker,
          speech_sample_rate: 24000,
          output_audio_codec: "wav",
          enable_preprocessing: true,
          pace: 1.0,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const elapsedMs = Math.round(performance.now() - startedAt);
      if (!response.ok) {
        let safeCode = "provider_error";
        try {
          const payload = await response.json();
          safeCode = payload?.error?.code || "provider_error";
        } catch { /* Never echo an untrusted body or request headers. */ }
        throw new Error(`http_${response.status}_${String(safeCode).slice(0, 80)}`);
      }
      const payload = await response.json();
      const encodedAudio = Array.isArray(payload?.audios) ? payload.audios.join("") : "";
      if (!encodedAudio || !/^[A-Za-z0-9+/]+={0,2}$/.test(encodedAudio)) throw new Error("invalid_audio_payload");
      const audio = Buffer.from(encodedAudio, "base64");
      const audioInfo = pcmWavMetadata(audio);
      await writeFile(outputPath, audio, { flag: "wx" });
      manifest.push({
        number: sample.number,
        kind: sample.kind,
        model: "bulbul:v4-flash",
        language: sample.languageCode,
        speaker: sample.speaker,
        text: sample.text,
        outputPath,
        sizeBytes: audio.length,
        requestElapsedMs: elapsedMs,
        ...audioInfo,
        result: "generated_and_wav_validated",
      });
      console.log(`Generated ${sample.kind} sample ${sample.number} (${elapsedMs} ms).`);
    } catch (error) {
      manifest.push({
        number: sample.number,
        kind: sample.kind,
        language: sample.languageCode,
        speaker: sample.speaker,
        result: "failed",
        safeError: String(error?.message || "request_failed").slice(0, 120),
      });
      console.error(`Failed ${sample.kind} sample ${sample.number}: ${String(error?.message || "request_failed").slice(0, 120)}.`);
      break;
    }
  }

  await writeFile(manifestPath, `${JSON.stringify({ model: "bulbul:v4-flash", sampleNumbers: numbers, results: manifest }, null, 2)}\n`, { flag: "wx" });
  const successes = manifest.filter((item) => item.result === "generated_and_wav_validated").length;
  console.log(JSON.stringify({ success: successes === plans.length, generated: successes, planned: plans.length, manifestPath }));
  if (successes !== plans.length) process.exitCode = 1;
}
