import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import QRCode from "qrcode";
import { createMemoryMfaRecoveryStore, generateRecoveryCodes, hashRecoveryCode } from "../server/admin/mfa-recovery.js";
import { generateSecret, provisioningUri, currentCode, verifyCode } from "../server/admin/mfa.js";
import { encryptSecret, decryptSecret } from "../server/admin/mfa.js";
import { openDurableSchema } from "./pattern-harness.js";
import { createOwnerStore } from "../server/admin/owner-store.js";
import { createOwnerSessionStore } from "../server/admin/owner-sessions.js";
import { createMfaChallengeStore } from "../server/admin/mfa-challenges.js";
import { createMfaRecoveryStore } from "../server/admin/mfa-recovery.js";
import { hashPassword } from "../server/admin/password.js";

const hasDatabase = Boolean(process.env.DATABASE_URL);

test("owner MFA recovery authorization is expiring, bound to owner, and one-use", async () => {
  let now = 1_000;
  const store = createMemoryMfaRecoveryStore({ now: () => now, ttlMs: 100 });
  const issuedToken = "a".repeat(64);
  const issued = await store.issueAuthorization({ ownerId: "owner-a", authorizationToken: issuedToken });
  assert.equal(Object.hasOwn(issued, "token"), false, "the authorization store never returns the bearer token");
  assert.equal((await store.begin({ ownerId: "owner-b", authorization: issuedToken })).ok, false);
  assert.equal((await store.begin({ ownerId: "owner-a", authorization: "wrong" })).ok, false);
  assert.equal((await store.begin({ ownerId: "owner-a", authorization: issuedToken })).ok, true);
  assert.equal((await store.begin({ ownerId: "owner-a", authorization: issuedToken })).ok, false);
  const expiringToken = "b".repeat(64);
  const expiring = await store.issueAuthorization({ ownerId: "owner-a", authorizationToken: expiringToken });
  now += 101;
  assert.equal((await store.begin({ ownerId: "owner-a", authorization: expiringToken })).ok, false);
});

test("recovery QR is a genuine TOTP provisioning QR and is revealed only once", async () => {
  const secret = generateSecret();
  const uri = provisioningUri({ secret, username: "owner@example.test", issuer: "Ninety Club" });
  const qr = await QRCode.toDataURL(uri);
  assert.match(uri, /^otpauth:\/\/totp\/Ninety%20Club:/);
  assert.match(uri, /secret=[A-Z2-7]+/);
  assert.match(qr, /^data:image\/png;base64,/);
  assert.equal(verifyCode({ secret, code: currentCode({ secret }) }).ok, true);

  const store = createMemoryMfaRecoveryStore();
  const authToken = "c".repeat(64);
  await store.issueAuthorization({ ownerId: "owner-1", authorizationToken: authToken });
  const flow = await store.begin({ ownerId: "owner-1", authorization: authToken });
  assert.equal((await store.setPending({ flowId: flow.flowId, secretEnc: "sealed" })).ok, true);
  assert.equal((await store.revealQr({ flowId: flow.flowId })).ok, true);
  assert.equal((await store.revealQr({ flowId: flow.flowId })).ok, false);
});

test("recovery codes are high entropy, hashed at rest, and consumed once", async () => {
  const { values, hashes } = generateRecoveryCodes();
  assert.equal(values.length, 10);
  assert.equal(new Set(values).size, values.length);
  assert.equal(hashes.every((value, index) => value !== values[index] && /^[0-9a-f]{64}$/.test(value)), true);
  const store = createMemoryMfaRecoveryStore();
  const authToken = "d".repeat(64);
  await store.issueAuthorization({ ownerId: "owner-1", authorizationToken: authToken });
  const flow = await store.begin({ ownerId: "owner-1", authorization: authToken });
  await store.setPending({ flowId: flow.flowId, secretEnc: "ciphertext" });
  await store.revealQr({ flowId: flow.flowId });
  const complete = await store.complete({ flowId: flow.flowId, ownerId: "owner-1", secretEnc: "ciphertext", step: 1, codes: hashes });
  assert.equal(complete.ok, true);
  const codeHash = hashRecoveryCode(values[0]);
  assert.equal(codeHash, hashes[0]);
  assert.equal((await store.consumeCode({ ownerId: "owner-1", codeHash })).ok, true);
  assert.equal((await store.consumeCode({ ownerId: "owner-1", codeHash })).ok, false);
  assert.equal(hashRecoveryCode("invalid"), null);
});

test("a recovery flow accepts no more than five verification attempts", async () => {
  const store = createMemoryMfaRecoveryStore();
  const authorizationToken = "e".repeat(64);
  await store.issueAuthorization({ ownerId: "owner-attempts", authorizationToken });
  const flow = await store.begin({ ownerId: "owner-attempts", authorization: authorizationToken });
  await store.setPending({ flowId: flow.flowId, secretEnc: "encrypted-pending-secret" });
  await store.revealQr({ flowId: flow.flowId });
  for (let i = 0; i < 5; i += 1) assert.equal((await store.consumeAttempt({ flowId: flow.flowId })).ok, true);
  assert.equal((await store.consumeAttempt({ flowId: flow.flowId })).ok, false);
  assert.equal((await store.flow({ token: flow.token })).ok, false);
});

test("durable MFA recovery is transactional on PostgreSQL", { skip: !hasDatabase }, async (t) => {
  const { db, close } = await openDurableSchema({ prefix: "mfa_recovery" });
  t.after(close);
  const key = Buffer.alloc(32, 7);
  const owners = createOwnerStore({ db });
  const sessions = createOwnerSessionStore({ db });
  const challenges = createMfaChallengeStore({ db });
  const recovery = createMfaRecoveryStore({ db });
  const passwordHash = await hashPassword("test-only-owner-password");
  const owner = await owners.create({ username: "recovery_owner", passwordHash });
  const rls = await db.query("SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass($1)", [
    `${db.schema}.owner_mfa_recovery_authorizations`,
  ]);
  assert.equal(rls.rows[0]?.relrowsecurity, true, "recovery tables enable deny-by-default row-level security");
  const oldSecret = generateSecret();
  const oldEnvelope = encryptSecret({ secret: oldSecret, ownerId: owner.ownerId, key });
  assert.equal((await owners.beginMfaEnrollment({ ownerId: owner.ownerId, secretEnc: oldEnvelope })).ok, true);
  assert.equal((await owners.confirmMfa({ ownerId: owner.ownerId, step: 10 })).ok, true);
  const session = await sessions.issue({ ownerId: owner.ownerId });
  const challenge = await challenges.issue({ ownerId: owner.ownerId });

  const firstAuthorizationToken = "f".repeat(64);
  const firstAuthorization = await recovery.issueAuthorization({ ownerId: owner.ownerId, username: owner.username, authorizationToken: firstAuthorizationToken });
  const firstHash = await db.query("SELECT token_hash FROM owner_mfa_recovery_authorizations WHERE owner_id=$1", [owner.ownerId]);
  assert.notEqual(firstHash.rows[0].token_hash.trim(), firstAuthorizationToken);
  assert.equal(Object.hasOwn(firstAuthorization, "token"), false, "durable authorization issue returns no bearer token");
  assert.equal((await recovery.begin({ ownerId: owner.ownerId, authorization: "bad-token", username: owner.username })).ok, false);
  const firstFlow = await recovery.begin({ ownerId: owner.ownerId, authorization: firstAuthorizationToken, username: owner.username });
  assert.equal(firstFlow.ok, true);
  assert.equal((await recovery.flow({ token: firstFlow.token })).ok, true);

  const secondAuthorizationToken = "1".repeat(64);
  const secondAuthorization = await recovery.issueAuthorization({ ownerId: owner.ownerId, username: owner.username, authorizationToken: secondAuthorizationToken });
  assert.equal((await recovery.flow({ token: firstFlow.token })).ok, false, "issuing a new authorization cancels an old flow");
  assert.equal((await recovery.begin({ ownerId: owner.ownerId, authorization: firstAuthorizationToken })).ok, false, "authorization is one-use");
  const flow = await recovery.begin({ ownerId: owner.ownerId, authorization: secondAuthorizationToken, username: owner.username });
  const newSecret = generateSecret();
  const newEnvelope = encryptSecret({ secret: newSecret, ownerId: owner.ownerId, key });
  assert.equal((await recovery.setPending({ flowId: flow.flowId, secretEnc: newEnvelope })).ok, true);
  assert.equal((await recovery.revealQr({ flowId: flow.flowId })).ok, true);
  assert.equal((await recovery.revealQr({ flowId: flow.flowId })).ok, false);
  const pending = await recovery.flow({ token: flow.token });
  assert.equal(pending.secretEnc.includes(newSecret), false, "pending TOTP is encrypted at rest");
  for (let i = 0; i < 5; i += 1) assert.equal((await recovery.consumeAttempt({ flowId: flow.flowId })).ok, true);
  assert.equal((await recovery.consumeAttempt({ flowId: flow.flowId })).ok, false);

  const { hashes } = generateRecoveryCodes();
  await assert.rejects(() => recovery.complete({ flowId: flow.flowId, ownerId: owner.ownerId, secretEnc: newEnvelope, step: 11, codes: [hashes[0], hashes[0]], username: owner.username }));
  let current = await owners.getForMfa({ ownerId: owner.ownerId });
  assert.equal(decryptSecret({ envelope: current.totpSecretEnc, ownerId: owner.ownerId, key }), oldSecret, "a failed transaction leaves the old factor active");
  assert.equal((await sessions.verify({ token: session.token })).ok, true, "a failed transaction leaves owner sessions valid");
  assert.equal((await challenges.lookup({ token: challenge.token })).ok, true, "a failed transaction leaves sign-in challenges valid");

  const completed = await recovery.complete({ flowId: flow.flowId, ownerId: owner.ownerId, secretEnc: newEnvelope, step: 11, codes: hashes, username: owner.username, ipHash: "test-ip-hash" });
  assert.equal(completed.ok, true);
  current = await owners.getForMfa({ ownerId: owner.ownerId });
  assert.equal(decryptSecret({ envelope: current.totpSecretEnc, ownerId: owner.ownerId, key }), newSecret);
  assert.equal((await sessions.verify({ token: session.token })).ok, false, "successful recovery revokes sessions");
  assert.equal((await challenges.lookup({ token: challenge.token })).ok, false, "successful recovery revokes challenges");
  assert.equal((await recovery.consumeCode({ ownerId: owner.ownerId, codeHash: hashes[0] })).ok, true);
  assert.equal((await recovery.consumeCode({ ownerId: owner.ownerId, codeHash: hashes[0] })).ok, false);
  const audit = await db.query("SELECT action FROM admin_audit WHERE target_id=$1 ORDER BY event_id", [owner.ownerId]);
  assert.deepEqual(audit.rows.map((row) => row.action), ["owner.bootstrap", "owner.mfa.recovery-authorized", "owner.mfa.recovery-start", "owner.mfa.recovery-flow-cancelled", "owner.mfa.recovery-authorized", "owner.mfa.recovery-start", "owner.mfa.recovery-complete"]);

  const { migrate } = await import("../server/db/migrate.js");
  const migrationDir = fs.mkdtempSync(path.join(os.tmpdir(), "nc-mfa-migration-rollback-"));
  try {
    fs.writeFileSync(path.join(migrationDir, "999_rollback_probe.sql"), "CREATE TABLE recovery_migration_rollback_probe(id integer);\nSELECT 1 / 0;\n");
    await assert.rejects(() => migrate({ db, dir: migrationDir }));
    const rolledBack = await db.query("SELECT to_regclass($1) AS probe", [`${db.schema}.recovery_migration_rollback_probe`]);
    assert.equal(rolledBack.rows[0].probe, null, "DDL before a failed statement rolls back with the migration");
    const ledger = await db.query("SELECT version FROM schema_migrations WHERE version='999'");
    assert.equal(ledger.rowCount, 0, "a failed migration is not recorded as applied");
  } finally {
    fs.rmSync(migrationDir, { recursive: true, force: true });
  }
});
