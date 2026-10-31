/**
 * Production environment gate.
 *
 * `npm start` already refuses to run without a database, and the server fails
 * at boot on a malformed OWNER_MFA_KEY. Everything else that makes a deployment
 * *correct* rather than merely runnable - a TLS-verified database URL, the
 * public origin used in invite links, proxy awareness for real client IPs, a
 * non-default database password - was only described in DEPLOYMENT.md for a
 * human to remember. This script turns that checklist into an assertion so a
 * deploy pipeline (or an operator) can fail before the container starts.
 *
 * Two profiles:
 *   production  everything must be right; a missing or unsafe value is an error
 *   development a laptop may legitimately be incomplete; the same findings are
 *               reported as warnings, malformed values stay errors
 *
 * Nothing here prints a value from the environment - only the variable name and
 * the reason. That keeps a CI log or a screenshot from leaking a connection
 * string.
 *
 * CLI
 *   node scripts/env-check.mjs                 # profile from NODE_ENV
 *   node scripts/env-check.mjs --production    # force the strict profile
 *   node scripts/env-check.mjs --json          # machine readable
 *   node scripts/env-check.mjs --quiet         # exit code only
 *
 * Exit code 0 = no errors (warnings allowed), 1 = at least one error.
 */

import { pathToFileURL } from "node:url";

const MANAGED_HOSTS =
  /(^|\.)(supabase\.(co|com|in)|neon\.tech|neon\.build|render\.com|railway\.app|fly\.dev|koyeb\.app|aivencloud\.com|timescale\.com|amazonaws\.com|azure\.com|digitalocean\.com|ondigitalocean\.com|db\.ondigitalocean\.com)$/i;

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|::1|\[::1\]|0\.0\.0\.0|host\.docker\.internal)$/i;

function isManagedHost(hostname) {
  return Boolean(hostname) && MANAGED_HOSTS.test(hostname);
}

function isLocalHost(hostname) {
  return Boolean(hostname) && LOCAL_HOST.test(hostname);
}

/** Parse an absolute http(s) origin, or null. A root trailing slash is
 * canonicalised away; any path, query or fragment is refused. Never echoes the
 * input. */
export function parseOrigin(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.pathname !== "/" || url.search || url.hash) return null;
  return url;
}

/** A 32-byte key as 64 hex characters or standard base64 (server's format). */
export function isMfaKeyShape(raw) {
  if (typeof raw !== "string") return false;
  const value = raw.trim();
  if (/^[0-9a-f]{64}$/i.test(value)) return true;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  try {
    return Buffer.from(value, "base64").length === 32;
  } catch {
    return false;
  }
}

function intOrNull(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

/**
 * @param {Record<string, string|undefined>} env
 * @param {{profile?: "production"|"development"}} [options]
 * @returns {{profile: string, ok: boolean, errors: number, warnings: number, checks: Array<{id:string, level:"ok"|"warn"|"error", detail:string}>}}
 */
export function validateEnv(env = {}, options = {}) {
  const profile =
    options.profile || ((env.NODE_ENV || "").toLowerCase() === "production" ? "production" : "development");
  const strict = profile === "production";
  const checks = [];

  function add(id, level, detail) {
    checks.push({ id, level, detail });
  }
  /** A production requirement: error under the strict profile, warning otherwise. */
  function requirement(id, ok, detail) {
    if (ok) add(id, "ok", "set");
    else add(id, strict ? "error" : "warn", detail);
  }
  /** A genuine misconfiguration in any profile. */
  function wrong(id, ok, detail) {
    if (ok) add(id, "ok", "valid");
    else add(id, "error", detail);
  }

  // ------------------------------------------------------------- mode / database
  if (strict && (env.NODE_ENV || "").toLowerCase() !== "production") {
    add("NODE_ENV", "warn", "not 'production'; Secure cookies and HSTS stay off");
  } else if (strict) {
    add("NODE_ENV", "ok", "production");
  }

  const rawUrl = env.DATABASE_URL;
  let dbUrl = null;
  if (rawUrl && rawUrl.trim()) {
    try {
      dbUrl = new URL(rawUrl.trim());
    } catch {
      dbUrl = null;
    }
  }
  if (!dbUrl) {
    requirement(
      "DATABASE_URL",
      false,
      "missing or unparseable; a production server without a database refuses to start (ALLOW_MEMORY_ONLY is not a deployment mode)"
    );
  } else {
    const proto = dbUrl.protocol.replace(":", "");
    const host = dbUrl.hostname;
    const password = dbUrl.password;
    const sslmode = (dbUrl.searchParams.get("sslmode") || "").toLowerCase();
    const managed = isManagedHost(host);
    const local = isLocalHost(host);

    wrong("DATABASE_URL.protocol", proto === "postgres" || proto === "postgresql", "must be postgres:// or postgresql://");
    requirement("DATABASE_URL.host", Boolean(host), "has no host");

    const defaultPassword = /^(tambola|postgres|password|admin|root|changeme)$/i.test(password || "");
    wrong(
      "DATABASE_URL.password",
      !defaultPassword && Boolean(password),
      "uses a default or empty password; set a generated one before exposing this server"
    );

    if (local) {
      add(
        "DATABASE_URL.tls",
        "warn",
        "database host is localhost: correct for a single VM with a private Postgres, never for a managed plan (use the provider's TLS URL)"
      );
    } else if (!sslmode) {
      wrong(
        "DATABASE_URL.tls",
        false,
        "remote database URL has no sslmode; add sslmode=verify-full (Supabase: &sslrootcert=/app/deploy/supabase-root-ca.pem)"
      );
    } else if (sslmode === "disable" || sslmode === "prefer") {
      wrong("DATABASE_URL.tls", false, "sslmode=" + sslmode + " does not verify the server; use verify-full or require");
    } else {
      add("DATABASE_URL.tls", "ok", "sslmode=" + sslmode);
    }

    if (managed && sslmode && sslmode !== "verify-full" && sslmode !== "require") {
      add("DATABASE_URL.tls", "warn", "managed database with sslmode=" + sslmode + "; verify-full is stronger");
    }
    if (/6543/.test(dbUrl.port || "")) {
      add("DATABASE_URL.port", "warn", "port 6543 is a transaction pooler; this server needs session pooling (5432) for its advisory lease");
    }
  }

  if (env.ALLOW_MEMORY_ONLY === "1") {
    wrong("ALLOW_MEMORY_ONLY", false, "set to 1: every room is lost on restart and the owner console cannot sign in");
  } else {
    add("ALLOW_MEMORY_ONLY", "ok", "not set");
  }

  // ----------------------------------------------------------------- origin / TLS
  const origin = env.PUBLIC_ORIGIN ? parseOrigin(env.PUBLIC_ORIGIN) : null;
  if (!env.PUBLIC_ORIGIN) {
    requirement("PUBLIC_ORIGIN", false, "unset: invite links and QR codes fall back to the request host and the admin UI warns");
  } else if (!origin) {
    wrong("PUBLIC_ORIGIN", false, "is not a bare http(s) origin such as https://games.example.com (no path, no trailing slash)");
  } else if (origin.protocol !== "https:") {
    requirement("PUBLIC_ORIGIN", false, "is http; a public deployment must serve https or browsers block Secure cookies");
  } else {
    add("PUBLIC_ORIGIN", "ok", "https origin");
  }

  if (env.ALLOWED_ORIGINS && env.ALLOWED_ORIGINS.trim()) {
    const entries = env.ALLOWED_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean);
    const bad = entries.filter((value) => {
      const parsed = parseOrigin(value);
      return !parsed || parsed.protocol !== "https:";
    });
    if (bad.length) {
      requirement("ALLOWED_ORIGINS", false, bad.length + " entr(y/ies) are not bare https origins");
    } else if (origin && entries.length === 1 && entries[0].replace(/\/+$/, "") === origin.origin) {
      add("ALLOWED_ORIGINS", "warn", "lists only PUBLIC_ORIGIN; leave it empty for same-origin sockets");
    } else {
      add("ALLOWED_ORIGINS", "ok", entries.length + " origin(s)");
    }
  }

  requirement(
    "TRUST_PROXY",
    env.TRUST_PROXY === "1",
    "not 1: behind Cloudflare, a PaaS router or nginx every client shares one IP, so rate limits and logs are wrong"
  );

  if (env.TAMBOLA_COOKIE_SECURE === "0" || (env.TAMBOLA_COOKIE_SECURE || "").toLowerCase() === "false") {
    wrong("TAMBOLA_COOKIE_SECURE", false, "explicitly disables Secure cookies while the site is public");
  }

  // ---------------------------------------------------------------- owner / MFA
  if (!env.OWNER_MFA_KEY) {
    requirement(
      "OWNER_MFA_KEY",
      false,
      "unset: the owner console reports MFA as unconfigured and refuses to enrol; set it before handing the site over"
    );
  } else if (!isMfaKeyShape(env.OWNER_MFA_KEY)) {
    wrong("OWNER_MFA_KEY", false, "is neither 64 hex characters nor base64 of 32 bytes; the server would fail at boot");
  } else {
    add("OWNER_MFA_KEY", "ok", "32-byte key");
  }

  if (!env.MFA_ISSUER || env.MFA_ISSUER === "Tambola") {
    add("MFA_ISSUER", "warn", "still the default label shown in authenticator apps");
  }

  // ------------------------------------------------------------------- database load
  const poolMax = intOrNull(env.DB_POOL_MAX);
  if (poolMax === null) {
    add("DB_POOL_MAX", "ok", "default 8 (plus the lease connection)");
  } else if (poolMax > 50) {
    wrong("DB_POOL_MAX", false, "above the hard ceiling of 50; the server clamps it, so the configured value would be a lie");
  } else if (poolMax > 20) {
    add("DB_POOL_MAX", "warn", poolMax + " connections per instance; keep pool+1 under the plan's connection limit");
  } else {
    add("DB_POOL_MAX", "ok", String(poolMax));
  }

  const acquire = intOrNull(env.DB_POOL_ACQUIRE_TIMEOUT_MS);
  if (acquire !== null && (acquire < 500 || acquire > 60000)) {
    add("DB_POOL_ACQUIRE_TIMEOUT_MS", "warn", "outside 500-60000ms");
  }

  // ------------------------------------------------------------------- gameplay
  const interval = intOrNull(env.CALL_INTERVAL_MS);
  if (interval !== null && (interval < 500 || interval > 120000)) {
    add("CALL_INTERVAL_MS", "warn", "outside the clamped 500-120000ms range");
  }
  const players = intOrNull(env.MAX_PLAYERS);
  if (players !== null && (players < 2 || players > 1000)) {
    add("MAX_PLAYERS", "warn", "outside a sensible 2-1000 range");
  }

  // ------------------------------------------------------------------ logging
  if (env.LOG_FILE) {
    add("LOG_FILE", "warn", "writes to a file: containers should log to stdout so the platform collects and rotates them");
  }
  if (env.LOG_LEVEL && !["debug", "info", "warn", "error"].includes(env.LOG_LEVEL)) {
    add("LOG_LEVEL", "warn", "unknown level; the logger falls back to info");
  }

  const errors = checks.filter((check) => check.level === "error").length;
  const warnings = checks.filter((check) => check.level === "warn").length;
  return { profile, ok: errors === 0, errors, warnings, checks };
}

/** Human-readable lines. Neither values nor secrets appear here. */
export function formatReport(result) {
  const lines = [];
  lines.push("Tambola environment check - " + result.profile + " profile");
  for (const check of result.checks) {
    if (check.level === "ok") continue;
    lines.push("  " + (check.level === "error" ? "FAIL" : "WARN").padEnd(4) + "  " + check.id.padEnd(26) + " " + check.detail);
  }
  const passed = result.checks.filter((check) => check.level === "ok").length;
  lines.push(
    "  " +
      passed +
      " ok, " +
      result.warnings +
      " warning(s), " +
      result.errors +
      " error(s) - " +
      (result.ok ? "READY" : "NOT READY")
  );
  return lines.join("\n");
}

// ------------------------------------------------------------------------ CLI

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const args = new Set(process.argv.slice(2));
  const profile = args.has("--production") ? "production" : args.has("--development") ? "development" : undefined;
  const result = validateEnv(process.env, { profile });
  if (args.has("--json")) console.log(JSON.stringify(result, null, 2));
  else if (!args.has("--quiet")) console.log(formatReport(result));
  process.exitCode = result.ok ? 0 : 1;
}
