import { createHmac } from "node:crypto";

export function parsePhoneLookupKey(value) {
  if (typeof value !== "string" || !/^(?:[a-f0-9]{64}|[A-Za-z0-9+/]{43}=?)$/i.test(value.trim())) return null;
  const normalizedValue = value.trim();
  const key = /^[a-f0-9]{64}$/i.test(normalizedValue) ? Buffer.from(normalizedValue, "hex") : Buffer.from(normalizedValue, "base64");
  return key.length === 32 ? key : null;
}

export function normalizePhoneNumber(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/[\s().-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}

export function hashPhoneForSession(key, sessionId, phone) {
  const normalized = normalizePhoneNumber(phone);
  if (!key || !normalized) return null;
  return createHmac("sha256", key).update(`${sessionId}:${normalized}`).digest("hex");
}
