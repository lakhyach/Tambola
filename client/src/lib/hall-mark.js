export function hallMark(slug = "") {
  const value = String(slug).toLowerCase();
  if (/(^|[-_])bumper($|[-_])/.test(value)) return { src: "/brand/bumper-mark.svg", alt: "Bumper Tambola emblem" };
  if (/(^|[-_])regular($|[-_])/.test(value)) return { src: "/brand/regular-mark.svg", alt: "Regular Tambola emblem" };
  return null;
}
