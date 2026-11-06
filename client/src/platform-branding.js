import { useSyncExternalStore } from "react";
import { config } from "./config.js";
import { DEFAULT_BRAND, normalizeManifestAccent } from "./brand-defaults.js";

const assets = new Set([
  "ninety-club-mark.svg", "ninety-club-lockup.svg", "ninety-club-crown-controller.svg",
  "ninety-club-wordmark.svg", "ninety-club-crown-controller-icon.svg", "ninety-club-social-card.svg", "regular-mark.svg",
  "bumper-mark.svg", "icon.svg", "social-card.svg", "tambola-house-mark.svg",
  "tambola-house-lockup.svg", "tambola-house-icon.svg", "tambola-house-social-card.svg",
]);

const fallback = Object.freeze({
  name: config.brand.name,
  tagline: config.brand.tagline,
  subtitle: config.brand.subtitle,
  mark: config.brand.mark,
  logo: configuredAsset(config.brand.logoPath, DEFAULT_BRAND.logo),
  horizontalLogo: configuredAsset(config.brand.horizontalLogoPath, DEFAULT_BRAND.horizontalLogo),
  icon: configuredAsset(config.brand.iconPath, DEFAULT_BRAND.icon),
  socialCard: configuredAsset(config.brand.socialCardPath, DEFAULT_BRAND.socialCard),
  accent: config.theme.gold,
  accentBright: config.theme.goldBright,
  accentDeep: config.theme.goldDeep,
  coral: config.theme.coral,
  termsUrl: config.links.terms,
  privacyUrl: config.links.privacy,
  supportUrl: config.links.support,
  footerNotice: config.footer.notice,
});

let current = { ...fallback };
const listeners = new Set();

export function getPlatformBranding() { return current; }
export function subscribePlatformBranding(listener) { listeners.add(listener); return () => listeners.delete(listener); }
export function usePlatformBranding() { return useSyncExternalStore(subscribePlatformBranding, getPlatformBranding, getPlatformBranding); }

function safeAsset(value, fallbackAsset) { return assets.has(value) ? value : fallbackAsset; }
function configuredAsset(value, fallbackAsset) {
  const filename = typeof value === "string" && value.startsWith("/brand/") ? value.slice("/brand/".length) : "";
  return safeAsset(filename, fallbackAsset);
}
function safeColor(value, fallbackColor) { return /^#[0-9a-f]{6}$/i.test(value || "") ? value : fallbackColor; }

export function setPlatformBranding(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return current;
  current = {
    ...fallback,
    ...value,
    name: value.name === undefined
      ? fallback.name
      : typeof value.name === "string" && value.name.trim().toLowerCase() === "tambola house"
        ? DEFAULT_BRAND.name
        : value.name,
    logo: safeAsset(value.logo, fallback.logo),
    horizontalLogo: safeAsset(value.horizontalLogo, fallback.horizontalLogo),
    icon: safeAsset(value.icon, fallback.icon),
    socialCard: safeAsset(value.socialCard, fallback.socialCard),
    accent: safeColor(value.accent, fallback.accent),
    accentBright: safeColor(value.accentBright, fallback.accentBright),
    accentDeep: safeColor(value.accentDeep, fallback.accentDeep),
    coral: safeColor(value.coral, fallback.coral),
  };
  applyPlatformBranding(current);
  for (const listener of listeners) listener();
  if (typeof document !== "undefined") document.dispatchEvent(new CustomEvent("platform-branding-change", { detail: current }));
  return current;
}

function ensureMeta(selector, attribute, name) {
  let element = document.querySelector(selector);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, name);
    document.head.appendChild(element);
  }
  return element;
}

export function applyPlatformBranding(value = current) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!root.dataset.themeId && !root.dataset.instanceName) {
    root.style.setProperty("--oh-gold", value.accent);
    root.style.setProperty("--oh-gold-bright", value.accentBright);
    root.style.setProperty("--oh-gold-deep", value.accentDeep);
    root.style.setProperty("--oh-brand-coral", value.coral);
    const rgb = value.accent.slice(1).match(/.{2}/g)?.map((part) => Number.parseInt(part, 16));
    if (rgb?.length === 3) root.style.setProperty("--oh-line-gold", `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.35)`);
  }
  document.title = value.name;
  ensureMeta('meta[name="description"]', "name", "description").setAttribute("content", value.subtitle);
  ensureMeta('meta[property="og:title"]', "property", "og:title").setAttribute("content", value.name);
  ensureMeta('meta[property="og:description"]', "property", "og:description").setAttribute("content", value.subtitle);
  ensureMeta('meta[property="og:image"]', "property", "og:image").setAttribute("content", new URL(`/brand/${value.socialCard}`, window.location.origin).href);
  const icon = document.querySelector('link[rel="icon"]');
  if (icon) icon.setAttribute("href", `/brand/${value.icon}`);
  const appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
  if (appleIcon) appleIcon.setAttribute("href", ["icon.svg", "tambola-house-icon.svg", "ninety-club-crown-controller-icon.svg"].includes(value.icon) ? "/icon/ninety-club-180.png" : `/brand/${value.icon}`);
  const manifest = document.querySelector('link[rel="manifest"]');
  if (manifest) {
    const query = new URLSearchParams({ fallbackName: value.name, fallbackSubtitle: value.subtitle, fallbackIcon: value.icon, fallbackAccent: normalizeManifestAccent(value.accent) });
    manifest.setAttribute("href", `/api/public/manifest.webmanifest?${query.toString()}`);
  }
}

export async function loadPlatformBranding() {
  try {
    const response = await fetch("/api/public/branding", { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!response.ok) return current;
    const data = await response.json();
    return setPlatformBranding(data?.branding);
  } catch {
    return current;
  }
}

export function assetUrl(asset) { return `/brand/${safeAsset(asset, fallback.logo)}`; }
