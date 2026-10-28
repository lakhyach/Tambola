/**
 * Game invitations.
 *
 * One job: turn a room code into the exact free-to-play join URL a player
 * should open, plus the artefacts the owner shares it with (a QR image, a
 * WhatsApp deep link). Nothing here touches credentials: the URL carries only
 * the room code, which is a public join reference and already shared openly by
 * hosts. There is no owner session token, host token or player token anywhere in
 * this module's output.
 *
 * The public origin comes from configuration, never from a guess:
 *   PUBLIC_ORIGIN env (or config.publicOrigin) is used in production.
 *   In development, falling back to the request origin is acceptable because the
 *   address is a real one the operator can reach.
 * If the server is running in production and no public origin is configured, or
 * the configured value is a local/loopback address, the response is marked
 * `originConfigured: false` with an explicit warning. The URL is still returned
 * so the UI can show something, but it is flagged as a setup problem - we do
 * not fabricate a production address.
 *
 * QR generation uses the maintained `qrcode` package (the de-facto standard,
 * actively maintained) server-side, so the encoded value is provably the same
 * string we return to the client and can be asserted in tests.
 */

import QRCode from "qrcode";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function isLocalOrigin(origin) {
  try {
    const url = new URL(origin);
    return LOCAL_HOSTS.has(url.hostname);
  } catch {
    return true;
  }
}

/**
 * Work out the origin to build invite links from.
 * Returns { origin, configured, warning }.
 */
export function resolvePublicOrigin({ configured, requestOrigin, production = false } = {}) {
  const explicit = stripTrailingSlash(configured);
  if (explicit) {
    if (production && isLocalOrigin(explicit)) {
      return {
        origin: explicit,
        configured: false,
        warning:
          "PUBLIC_ORIGIN points at a local address while the server runs in production. " +
          "Set PUBLIC_ORIGIN to the public https address so invitations work for remote players.",
      };
    }
    return { origin: explicit, configured: true, warning: null };
  }
  if (production) {
    return {
      origin: "",
      configured: false,
      warning:
        "No PUBLIC_ORIGIN is configured. Invitations cannot be built with a public address. " +
        "Set PUBLIC_ORIGIN to the public https address of this deployment.",
    };
  }
  const fallback = stripTrailingSlash(requestOrigin);
  return {
    origin: fallback,
    configured: Boolean(fallback),
    warning: fallback ? null : "No origin available to build an invitation link.",
  };
}

export function buildInviteUrl(roomId, origin) {
  const base = stripTrailingSlash(origin);
  // same path the host screen already shares: /player?id=<CODE>
  return `${base}/player?id=${encodeURIComponent(roomId)}`;
}

export function buildWhatsAppUrl(message, url) {
  const text = `${message} ${url}`.trim();
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/**
 * Build the full invitation bundle for one room. Awaits the QR render, so the
 * caller gets a data URL it can show directly.
 */
export async function createInvitation({ roomId, gameName = null, origin, configured = true, warning = null } = {}) {
  const useOrigin = stripTrailingSlash(origin);
  if (!useOrigin) {
    // No origin at all: report the problem rather than producing a broken URL.
    return {
      roomId,
      origin: "",
      originConfigured: false,
      warning: warning || "No origin is available to build an invitation link.",
      url: null,
      qrDataUrl: null,
      whatsappUrl: null,
      message: null,
    };
  }
  const url = buildInviteUrl(roomId, useOrigin);
  const label = gameName ? `Tambola: ${gameName}` : "Tambola";
  const message = `Join my free-to-play ${label} room (code ${roomId}).`;
  const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 320, errorCorrectionLevel: "M" });
  return {
    roomId,
    origin: useOrigin,
    originConfigured: Boolean(configured),
    warning: warning || null,
    url,
    qrDataUrl,
    whatsappUrl: buildWhatsAppUrl(message, url),
    message,
  };
}
