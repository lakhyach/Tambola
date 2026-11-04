import test from "node:test";
import assert from "node:assert/strict";
import { createOpenAiImageProvider, validateArtPrompt } from "../server/posters/image-provider.js";

const prompt = "An elegant Diwali Tambola night in plum and luminous gold with palace arches and warm diya light.";
function png(size = "1024x1536") {
  const [width, height] = size.split("x").map(Number);
  const image = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(image);
  image.writeUInt32BE(13, 8); image.write("IHDR", 12, "ascii"); image.writeUInt32BE(width, 16); image.writeUInt32BE(height, 20);
  return image;
}

test("prompt validation rejects short and oversized input", () => {
  assert.equal(validateArtPrompt("tiny").error, "POSTER_PROMPT_INVALID");
  assert.equal(validateArtPrompt("x".repeat(1201)).error, "POSTER_PROMPT_INVALID");
  assert.equal(validateArtPrompt(prompt).prompt, prompt);
});

test("provider fails closed without credentials and never attempts network", async () => {
  let calls = 0;
  const provider = createOpenAiImageProvider({ apiKey: "", fetchImpl: async () => { calls += 1; } });
  assert.equal(provider.configured, false);
  assert.deepEqual(await provider.generate({ prompt }), { error: "POSTER_PROVIDER_UNCONFIGURED" });
  assert.equal(calls, 0);
});

test("provider calls OpenAI server-side with art-only prompt and accepts valid PNG", async () => {
  let request;
  const provider = createOpenAiImageProvider({ apiKey: "server-secret", fetchImpl: async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ data: [{ b64_json: png().toString("base64") }] }), { status: 200, headers: { "content-type": "application/json" } });
  } });
  const result = await provider.generate({ prompt, actor: "synthetic-owner" });
  assert.equal(result.provider, "openai-images");
  assert.equal(result.model, "gpt-image-2.5-flare");
  assert.deepEqual(result.image, png());
  assert.equal(request.url, "https://api.openai.com/v1/images/generations");
  assert.equal(request.options.headers.Authorization, "Bearer server-secret");
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.size, "1024x1536");
  assert.match(payload.prompt, /BACKGROUND ART ONLY/);
  assert.match(payload.prompt, /Do not draw letters/);
  assert.equal(payload.safety_identifier.length, 64);
});

test("provider enforces the requested PNG dimensions", async () => {
  const provider = createOpenAiImageProvider({ apiKey: "test", fetchImpl: async () => new Response(JSON.stringify({ data: [{ b64_json: png("1024x1024").toString("base64") }] }), { status: 200 }) });
  assert.deepEqual(await provider.generate({ prompt, size: "1024x1536" }), { error: "POSTER_PROVIDER_INVALID_IMAGE" });
});

test("provider retries a transient 5xx once and reports invalid output honestly", async () => {
  let calls = 0;
  const provider = createOpenAiImageProvider({ apiKey: "test", fetchImpl: async () => {
    calls += 1;
    return calls === 1 ? new Response("{}", { status: 503 }) : new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("not a png").toString("base64") }] }), { status: 200 });
  } });
  assert.deepEqual(await provider.generate({ prompt }), { error: "POSTER_PROVIDER_INVALID_IMAGE" });
  assert.equal(calls, 2);
});

test("provider maps authorization and rate-limit failures without fabricating an image", async () => {
  const forbidden = createOpenAiImageProvider({ apiKey: "bad", fetchImpl: async () => new Response("{}", { status: 403 }) });
  assert.deepEqual(await forbidden.generate({ prompt }), { error: "POSTER_PROVIDER_CONFIGURATION" });
  const limited = createOpenAiImageProvider({ apiKey: "test", fetchImpl: async () => new Response("{}", { status: 429 }) });
  assert.deepEqual(await limited.generate({ prompt }), { error: "POSTER_PROVIDER_RATE_LIMITED" });
});
