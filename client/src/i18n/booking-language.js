import { useSyncExternalStore } from "react";

const STORAGE_KEY = "oh:booking-language";
const CHANGE_EVENT = "oh-booking-language-change";

export const BOOKING_LANGUAGES = [
  { id: "en", label: "English" },
];

export function resolveBookingLanguage(value) {
  void value;
  return "en";
}

export function getBookingLanguage() {
  // React calls this from render; keep it side-effect free. Old saved Hindi UI
  // preferences are ignored and the app remains English-only.
  return "en";
}

export function setBookingLanguage(value) {
  void value;
  const language = "en";
  try { globalThis.localStorage?.setItem(STORAGE_KEY, language); } catch { /* in-memory state still updates */ }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE_EVENT));
  return language;
}

function subscribe(callback) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, callback);
  return () => window.removeEventListener(CHANGE_EVENT, callback);
}

export function useBookingLanguage() {
  return useSyncExternalStore(subscribe, getBookingLanguage, () => "en");
}
