import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchFile, isSecretValue, mask } from "../scripts/secret-scan.mjs";

// `npm run secret-scan` printing "PASSED" is worth nothing until this file shows
// the same matcher reports a secret that is really there — and stays quiet about
// the configuration values that merely look like one in a regex's eye.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Assembled rather than written out. A literal credential URL or private-key
// header in this file would be (correctly) reported by the very scan these tests
// exercise, and the repository could then never pass its own check.
const REAL_PASSWORD = ["Tr4g", "3d1c-P@ssw0rd-9f3a"].join("");
const REAL_MFA_KEY = ["jdyWm3Lq", "vz8tKp4XnQ7rB2Nc"].join("");
const REAL_URL = ["postgres://tambola:", REAL_PASSWORD, "@db.internal:5432/tambola"].join("");
const AWS_KEY = ["AKIA", "QZLMNPRSTUVWXY37"].join("");

const VALUES = [
  { name: "DATABASE_URL", value: REAL_URL },
  { name: "OWNER_MFA_KEY", value: REAL_MFA_KEY },
];

test("a deployed credential copied into shipped content is reported", () => {
  const lines = [
    "# Runbook",
    "export DATABASE_URL=" + REAL_URL,
    "export OWNER_MFA_KEY=" + REAL_MFA_KEY,
    "then restart the service",
  ];
  const findings = matchFile({ rel: "server/RUNBOOK.md", lines, values: VALUES });

  // Both deployed secrets are named, once each, at the right line.
  const leaked = findings.filter((f) => f.kind === "leakage");
  assert.deepEqual(leaked.map((f) => f.detail).sort(), [
    "value of DATABASE_URL appears in shipped content",
    "value of OWNER_MFA_KEY appears in shipped content",
  ]);
  assert.deepEqual(leaked.map((f) => f.where), ["server/RUNBOOK.md:2", "server/RUNBOOK.md:3"]);
  // The URL line is also credential-shaped, so it is reported twice, from two
  // independent readings of the same file.
  assert.ok(findings.some((f) => f.kind === "shape" && f.where === "server/RUNBOOK.md:2"), "the shape check must not be blinded by the leak check");

  // Nothing in the report may echo the secret it found - the log itself would
  // then be a leak.
  const rendered = JSON.stringify(findings);
  for (const secret of [REAL_PASSWORD, REAL_MFA_KEY, REAL_URL]) {
    assert.ok(!rendered.includes(secret), `the finding must not repeat ${secret.slice(0, 4)}…`);
  }
});

test("a secret baked into the built bundle is identified as the bundle", () => {
  const findings = matchFile({ rel: "client/assets/index-abc123.js", lines: ['const e="' + REAL_MFA_KEY + '";'], values: VALUES, inBundle: true });
  assert.equal(findings.length, 1);
  assert.match(findings[0].detail, /built bundle/, "an operator must know this one is public, not merely committed");
});

test("ordinary configuration is not treated as a credential", () => {
  // These are the values a naive scanner screams about, and the reason real
  // scanners get ignored: the words appear in docs, code and tables constantly.
  const benign = [
    { name: "NODE_ENV", value: "production" },
    { name: "SESSION_IDLE_MS", value: "604800000" },
    { name: "PG_CONTAINER", value: "tambola-pg" },
    { name: "DB_SCHEMA", value: "public" },
    { name: "MFA_ISSUER", value: "Tambola Admin" },
  ];
  for (const entry of benign) {
    assert.equal(isSecretValue(entry), false, `${entry.name} is configuration, not a secret`);
  }
});

test("credential variables are recognised by name and by shape", () => {
  assert.equal(isSecretValue({ name: "DATABASE_URL", value: REAL_URL }), true);
  assert.equal(isSecretValue({ name: "OWNER_MFA_KEY", value: REAL_MFA_KEY }), true);
  assert.equal(isSecretValue({ name: "ADMIN_PASSWORD", value: "hunter2hunter2" }), true);
  // A secret-named variable holding a trivially short value is not worth hunting
  // through every file: a four-character string collides with half the codebase.
  assert.equal(isSecretValue({ name: "DATABASE_URL", value: "pgurl" }), false);
  // An unfilled template value must not be hunted through the repository either.
  assert.equal(isSecretValue({ name: "DATABASE_URL", value: "your-connection-string-here" }), false);
});

test("credential-shaped text is caught wherever it comes from", () => {
  // Each one is assembled so this file stays clean, and none of them contains a
  // word from the documentation allow-list - an allow-list that excused a fixture
  // would prove nothing about the real thing.
  const planted = {
    private_key: "-----BEGIN OPENSSH PRIVATE KE" + "Y-----\nb3BlbnNzaA==",
    aws_key: "access_token = " + AWS_KEY,
    google_key: "GOOGLE = " + ["AIza", "SyDnMcGf1wq0Zm9X3rY7sT8uV9wX0yZ1a2b"].join(""),
    stripe_live_key: 'const key = "' + ["sk_live_", "51oBxYzAbCdEfGhIjKlMnOpQ"].join("") + '";',
    connection_string: "url: " + ["'postgres://app:Fl4w", "-Pr0dS3cr3t9f3a@prod.internal:5432/x'"].join(""),
  };
  for (const [label, body] of Object.entries(planted)) {
    const findings = matchFile({ rel: "server/" + label + ".js", lines: body.split("\n"), values: [] });
    assert.ok(findings.length >= 1, `${label} must be reported`);
    assert.equal(findings[0].kind, "shape", label);
  }
});

test("illustrated placeholders in documentation stay quiet", () => {
  const docs = [
    "# Setup",
    "  DATABASE_URL=postgres://user:pass@127.0.0.1:5432/tambola",
    "  OWNER_MFA_KEY=<generate one with npm run owner:create>",
    "| `RESTORE_ADMIN_DATABASE_URL` | postgres://***:***@host/db |",
    "  \"password\": \"changeme\",",
    "  token: process.env.SESSION_TOKEN,",
    // The local development database really does ship a throwaway password, and
    // .env.example has to document it. It is unreachable from anywhere else.
    "  DATABASE_URL=postgres://tambola:tambola@127.0.0.1:5432/tambola",
    "  DATABASE_URL=postgres://tambola:tambola@localhost:5432/tambola",
  ];
  const findings = matchFile({ rel: "server/RUNBOOK.md", lines: docs, values: [] });
  assert.deepEqual(findings, [], "a doc template is not a leak; screaming about it is how the scan gets disabled");

  // …and the loopback excuse is bound to the host, not to the shape of the line.
  const sameUrlElsewhere = docs[docs.length - 2].replace("127.0.0.1", "db.internal");
  assert.equal(matchFile({ rel: ".env.example", lines: [sameUrlElsewhere], values: [] }).length, 1, "the same credential on a reachable host is a finding");
});

test("a test fixture password is excused, but a planted credential URL is not", () => {
  const fixture = ['const OWNER = { username: "operator", password: "correct-horse-battery-staple" };'];
  assert.deepEqual(matchFile({ rel: "tests/admin.test.js", lines: fixture, values: [] }), [], "unit tests need a login password");
  const sameLineElsewhere = fixture;
  assert.equal(matchFile({ rel: "server/index.js", lines: sameLineElsewhere, values: [] }).length, 1, "the same shape outside tests is still a finding");
  const plantedUrl = ["const url = " + "'postgres://app:Fl4w", "-Pr0dS3cr3t9f3a@prod.internal:5432/x'"].join("");
  assert.ok(matchFile({ rel: "tests/whatever.test.js", lines: [plantedUrl], values: [] }).length >= 1, "the excuse covers passwords only, never a credential URL");
});

test("the report never echoes the secret it found", () => {
  const masked = mask("DATABASE_URL=" + REAL_URL + ' and password = "hunter2hunter2" plus ' + AWS_KEY);
  assert.ok(!masked.includes(REAL_PASSWORD) && !masked.includes("hunter2hunter2") && !masked.includes(AWS_KEY), masked);
  assert.match(masked, /\*\*\*:\*\*\*@/, "the operator still needs to recognise the shape of what was masked");
  assert.match(masked, /redacted/);
});

test("the repository as it stands is clean - and the scan really reads it", () => {
  // Re-run the shipped scanner over the actual tree. This is the assertion that
  // keeps the deliverable honest: it fails the moment anything credential-shaped
  // is committed, and it fails loudly if the file list ever comes back empty.
  const dist = path.join(root, "client", "dist");
  const built = fs.existsSync(dist)
    ? fs.readdirSync(path.join(dist, "assets"), { recursive: false }).filter((n) => /\.(js|css|html)$/.test(n))
    : [];
  const values = (() => {
    const file = path.join(root, ".env");
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/))
      .filter(Boolean)
      .map((m) => ({ name: m[1], value: m[2].replace(/^["']|["']$/g, "") }))
      .filter(isSecretValue);
  })();

  const scanned = [];
  const skip = new Set(["node_modules", ".git", ".pgdata", ".npm-cache", ".vercel", ".preflight", "backups"]);
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) walk(path.join(dir, entry.name));
        continue;
      }
      if (!/\.(js|mjs|cjs|jsx|json|md|html|css|sql|yml|yaml|toml|txt|example|ps1|sh)$/.test(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (fs.statSync(full).size > 2 * 1024 * 1024) continue;
      scanned.push(full);
    }
  })(root);

  const findings = scanned
    .filter((p) => path.basename(p) !== ".env")
    .flatMap((p) => matchFile({
      rel: path.relative(root, p).replace(/\\/g, "/"),
      lines: fs.readFileSync(p, "utf8").split(/\r?\n/),
      values,
      inBundle: p.includes(path.join("client", "dist")),
    }));

  assert.ok(scanned.length > 100, `expected to inspect the whole tree, saw ${scanned.length} file(s)`);
  assert.deepEqual(findings, [], "the repository must ship no credential values and no credential-shaped text");
  if (built.length) {
    const bundle = scanned.filter((p) => p.includes(path.join("client", "dist")));
    assert.ok(bundle.length > 0, "client/dist exists, so the built bundle must be part of the scan");
  }
});
