import test from "node:test";
import assert from "node:assert/strict";
import viteConfig from "../client/vite.config.js";
import { DEFAULT_BRAND } from "../client/src/brand-defaults.js";
import { config } from "../client/src/config.js";
import { getPlatformBranding, setPlatformBranding } from "../client/src/platform-branding.js";

function metadataPlugin() {
  const config = viteConfig({ mode: "production", command: "build" });
  return config.plugins.find((plugin) => plugin.name === "configured-brand-metadata");
}

test("Vite static HTML metadata uses one configured build brand and escapes attribute text", (t) => {
  const previousName = process.env.VITE_APP_NAME;
  const previousSubtitle = process.env.VITE_APP_SUBTITLE;
  const previousIcon = process.env.VITE_APP_ICON;
  const previousColor = process.env.VITE_BRAND_COLOR;
  t.after(() => {
    if (previousName === undefined) delete process.env.VITE_APP_NAME;
    else process.env.VITE_APP_NAME = previousName;
    if (previousSubtitle === undefined) delete process.env.VITE_APP_SUBTITLE;
    else process.env.VITE_APP_SUBTITLE = previousSubtitle;
    if (previousIcon === undefined) delete process.env.VITE_APP_ICON;
    else process.env.VITE_APP_ICON = previousIcon;
    if (previousColor === undefined) delete process.env.VITE_BRAND_COLOR;
    else process.env.VITE_BRAND_COLOR = previousColor;
  });

  process.env.VITE_APP_NAME = "Roundhouse & <Play>";
  process.env.VITE_APP_SUBTITLE = "A safe <free> game & friends";
  process.env.VITE_APP_ICON = "/brand/regular-mark.svg";
  process.env.VITE_BRAND_COLOR = "#abc";
  const html = metadataPlugin().transformIndexHtml("<title>__APP_NAME__</title><meta content=\"__APP_SUBTITLE__\"><link rel=\"manifest\" href=\"__MANIFEST_HREF__\">");

  assert.equal(html, "<title>Roundhouse &amp; &lt;Play&gt;</title><meta content=\"A safe &lt;free&gt; game &amp; friends\"><link rel=\"manifest\" href=\"/api/public/manifest.webmanifest?fallbackName=Roundhouse+%26+%3CPlay%3E&amp;fallbackSubtitle=A+safe+%3Cfree%3E+game+%26+friends&amp;fallbackIcon=regular-mark.svg&amp;fallbackAccent=%23aabbcc\">");
});

test("Vite static metadata falls back to the shared brand default", (t) => {
  const previousName = process.env.VITE_APP_NAME;
  const previousSubtitle = process.env.VITE_APP_SUBTITLE;
  delete process.env.VITE_APP_NAME;
  delete process.env.VITE_APP_SUBTITLE;
  t.after(() => {
    if (previousName === undefined) delete process.env.VITE_APP_NAME;
    else process.env.VITE_APP_NAME = previousName;
    if (previousSubtitle === undefined) delete process.env.VITE_APP_SUBTITLE;
    else process.env.VITE_APP_SUBTITLE = previousSubtitle;
  });

  const html = metadataPlugin().transformIndexHtml("<title>__APP_NAME__</title><meta content=\"__APP_SUBTITLE__\"><link rel=\"manifest\" href=\"__MANIFEST_HREF__\">");
  const query = new URLSearchParams({ fallbackName: DEFAULT_BRAND.name, fallbackSubtitle: DEFAULT_BRAND.subtitle, fallbackIcon: DEFAULT_BRAND.icon, fallbackAccent: DEFAULT_BRAND.accent });
  const manifestHref = `/api/public/manifest.webmanifest?${query.toString().replaceAll("&", "&amp;")}`;
  assert.equal(html, `<title>${DEFAULT_BRAND.name}</title><meta content=\"${DEFAULT_BRAND.subtitle}\"><link rel=\"manifest\" href=\"${manifestHref}\">`);
});

test("Vite converts supported three/eight digit accents for the install manifest", (t) => {
  const previousColor = process.env.VITE_BRAND_COLOR;
  t.after(() => {
    if (previousColor === undefined) delete process.env.VITE_BRAND_COLOR;
    else process.env.VITE_BRAND_COLOR = previousColor;
  });
  process.env.VITE_BRAND_COLOR = "#abc";
  const plugin = metadataPlugin();
  const html = plugin.transformIndexHtml("<link href=\"__MANIFEST_HREF__\">");
  assert.match(html, /fallbackAccent=%23aabbcc/);
});

test("runtime platform assets honor the curated build fallback and reject untrusted paths", () => {
  const original = getPlatformBranding();
  const configuredFile = (path, fallback) => path.startsWith("/brand/") ? path.slice("/brand/".length) : fallback;
  assert.equal(original.logo, configuredFile(config.brand.logoPath, "ninety-club-mark.svg"));
  assert.equal(original.horizontalLogo, configuredFile(config.brand.horizontalLogoPath, "ninety-club-lockup.svg"));
  assert.equal(original.icon, configuredFile(config.brand.iconPath, "icon.svg"));
  assert.equal(original.socialCard, configuredFile(config.brand.socialCardPath, "social-card.svg"));

  const updated = setPlatformBranding({ ...original, logo: "https://example.invalid/logo.svg", icon: "../secret.svg", socialCard: "data:text/html,unsafe" });
  assert.equal(updated.logo, original.logo);
  assert.equal(updated.icon, original.icon);
  assert.equal(updated.socialCard, original.socialCard);
  setPlatformBranding(original);
});
