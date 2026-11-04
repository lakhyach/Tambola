import { mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(root, ".tmp-sarvam-audition");
const outputPath = path.join(outputDirectory, "hindi-7-bulbul-v4-flash.wav");
const apiKey = process.env.SARVAM_API_KEY;

if (!apiKey?.trim()) {
  console.error("Sarvam audition failed: SARVAM_API_KEY is not set. Run with Node's --env-file=.env option.");
  process.exitCode = 2;
} else {
  const requestStarted = performance.now();
  let response;
  try {
    response = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: {
        "api-subscription-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: "नंबर सात! अरे वाह, किस्मत चमक गई! सात नंबर आ गया!",
        model: "bulbul:v4-flash",
        language_code: "hi-IN",
        speaker: "shubh_hi_customer",
        speech_sample_rate: 24000,
        output_audio_codec: "wav",
        enable_preprocessing: true,
        pace: 1.0,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    const safeCode = error?.cause?.code || error?.name || "network_error";
    console.error(`Sarvam audition failed before an HTTP response (${safeCode}).`);
    process.exitCode = 1;
  }

  if (response) {
    const elapsedMs = Math.round(performance.now() - requestStarted);
    if (!response.ok) {
      let safeCode = "provider_error";
      try {
        const payload = await response.json();
        const candidateCode = payload?.error?.code;
        safeCode = typeof candidateCode === "string" && /^[a-zA-Z0-9_-]{1,48}$/.test(candidateCode)
          ? candidateCode
          : safeCode;
      } catch {
        // Do not echo an untrusted response body or any request headers.
      }
      console.error(`Sarvam request failed: HTTP ${response.status}; ${String(safeCode).slice(0, 120)}.`);
      process.exitCode = 1;
    } else {
      try {
        const payload = await response.json();
        const encodedAudio = Array.isArray(payload?.audios) ? payload.audios.join("") : "";
        if (!encodedAudio || !/^[A-Za-z0-9+/]+={0,2}$/.test(encodedAudio)) {
          throw new Error("invalid_audio_payload");
        }
        const audio = Buffer.from(encodedAudio, "base64");
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
        const durationSeconds = Math.round((audioBytes / byteRate) * 1000) / 1000;
        await mkdir(outputDirectory, { recursive: true });
        await writeFile(outputPath, audio, { flag: "wx" });
        const fileInfo = await stat(outputPath);
        if (fileInfo.size === 0) throw new Error("empty_audio_file");
        console.log(JSON.stringify({
          success: true,
          httpStatus: response.status,
          model: "bulbul:v4-flash",
          language: "hi-IN",
          speaker: "shubh_hi_customer",
          outputPath,
          format: "WAV PCM",
          channels,
          sampleRate,
          durationSeconds,
          sizeBytes: fileInfo.size,
          requestElapsedMs: elapsedMs,
        }));
      } catch (error) {
        const safeCode = String(error?.message || "audio_validation_failed").slice(0, 120);
        console.error(`Sarvam returned a response, but audio validation failed (${safeCode}).`);
        process.exitCode = 1;
      }
    }
  }
}
