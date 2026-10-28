/**
 * Display formatting for the owner control centre.
 *
 * Pure functions only. Every one of them degrades to an explicit placeholder
 * ("—") when a value is missing rather than inventing a figure, because the
 * dashboard must never show a number or timestamp the server did not send.
 */

import { PATTERN_META } from "../brand.js";

const DATE_TIME = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const DATE_ONLY = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "2-digit" });
const TIME_ONLY = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(value) {
  const date = toDate(value);
  return date ? DATE_TIME.format(date) : "—";
}

export function formatDate(value) {
  const date = toDate(value);
  return date ? DATE_ONLY.format(date) : "—";
}

export function formatClock(value) {
  const date = toDate(value);
  return date ? TIME_ONLY.format(date) : "—";
}

/** Compact "3m ago" style age. Older than a week is shown as a date. */
export function formatRelative(value) {
  const date = toDate(value);
  if (!date) return "—";
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 0) return formatDateTime(date);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(date);
}

export function formatInterval(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value < 1000) return `${Math.round(value)} ms`;
  const seconds = value / 1000;
  return Number.isInteger(seconds) ? `${seconds}s` : `${seconds.toFixed(1)}s`;
}

export function formatNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString() : "—";
}

const STATUS_LABELS = {
  WAITING: "Waiting",
  RUNNING: "Live",
  PAUSED: "Paused",
  COMPLETED: "Completed",
  CLOSED: "Closed",
  ABANDONED: "Abandoned",
  AWARDED: "Awarded",
  REJECTED: "Rejected",
  ACCEPTED: "Accepted",
  OPEN: "Open",
};

export function statusLabel(status) {
  if (!status) return "Unknown";
  return STATUS_LABELS[status] || status.charAt(0) + status.slice(1).toLowerCase();
}

const STATUS_TONES = {
  WAITING: "info",
  RUNNING: "ok",
  PAUSED: "warn",
  COMPLETED: "silver",
  CLOSED: "muted",
  ABANDONED: "danger",
  AWARDED: "ok",
  REJECTED: "danger",
  ACCEPTED: "ok",
  OPEN: "info",
};

export function statusTone(status) {
  return STATUS_TONES[status] || "muted";
}

export function claimTone(status) {
  if (status === "AWARDED" || status === "ACCEPTED") return "ok";
  if (status === "REJECTED") return "danger";
  return "warn";
}

/** Cosmetic label for a winning pattern; the rules remain server-side only. */
export function patternLabel(id) {
  if (!id) return "—";
  const meta = PATTERN_META[id];
  return meta ? meta.label : id;
}

export function enabledPatternIds(config) {
  if (!config || typeof config.patterns !== "object" || config.patterns === null) return [];
  return Object.keys(config.patterns).filter((id) => config.patterns[id]);
}

/** Human-friendly one-liner for a health string from the API. */
export function healthLabel(value) {
  if (value === "ok") return "Operational";
  if (value === "down") return "Unreachable";
  if (value === "not-configured") return "Not configured";
  return value ? String(value) : "Unknown";
}

export function healthTone(value) {
  if (value === "ok") return "ok";
  if (value === "down") return "danger";
  if (value === "not-configured") return "muted";
  return "muted";
}
