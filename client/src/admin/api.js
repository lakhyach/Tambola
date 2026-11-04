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
  platformBranding: () => request("GET", "/branding"),
  savePlatformBranding: (branding) => request("PUT", "/branding", { branding }),
  instanceReports: (params = {}) => request("GET", `/reports/instances${queryString(params)}`),

  moderators: () => request("GET", "/moderators"),
  moderator: (moderatorId) => request("GET", `/moderators/${encodeURIComponent(moderatorId)}`),
  createModerator: (payload) => request("POST", "/moderators", payload),
  setModeratorStatus: (moderatorId, status) => request("PATCH", `/moderators/${encodeURIComponent(moderatorId)}/status`, { status }),
  updateModeratorGrant: (moderatorId, instanceId, permissions) => request("PUT", `/moderators/${encodeURIComponent(moderatorId)}/grants/${encodeURIComponent(instanceId)}`, { permissions }),
  revokeModeratorGrant: (moderatorId, instanceId) => request("DELETE", `/moderators/${encodeURIComponent(moderatorId)}/grants/${encodeURIComponent(instanceId)}`),
  revokeModeratorSessions: (moderatorId) => request("POST", `/moderators/${encodeURIComponent(moderatorId)}/sessions/revoke`, {}),
  issueModeratorRecovery: (moderatorId) => request("POST", `/moderators/${encodeURIComponent(moderatorId)}/recovery`, {}),

  instances: () => request("GET", "/instances"),
  instanceOverview: (instanceId) => request("GET", `/instances/${encodeURIComponent(instanceId)}/overview`),
  createInstance: (payload) => request("POST", "/instances", payload),
  updateInstance: (instanceId, payload) => request("PATCH", `/instances/${encodeURIComponent(instanceId)}`, payload),

  sessions: (instanceId) => request("GET", `/instances/${encodeURIComponent(instanceId)}/sessions`),
  createSession: (instanceId, payload) => request("POST", `/instances/${encodeURIComponent(instanceId)}/sessions`, payload),
  generateSessionInventory: (instanceId, sessionId, payload) => request("POST", `/instances/${encodeURIComponent(instanceId)}/sessions/${encodeURIComponent(sessionId)}/inventory`, payload),
  sessionTickets: (instanceId, sessionId, params = {}) => request("GET", `/instances/${encodeURIComponent(instanceId)}/sessions/${encodeURIComponent(sessionId)}/tickets${queryString(params)}`),
  updateSession: (instanceId, sessionId, payload) => request("PATCH", `/instances/${encodeURIComponent(instanceId)}/sessions/${encodeURIComponent(sessionId)}`, payload),
  reservations: (instanceId, params = {}) => request("GET", `/instances/${encodeURIComponent(instanceId)}/reservations${queryString(params)}`),
  reservation: (instanceId, reservationId) => request("GET", `/instances/${encodeURIComponent(instanceId)}/reservations/${encodeURIComponent(reservationId)}`),
  cancelReservation: (instanceId, reservationId) => request("POST", `/instances/${encodeURIComponent(instanceId)}/reservations/${encodeURIComponent(reservationId)}/cancel`, {}),

  themes: () => request("GET", "/themes/store"),
  activeTheme: () => request("GET", "/themes/active"),
  themeSchedule: () => request("GET", "/themes/schedule"),
  themeReleases: (params = {}) => request("GET", `/themes/releases${queryString(params)}`),
  themeNotifications: () => request("GET", "/themes/notifications"),
  markThemeNotificationRead: (notificationId) => request("POST", `/themes/notifications/${encodeURIComponent(notificationId)}/read`, {}),
  createThemeDraft: (payload) => request("POST", "/themes/drafts", payload),
  createThemeVersion: (themeId, payload) => request("POST", `/themes/${encodeURIComponent(themeId)}/versions`, payload),
  approveThemeVersion: (themeId, versionId) => request("POST", `/themes/${encodeURIComponent(themeId)}/versions/${encodeURIComponent(versionId)}/approve`, {}),
  approveTheme: (themeId) => request("POST", `/themes/${encodeURIComponent(themeId)}/approve`, {}),
  retireTheme: (themeId) => request("POST", `/themes/${encodeURIComponent(themeId)}/retire`, {}),
  publishTheme: (themeVersionId) => request("POST", "/themes/publish", { themeVersionId }),
  rollbackTheme: () => request("POST", "/themes/rollback", {}),
  saveThemeSchedule: (payload) => request("PUT", "/themes/schedule", payload),
  setInstanceTheme: (instanceId, payload) => request("PUT", `/themes/instances/${encodeURIComponent(instanceId)}/selection`, payload),

  posterTemplates: () => request("GET", "/posters/templates"),
  posterProvider: () => request("GET", "/posters/provider"),
  posterSessions: (instanceId) => request("GET", `/posters/sessions${queryString({ instanceId })}`),
  posterSessionContext: (instanceId, sessionId) => request("GET", `/posters/sessions/${encodeURIComponent(sessionId)}/context${queryString({ instanceId })}`),
  generatePosterArtwork: (payload) => request("POST", "/posters/generate", payload),
  posterTemplateSchedule: () => request("GET", "/posters/templates/schedule"),
  savePosterTemplateSchedule: (payload) => request("PUT", "/posters/templates/schedule", payload),
  posters: () => request("GET", "/posters"),
  createPoster: (payload) => request("POST", "/posters/drafts", payload),
  savePoster: (posterId, payload) => request("PUT", `/posters/${encodeURIComponent(posterId)}`, payload),
  duplicatePoster: (posterId) => request("POST", `/posters/${encodeURIComponent(posterId)}/duplicate`, {}),
  publishPoster: (posterId) => request("POST", `/posters/${encodeURIComponent(posterId)}/publish`, {}),
  createPosterTemplate: (payload) => request("POST", "/posters/templates/drafts", payload),
  createPosterTemplateVersion: (templateId, payload) => request("POST", `/posters/templates/${encodeURIComponent(templateId)}/versions`, payload),
  approvePosterTemplate: (templateId) => request("POST", `/posters/templates/${encodeURIComponent(templateId)}/approve`, {}),
  approvePosterTemplateVersion: (templateId, versionId) => request("POST", `/posters/templates/${encodeURIComponent(templateId)}/versions/${encodeURIComponent(versionId)}/approve`, {}),
  publishPosterTemplate: (templateVersionId) => request("POST", "/posters/templates/publish", { templateVersionId }),
  rollbackPosterTemplate: (templateId, templateVersionId) => request("POST", `/posters/templates/${encodeURIComponent(templateId)}/rollback`, { templateVersionId }),

  games: (params) => request("GET", `/games${queryString(params)}`),
  createGame: (payload) => request("POST", "/games", payload),
  game: (roomId) => request("GET", `/games/${encodeURIComponent(roomId)}`),
  invitation: (roomId) => request("GET", `/games/${encodeURIComponent(roomId)}/invitation`),
  action: (roomId, action, payload) =>
    request("POST", `/games/${encodeURIComponent(roomId)}/${action}`, payload === undefined ? {} : payload),
  recoverRoom: (roomId) => request("POST", `/games/${encodeURIComponent(roomId)}/recover`, {}),
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
  backupStatus: () => request("GET", "/backups/status"),
};
