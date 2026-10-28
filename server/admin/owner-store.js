/**
 * Owner accounts: the permanent administrative identity.
 *
 * This is intentionally a DIFFERENT table, with DIFFERENT credentials, from the
 * game `sessions` table. Holding a host token in one room grants nothing here;
 * the only way to become an owner is the documented bootstrap CLI (scripts/
 * owner.js), which is the sole path that writes these rows. There is no public
 * registration and nothing in the request path can create an account.
 *
 * Two backends share one interface so the admin routes behave identically with
 * or without a database:
 *   createOwnerStore({ db })         - durable, reads/writes owner_accounts
 *   createMemoryOwnerStore()         - process-local, for tests and no-DB runs
 *
 * A password hash is only ever returned from getByUsername (needed to verify a
 * login). list()/count() never expose it, and no method logs a secret.
 */

import { randomUUID, createHash } from "node:crypto";
import { verifyPassword, hashPassword, PASSWORD_ALGO } from "./password.js";

const USERNAME_RE = /^[a-z0-9._-]{3,40}$/;

export function normalizeUsername(raw) {
  return String(raw ?? "").trim().toLowerCase();
}

/** Shared credential check so both backends answer a bad login identically. */
async function checkDigest(password, passwordHash) {
  return verifyPassword(password, passwordHash);
}

export function createOwnerStore({ db, log = () => {} } = {}) {
  if (!db) throw new Error("createOwnerStore needs a database handle");

  async function create({ username, passwordHash }) {
    const name = normalizeUsername(username);
    if (!USERNAME_RE.test(name)) throw new Error("username must match [a-z0-9._-] and be 3-40 characters");
    if (typeof passwordHash !== "string" || passwordHash.length < 16) throw new Error("a password hash is required");
    const ownerId = randomUUID();
    await db.query(
      `INSERT INTO owner_accounts (owner_id, username, password_hash, password_algo)
       VALUES ($1, $2, $3, $4)`,
      [ownerId, name, passwordHash, PASSWORD_ALGO]
    );
    log("owner account created", name);
    return { ownerId, username: name };
  }

  async function getByUsername(username) {
    const name = normalizeUsername(username);
    const result = await db.query(
      `SELECT owner_id, username, password_hash, password_algo, created_at, last_login_at, password_updated_at,
              totp_secret_enc, totp_confirmed_at, totp_last_step
         FROM owner_accounts WHERE username = $1`,
      [name]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      ownerId: row.owner_id,
      username: row.username,
      passwordHash: row.password_hash,
      passwordAlgo: row.password_algo,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at,
      passwordUpdatedAt: row.password_updated_at,
      totpSecretEnc: row.totp_secret_enc,
      totpConfirmedAt: row.totp_confirmed_at,
      totpLastStep: row.totp_last_step,
      mfaEnrolled: Boolean(row.totp_confirmed_at),
    };
  }

  async function getById(ownerId) {
    const result = await db.query(
      `SELECT owner_id, username, created_at, last_login_at, password_updated_at
         FROM owner_accounts WHERE owner_id = $1`,
      [ownerId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return { ownerId: row.owner_id, username: row.username, createdAt: row.created_at, lastLoginAt: row.last_login_at, passwordUpdatedAt: row.password_updated_at };
  }

  /**
   * Verify a login. Returns an owner identity on success and an identical
   * INVALID_CREDENTIALS on any failure, so a caller cannot learn whether the
   * username exists. Never logs the password, and never hands the stored digest
   * back to the caller - verification is all that is needed.
   */
  async function verifyLogin({ username, password } = {}) {
    const account = await getByUsername(username);
    if (!account) {
      // keep timing flat: still run a scrypt against a fixed dummy digest so a
      // missing username is not distinguishable from a wrong password
      await verifyPassword(password || "", "scrypt$16384$8$1$00$00");
      return { ok: false, code: "INVALID_CREDENTIALS" };
    }
    const good = await checkDigest(password, account.passwordHash);
    if (!good) return { ok: false, code: "INVALID_CREDENTIALS" };
    return {
      ok: true,
      ownerId: account.ownerId,
      username: account.username,
      mfaEnrolled: account.mfaEnrolled,
      mfaPending: Boolean(account.totpSecretEnc) && !account.totpConfirmedAt,
    };
  }

  async function setPassword({ ownerId, passwordHash }) {
    if (typeof passwordHash !== "string" || passwordHash.length < 16) throw new Error("a password hash is required");
    const result = await db.query(
      `UPDATE owner_accounts SET password_hash = $2, password_algo = $3, password_updated_at = now()
        WHERE owner_id = $1
        RETURNING username`,
      [ownerId, passwordHash, PASSWORD_ALGO]
    );
    if (!result.rows.length) return { ok: false, code: "OWNER_NOT_FOUND" };
    log("owner password rotated", result.rows[0].username);
    return { ok: true, username: result.rows[0].username };
  }

  async function touchLogin({ ownerId }) {
    await db.query("UPDATE owner_accounts SET last_login_at = now() WHERE owner_id = $1", [ownerId]);
    return { ok: true };
  }

  /**
   * The second-factor view of one account: the sealed secret and the last used
   * time step. Deliberately separate from getById, which backs every
   * authenticated request and has no reason to carry a factor.
   */
  async function getForMfa({ ownerId } = {}) {
    const result = await db.query(
      `SELECT owner_id, username, totp_secret_enc, totp_confirmed_at, totp_last_step
         FROM owner_accounts WHERE owner_id = $1`,
      [ownerId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      ownerId: row.owner_id,
      username: row.username,
      totpSecretEnc: row.totp_secret_enc,
      totpConfirmedAt: row.totp_confirmed_at,
      totpLastStep: row.totp_last_step,
    };
  }

  /**
   * Start (or restart) an enrollment. Only a not-yet-confirmed account can
   * begin one, so a stale browser tab cannot silently replace the secret of a
   * working second factor; that requires an explicit CLI reset.
   */
  async function beginMfaEnrollment({ ownerId, secretEnc } = {}) {
    if (!ownerId || typeof secretEnc !== "string" || !secretEnc) throw new Error("beginMfaEnrollment() needs an owner and a sealed secret");
    const result = await db.query(
      `UPDATE owner_accounts
          SET totp_secret_enc = $2, totp_confirmed_at = NULL, totp_last_step = NULL
        WHERE owner_id = $1 AND totp_confirmed_at IS NULL
        RETURNING username`,
      [ownerId, secretEnc]
    );
    if (!result.rows.length) return { ok: false, code: "MFA_ALREADY_ENROLLED" };
    return { ok: true, username: result.rows[0].username };
  }

  /** Promote a pending secret to an active second factor after a valid code. */
  async function confirmMfa({ ownerId, step } = {}) {
    const result = await db.query(
      `UPDATE owner_accounts
          SET totp_confirmed_at = now(), totp_last_step = $2
        WHERE owner_id = $1 AND totp_secret_enc IS NOT NULL AND totp_confirmed_at IS NULL
        RETURNING username`,
      [ownerId, Number.isFinite(Number(step)) ? Number(step) : null]
    );
    if (!result.rows.length) return { ok: false, code: "MFA_NOT_PENDING" };
    log("owner second factor enabled", result.rows[0].username);
    return { ok: true, username: result.rows[0].username };
  }

  /**
   * Record an accepted time step and report whether it was still fresh. The
   * comparison happens in SQL, so two concurrent sign-ins with the same code
   * cannot both win.
   */
  async function advanceMfaStep({ ownerId, step } = {}) {
    if (!Number.isFinite(Number(step))) return { ok: false, code: "MFA_STEP_INVALID" };
    const result = await db.query(
      `UPDATE owner_accounts
          SET totp_last_step = $2
        WHERE owner_id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)
        RETURNING totp_last_step`,
      [ownerId, Number(step)]
    );
    return result.rows.length ? { ok: true } : { ok: false, code: "MFA_REPLAY" };
  }

  /** Disable the second factor (CLI recovery). The secret is destroyed, not kept. */
  async function clearMfa({ ownerId } = {}) {
    const result = await db.query(
      `UPDATE owner_accounts
          SET totp_secret_enc = NULL, totp_confirmed_at = NULL, totp_last_step = NULL
        WHERE owner_id = $1
        RETURNING username`,
      [ownerId]
    );
    if (!result.rows.length) return { ok: false, code: "OWNER_NOT_FOUND" };
    log("owner second factor cleared", result.rows[0].username);
    return { ok: true, username: result.rows[0].username };
  }

  async function list() {
    const result = await db.query(
      `SELECT owner_id, username, created_at, last_login_at, password_updated_at,
              totp_confirmed_at, totp_secret_enc
         FROM owner_accounts ORDER BY created_at`
    );
    return result.rows.map((row) => ({
      ownerId: row.owner_id,
      username: row.username,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at,
      passwordUpdatedAt: row.password_updated_at,
      mfaEnrolled: Boolean(row.totp_confirmed_at),
      mfaPending: Boolean(row.totp_secret_enc) && !row.totp_confirmed_at,
      mfaConfirmedAt: row.totp_confirmed_at,
    }));
  }

  async function count() {
    const result = await db.query("SELECT count(*)::int AS n FROM owner_accounts");
    return result.rows[0].n;
  }

  async function remove({ ownerId }) {
    const result = await db.query("DELETE FROM owner_accounts WHERE owner_id = $1 RETURNING username", [ownerId]);
    if (!result.rows.length) return { ok: false, code: "OWNER_NOT_FOUND" };
    log("owner account removed", result.rows[0].username);
    return { ok: true, username: result.rows[0].username };
  }

  return {
    backend: "database",
    create,
    getByUsername,
    getById,
    getForMfa,
    verifyLogin,
    setPassword,
    touchLogin,
    beginMfaEnrollment,
    confirmMfa,
    advanceMfaStep,
    clearMfa,
    list,
    count,
    remove,
  };
}

/** In-memory owner store: same interface, nothing survives a restart. */
export function createMemoryOwnerStore({ log = () => {} } = {}) {
  const byId = new Map();
  const byName = new Map();

  async function create({ username, passwordHash }) {
    const name = normalizeUsername(username);
    if (!USERNAME_RE.test(name)) throw new Error("username must match [a-z0-9._-] and be 3-40 characters");
    if (typeof passwordHash !== "string" || passwordHash.length < 16) throw new Error("a password hash is required");
    if (byName.has(name)) throw new Error("that username is already taken");
    const ownerId = randomUUID();
    const account = {
      ownerId,
      username: name,
      passwordHash,
      passwordAlgo: PASSWORD_ALGO,
      createdAt: new Date(),
      lastLoginAt: null,
      passwordUpdatedAt: new Date(),
      totpSecretEnc: null,
      totpConfirmedAt: null,
      totpLastStep: null,
    };
    byId.set(ownerId, account);
    byName.set(name, account);
    log("owner account created (memory)", name);
    return { ownerId, username: name };
  }

  async function getByUsername(username) {
    const account = byName.get(normalizeUsername(username));
    if (!account) return null;
    return { ...account };
  }

  async function getById(ownerId) {
    const account = byId.get(ownerId);
    if (!account) return null;
    const { passwordHash, ...safe } = account;
    return safe;
  }

  async function verifyLogin({ username, password } = {}) {
    const account = byName.get(normalizeUsername(username));
    if (!account) {
      await verifyPassword(password || "", "scrypt$16384$8$1$00$00");
      return { ok: false, code: "INVALID_CREDENTIALS" };
    }
    const good = await checkDigest(password, account.passwordHash);
    if (!good) return { ok: false, code: "INVALID_CREDENTIALS" };
    return {
      ok: true,
      ownerId: account.ownerId,
      username: account.username,
      mfaEnrolled: Boolean(account.totpConfirmedAt),
      mfaPending: Boolean(account.totpSecretEnc) && !account.totpConfirmedAt,
    };
  }

  async function setPassword({ ownerId, passwordHash }) {
    const account = byId.get(ownerId);
    if (!account) return { ok: false, code: "OWNER_NOT_FOUND" };
    if (typeof passwordHash !== "string" || passwordHash.length < 16) throw new Error("a password hash is required");
    account.passwordHash = passwordHash;
    account.passwordUpdatedAt = new Date();
    log("owner password rotated (memory)", account.username);
    return { ok: true, username: account.username };
  }

  async function touchLogin({ ownerId }) {
    const account = byId.get(ownerId);
    if (account) account.lastLoginAt = new Date();
    return { ok: true };
  }

  async function getForMfa({ ownerId } = {}) {
    const account = byId.get(ownerId);
    if (!account) return null;
    return {
      ownerId: account.ownerId,
      username: account.username,
      totpSecretEnc: account.totpSecretEnc || null,
      totpConfirmedAt: account.totpConfirmedAt || null,
      totpLastStep: account.totpLastStep ?? null,
    };
  }

  async function beginMfaEnrollment({ ownerId, secretEnc } = {}) {
    const account = byId.get(ownerId);
    if (!account) return { ok: false, code: "OWNER_NOT_FOUND" };
    if (account.totpConfirmedAt) return { ok: false, code: "MFA_ALREADY_ENROLLED" };
    account.totpSecretEnc = secretEnc;
    account.totpConfirmedAt = null;
    account.totpLastStep = null;
    return { ok: true, username: account.username };
  }

  async function confirmMfa({ ownerId, step } = {}) {
    const account = byId.get(ownerId);
    if (!account || !account.totpSecretEnc || account.totpConfirmedAt) return { ok: false, code: "MFA_NOT_PENDING" };
    account.totpConfirmedAt = new Date();
    account.totpLastStep = Number.isFinite(Number(step)) ? Number(step) : null;
    log("owner second factor enabled (memory)", account.username);
    return { ok: true, username: account.username };
  }

  async function advanceMfaStep({ ownerId, step } = {}) {
    const account = byId.get(ownerId);
    if (!account || !Number.isFinite(Number(step))) return { ok: false, code: "MFA_STEP_INVALID" };
    if (account.totpLastStep != null && Number(step) <= account.totpLastStep) return { ok: false, code: "MFA_REPLAY" };
    account.totpLastStep = Number(step);
    return { ok: true };
  }

  async function clearMfa({ ownerId } = {}) {
    const account = byId.get(ownerId);
    if (!account) return { ok: false, code: "OWNER_NOT_FOUND" };
    account.totpSecretEnc = null;
    account.totpConfirmedAt = null;
    account.totpLastStep = null;
    log("owner second factor cleared (memory)", account.username);
    return { ok: true, username: account.username };
  }

  async function list() {
    return [...byId.values()].map(({ passwordHash, totpSecretEnc, ...safe }) => ({
      ...safe,
      mfaEnrolled: Boolean(safe.totpConfirmedAt),
      mfaPending: Boolean(totpSecretEnc) && !safe.totpConfirmedAt,
      mfaConfirmedAt: safe.totpConfirmedAt,
    }));
  }

  async function count() {
    return byId.size;
  }

  async function remove({ ownerId }) {
    const account = byId.get(ownerId);
    if (!account) return { ok: false, code: "OWNER_NOT_FOUND" };
    byId.delete(ownerId);
    byName.delete(account.username);
    log("owner account removed (memory)", account.username);
    return { ok: true, username: account.username };
  }

  return {
    backend: "memory",
    create,
    getByUsername,
    getById,
    getForMfa,
    verifyLogin,
    setPassword,
    touchLogin,
    beginMfaEnrollment,
    confirmMfa,
    advanceMfaStep,
    clearMfa,
    list,
    count,
    remove,
  };
}

/** Convenience for the CLI: hash + create in one call. */
export async function hashAndPrepare(password) {
  return hashPassword(password);
}

/** Non-secret actor fingerprint used in audit rows (never a raw value). */
export function fingerprint(value) {
  if (value == null) return null;
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}
