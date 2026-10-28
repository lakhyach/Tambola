/**
 * Structured, redacting logger - small enough to have no dependencies.
 *
 * One JSON object per line:
 *   {"ts":"...","level":"info","service":"tambola","event":"room.created",
 *    "requestId":"...","msg":"...", ...fields}
 *
 * Why this exists
 *   The original server logged ad-hoc strings through a `log(...args)` callback.
 *   Nothing carried a timestamp, a severity or a request id, and an error
 *   message was printed verbatim - a pg failure can quote a parameter, and a
 *   thrown error can quote a path. This module keeps every existing call site
 *   working (via `shim`) while giving new code a real interface, and it scrubs
 *   the parts that must never reach a log: passwords, session tokens, cookies,
 *   CSRF values, TOTP secrets, connection strings.
 *
 * Rotation
 *   stdout is the default sink and the right one under systemd/Docker (use the
 *   platform's log driver for retention). If LOG_FILE is set, lines are appended
 *   there and the file is rotated at LOG_MAX_BYTES (default 5 MB) keeping
 *   LOG_KEEP (default 3) older files. Nothing is ever deleted outside that
 *   directory.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const SENSITIVE_KEY = /pass(word)?|secret|token|cookie|authorization|csrf|totp|otp|api[-_]?key|database_url|dsn|session[-_]?id|challenge/i;
const HEX_SECRET = /\b[0-9a-f]{32,}\b/gi;
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:[^\s@/]+@/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

export const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40, silent: 100 });

/** Scrub one string. Never called on a value we intend to keep verbatim. */
export function redactString(text) {
  return String(text)
    .replace(URL_CREDENTIALS, "$1[redacted]@")
    .replace(BEARER, "Bearer [redacted]")
    .replace(HEX_SECRET, "[redacted]");
}

/** Deep-scrub a structured field value. Sensitive keys become "[redacted]". */
export function redactValue(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) return { name: value.name, code: value.code || null, message: redactString(value.message || "") };
  if (depth >= 4) return "[depth]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactValue(item, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 50)) {
      out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redactValue(item, depth + 1);
    }
    return out;
  }
  return String(value);
}

function rotateIfNeeded(file, maxBytes, keep) {
  try {
    const stats = fs.statSync(file);
    if (stats.size < maxBytes) return;
    for (let index = keep - 1; index >= 1; index--) {
      const from = index === 1 ? file : `${file}.${index - 1}`;
      const to = `${file}.${index}`;
      if (fs.existsSync(from)) fs.renameSync(from, to);
    }
  } catch {
    /* first write, nothing to rotate */
  }
}

function createFileSink(file, { maxBytes, keep }) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  rotateIfNeeded(file, maxBytes, keep);
  const stream = fs.createWriteStream(file, { flags: "a" });
  stream.on("error", () => {});
  return stream;
}

/**
 * @returns a logger with debug/info/warn/error plus `child(fields)` and
 *          `shim(...args)` for the legacy call sites.
 */
export function createLogger({
  level = process.env.LOG_LEVEL || "info",
  service = "tambola",
  now = () => new Date(),
  sink = null,
  file = process.env.LOG_FILE || null,
  maxBytes = Number(process.env.LOG_MAX_BYTES) || 5 * 1024 * 1024,
  keep = Number(process.env.LOG_KEEP) || 3,
} = {}) {
  const threshold = LEVELS[String(level).toLowerCase()] ?? LEVELS.info;
  const stream = sink ? null : file ? createFileSink(file, { maxBytes, keep }) : null;
  const write = sink || ((line) => (stream ? stream.write(line) : process.stdout.write(line)));

  function emit(levelName, event, fields = {}) {
    if (LEVELS[levelName] < threshold) return;
    const record = {
      ts: now().toISOString(),
      level: levelName,
      service,
      event: redactString(event || "log"),
      ...redactValue(fields),
    };
    write(JSON.stringify(record) + "\n");
  }

  function build(baseFields) {
    return {
      level,
      debug: (event, fields) => emit("debug", event, { ...baseFields, ...fields }),
      info: (event, fields) => emit("info", event, { ...baseFields, ...fields }),
      warn: (event, fields) => emit("warn", event, { ...baseFields, ...fields }),
      error: (event, fields) => emit("error", event, { ...baseFields, ...fields }),
      child: (fields) => build({ ...baseFields, ...fields }),
      /**
       * Legacy adapter: `log("room created", roomId)` from existing modules.
       * The first argument becomes the message; a level is inferred from words
       * that already appear in the project's messages, so nothing has to be
       * rewritten at once.
       */
      shim: (...args) => {
        const parts = args.map((item) => (item instanceof Error ? item.message : item));
        const message = parts.filter((part) => part !== undefined && part !== null).join(" ");
        const lower = message.toLowerCase();
        const levelName = /fail|error|lost|refused|unreachable|exceeded/.test(lower)
          ? "warn"
          : /frozen|cannot|denied/.test(lower)
            ? "warn"
            : "info";
        emit(levelName, "message", { ...baseFields, msg: message });
      },
      close: () => stream && stream.end(),
    };
  }

  return build({});
}

/** Request/response line with a correlation id and a safe path (no query string). */
export function requestLogger(logger) {
  return function middleware(req, res, next) {
    const id = req.headers["x-request-id"] && /^[A-Za-z0-9_-]{8,64}$/.test(String(req.headers["x-request-id"]))
      ? String(req.headers["x-request-id"])
      : randomUUID();
    req.id = id;
    res.setHeader("X-Request-Id", id);
    const started = process.hrtime.bigint();
    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
      logger[level]("http.request", {
        requestId: id,
        method: req.method,
        path: String(req.path || req.url || "").split("?")[0],
        status: res.statusCode,
        durationMs: Math.round(durationMs * 10) / 10,
      });
    });
    next();
  };
}
