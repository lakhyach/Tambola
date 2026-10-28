/**
 * Owner cookies: the transport for the owner session token and the CSRF token.
 *
 * No cookie-parser dependency is added. This is a deliberately small, focused
 * reader/writer for exactly the two cookies the admin app uses:
 *
 *   tambola_owner  HttpOnly, SameSite=Strict, Secure in production, Path=/api/admin.
 *                  Carries the owner session token. Never readable by page
 *                  script, so a cross-site script cannot lift it; Path scoping
 *                  means it is only ever sent to the admin API surface.
 *
 *   tambola_csrf   NOT HttpOnly (the SPA must echo it back), SameSite
 *                  =Strict, Secure in production, Path=/api/admin. This is the
 *                  double-submit anti-CSRF value: a state-changing request must
 *                  present it in the X-CSRF-Token header matching the cookie.
 *                  SameSite=Strict already blocks a cross-site browser from
 *                  sending the cookie at all; the header check is the second
 *                  lock. The value is an anti-forgery token, not a credential,
 *                  so leaving it script-readable is safe.
 *
 * A CSRF token is never a secret session value and a session token is never
 * placed in a URL, a header the client reads, or a log line.
 */

import { randomBytes } from "node:crypto";

export const OWNER_COOKIE = "tambola_owner";
export const CSRF_COOKIE = "tambola_csrf";
export const CSRF_HEADER = "x-csrf-token";
export const COOKIE_PATH = "/api/admin";

function isProduction() {
  return process.env.NODE_ENV === "production" || process.env.TAMBOLA_COOKIE_SECURE === "1";
}

/** Parse a Cookie header into a plain object. Safe on absent/malformed input. */
export function parseCookies(header) {
  const out = Object.create(null);
  if (typeof header !== "string" || !header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      out[name] = decodeURIComponent(raw);
    } catch {
      out[name] = raw;
    }
  }
  return out;
}

export function serializeCookie(name, value, { httpOnly = false, maxAgeSeconds = null, secure = isProduction(), path = COOKIE_PATH } = {}) {
  const segments = [`${name}=${encodeURIComponent(value)}`];
  segments.push(`Path=${path}`);
  if (maxAgeSeconds != null) segments.push(`Max-Age=${Math.floor(maxAgeSeconds)}`);
  if (httpOnly) segments.push("HttpOnly");
  if (secure) segments.push("Secure");
  segments.push("SameSite=Strict");
  return segments.join("; ");
}

function appendSetCookie(res, cookie) {
  const existing = res.getHeader("Set-Cookie");
  if (!existing) res.setHeader("Set-Cookie", [cookie]);
  else if (Array.isArray(existing)) res.setHeader("Set-Cookie", [...existing, cookie]);
  else res.setHeader("Set-Cookie", [existing, cookie]);
}

export function setOwnerCookie(res, token) {
  appendSetCookie(res, serializeCookie(OWNER_COOKIE, token, { httpOnly: true }));
}

export function clearOwnerCookie(res) {
  appendSetCookie(res, serializeCookie(OWNER_COOKIE, "", { httpOnly: true, maxAgeSeconds: 0 }));
}

/** Ensure a CSRF cookie exists; return the value the SPA must echo back. */
export function ensureCsrfToken(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const existing = cookies[CSRF_COOKIE];
  if (existing && /^[0-9a-f]{32,128}$/.test(existing)) return existing;
  const token = randomBytes(24).toString("hex");
  appendSetCookie(res, serializeCookie(CSRF_COOKIE, token, { httpOnly: false }));
  return token;
}

/**
 * Double-submit check for state-changing requests. Returns true only when the
 * header and the cookie are both present and byte-identical.
 */
export function verifyCsrf(req) {
  const cookies = parseCookies(req.headers.cookie);
  const fromCookie = cookies[CSRF_COOKIE];
  const fromHeader = req.headers[CSRF_HEADER];
  if (!fromCookie || typeof fromHeader !== "string") return false;
  if (fromCookie.length < 32 || fromHeader.length < 32) return false;
  // constant-time comparison of equal-length strings
  if (fromCookie.length !== fromHeader.length) return false;
  let diff = 0;
  for (let i = 0; i < fromCookie.length; i++) diff |= fromCookie.charCodeAt(i) ^ fromHeader.charCodeAt(i);
  return diff === 0;
}

export function readOwnerToken(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[OWNER_COOKIE];
  return typeof token === "string" && /^[0-9a-f]{16,128}$/.test(token) ? token : null;
}
