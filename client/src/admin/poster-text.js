/** Keep fixed-width poster copy readable when it has to be shortened. */
export function truncatePosterText(value, limit) {
  const copy = String(value ?? "").slice(0, 240).trim();
  if (!Number.isInteger(limit) || limit < 2) return copy;
  if (copy.length <= limit) return copy;

  const prefix = copy.slice(0, limit - 1);
  const boundary = prefix.lastIndexOf(" ");
  const readable = boundary >= Math.floor((limit - 1) * 0.6)
    ? prefix.slice(0, boundary)
    : prefix.trimEnd();
  return `${readable.trimEnd()}…`;
}
