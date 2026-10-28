/**
 * Owner control-centre API client.
 *
 * Same-origin by default. The owner session lives in an HttpOnly cookie scoped
 * to /api/admin, so this module never sees or stores the session token; it only
 * remembers the CSRF value the server returns in a response body so it can echo
 * it back in the X-CSRF-Token header on state-changing requests.
 *
 * Two failure behaviours matter to the UI:
 *   - 401 UNAUTHENTICATED means the owner session is gone. The provider is told
 *     so every screen can fall back to sign-in without duplicating that check.
 *   - 403 CSRF_FAILED means our remembered token went stale (a rotated cookie,
 *     a second tab). It is recoverable: refresh the session, retry once.
 *
 * Nothing here decides authorisation. The server re-verifies the owner on every
 * request; this client only presents what the browser already holds.
 */

const BASE = (import.meta.env.VITE_ADMIN_API_BASE || "/api/admin").replace(/\/+$/, "");

let csrfToken = null;
let onUnauthenticated = () => {};

/** The error shape every screen renders. `message` is always safe to display. */
export class ApiError extends Error {
  constructor(message, { status = 0, code = "NETWORK", payload = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

export function setCsrfToken(token) {
  if (typeof token === "string" && token) csrfToken = token;
}

export function setUnauthenticatedHandler(handler) {
  onUnauthenticated = typeof handler === "function" ? handler : () => {};
}

function queryString(params) {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function send(method, path, body, retry) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && csrfToken) headers["X-CSRF-Token"] = csrfToken;

  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("The control centre could not reach the server.", { status: 0, code: "NETWORK" });
  }

  const payload = await readJson(response);
  if (payload && typeof payload.csrfToken === "string") csrfToken = payload.csrfToken;

  if (!response.ok) {
    const code = (payload && payload.code) || `HTTP_${response.status}`;
    if (response.status === 403 && code === "CSRF_FAILED" && retry) {
      try {
        await fetchSession();
        return send(method, path, body, false);
      } catch {
        /* fall through to the original error */
      }
    }
    if (response.status === 401) onUnauthenticated();
    const message = (payload && payload.error) || `The request failed (${response.status}).`;
    throw new ApiError(message, { status: response.status, code, payload });
  }
  return payload;
}

function request(method, path, body) {
  return send(method, path, body, true);
}

export function fetchSession() {
  return request("GET", "/session");
}

export const api = {
  session: fetchSession,
  signIn: (username, password) => request("POST", "/signin", { username, password }),
  // Second step of an MFA sign-in. The challenge token is the only credential it
  // accepts, and it is spent whether the code is right or wrong - a rejected code
  // means starting over with the password, not retrying the same challenge.
  signInMfa: (challengeToken, code) => request("POST", "/signin/mfa", { challengeToken, code }),
  signOut: () => request("POST", "/signout"),

  overview: () => request("GET", "/overview"),

  games: (params) => request("GET", `/games${queryString(params)}`),
  createGame: (payload) => request("POST", "/games", payload),
  game: (roomId) => request("GET", `/games/${encodeURIComponent(roomId)}`),
  invitation: (roomId) => request("GET", `/games/${encodeURIComponent(roomId)}/invitation`),
  action: (roomId, action, payload) =>
    request("POST", `/games/${encodeURIComponent(roomId)}/${action}`, payload === undefined ? {} : payload),
  closeRoom: (roomId) => request("POST", `/games/${encodeURIComponent(roomId)}/close`, {}),
  removeMember: (roomId, playerId) =>
    request("DELETE", `/games/${encodeURIComponent(roomId)}/members/${encodeURIComponent(playerId)}`),

  players: (params) => request("GET", `/players${queryString(params)}`),
  player: (playerId) => request("GET", `/players/${encodeURIComponent(playerId)}`),

  history: (params) => request("GET", `/history${queryString(params)}`),
  audit: (params) => request("GET", `/audit${queryString(params)}`),

  settings: () => request("GET", "/settings"),
  changePassword: (currentPassword, newPassword, code) =>
    request("POST", "/settings/password", { currentPassword, newPassword, ...(code ? { code } : {}) }),

  // Second-factor management. The secret and its QR are returned once, by enroll;
  // nothing here caches them and nothing writes them to storage.
  mfaEnroll: () => request("POST", "/settings/mfa/enroll", {}),
  mfaConfirm: (code) => request("POST", "/settings/mfa/confirm", { code }),
  mfaDisable: (code) => request("POST", "/settings/mfa/disable", { code }),

  health: () => request("GET", "/health"),
};
