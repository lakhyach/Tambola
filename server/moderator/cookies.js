import { randomBytes } from "node:crypto";

export const MODERATOR_COOKIE = "tambola_moderator";
export const MODERATOR_CSRF_COOKIE = "tambola_moderator_csrf";
const COOKIE_PATH = "/"; // Socket.IO's /socket.io handshake must carry the HttpOnly credential.
const CSRF_PATH = "/api/moderator";
const production = () => process.env.NODE_ENV === "production" || process.env.TAMBOLA_COOKIE_SECURE === "1";

export function readCookie(req, name) {
  const pair = String(req.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!pair) return null;
  try { return decodeURIComponent(pair.slice(name.length + 1)); } catch { return null; }
}

function append(res, value) {
  const current = res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie", current ? [...(Array.isArray(current) ? current : [current]), value] : [value]);
}

function serialize(name, value, { path, httpOnly = false, maxAge = null } = {}) {
  return [ `${name}=${encodeURIComponent(value)}`, `Path=${path}`, ...(maxAge == null ? [] : [`Max-Age=${maxAge}`]), ...(httpOnly ? ["HttpOnly"] : []), ...(production() ? ["Secure"] : []), "SameSite=Strict" ].join("; ");
}

export function setModeratorCookie(res, token) { append(res, serialize(MODERATOR_COOKIE, token, { path: COOKIE_PATH, httpOnly: true })); }
export function clearModeratorCookie(res) { append(res, serialize(MODERATOR_COOKIE, "", { path: COOKIE_PATH, httpOnly: true, maxAge: 0 })); }

export function ensureCsrf(req, res) {
  const current = readCookie(req, MODERATOR_CSRF_COOKIE);
  if (current && /^[0-9a-f]{48}$/.test(current)) return current;
  const token = randomBytes(24).toString("hex");
  append(res, serialize(MODERATOR_CSRF_COOKIE, token, { path: CSRF_PATH }));
  return token;
}

export function verifyModeratorCsrf(req) {
  const cookie = readCookie(req, MODERATOR_CSRF_COOKIE);
  const header = req.headers["x-csrf-token"];
  if (typeof cookie !== "string" || typeof header !== "string" || cookie.length !== header.length || !/^[0-9a-f]{48}$/.test(cookie)) return false;
  let diff = 0;
  for (let i = 0; i < cookie.length; i++) diff |= cookie.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}
