#!/usr/bin/env node
/**
 * Secret scan (Phase 14 §10) — "does anything sensitive ship?"
 *
 *   npm run secret-scan
 *
 * Two independent questions, because they fail differently:
 *
 *  1. LEAKAGE — does a credential that lives in the local `.env` appear anywhere
 *     in version-controlled content or in the built client bundle? A single
 *     deployed secret baked into `VITE_*` territory, copied into a doc, or
 *     committed by accident is the incident this catches. Only variables that are
 *     plausibly credentials are compared — by name (`…_PASSWORD`, `…_TOKEN`,
 *     `DATABASE_URL`, …) or because the value itself carries a
 *     `scheme://user:pass@` shape. Plain configuration (`NODE_ENV=production`,
 *     `SESSION_IDLE_MS=604800000`) is not a secret and is not treated as one.
 *
 *  2. SHAPE — does any scanned file contain something that looks like a
 *     credential regardless of `.env` (a connection string with a password, a
 *     private key block, a cloud access key)? This catches secrets introduced by
 *     hand, which is exactly how they usually appear.
 *
 * These two checks are not equally strong, and pretending otherwise would be
 * worse than saying it: the SHAPE check is a heuristic with a deliberate bias
 * toward silence, because documentation is legitimately full of illustrated
 * credentials (`postgres://user:pass@…`). A line carrying an obvious placeholder
 * word is therefore excused, which means a hand-written secret dressed up as an
 * example could slip past it. The LEAKAGE check has no such allowance — it
 * compares against the real values in `.env` and is the one that actually matters.
 *
 * `.env` itself is exempt from both checks — it is the sanctioned place for
 * secrets, and `.gitignore` keeps it out of the repository. `.env.example` is
 * scanned: a placeholder template must not have had a real value pasted into it.
 *
 * Deliberately NOT scanned: node_modules, .git, the local database cluster
 * directory, backup archives, and the npm cache. Nothing there is authored here.
 *
 * Exit code 0 = clean, 1 = findings. Never prints a matched secret; it prints the
 * variable name, the file, and the line number.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SKIP_DIRS = new Set(["node_modules", ".git", ".pgdata", ".npm-cache", ".vercel", ".preflight", "backups"]);
// Text files only, and only the ones a human or a build would ship.
const TEXT_EXT = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".json", ".md", ".html", ".css", ".sql", ".yml", ".yaml", ".toml", ".txt", ".example", ".env", ".ps1", ".sh"]);
const MAX_BYTES = 2 * 1024 * 1024;

const SHAPES = [
  ["password-bearing connection string", /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s/:@"']+:[^\s/@"']{4,}@/i],
  ["private key block", /-----BEGIN (?:RSA |EC |OPENSSH |PG )?PRIVATE KEY-----/],
  ["AWS access key id", /\bAKIA[0-9A-Z]{16}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["Stripe secret key", /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}\b/],
  ["OpenAI-style secret key", /\bsk-[a-zA-Z0-9]{20,}\b/],
  ["generic assigned secret", /\b(?:secret|password|passwd|token|api_key|apikey|access_key|private_key)\s*[:=]\s*["'][^"'\s][^"']{7,}["']/i],
];

// Lines that are obviously documentation or templates, not credentials.
const SHAPE_ALLOW = [
  /^\s*[0-9+-]*\s*[>*|]\s/, // markdown table row
  /postgres:\/\/user:pass@/, // the canonical placeholder in README/docs
  /postgres:\/\/\*\*\*:\*\*\*@/, // redacted output
  /postgres:\/\/[^@\s]*\*[^@\s]*@/, // anything with a mask in it
  /\$\{|\$[A-Z_]+\b|%[A-Z_]+%/, // interpolation, not a literal
  /x{8,}|y{8,}|example|placeholder|changeme|your[-_]|dummy|redacted|<[^>]+>/i,
  // A credential whose host is the machine's own loopback is unreachable from
  // anywhere else, which is why the local development database in
  // docker-compose.yml ships a throwaway password and .env.example documents it.
  // The excuse is bound to the host: point the same shape at anything other than
  // localhost / 127.x.x.x / [::1] and it is reported again. It also never touches
  // the leakage check, which compares against the real values in `.env`.
  /:[^\s/"'@]{4,}@(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?\//i,
];

function isText(file) {
  const ext = path.extname(file);
  const base = path.basename(file);
  if (base === ".env" || base === ".gitignore" || base === ".dockerignore" || base === ".eslintrc.cjs") return true;
  if (base.endsWith(".example")) return true;
  return TEXT_EXT.has(ext);
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".git") && entry.name !== ".gitignore" && entry.name !== ".github") continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && isText(full) && fs.statSync(full).size <= MAX_BYTES) out.push(full);
  }
  return out;
}

function trackedFiles() {
  try {
    // --others --exclude-standard adds the not-yet-committed work in progress:
    // what a `git add -A` would ship today, ignoring what .gitignore excludes.
    const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" });
    return out.split("\0").filter(Boolean).map((p) => path.join(root, p));
  } catch {
    return null; // not a git checkout: fall back to a filesystem walk
  }
}

function buildOutput() {
  const dist = path.join(root, "client", "dist");
  return fs.existsSync(dist) ? walk(dist, []) : [];
}

// Only some variables are credentials. `NODE_ENV=production` or
// `SESSION_IDLE_MS=604800000` appearing in a doc is not a leak, and treating it
// as one would train everyone to ignore this tool — which is how real leaks
// survive. A value is checked when its NAME says it is secret material, or when
// the VALUE itself is credential-shaped (a URL that carries a password).
const SECRET_NAME = /(?:PASSWORD|PASSWD|SECRET|TOKEN|DSN|API_?KEY|PRIVATE_?KEY|MFA_KEY|TOTP|SIGNING|DATABASE_URL|_URL$)/i;
const CREDENTIAL_SHAPED = /[a-z][a-z0-9+.-]*:\/\/[^/\s:@"']+:[^/\s@"']{4,}@/i;
const PLACEHOLDER = /^(?:changeme|your[-_]?|xxx+|<.*>|replace[-_]?me|dummy|todo|placeholder)/i;

export function isSecretValue({ name, value }) {
  if (value.length < 8) return false;
  if (PLACEHOLDER.test(value)) return false;
  return SECRET_NAME.test(name) || CREDENTIAL_SHAPED.test(value);
}

function envValues() {
  const file = path.join(root, ".env");
  if (!fs.existsSync(file)) return [];
  const values = [];
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, "");
    const candidate = { name: m[1], value };
    if (isSecretValue(candidate)) values.push(candidate);
  }
  return values;
}

/**
 * A report that prints the secret it found is a second leak — in a CI log, on a
 * screen, in a chat paste. Every quoted line goes through here first: credentials
 * inside URLs and behind `password = "…"` are replaced, and any long opaque run
 * (the shape of a real key) is reduced to a prefix and its length.
 */
export function mask(text) {
  return String(text)
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/"'@]+:[^\s/"'@]+@/gi, "$1***:***@")
    .replace(/(\b(?:secret|password|passwd|token|api_?key|access_key|private_key)\s*[:=]\s*["'])[^"']+(["'])/gi, "$1…redacted…$2")
    .replace(/\b[A-Za-z0-9_-]{20,}\b/g, (run) => run.slice(0, 4) + "…" + run.length + "chars");
}

/**
 * One file, all checks. Exported and pure (it takes lines, not paths) so the
 * suite can prove it actually detects a leak — a scanner that has never been
 * shown a planted secret is just a message that says "PASSED".
 */
export function matchFile({ rel, lines, values, inBundle = false }) {
  const findings = [];
  const where = (i) => `${rel}:${i + 1}`;
  const place = inBundle ? "the built bundle" : "shipped content";

  for (const { name, value } of values) {
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes(value)) continue;
      findings.push({ kind: "leakage", where: where(i), detail: `value of ${name} appears in ${place}` });
      break; // one hit per variable per file is enough to condemn it
    }
  }

  for (const [label, pattern] of SHAPES) {
    // A unit test needs a password string to log in with; that string is authored
    // in the open and guards nothing. Only this one loose shape is excused there —
    // private keys, live payment keys and credential-bearing URLs are still flagged
    // inside tests, and the leakage check above is never relaxed anywhere.
    if (label === "generic assigned secret" && /^tests\//.test(rel)) continue;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!pattern.test(line)) continue;
      if (SHAPE_ALLOW.some((allow) => allow.test(line))) continue;
      findings.push({ kind: "shape", where: where(i), detail: `${label}${inBundle ? " in the built bundle" : ""}: ${mask(line).trim().slice(0, 60)}` });
      break; // the first hit in a file is enough to condemn it
    }
  }

  return findings;
}

function main() {
  const tracked = trackedFiles();
  const candidates = tracked ? tracked.filter((p) => fs.existsSync(p) && fs.statSync(p).isFile()) : walk(root, []);
  const built = buildOutput();
  // `.env` is the sanctioned home for secrets; never flag it against itself.
  const isEnv = (p) => path.basename(p) === ".env";
  const scanned = [...new Set([...candidates, ...built])].filter((p) => !isEnv(p));

  const findings = [];
  const values = envValues();

  for (const file of scanned) {
    const rel = path.relative(root, file).replace(/\\/g, "/");
    let lines;
    try {
      lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    } catch {
      continue; // binary or unreadable: nothing authored here to check
    }
    findings.push(...matchFile({ rel, lines, values, inBundle: built.includes(file) }));
  }

  console.log(`[secret-scan] ${scanned.length} file(s) inspected (${built.length} from client/dist, the rest version-controlled)`);
  console.log(`[secret-scan] ${values.length} .env value(s) checked for leakage; ${SHAPES.length} credential shape(s) checked`);

  if (!findings.length) {
    console.log("\nSECRET SCAN PASSED — no credential values and no credential-shaped text in shipped content or the built bundle.");
    return;
  }

  console.error(`\nSECRET SCAN FAILED — ${findings.length} finding(s):`);
  for (const f of findings.slice(0, 40)) console.error(`  - [${f.kind}] ${f.where} — ${f.detail}`);
  if (findings.length > 40) console.error(`  … and ${findings.length - 40} more`);
  console.error("\nA secret in the built bundle is public: anything in client/dist is served to every browser.");
  process.exit(1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
