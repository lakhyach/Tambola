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
 *   • This is the deployment fallback brand. Future instance identity must
 *     come from validated server configuration, not these Vite defaults.
 */

import { DEFAULT_BRAND } from "./brand-defaults.js";

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

export const config = {
  brand: {
    name: (() => {
      const name = str("VITE_APP_NAME", DEFAULT_BRAND.name);
      return name.trim().toLowerCase() === "tambola house" ? DEFAULT_BRAND.name : name;
    })(),
    tagline: str("VITE_APP_TAGLINE", "A festive home for Tambola"),
    subtitle: str("VITE_APP_SUBTITLE", DEFAULT_BRAND.subtitle),
    logoPath: str("VITE_APP_LOGO", `/brand/${DEFAULT_BRAND.logo}`),
    horizontalLogoPath: str("VITE_APP_HORIZONTAL_LOGO", `/brand/${DEFAULT_BRAND.horizontalLogo}`),
    compactLogoPath: str("VITE_APP_COMPACT_LOGO", `/brand/${DEFAULT_BRAND.logo}`),
    iconPath: str("VITE_APP_ICON", `/brand/${DEFAULT_BRAND.icon}`),
    socialCardPath: str("VITE_APP_SOCIAL_CARD", `/brand/${DEFAULT_BRAND.socialCard}`),
    // Provisional identity. Alternatives: Roundhouse 90, Rally Ninety.
    mark: str("VITE_BRAND_EYEBROW", "FESTIVAL GAME NIGHT"),
  },

  // Provisional festival / saffron / gulal identity; replaceable by env.
  theme: {
    gold: color("VITE_BRAND_COLOR", DEFAULT_BRAND.accent),
    goldBright: color("VITE_BRAND_COLOR_BRIGHT", "#ffdc8a"),
    goldDeep: color("VITE_BRAND_COLOR_DEEP", "#c87918"),
    coral: color("VITE_BRAND_CORAL", "#ff7187"),
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
    // Application interface language. Hindi remains available only as a voice
    // option in the caller; UI text, quick messages, and navigation are English.
    supported: ["en"],
    default: "en",
    bilingualPicker: false,
  },
};

/** True when `lang` is one of the supported catalogue languages. */
export function isSupportedLang(lang) {
  return config.i18n.supported.includes(lang);
}

/** Normalise a raw value to a supported language, falling back to the default. */
export function resolveLang(lang) {
  void lang;
  return "en";
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
  root.style.setProperty("--oh-brand-coral", config.theme.coral);
  // Derive the translucent gold hairline from the accent so it stays in sync.
  const alpha = gold.replace(/^#/, "").match(/.{2}/g);
  if (alpha && alpha.length >= 3) {
    const [r, g, b] = alpha.slice(0, 3).map((h) => parseInt(h, 16));
    root.style.setProperty("--oh-line-gold", `rgba(${r}, ${g}, ${b}, 0.35)`);
  }
}
