import { applyPlatformBranding, getPlatformBranding } from "./platform-branding.js";

const COLOR_VARS = Object.freeze({
  void: "--oh-void", obsidian: "--oh-obsidian", graphite: "--oh-graphite", panel: "--oh-panel",
  panelRaised: "--oh-panel-raised", inset: "--oh-inset", line: "--oh-line", gold: "--oh-gold",
  goldBright: "--oh-gold-bright", goldDeep: "--oh-gold-deep", coral: "--oh-brand-coral",
  silver: "--oh-silver", silverDim: "--oh-silver-dim", ivory: "--oh-ivory", text: "--oh-text",
  textMuted: "--oh-text-muted", textFaint: "--oh-text-faint", ok: "--oh-ok", warn: "--oh-warn",
  danger: "--oh-danger", info: "--oh-info", ticket: "--oh-ticket", ticketInk: "--oh-ticket-ink",
  board: "--oh-board", boardCalled: "--oh-board-called",
});
const RADIUS = Object.freeze({
  soft: ["8px", "14px", "22px", "12px"],
  rounded: ["12px", "20px", "28px", "16px"],
  square: ["4px", "8px", "12px", "6px"],
});
const SHADOW = Object.freeze({
  subtle: ["0 12px 30px -22px rgba(0,0,0,.55), 0 1px 5px -3px rgba(0,0,0,.4)", "0 18px 44px -26px rgba(0,0,0,.65)"],
  deep: ["0 18px 40px -22px rgba(0,0,0,.85), 0 2px 8px -4px rgba(0,0,0,.6)", "0 26px 60px -26px rgba(0,0,0,.9)"],
});
const FONTS = Object.freeze({
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, ui-serif, "Times New Roman", serif',
  system: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
});
const INSTANCE_LOGOS = new Set(["ninety-club-mark.svg", "ninety-club-lockup.svg", "tambola-house-mark.svg", "tambola-house-lockup.svg", "regular-mark.svg", "bumper-mark.svg"]);
const BRAND_COLOR_VARS = Object.freeze({ accent: "--oh-gold", accentBright: "--oh-gold-bright", accentDeep: "--oh-gold-deep", coral: "--oh-brand-coral" });
const LEGACY_OBSIDIAN_DEFAULT = Object.freeze({
  gold: "#42c98a", goldBright: "#9cf0c5", goldDeep: "#178354",
  void: "#07110f", obsidian: "#0b1814", graphite: "#10231c", panel: "#153027",
});
const FESTIVAL_OBSIDIAN_PRESENTATION = Object.freeze({
  void: "#100b19", obsidian: "#180f23", graphite: "#21142f", panel: "#2b1a39",
  panelRaised: "#382047", inset: "#1a1125", line: "#574064", gold: "#ffbe4d",
  goldBright: "#ffdc8a", goldDeep: "#c87918", coral: "#ff7187", silver: "#e8ddec",
  silverDim: "#c2b1ca", ivory: "#fff7e9", text: "#fff7ed", textMuted: "#d3c4d6",
  textFaint: "#b9a8c0", ticket: "#fff4dd", ticketInk: "#251426", board: "#21142f",
  boardCalled: "#ffbe4d",
});
const LEGACY_OBSIDIAN_BRANDING = Object.freeze({ accent: "#42c98a", accentBright: "#9cf0c5", accentDeep: "#178354" });

export function safeInstanceLogo(value) {
  return typeof value === "string" && INSTANCE_LOGOS.has(value) ? `/brand/${value}` : null;
}

export function instanceBrandingStyles(branding = {}) {
  const style = {};
  const isLegacyObsidian = Object.entries(LEGACY_OBSIDIAN_BRANDING).every(([key, value]) => typeof branding[key] === "string" && branding[key].toLowerCase() === value);
  // This tuple was the old built-in default, not an owner customization. Let
  // the active reviewed theme determine the accent; use the application-level
  // festival defaults only when no runtime theme is available.
  if (isLegacyObsidian) return style;
  const presentation = branding;
  for (const [key, property] of Object.entries(BRAND_COLOR_VARS)) {
    if (typeof presentation[key] === "string" && /^#[0-9a-f]{6}$/i.test(presentation[key])) style[property] = presentation[key];
  }
  if (typeof presentation.accent === "string" && /^#[0-9a-f]{6}$/i.test(presentation.accent)) {
    const [red, green, blue] = presentation.accent.slice(1).match(/../g).map((part) => Number.parseInt(part, 16));
    style["--oh-line-gold"] = `rgba(${red}, ${green}, ${blue}, .35)`;
  }
  return style;
}

export function applyInstanceBranding(branding = {}, instanceName = "") {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const colors = instanceBrandingStyles(branding);
  for (const [property, value] of Object.entries(colors)) root.style.setProperty(property, value);
  const logoUrl = safeInstanceLogo(branding.logo);
  const iconUrl = safeInstanceLogo(branding.icon || branding.logo);
  root.dataset.instanceLogo = logoUrl || "";
  root.dataset.instanceIcon = iconUrl || "";
  root.dataset.instanceName = typeof instanceName === "string" ? instanceName.slice(0, 80) : "";
  root.dataset.instanceTagline = typeof branding.tagline === "string" ? branding.tagline.slice(0, 100) : "";
  const alpha = branding.accent?.replace(/^#/, "").match(/.{2}/g);
  if (alpha?.length === 3) {
    const [red, green, blue] = alpha.map((part) => Number.parseInt(part, 16));
    root.style.setProperty("--oh-line-gold", `rgba(${red}, ${green}, ${blue}, 0.35)`);
  }
  document.dispatchEvent(new CustomEvent("instance-branding-change", { detail: { name: root.dataset.instanceName, logoUrl: root.dataset.instanceLogo, active: Boolean(instanceName) } }));
}

export function runtimeThemeValues(themePackage) {
  const tokens = themePackage?.tokens;
  if (!themePackage || themePackage.schemaVersion !== 1 || !tokens) return null;
  const values = {};
  for (const [key, variable] of Object.entries(COLOR_VARS)) {
    if (typeof tokens[key] !== "string" || !/^#[0-9a-f]{6}$/i.test(tokens[key])) return null;
    values[variable] = tokens[key];
  }
  const radius = RADIUS[tokens.radius];
  const shadow = SHADOW[tokens.shadow];
  if (!radius || !shadow || !FONTS[tokens.displayFont] || tokens.uiFont !== "system") return null;
  values["--oh-r-sm"] = radius[0];
  values["--oh-r-md"] = radius[1];
  values["--oh-r-lg"] = radius[2];
  values["--oh-r-tile"] = radius[3];
  values["--oh-shadow"] = shadow[0];
  values["--oh-shadow-lift"] = shadow[1];
  values["--oh-font-display"] = FONTS[tokens.displayFont];
  values["--oh-font-ui"] = FONTS[tokens.uiFont];
  values["--oh-font-num"] = FONTS[tokens.uiFont];
  return values;
}

export function applyRuntimeTheme(theme) {
  const packageData = theme?.package;
  const tokens = packageData?.tokens;
  const isLegacyObsidian = theme?.themeId === "obsidian-hall"
    && Object.entries(LEGACY_OBSIDIAN_DEFAULT).every(([key, value]) => typeof tokens?.[key] === "string" && tokens[key].toLowerCase() === value);
  const presentationPackage = isLegacyObsidian
    ? { ...packageData, tokens: { ...tokens, ...FESTIVAL_OBSIDIAN_PRESENTATION } }
    : packageData;
  const values = runtimeThemeValues(presentationPackage);
  if (!values || typeof document === "undefined") return false;
  const root = document.documentElement;
  for (const [name, value] of Object.entries(values)) root.style.setProperty(name, value);
  root.dataset.themeId = theme.themeId;
  root.dataset.themeVersion = String(theme.version);
  return true;
}

export function clearRuntimeTheme() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const name of [...Object.values(COLOR_VARS), "--oh-line-gold", "--oh-r-sm", "--oh-r-md", "--oh-r-lg", "--oh-r-tile", "--oh-shadow", "--oh-shadow-lift", "--oh-font-display", "--oh-font-ui", "--oh-font-num"]) root.style.removeProperty(name);
  delete root.dataset.themeId;
  delete root.dataset.themeVersion;
  delete root.dataset.instanceLogo;
  delete root.dataset.instanceIcon;
  delete root.dataset.instanceName;
  delete root.dataset.instanceTagline;
  applyPlatformBranding(getPlatformBranding());
  document.dispatchEvent(new CustomEvent("instance-branding-change", { detail: { name: "", logoUrl: "", active: false } }));
}
