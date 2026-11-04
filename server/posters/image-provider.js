import { createHash } from "node:crypto";

const MAX_PROMPT = 1200;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function validPngImage(image, size) {
  if (!Buffer.isBuffer(image) || image.length < 24 || image.length > MAX_IMAGE_BYTES
    || image.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
    || image.readUInt32BE(8) !== 13 || image.toString("ascii", 12, 16) !== "IHDR") return false;
  const dimensions = { "1024x1024": [1024, 1024], "1024x1536": [1024, 1536], "1536x1024": [1536, 1024] }[size];
  return Boolean(dimensions && image.readUInt32BE(16) === dimensions[0] && image.readUInt32BE(20) === dimensions[1]);
}

export function validateArtPrompt(prompt) {
  if (typeof prompt !== "string") return { error: "POSTER_PROMPT_REQUIRED" };
  const value = prompt.trim();
  if (value.length < 12 || value.length > MAX_PROMPT) return { error: "POSTER_PROMPT_INVALID" };
  return { prompt: value };
}

export function createOpenAiImageProvider({ apiKey = process.env.OPENAI_API_KEY, model = process.env.POSTER_IMAGE_MODEL || "gpt-image-2.5-flare", fetchImpl = fetch, timeoutMs = 105_000 } = {}) {
  return {
    provider: "openai-images",
    model,
    configured: Boolean(apiKey),
    async generate({ prompt, size = "1024x1536", actor }) {
      if (!apiKey) return { error: "POSTER_PROVIDER_UNCONFIGURED" };
      const checked = validateArtPrompt(prompt);
      if (checked.error) return checked;
      if (!new Set(["1024x1024", "1024x1536", "1536x1024"]).has(size)) return { error: "POSTER_IMAGE_SIZE_INVALID" };
      const safePrompt = `Create original premium Indian festival event-poster BACKGROUND ART ONLY. Do not draw letters, words, numbers, logos, QR codes, labels, or readable text; accurate event text will be typeset separately. Style direction: ${checked.prompt}. Compose rich dimensional atmosphere with a calm darker central area and a clean lower-third area for legible typography. No real-money gambling imagery, currency, chips, or payouts. High-end editorial illustration, polished lighting, refined detail.`;
      const safetyIdentifier = createHash("sha256").update(String(actor || "poster-owner")).digest("hex");
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), timeoutMs);
        timer.unref?.();
        let response;
        try {
          response = await fetchImpl("https://api.openai.com/v1/images/generations", {
            method: "POST", signal: abort.signal,
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model, prompt: safePrompt, n: 1, size, quality: "high", output_format: "png", background: "opaque", safety_identifier: safetyIdentifier }),
          });
        } catch (error) {
          clearTimeout(timer);
          if (error?.name === "AbortError") return { error: "POSTER_PROVIDER_TIMEOUT" };
          if (attempt === 0) continue;
          return { error: "POSTER_PROVIDER_UNAVAILABLE" };
        }
        if (!response.ok) {
          const status = response.status;
          if (attempt === 0 && (status === 429 || status >= 500)) {
            await response.body?.cancel().catch(() => {});
            clearTimeout(timer);
            const retryAfter = Math.min(3000, Math.max(0, Number(response.headers.get("retry-after")) * 1000 || 500));
            await new Promise((resolve) => setTimeout(resolve, retryAfter));
            continue;
          }
          clearTimeout(timer);
          await response.body?.cancel().catch(() => {});
          return { error: status === 401 || status === 403 ? "POSTER_PROVIDER_CONFIGURATION" : status === 429 ? "POSTER_PROVIDER_RATE_LIMITED" : "POSTER_PROVIDER_FAILED" };
        }
        const contentLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES * 1.4) {
          clearTimeout(timer);
          await response.body?.cancel().catch(() => {});
          return { error: "POSTER_PROVIDER_INVALID_IMAGE" };
        }
        let payload;
        try { payload = await response.json(); }
        catch (error) {
          clearTimeout(timer);
          if (error?.name === "AbortError") return { error: "POSTER_PROVIDER_TIMEOUT" };
          return { error: "POSTER_PROVIDER_INVALID_RESPONSE" };
        }
        clearTimeout(timer);
        const encoded = payload?.data?.[0]?.b64_json;
        if (typeof encoded !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return { error: "POSTER_PROVIDER_INVALID_RESPONSE" };
        const image = Buffer.from(encoded, "base64");
        if (!validPngImage(image, size)) return { error: "POSTER_PROVIDER_INVALID_IMAGE" };
        return { image, provider: "openai-images", model };
      }
      return { error: "POSTER_PROVIDER_FAILED" };
    },
  };
}

export const POSTER_PROMPT_LIMIT = MAX_PROMPT;
export const POSTER_IMAGE_LIMIT = MAX_IMAGE_BYTES;
