/**
 * The caller console's view-model — pure functions, no React, no DOM.
 *
 * Everything the host screen displays is derived here from ONE authoritative
 * server snapshot. Nothing in this file can invent a number, a state or a
 * count: each function either formats a value the server sent or says plainly
 * that the value is not available yet.
 *
 * Keeping these rules out of the components is what makes them testable under
 * `node --test` (see tests/caller-console.test.js) and keeps the console free of
 * guessing: the "next number" preview, for example, is defined as a SEALED slot
 * that carries only a count. The server never sends the next number, and this
 * module has no way to produce one.
 */

/** The server-side bounds for a calling interval (server/game/engine.js). */
export const INTERVAL_MIN_MS = 500;
export const INTERVAL_MAX_MS = 120000;

/**
 * The cadences the console offers. All inside the server's accepted range, and
 * all slow enough for a human caller to be understood between calls.
 */
export const INTERVAL_PRESETS = Object.freeze([3000, 5000, 8000, 10000, 15000, 20000, 30000]);

/** Whole seconds a preset is worth on the wire. */
export function clampInterval(ms) {
  const value = Math.round(Number(ms));
  if (!Number.isFinite(value)) return null;
  if (value < INTERVAL_MIN_MS || value > INTERVAL_MAX_MS) return null;
  return value;
}

/** "8s" — the shortest honest label for a cadence. */
export function intervalLabel(ms) {
  const value = clampInterval(ms);
  if (value === null) return "—";
  if (value % 1000 === 0) return value / 1000 + "s";
  return (value / 1000).toFixed(1) + "s";
}

/**
 * A call interval is sent on the same event as the auto-call switch, so a
 * cadence change alone must not flip the switch off. `enabled` is therefore
 * only included when it is a real boolean.
 */
export function intervalPayload(ms) {
  const value = clampInterval(ms);
  return value === null ? null : { intervalMs: value };
}

/** MM:SS, or H:MM:SS once a round passes an hour. Never negative. */
export function formatClock(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (n) => String(n).padStart(2, "0");
  return hours > 0 ? hours + ":" + two(minutes) + ":" + two(seconds) : two(minutes) + ":" + two(seconds);
}

/**
 * The clock the console shows. The server's `elapsedMs` is the anchor; while
 * the round is RUNNING the local clock advances from it between snapshots so the
 * display ticks without a request per second. A paused or completed round shows
 * the frozen server value — the console never counts time the server is not
 * counting.
 */
export function elapsedAt({ state, elapsedMs, receivedAt, now }) {
  const base = Math.max(0, Number(elapsedMs) || 0);
  if (state !== "RUNNING") return base;
  const since = Number.isFinite(receivedAt) && Number.isFinite(now) ? now - receivedAt : 0;
  return base + Math.max(0, since);
}

/**
 * What each control may do, and — when it may not — the sentence the console
 * shows instead of a dead button. The server re-checks all of this; these rules
 * only stop the host from sending an intent that is certain to be refused.
 *
 * @returns {Record<string, {enabled: boolean, reason: string}>}
 */
export function callerActions({ state, connected = true, busy = false, seated = 0, remaining = null }) {
  const waiting = state === "WAITING";
  const running = state === "RUNNING";
  const paused = state === "PAUSED";
  const finished = state === "COMPLETED";
  const idle = !busy;
  const drained = Number.isInteger(remaining) && remaining <= 0;

  const reason = (ok, why) => ({ enabled: ok, reason: ok ? "" : why });

  return {
    start: reason(waiting && idle && connected && seated > 0,
      !connected ? "not connected" : !seated ? "nobody is seated" : busy ? "working…" : "a round is already open"),
    call: reason(running && idle && !drained,
      drained ? "all 90 numbers are out" : paused ? "the round is paused" : finished ? "the round is over" : !running ? "the round has not started" : busy ? "waiting for the last call" : ""),
    pause: reason(running && idle, !running ? "nothing is running" : busy ? "working…" : ""),
    resume: reason(paused && idle, !paused ? "nothing is paused" : busy ? "working…" : ""),
    end: reason((running || paused) && idle, waiting ? "the round has not started" : finished ? "the round is already over" : busy ? "working…" : ""),
    reset: reason(finished && idle, !finished ? "only after the round ends" : busy ? "working…" : ""),
    autocall: reason((running || paused) && idle, waiting ? "starts with the round" : finished ? "the round is over" : busy ? "working…" : ""),
    interval: reason(!finished && idle, finished ? "the round is over" : busy ? "working…" : ""),
  };
}

/**
 * The room at a glance, from the roster the server sent. Ticket counts are the
 * counts the seats committed to, never grids; nothing private (session tokens,
 * player ids used as credentials) is read here.
 */
export function roomSummary({ players = [], maxPlayers = null } = {}) {
  const seats = Array.isArray(players) ? players : [];
  let tickets = 0;
  let here = 0;
  for (const seat of seats) {
    tickets += Number.isFinite(seat.tickets) ? seat.tickets : 0;
    if (seat.connected) here += 1;
  }
  const capacity = Number.isFinite(maxPlayers) && maxPlayers > 0 ? maxPlayers : null;
  return {
    seated: seats.length,
    connected: here,
    away: seats.length - here,
    tickets,
    capacity,
    seatsLeft: capacity === null ? null : Math.max(0, capacity - seats.length),
  };
}

/** The full call history, newest first, each row tagged with its call ordinal. */
export function callRows(calledNumbers = []) {
  const list = Array.isArray(calledNumbers) ? calledNumbers : [];
  const rows = [];
  for (let i = list.length - 1; i >= 0; i -= 1) rows.push({ ordinal: i + 1, number: list[i] });
  return rows;
}

/** Previous call and call-1-before-last, both from the server's history. */
export function recentCalls(calledNumbers = []) {
  const list = Array.isArray(calledNumbers) ? calledNumbers : [];
  const last = list.length ? list[list.length - 1] : null;
  const previous = list.length > 1 ? list[list.length - 2] : null;
  return { last, previous };
}

/**
 * The next-call slot. Deliberately sealed: it carries a count and nothing
 * else, because the server does not choose the next number until the call is
 * made. This function is the single place that shape is defined and the test
 * suite asserts it has no numeric `number` field.
 */
export function nextCallPreview({ remaining = null, state = "WAITING" } = {}) {
  const left = Number.isInteger(remaining) ? remaining : null;
  const label = state === "COMPLETED" ? "Round complete" : left === 0 ? "All 90 called" : "Next";
  return { sealed: true, remaining: left, label };
}

/** The one-line hint under the call button: what the clock will do next. */
export function nextCallHint({ state, autoCall = false, callIntervalMs = null, remaining = null } = {}) {
  if (state === "WAITING") return "The server draws the first number when you start";
  if (state === "PAUSED") return "Paused — the clock is stopped, nothing is drawn";
  if (state === "COMPLETED") return "Round complete — results stay available";
  if (Number.isInteger(remaining) && remaining <= 0) return "All 90 numbers have been called";
  if (autoCall) return "Auto-calling every " + intervalLabel(callIntervalMs);
  return "Manual — call the next number when the room is ready";
}

/**
 * Voice state, said plainly. The console must never show "VOICE" while nothing
 * is being spoken, and must never blame the room for a browser that cannot
 * speak: each case below is a different, honest sentence.
 */
export function voiceStatus({
  speech = false,
  dead = false,
  engine = true,
  pending = 0,
  speaking = null,
  lang = "en",
  voices = null,
  state = "RUNNING",
} = {}) {
  const language = lang === "hi" ? "Hindi" : "English";
  if (!engine) {
    return {
      tone: "off",
      label: "No voice engine",
      detail: "This browser cannot speak. The board, chime and every player's own device keep working.",
    };
  }
  if (dead) {
    return { tone: "danger", label: "Voice stopped", detail: "The browser stopped speaking. Retry starts it again." };
  }
  if (!speech) {
    return { tone: "muted", label: "Voice muted", detail: "Numbers are shown and announced on players' devices, not here." };
  }
  // Nothing will be read aloud again this round, so do not promise a next call.
  if (state === "COMPLETED") {
    return { tone: "ok", label: "Round complete", detail: "No more numbers this round — the voice has nothing left to read." };
  }
  if (Number.isInteger(speaking)) {
    return { tone: "ok", label: "Reading " + speaking, detail: "One number at a time, in call order." };
  }
  if (pending > 0) {
    return { tone: "warn", label: "Reading " + pending + " behind", detail: "The voice is catching up with the board." };
  }
  if (voices === 0) {
    return {
      tone: "warn",
      label: "No " + language + " voice listed",
      detail: "The browser will use its default voice for " + language + ".",
    };
  }
  return { tone: "ok", label: "Voice ready", detail: "The next call is read once, in " + language + "." };
}

/**
 * The keyboard map the console advertises. Single keys only, never a chord, and
 * never while the host is typing in chat — the console checks the event target.
 */
export const CALLER_KEYS = Object.freeze({
  c: "call",
  p: "pause",
  r: "repeat",
});

/** True when a keyboard event came from a field the host is typing into. */
export function isTypingTarget(target) {
  if (!target || typeof target !== "object") return false;
  const tag = String(target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return Boolean(target.isContentEditable);
}

/**
 * Fold a keypress into one console command. Returns null for anything the
 * console does not own, so the browser's own behaviour is untouched.
 */
export function hotkeyCommand(event) {
  if (!event || event.ctrlKey || event.metaKey || event.altKey) return null;
  if (typeof event.key !== "string" || event.key.length !== 1) return null;
  if (isTypingTarget(event.target)) return null;
  const key = event.key.toLowerCase();
  return Object.prototype.hasOwnProperty.call(CALLER_KEYS, key) ? CALLER_KEYS[key] : null;
}
