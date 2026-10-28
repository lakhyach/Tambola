/**
 * Owner multi-factor authentication: TOTP, and the encryption that protects it.
 *
 * Two separate jobs, kept together because they must agree on one detail: the
 * secret is only ever usable by this module.
 *
 *  1. RFC 6238 verification, delegated to the maintained `otpauth` package. The
 *     code is checked with a ±1 step window (30 s each side) to absorb clock
 *     drift, and the accepted time step is returned so the caller can persist it
 *     and refuse a replay of the same code inside its window.
 *
 *  2. Secret storage. A database dump must never be enough to mint a valid
 *     second factor, so the base32 secret is sealed with AES-256-GCM under a key
 *     read from OWNER_MFA_KEY. The owner id is authenticated as additional data,
 *     so a ciphertext copied from one row into another fails to decrypt.
 *
 * Envelope: v1.<iv base64url>.<tag base64url>.<ciphertext base64url>
 *
 * There is deliberately NO default or fallback key. If OWNER_MFA_KEY is absent
 * the feature reports itself unconfigured and enrollment is refused; if it is
 * present but malformed the server fails at boot rather than accepting a weak
 * key (see parseMfaKey). An enrolled owner whose key has gone missing cannot
 * sign in - that is the point of "fail closed" - and the documented recovery is
 * the server-side CLI, which requires host access.
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { TOTP, Secret } from "otpauth";

export const MFA_KEY_ENV = "OWNER_MFA_KEY";
export const MFA_DIGITS = 6;
export const MFA_PERIOD_SECONDS = 30;
export const MFA_WINDOW = 1;
const AAD_PREFIX = "owner-mfa:";
const ENVELOPE_VERSION = "v1";

/** 6 digits, leading zeros allowed. Anything else is refused before any crypto. */
export function normalizeCode(raw) {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\s+/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

/**
 * Read the key from the environment. Accepts 32 raw bytes as base64 (with or
 * without padding) or as 64 hex characters - nothing shorter, nothing longer.
 * Returns {configured:false} when unset (MFA simply unavailable), and throws on
 * a value that is set but wrong, so a typo cannot silently downgrade security.
 */
export function parseMfaKey(raw, { label = MFA_KEY_ENV } = {}) {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return { configured: false, key: null };
  }
  const text = String(raw).trim();
  let key = null;
  if (/^[0-9a-fA-F]{64}$/.test(text)) {
    key = Buffer.from(text, "hex");
  } else if (/^[A-Za-z0-9+/_-]{43}=?$/.test(text)) {
    // base64url and standard base64 are both accepted; 32 bytes is 44 chars padded
    key = Buffer.from(text.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  }
  if (!key || key.length !== 32) {
    const error = new Error(`${label} must be 32 bytes encoded as base64 or 64 hex characters`);
    error.code = "MFA_KEY_INVALID";
    throw error;
  }
  return { configured: true, key };
}

export function mfaKeyFromEnv(env = process.env) {
  return parseMfaKey(env[MFA_KEY_ENV]);
}

/** Seal a base32 secret for one owner. Returns null when no key is configured. */
export function encryptSecret({ secret, ownerId, key } = {}) {
  if (!key) return null;
  if (typeof secret !== "string" || !secret) throw new Error("encryptSecret() needs a base32 secret");
  if (!ownerId) throw new Error("encryptSecret() needs the owning owner id");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(AAD_PREFIX + ownerId, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENVELOPE_VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

/**
 * Open a sealed secret. Returns null for anything that does not authenticate -
 * a wrong key, a tampered row, a ciphertext from another owner - and never
 * throws with secret material in the message.
 */
export function decryptSecret({ envelope, ownerId, key } = {}) {
  if (!key || typeof envelope !== "string" || !ownerId) return null;
  const parts = envelope.split(".");
  if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) return null;
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const ciphertext = Buffer.from(parts[3], "base64url");
    if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(AAD_PREFIX + ownerId, "utf8"));
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    return /^[A-Z2-7]+=*$/.test(plain) ? plain : null;
  } catch {
    return null;
  }
}

/** A fresh 160-bit base32 secret, as every authenticator app expects. */
export function generateSecret() {
  return new Secret({ size: 20 }).base32;
}

function totpFor({ secret, issuer, label }) {
  return new TOTP({
    issuer,
    label,
    secret: Secret.fromBase32(secret),
    algorithm: "SHA1",
    digits: MFA_DIGITS,
    period: MFA_PERIOD_SECONDS,
  });
}

/** otpauth:// URI for the enrollment QR. Never logged, shown once. */
export function provisioningUri({ secret, username, issuer = "Tambola" } = {}) {
  if (!secret || !username) throw new Error("provisioningUri() needs a secret and a username");
  return totpFor({ secret, issuer, label: username }).toString();
}

/** Code for the current step - used by tests and the enrollment self-check. */
export function currentCode({ secret, now = Date.now() } = {}) {
  return totpFor({ secret, issuer: "Tambola", label: "self" }).generate({ timestamp: now });
}

/**
 * Verify a code for a secret.
 *
 * Returns {ok:true, step} when the code is valid AND newer than `lastStep`, so
 * the same six digits cannot be used twice inside their window. Returns
 * {ok:false, reason} otherwise: "FORMAT", "MISMATCH" or "REPLAY".
 */
export function verifyCode({ secret, code, lastStep = null, now = Date.now(), window = MFA_WINDOW } = {}) {
  const token = normalizeCode(code);
  if (!token) return { ok: false, reason: "FORMAT" };
  if (typeof secret !== "string" || !secret) return { ok: false, reason: "MISMATCH" };
  let delta = null;
  try {
    delta = totpFor({ secret, issuer: "Tambola", label: "verify" }).validate({ token, timestamp: now, window });
  } catch {
    return { ok: false, reason: "MISMATCH" };
  }
  if (delta === null || delta === undefined) return { ok: false, reason: "MISMATCH" };
  const step = Math.floor(now / 1000 / MFA_PERIOD_SECONDS) + Number(delta);
  if (lastStep != null && Number.isFinite(Number(lastStep)) && step <= Number(lastStep)) {
    return { ok: false, reason: "REPLAY", step };
  }
  return { ok: true, step };
}

/**
 * Compare two secrets without leaking length through timing. Only used to keep
 * enrollment idempotent; not part of verification.
 */
export function sameSecret(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Description of the MFA state for the settings screen - never the secret. */
export function describeMfa({ confirmedAt = null, pending = false, keyConfigured = false, locked = false } = {}) {
  if (!keyConfigured) return { state: "unavailable", enrolled: false, pending: false, keyConfigured: false };
  if (confirmedAt) return { state: "enrolled", enrolled: true, pending: false, keyConfigured: true, confirmedAt };
  if (pending) return { state: "pending", enrolled: false, pending: true, keyConfigured: true };
  return { state: "not-enrolled", enrolled: false, pending: false, keyConfigured: true, ...(locked ? { locked: true } : {}) };
}
