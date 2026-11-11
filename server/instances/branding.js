export const INSTANCE_LOGO_FILES = Object.freeze([
  "ninety-club-mark.svg",
  "ninety-club-lockup.svg",
  "ninety-club-crown-controller.svg",
  "ninety-club-wordmark.svg",
  "regular-mark.svg",
  "bumper-mark.svg",
]);

const COLOR_FIELDS = ["accent", "accentBright", "accentDeep", "coral"];
const ALLOWED_FIELDS = new Set(["logo", "icon", "tagline", "contacts", ...COLOR_FIELDS]);
const HEX = /^#[0-9a-f]{6}$/i;
const CONTACT_TEXT = /^[\p{L}\p{N} .+'()_-]{1,60}$/u;
const PHONE = /^\+?[0-9 ()-]{7,20}$/;
const validPhone = (value) => typeof value === "string" && PHONE.test(value.trim()) && value.replace(/\D/g, "").length >= 7 && value.replace(/\D/g, "").length <= 15;

function validateContacts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const contacts = {};
  for (const key of ["hostName", "hostPhone", "hostWhatsapp", "hostEmail"]) {
    if (value[key] === undefined || value[key] === "") continue;
    if (typeof value[key] !== "string") return null;
    const field = value[key].trim();
    if (key === "hostName" ? !CONTACT_TEXT.test(field) : key === "hostEmail" ? field.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(field) : !validPhone(field)) return null;
    contacts[key] = field;
  }
  if (value.agents !== undefined) {
    if (!Array.isArray(value.agents) || value.agents.length > 10) return null;
    contacts.agents = [];
    for (const agent of value.agents) {
      if (!agent || !CONTACT_TEXT.test(agent.name || "") || !validPhone(agent.phone)) return null;
      contacts.agents.push({ name: agent.name.trim(), phone: agent.phone.trim() });
    }
  }
  return contacts;
}

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((value) => Number.parseInt(value, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(first, second) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
}

export function validateInstanceBranding(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "INVALID_BRANDING" };
  const keys = Object.keys(value);
  if (keys.some((key) => !ALLOWED_FIELDS.has(key))) return { error: "INVALID_BRANDING" };
  const branding = {};
  for (const key of ["logo", "icon"]) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== "string" || !INSTANCE_LOGO_FILES.includes(value[key])) return { error: "INVALID_BRANDING" };
    branding[key] = value[key];
  }
  if (value.tagline !== undefined) {
    if (typeof value.tagline !== "string" || value.tagline.trim().length > 100 || /[<>\u0000-\u001f]/.test(value.tagline)) return { error: "INVALID_BRANDING" };
    branding.tagline = value.tagline.trim();
  }
  if (value.contacts !== undefined) {
    const contacts = validateContacts(value.contacts);
    if (!contacts) return { error: "INVALID_BRANDING" };
    branding.contacts = contacts;
  }
  for (const key of COLOR_FIELDS) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== "string" || !HEX.test(value[key])) return { error: "INVALID_BRANDING" };
    branding[key] = value[key].toLowerCase();
  }
  const darkSurface = "#07110f";
  if (branding.accent && contrast(branding.accent, darkSurface) < 3
    || branding.accentBright && contrast(branding.accentBright, darkSurface) < 4.5
    || branding.coral && contrast(branding.coral, darkSurface) < 3) return { error: "INVALID_BRANDING" };
  return { branding };
}

export function publicInstanceBranding(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const safe = {};
  for (const key of ["logo", "icon"]) if (INSTANCE_LOGO_FILES.includes(value[key])) safe[key] = value[key];
  if (typeof value.tagline === "string" && value.tagline.length <= 100 && !/[<>\u0000-\u001f]/.test(value.tagline)) safe.tagline = value.tagline;
  const contacts = validateContacts(value.contacts);
  if (contacts && Object.keys(contacts).length) safe.contacts = contacts;
  for (const key of COLOR_FIELDS) if (typeof value[key] === "string" && HEX.test(value[key])) safe[key] = value[key].toLowerCase();
  const darkSurface = "#07110f";
  if (safe.accent && contrast(safe.accent, darkSurface) < 3) delete safe.accent;
  if (safe.accentBright && contrast(safe.accentBright, darkSurface) < 4.5) delete safe.accentBright;
  if (safe.coral && contrast(safe.coral, darkSurface) < 3) delete safe.coral;
  return safe;
}
