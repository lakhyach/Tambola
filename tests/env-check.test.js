/**
 * The production environment gate: what it refuses, and what it must never print.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { validateEnv, formatReport, parseOrigin, isMfaKeyShape } from "../scripts/env-check.mjs";

// A password authored in the open, guarding nothing. It is interpolated rather
// than written inline so the repository's secret scanner keeps flagging real
// credential shapes inside tests instead of being taught to ignore this file.
const FAKE_DB_PASSWORD = "8f3c1d2e9a7b4c6d";

const GOOD = {
  NODE_ENV: "production",
  DATABASE_URL: `postgresql://tambola:${FAKE_DB_PASSWORD}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=verify-full`,
  PUBLIC_ORIGIN: "https://games.example.com",
  TRUST_PROXY: "1",
  OWNER_MFA_KEY: "a".repeat(64),
  MFA_ISSUER: "Example Tambola",
};

function ids(result, level) {
  return result.checks.filter((check) => check.level === level).map((check) => check.id);
}

test("a complete production environment passes with no errors", () => {
  const result = validateEnv(GOOD);
  assert.equal(result.profile, "production");
  assert.equal(result.ok, true, JSON.stringify(result.checks.filter((c) => c.level === "error")));
  assert.equal(result.errors, 0);
});

test("production without a database is refused, not degraded", () => {
  const result = validateEnv({ ...GOOD, DATABASE_URL: "" });
  assert.equal(result.ok, false);
  assert.ok(ids(result, "error").includes("DATABASE_URL"));
});

test("a remote database must be TLS-verified", () => {
  const plain = validateEnv({ ...GOOD, DATABASE_URL: "postgresql://u:p@db.example.net:5432/tambola" });
  assert.equal(plain.ok, false);
  assert.ok(ids(plain, "error").includes("DATABASE_URL.tls"));

  const disabled = validateEnv({ ...GOOD, DATABASE_URL: "postgresql://u:p@db.example.net:5432/tambola?sslmode=disable" });
  assert.equal(disabled.ok, false);
  assert.ok(ids(disabled, "error").includes("DATABASE_URL.tls"));

  const verified = validateEnv({ ...GOOD, DATABASE_URL: "postgresql://u:p@db.example.net:5432/tambola?sslmode=verify-full" });
  assert.equal(verified.ok, true);
});

test("default credentials and the transaction pooler are caught", () => {
  const weak = validateEnv({
    ...GOOD,
    DATABASE_URL: "postgresql://tambola:tambola@db.example.net:5432/tambola?sslmode=require",
  });
  assert.ok(ids(weak, "error").includes("DATABASE_URL.password"));

  const transactionPooler = validateEnv({
    ...GOOD,
    DATABASE_URL: "postgresql://u:p@db.example.net:6543/postgres?sslmode=require",
  });
  assert.equal(transactionPooler.ok, true, "a warning, not a blocker");
  assert.ok(ids(transactionPooler, "warn").includes("DATABASE_URL.port"));
});

test("memory-only mode is never a deployment mode", () => {
  const result = validateEnv({ ...GOOD, ALLOW_MEMORY_ONLY: "1" });
  assert.equal(result.ok, false);
  assert.ok(ids(result, "error").includes("ALLOW_MEMORY_ONLY"));
});

test("a public origin must be a bare https origin", () => {
  for (const bad of ["http://games.example.com", "https://games.example.com/app", "games.example.com"]) {
    const result = validateEnv({ ...GOOD, PUBLIC_ORIGIN: bad });
    assert.equal(result.ok, false, bad + " must be refused");
    assert.ok(ids(result, "error").includes("PUBLIC_ORIGIN"), bad);
  }
  const missing = validateEnv({ ...GOOD, PUBLIC_ORIGIN: "" });
  assert.ok(ids(missing, "error").includes("PUBLIC_ORIGIN"));
});

test("proxy awareness and cookie hardening are required in production", () => {
  const noProxy = validateEnv({ ...GOOD, TRUST_PROXY: "" });
  assert.ok(ids(noProxy, "error").includes("TRUST_PROXY"));

  const insecureCookies = validateEnv({ ...GOOD, TAMBOLA_COOKIE_SECURE: "0" });
  assert.ok(ids(insecureCookies, "error").includes("TAMBOLA_COOKIE_SECURE"));
});

test("the MFA key is checked by shape, not by presence alone", () => {
  assert.equal(validateEnv({ ...GOOD, OWNER_MFA_KEY: "" }).ok, false);
  assert.equal(validateEnv({ ...GOOD, OWNER_MFA_KEY: "too-short" }).ok, false);
  assert.equal(validateEnv({ ...GOOD, OWNER_MFA_KEY: Buffer.alloc(32, 7).toString("base64") }).ok, true);
  assert.equal(isMfaKeyShape("a".repeat(64)), true);
  assert.equal(isMfaKeyShape(Buffer.alloc(16, 1).toString("base64")), false, "16 bytes is not a 32-byte key");
});

test("the development profile warns where production fails", () => {
  const result = validateEnv({ NODE_ENV: "development", ALLOW_MEMORY_ONLY: "1" }, { profile: "development" });
  assert.equal(result.ok, false, "memory-only is still an error: it is a misconfiguration, not a preference");

  const bare = validateEnv({ NODE_ENV: "development" }, { profile: "development" });
  assert.equal(bare.ok, true);
  assert.ok(bare.warnings > 0);
  assert.ok(ids(bare, "warn").includes("DATABASE_URL"));
});

test("nothing in the report echoes a credential", () => {
  const env = { ...GOOD, DATABASE_URL: "postgresql://admin:hunter2@db.example.net:5432/tambola" };
  const result = validateEnv(env, { profile: "production" });
  const text = formatReport(result) + JSON.stringify(result);
  assert.equal(text.includes("hunter2"), false);
  assert.equal(text.includes("db.example.net"), false);
  assert.equal(text.includes(GOOD.DATABASE_URL), false);
});

test("origin parsing accepts exactly what it claims to", () => {
  assert.equal(parseOrigin("https://a.example.com").origin, "https://a.example.com");
  assert.equal(parseOrigin("https://a.example.com/").origin, "https://a.example.com", "a root slash is canonicalised away");
  assert.equal(parseOrigin("https://a.example.com/app"), null, "a path is not an origin");
  assert.equal(parseOrigin("ftp://a.example.com"), null);
  assert.equal(parseOrigin(""), null);
  assert.equal(parseOrigin(undefined), null);
});
