/**
 * Clipboard helper with a legacy fallback.
 *
 * navigator.clipboard is unavailable on insecure origins and inside some
 * embeds, so the invite panel must still be able to copy. The fallback uses a
 * temporary textarea and the deprecated execCommand path; it is only reached
 * when the modern API is absent or rejects.
 */

export async function copyText(value) {
  const text = String(value == null ? "" : value);
  if (!text) throw new Error("nothing to copy");

  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "-1000px";
  area.style.opacity = "0";
  document.body.appendChild(area);
  try {
    area.select();
    const ok = document.execCommand("copy");
    if (!ok) throw new Error("copy was refused");
  } finally {
    document.body.removeChild(area);
  }
}
