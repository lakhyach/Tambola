/**
 * CLIENT CONFIGURATION LAYER
 * --------------------------
 * The single, documented place for everything a purchasing client may want to
 * re-brand without editing component code: product name, tagline, logo, accent
 * colours, footer/legal links, supported languages and default language.
 *
 * Design rules:
 *   • Display + theme only. Nothing here changes gameplay. Ticket limits, room
 *     size, call interval and winning-pattern RULES stay server-authoritative
 *     and reach the client through the room snapshot / publicConfig — this file
 *     never overrides them.
 *   • Every value has a safe built-in default, so the app runs with zero config.
 *   • A handful of values can be overridden at build time through Vite `VITE_*`
 *     env vars (documented in .env.example). They are baked into the client
 *     bundle, so they are NON-SECRET branding strings only — never paste keys,
 *     tokens or anything sensitive into a VITE_* variable.
 *   • This is a whole-product config, not multi-tenant SaaS. One deployment
 *     serves one brand.
 */

const env = (typeof import.meta !== "undefined" && import.meta.env) || {};

/** Trimmed non-empty string override, else the built-in default. */
const str = (key, fallback) => {
  const v = env[key];
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
};

/** A hex colour (#rgb / #rrggbb / #rrggbbaa) override, else the default. */
const color = (key, fallback) => {
  const v = typeof env[key] === "string" ? env[key].trim() : "";
  return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ? v : fallback;
};

/** Boolean override: "true"/true enables, any other value keeps the default. */
const flag = (key, fallback) => (env[key] === undefined ? fallback : env[key] === "true" || env[key] === true);

export const config = {
  brand: {
    name: str("VITE_APP_NAME", "Tambola"),
    tagline: str("VITE_APP_TAGLINE", "The Obsidian Hall of Ninety Numbers"),
    subtitle: str("VITE_APP_SUBTITLE", "A free, fast, real-time multiplayer game of Tambola / Housie."),
    logoPath: str("VITE_APP_LOGO", "/icon/android-chrome-192x192.png"),
    // the small house label beside the product name in the header and game bar
    mark: str("VITE_BRAND_EYEBROW", "Obsidian Hall"),
  },

  // Champagne-gold accent family. Overriding BRAND_COLOR re-tints the single
  // accent that runs through the whole "Obsidian Hall" identity.
  theme: {
    gold: color("VITE_BRAND_COLOR", "#cfab63"),
    goldBright: color("VITE_BRAND_COLOR_BRIGHT", "#efd49a"),
    goldDeep: color("VITE_BRAND_COLOR_DEEP", "#9a7a34"),
  },

  // Legal / help links surfaced in the footer and waiting rooms. Left blank by
  // default: the UI hides any link that has no URL, so an unconfigured build
  // never shows a dead "Terms" button.
  links: {
    terms: str("VITE_TERMS_URL", ""),
    privacy: str("VITE_PRIVACY_URL", ""),
    support: str("VITE_SUPPORT_URL", ""),
  },

  footer: {
    notice: str("VITE_FOOTER_NOTICE", "Free to play. No money, wagers or prizes."),
  },

  i18n: {
    // Languages the quick-message catalogue and celebration strings ship with.
    supported: ["en", "hi"],
    default: str("VITE_DEFAULT_LANG", "en"),
    // When true, the chat picker offers both languages side by side; when false
    // it shows only the default language's messages.
    bilingualPicker: flag("VITE_BILINGUAL_CHAT", true),
  },
};

/** True when `lang` is one of the supported catalogue languages. */
export function isSupportedLang(lang) {
  return config.i18n.supported.includes(lang);
}

/** Normalise a raw value to a supported language, falling back to the default. */
export function resolveLang(lang) {
  return isSupportedLang(lang) ? lang : config.i18n.default;
}

/**
 * Push the theme accent colours into the `--oh-*` design tokens so a re-brand
 * needs no CSS rebuild. Called once at boot (see main.jsx). Only touches the
 * gold accent + its hairline; every other token keeps its stylesheet value.
 */
export function applyTheme(root = typeof document !== "undefined" ? document.documentElement : null) {
  if (!root || typeof root.style?.setProperty !== "function") return;
  const { gold, goldBright, goldDeep } = config.theme;
  root.style.setProperty("--oh-gold", gold);
  root.style.setProperty("--oh-gold-bright", goldBright);
  root.style.setProperty("--oh-gold-deep", goldDeep);
  // Derive the translucent gold hairline from the accent so it stays in sync.
  const alpha = gold.replace(/^#/, "").match(/.{2}/g);
  if (alpha && alpha.length >= 3) {
    const [r, g, b] = alpha.slice(0, 3).map((h) => parseInt(h, 16));
    root.style.setProperty("--oh-line-gold", `rgba(${r}, ${g}, ${b}, 0.35)`);
  }
}
