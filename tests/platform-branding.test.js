import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/index.js";
import { createLogger } from "../server/observability/log.js";
import { hashPassword } from "../server/admin/password.js";
import { createPlatformBrandingService, DEFAULT_PLATFORM_BRANDING, publicPlatformManifest, validatePlatformBranding } from "../server/branding/platform.js";

const validBrand = {
  ...DEFAULT_PLATFORM_BRANDING,
  name: "Roundhouse Ninety",
  tagline: "Play a round together",
  accent: "#34a879",
};

test("platform branding accepts only curated local assets, safe HTTPS links, and readable colors", () => {
  assert.equal(validatePlatformBranding(validBrand).error, undefined);
  assert.equal(validatePlatformBranding({ ...validBrand, logo: "https://attacker.example/logo.svg" }).error, "INVALID_BRANDING");
  assert.equal(validatePlatformBranding({ ...validBrand, logo: "../../secret.svg" }).error, "INVALID_BRANDING");
  assert.equal(validatePlatformBranding({ ...validBrand, termsUrl: "javascript:alert(1)" }).error, "INVALID_BRANDING");
  assert.equal(validatePlatformBranding({ ...validBrand, termsUrl: "http://example.test/terms" }).error, "INVALID_BRANDING");
  assert.equal(validatePlatformBranding({ ...validBrand, accentBright: "#333333" }).error, "INVALID_BRANDING");
  assert.equal(validatePlatformBranding({ ...validBrand, customHtml: "<script>" }).error, "INVALID_BRANDING");
  assert.equal(validatePlatformBranding({ ...validBrand, name: "<b>Brand</b>" }).error, "INVALID_BRANDING");
});

test("the installed-app manifest follows the configured platform name, icon and colors", () => {
  assert.deepEqual(publicPlatformManifest(validBrand), {
    name: validBrand.name,
    short_name: validBrand.name,
    description: validBrand.subtitle,
    start_url: "/",
    scope: "/",
    display: "standalone",
    icons: [{ src: `/brand/${validBrand.icon}`, sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
    theme_color: validBrand.accent,
    background_color: "#07110f",
  });
  assert.equal(publicPlatformManifest(null, { name: "<script>", subtitle: "bad > copy" }).name, DEFAULT_PLATFORM_BRANDING.name);
  assert.equal(publicPlatformManifest(null, { name: "Safe Name", subtitle: "<script>" }).description, DEFAULT_PLATFORM_BRANDING.subtitle);
  assert.equal(publicPlatformManifest(null, null).name, DEFAULT_PLATFORM_BRANDING.name);
});

test("platform branding service upserts the single versioned setting and returns it", async () => {
  const calls = [];
  let saved = null;
  const db = { async query(sql, params = []) {
    calls.push(sql);
    if (sql.startsWith("SELECT")) return { rows: saved ? [{ value: saved }] : [] };
    saved = JSON.parse(params[0]);
    return { rows: [] };
  } };
  const service = createPlatformBrandingService({ db });
  assert.equal((await service.get()).branding, null);
  const result = await service.save(validBrand, "owner-test");
  assert.equal(result.durable, true);
  assert.equal(result.branding.name, validBrand.name);
  assert.match(calls[1], /ON CONFLICT \(setting_key\) DO UPDATE/);
  assert.deepEqual((await service.get()).branding, validBrand);
});

test("public branding is readable while updates require owner auth and CSRF", async (t) => {
  const app = await createApp({
    memoryOnly: true,
    config: { autoCall: false },
    mfaKey: { configured: false, key: null },
    logger: createLogger({ level: "silent", sink: () => {} }),
    log: () => {},
  });
  t.after(async () => app.closeServer({ closeRoomsDurably: false }));
  await app.admin.ownerStore.create({ username: "brand-owner", passwordHash: await hashPassword("BrandOwnerPassword9!") });
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  const cookies = new Map();
  let csrf = null;
  const request = async (method, path, body) => {
    const headers = {};
    if (cookies.size) headers.cookie = [...cookies].map(([key, value]) => `${key}=${value}`).join("; ");
    if (body !== undefined) headers["content-type"] = "application/json";
    if (method !== "GET" && csrf) headers["x-csrf-token"] = csrf;
    const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(";", 1)[0];
      const index = pair.indexOf("=");
      if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const payload = await response.json();
    if (payload.csrfToken) csrf = payload.csrfToken;
    return { status: response.status, payload };
  };

  const publicBefore = await request("GET", "/api/public/branding");
  assert.equal(publicBefore.status, 200);
  assert.equal(publicBefore.payload.branding, null, "an unset owner setting leaves build-time defaults in control");
  assert.equal((await request("GET", "/api/admin/branding")).status, 401);
  const manifestBefore = await fetch(`${base}/api/public/manifest.webmanifest`);
  assert.equal(manifestBefore.status, 200);
  assert.match(manifestBefore.headers.get("content-type") || "", /application\/manifest\+json/);
  assert.equal(manifestBefore.headers.get("cache-control"), "no-store");
  assert.equal((await manifestBefore.json()).name, DEFAULT_PLATFORM_BRANDING.name);
  const buildFallback = await (await fetch(`${base}/api/public/manifest.webmanifest?fallbackName=Roundhouse%20Ninety&fallbackSubtitle=Build%20fallback&fallbackIcon=regular-mark.svg&fallbackAccent=%239cf0c5`)).json();
  assert.equal(buildFallback.name, "Roundhouse Ninety");
  assert.equal(buildFallback.description, "Build fallback");
  assert.equal(buildFallback.icons[0].src, "/brand/regular-mark.svg");
  assert.equal(buildFallback.theme_color, "#9cf0c5");
  const rejectedFallback = await (await fetch(`${base}/api/public/manifest.webmanifest?fallbackName=%3Cscript%3E&fallbackSubtitle=%3Cscript%3E`)).json();
  assert.equal(rejectedFallback.name, DEFAULT_PLATFORM_BRANDING.name);
  assert.equal(rejectedFallback.description, DEFAULT_PLATFORM_BRANDING.subtitle);
  const rejectedAssets = await (await fetch(`${base}/api/public/manifest.webmanifest?fallbackIcon=..%2Fsecret.svg&fallbackAccent=%23000000`)).json();
  assert.equal(rejectedAssets.icons[0].src, `/brand/${DEFAULT_PLATFORM_BRANDING.icon}`);
  assert.equal(rejectedAssets.theme_color, DEFAULT_PLATFORM_BRANDING.accent);
  await request("GET", "/api/admin/session");
  const signedIn = await request("POST", "/api/admin/signin", { username: "brand-owner", password: "BrandOwnerPassword9!" });
  assert.equal(signedIn.status, 200);
  const deniedWithoutCsrf = await fetch(`${base}/api/admin/branding`, { method: "PUT", headers: { cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; "), "content-type": "application/json" }, body: JSON.stringify({ branding: validBrand }) });
  assert.equal(deniedWithoutCsrf.status, 403);

  const saved = await request("PUT", "/api/admin/branding", { branding: validBrand });
  assert.equal(saved.status, 200);
  assert.equal(saved.payload.durable, false);
  assert.deepEqual((await request("GET", "/api/public/branding")).payload.branding, validBrand);
  const updatedManifest = await (await fetch(`${base}/api/public/manifest.webmanifest?fallbackName=Ignored%20Build%20Brand`)).json();
  assert.equal(updatedManifest.name, validBrand.name);
  assert.equal(updatedManifest.icons[0].src, `/brand/${validBrand.icon}`);
  assert.equal(updatedManifest.theme_color, validBrand.accent);
  const invalid = await request("PUT", "/api/admin/branding", { branding: { ...validBrand, logo: "https://attacker.invalid/a.svg" } });
  assert.equal(invalid.status, 400);
  assert.equal((await request("GET", "/api/public/branding")).payload.branding.name, validBrand.name);
  const audit = await app.admin.audit.recent();
  assert.ok(audit.some((event) => event.action === "PLATFORM_BRANDING_UPDATE"));
});
