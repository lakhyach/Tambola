import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(root, ".tmp-sarvam-style-audition");
const manifestPath = path.join(outputDirectory, "manifest.json");
const apiKey = process.env.SARVAM_API_KEY;
const model = "bulbul:v4-flash";
const numbers = [1, 7, 11, 27, 44, 55, 77, 90];

const newCallouts = {
  en: {
    1: "Number one! The game woke up; even the chai sat up straight.",
    7: "Lucky seven! Oho, someone's ticket is smiling before the win.",
    11: "Double one! Two tiny soldiers just marched onto your ticket.",
    27: "Twenty-seven! Three nines formed a committee; snacks are on the agenda.",
    44: "Double four! The corners heard the news and asked for samosas.",
    55: "Double five! Bollywood luck has entered; keep those pencils in rhythm.",
    77: "Double seven! Lovely luck—keep the victory dance on standby!",
    90: "Ninety! The grand finale; uncle's standing, but the game's still going!",
  },
  hi: {
    1: "नंबर एक! खेल जागा तो चाय ने भी सीधा बैठकर ताली बजाई!",
    7: "नंबर सात! अरे वाह, आज तो किस्मत भी ठुमके लगा रही है!",
    11: "ग्यारह नंबर! दो छोटे सिपाही टिकट पर कदमताल कर रहे हैं!",
    27: "सत्ताईस नंबर! तीन नौ मिले, किस्मत की टोली बन गई!",
    44: "चवालीस नंबर! चारों कोने बोले—पहले टिकट देखो, फिर समोसा लो!",
    55: "पचपन नंबर! डबल पाँच आया, किस्मत भी फ़िल्मी अंदाज़ में!",
    77: "सतहत्तर नंबर! डबल सात, क्या बात—नाचना थोड़ा संभाल के!",
    90: "नब्बे नंबर! आख़िरी पुकार, मामा जी की टिकट जाँच अभी भी जारी!",
  },
  hinglish: {
    1: "Number ek! Game jaag gaya, chai ne bhi seedha baith ke taali bajayi!",
    7: "Saat number! Arre wah, aaj toh kismat bhi thumke laga rahi hai!",
    11: "Gyarah number! Do chhote sipahi ticket par parade kar rahe hain!",
    27: "Sattais number! Teen nau mile, kismat ki team ban gayi!",
    44: "Chawalis number! Chaaron kone bole, pehle ticket dekho, phir samosa lo!",
    55: "Pachpan number! Double five aaya, luck bhi filmi andaaz mein!",
    77: "Satattar number! Double saat, kya baat—dance thoda sambhaal ke!",
    90: "Nabbe number! Final call, mama ji ki ticket checking abhi bhi jaari!",
  },
};

const configurations = {
  current: {
    en: { languageCode: "en-IN", speaker: "ashwin_en_sports_energetic", pace: 1, pitch: 0, loudness: 1 },
    hi: { languageCode: "hi-IN", speaker: "shubh_hi_ads", pace: 1, pitch: 0, loudness: 1 },
    hinglish: { languageCode: "hi-IN", speaker: "shubh_enhi_ads", pace: 1, pitch: 0, loudness: 1 },
  },
  alternative: {
    en: { languageCode: "en-IN", speaker: "sunny_en_social", pace: 1.05, pitch: 0.1, loudness: 1 },
    hi: { languageCode: "hi-IN", speaker: "simran_hi_social_energetic", pace: 1.05, pitch: 0.1, loudness: 1 },
    hinglish: { languageCode: "hi-IN", speaker: "shubh_enhi_companion", pace: 1.05, pitch: 0.1, loudness: 1 },
  },
};

function getText(kind, number) {
  if (kind === "en") return newCallouts.en[number];
  if (kind === "hi") return newCallouts.hi[number];
  return newCallouts.hinglish[number];
}

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

async function baselineRecords() {
  const manifestPath = path.join(root, ".tmp-sarvam-audition-set", "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  return manifest.results.map((record) => ({
    ...record,
    comparison: record.kind === "hindi-script"
      ? "previous_manual_hindi_script_audition_current_voice_settings_not_app_source"
      : "current_existing_callout_current_configuration",
    outputPath: record.outputPath,
  }));
}

if (!apiKey?.trim()) {
  console.error("Sarvam style audition failed: SARVAM_API_KEY is not set. Run with Node's --env-file=.env option.");
  process.exitCode = 2;
} else {
  await mkdir(outputDirectory, { recursive: true });
  try {
    await access(manifestPath);
    console.error("Sarvam style audition set already has a manifest; refusing to repeat paid requests.");
    process.exitCode = 3;
  } catch {
    // First run: no output manifest exists yet.
  }
  if (process.exitCode === 3) {
    // Deliberately do not synthesize an identical set again.
  } else {
  const manifest = {
    model,
    numbers,
    baseline: await baselineRecords(),
    newCallouts,
    generated: [],
    notes: [
      "English and Romanized Hinglish baseline audio reuses the prior 24-clip audition set; no identical baseline clips were regenerated.",
      "The app currently contains English and Romanized Hinglish callouts, not an existing Devanagari callout collection.",
      "Hindi-script baseline clips reuse prior manual translations and are not pre-existing app callout text.",
      "Hindi-script lines are original audition copy; Romanized Hinglish intentionally tests the current app's Latin-script Hindi style.",
      "Alternative samples change both documented speaker and pace/pitch, so they are a combined style comparison rather than a one-variable experiment.",
    ],
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  const plans = ["current", "alternative"].flatMap((configuration) =>
    ["en", "hi", "hinglish"].flatMap((kind) =>
      numbers.map((number) => ({ configuration, kind, number, text: getText(kind, number), ...configurations[configuration][kind] }))
    )
  );

  for (const sample of plans) {
    const filename = `${sample.configuration}-${sample.kind}-${String(sample.number).padStart(2, "0")}.wav`;
    const outputPath = path.join(outputDirectory, filename);
    const startedAt = performance.now();
    try {
      const response = await fetch("https://api.sarvam.ai/text-to-speech", {
        method: "POST",
        headers: { "api-subscription-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: sample.text,
          model,
          language_code: sample.languageCode,
          speaker: sample.speaker,
          speech_sample_rate: 24000,
          output_audio_codec: "wav",
          enable_preprocessing: true,
          pace: sample.pace,
          pitch: sample.pitch,
          loudness: sample.loudness,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const requestElapsedMs = Math.round(performance.now() - startedAt);
      if (!response.ok) {
        let safeCode = "provider_error";
        try {
          const payload = await response.json();
          const code = payload?.error?.code;
          if (typeof code === "string" && /^[a-zA-Z0-9_-]{1,48}$/.test(code)) safeCode = code;
        } catch { /* Never echo an untrusted response body or request headers. */ }
        throw new Error(`http_${response.status}_${safeCode}`);
      }
      const payload = await response.json();
      const encodedAudio = Array.isArray(payload?.audios) ? payload.audios.join("") : "";
      if (!encodedAudio || !/^[A-Za-z0-9+/]+={0,2}$/.test(encodedAudio)) throw new Error("invalid_audio_payload");
      const audio = Buffer.from(encodedAudio, "base64");
      const metadata = pcmWavMetadata(audio);
      await writeFile(outputPath, audio, { flag: "wx" });
      manifest.generated.push({
        comparison: `new_callout_${sample.configuration}_configuration`,
        number: sample.number,
        kind: sample.kind,
        text: sample.text,
        model,
        language: sample.languageCode,
        speaker: sample.speaker,
        pace: sample.pace,
        pitch: sample.pitch,
        loudness: sample.loudness,
        enablePreprocessing: true,
        outputPath,
        requestElapsedMs,
        sizeBytes: audio.length,
        result: "generated_and_wav_validated",
        ...metadata,
      });
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      console.log(`Generated ${sample.configuration} ${sample.kind} sample ${sample.number} (${requestElapsedMs} ms).`);
    } catch (error) {
      manifest.generated.push({
        comparison: `new_callout_${sample.configuration}_configuration`,
        number: sample.number,
        kind: sample.kind,
        speaker: sample.speaker,
        result: "failed",
        safeError: String(error?.message || "request_failed").slice(0, 120),
      });
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      console.error(`Failed ${sample.configuration} ${sample.kind} sample ${sample.number}: ${String(error?.message || "request_failed").slice(0, 120)}.`);
      break;
    }
  }

  const successes = manifest.generated.filter((item) => item.result === "generated_and_wav_validated").length;
  console.log(JSON.stringify({ success: successes === plans.length, generated: successes, planned: plans.length, manifestPath }));
  if (successes !== plans.length) process.exitCode = 1;
  }
}
