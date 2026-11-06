const ASSETS = new Set([
  "ninety-club-mark.svg",
  "ninety-club-lockup.svg",
  "regular-mark.svg",
  "bumper-mark.svg",
  "icon.svg",
  "social-card.svg",
  "tambola-house-mark.svg",
  "tambola-house-lockup.svg",
  "tambola-house-icon.svg",
  "tambola-house-social-card.svg",
]);
const COLORS = ["accent", "accentBright", "accentDeep", "coral"];
const KEYS = new Set(["name", "tagline", "subtitle", "mark", "logo", "horizontalLogo", "icon", "socialCard", ...COLORS, "termsUrl", "privacyUrl", "supportUrl", "footerNotice"]);
const HEX = /^#[0-9a-f]{6}$/i;

export const DEFAULT_PLATFORM_BRANDING = Object.freeze({
  name: "Ninety Club",
  tagline: "",
  subtitle: "Gather your friends for free, joyful live Tambola.",
  mark: "",
  logo: "ninety-club-mark.svg",
  horizontalLogo: "ninety-club-lockup.svg",
  icon: "ninety-club-mark.svg",
  socialCard: "social-card.svg",
  accent: "#ffbe4d",
  accentBright: "#ffdc8a",
  accentDeep: "#c87918",
  coral: "#ff7187",
  termsUrl: "",
  privacyUrl: "",
  supportUrl: "",
  footerNotice: "Free to play. No money, wagers or prizes.",
});

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((part) => Number.parseInt(part, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

function validText(value, { min = 0, max, required = false } = {}) {
  return typeof value === "string" && value.trim().length >= min && value.trim().length <= max
    && !(required && !value.trim()) && !/[<>\u0000-\u001f]/.test(value);
}

function validUrl(value) {
  if (value === "") return true;
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}

export function validatePlatformBranding(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "INVALID_BRANDING" };
  if (Object.keys(value).some((key) => !KEYS.has(key))) return { error: "INVALID_BRANDING" };
  const branding = { ...DEFAULT_PLATFORM_BRANDING };
  for (const [key, limits] of Object.entries({
    name: { min: 2, max: 48, required: true },
    tagline: { max: 100 },
    subtitle: { max: 180 },
    mark: { max: 32 },
    footerNotice: { max: 180 },
  })) {
    if (value[key] === undefined) continue;
    if (!validText(value[key], limits)) return { error: "INVALID_BRANDING" };
    branding[key] = value[key].trim();
  }
  for (const key of ["logo", "horizontalLogo", "icon", "socialCard"]) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== "string" || !ASSETS.has(value[key])) return { error: "INVALID_BRANDING" };
    branding[key] = value[key];
  }
  for (const key of COLORS) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== "string" || !HEX.test(value[key])) return { error: "INVALID_BRANDING" };
    branding[key] = value[key].toLowerCase();
  }
  for (const key of ["termsUrl", "privacyUrl", "supportUrl"]) {
    if (value[key] === undefined) continue;
    if (!validUrl(value[key])) return { error: "INVALID_BRANDING" };
    branding[key] = value[key];
  }
  if (contrast(branding.accent, "#07110f") < 3
    || contrast(branding.accentBright, "#07110f") < 4.5
    || contrast(branding.coral, "#07110f") < 3) return { error: "INVALID_BRANDING" };
  return { branding };
}

export function publicPlatformBranding(value) {
  const validated = validatePlatformBranding({ ...DEFAULT_PLATFORM_BRANDING, ...(value || {}) });
  if (validated.error) return { ...DEFAULT_PLATFORM_BRANDING };
  const branding = validated.branding;
  if (branding.name.trim().toLowerCase() === "tambola house" || /festival\s+game\s+night/i.test(branding.name)) branding.name = "Ninety Club";
  if (/festival\s+game\s+night/i.test(branding.tagline)) branding.tagline = "";
  if (/festival\s+game\s+night/i.test(branding.mark)) branding.mark = "";
  const isLegacyProjectDefault = branding.name === "Ninety Club"
    && branding.tagline === "A fresh table for every game"
    && branding.logo === "ninety-club-mark.svg"
    && branding.horizontalLogo === "ninety-club-lockup.svg"
    && branding.icon === "icon.svg"
    && branding.socialCard === "social-card.svg";
  return isLegacyProjectDefault ? { ...DEFAULT_PLATFORM_BRANDING } : branding;
}

export function publicPlatformManifest(value, fallback = {}) {
  const fallbackBranding = { ...DEFAULT_PLATFORM_BRANDING };
  const requestedFallback = fallback && typeof fallback === "object" && !Array.isArray(fallback) ? fallback : {};
  if (typeof requestedFallback.name === "string" && validText(requestedFallback.name, { min: 2, max: 48, required: true })) {
    fallbackBranding.name = requestedFallback.name.trim();
  }
  if (typeof requestedFallback.subtitle === "string" && validText(requestedFallback.subtitle, { max: 180 })) {
    fallbackBranding.subtitle = requestedFallback.subtitle.trim();
  }
  if (typeof requestedFallback.icon === "string" && ASSETS.has(requestedFallback.icon)) {
    fallbackBranding.icon = requestedFallback.icon;
  }
  if (typeof requestedFallback.accent === "string" && HEX.test(requestedFallback.accent)
    && contrast(requestedFallback.accent, "#07110f") >= 3) {
    fallbackBranding.accent = requestedFallback.accent.toLowerCase();
  }
  const branding = value ? publicPlatformBranding(value) : fallbackBranding;
  return {
    name: branding.name,
    short_name: branding.name,
    description: branding.subtitle,
    start_url: "/",
    scope: "/",
    display: "standalone",
    icons: [{ src: `/brand/${branding.icon}`, sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
    theme_color: branding.accent,
    background_color: "#07110f",
  };
}

export function createPlatformBrandingService({ db = null } = {}) {
  let memoryValue = null;

  async function get() {
    if (!db) return { branding: memoryValue ? { ...memoryValue } : null, durable: false };
    const result = await db.query("SELECT value FROM platform_settings WHERE setting_key='branding'");
    return { branding: result.rows[0] ? publicPlatformBranding(result.rows[0].value) : null, durable: true };
  }

  async function save(value, updatedBy) {
    const checked = validatePlatformBranding(value);
    if (checked.error) return checked;
    if (db) {
      await db.query(
        `INSERT INTO platform_settings(setting_key,value,updated_by) VALUES ('branding',$1,$2)
         ON CONFLICT (setting_key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()`,
        [JSON.stringify(checked.branding), String(updatedBy || "owner").slice(0, 80)],
      );
    } else {
      memoryValue = checked.branding;
    }
    return { branding: checked.branding, durable: Boolean(db) };
  }

  return { get, save, durable: Boolean(db) };
}
