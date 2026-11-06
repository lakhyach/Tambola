// Shared by the runtime configuration and Vite's static HTML metadata plugin.
// This keeps crawlers and first paint aligned with the brand shown after boot.
export const DEFAULT_BRAND = Object.freeze({
  name: "Ninety Club",
  subtitle: "Gather your friends for free, joyful live Tambola.",
  logo: "ninety-club-crown-controller.svg",
  horizontalLogo: "ninety-club-wordmark.svg",
  icon: "ninety-club-crown-controller-icon.svg",
  socialCard: "ninety-club-social-card.svg",
  accent: "#ffbe4d",
});

export function normalizeManifestAccent(value) {
  const color = typeof value === "string" ? value.trim() : "";
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(color)) return `#${[...color.slice(1)].map((digit) => digit + digit).join("")}`.toLowerCase();
  if (/^#[0-9a-f]{8}$/i.test(color)) return color.slice(0, 7).toLowerCase();
  return DEFAULT_BRAND.accent;
}
