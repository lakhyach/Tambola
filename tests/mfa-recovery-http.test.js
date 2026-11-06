import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createApp } from "../server/index.js";
import { createMemoryOwnerStore } from "../server/admin/owner-store.js";
import { createMemoryOwnerSessions } from "../server/admin/owner-sessions.js";
import { createMemoryAdminAudit } from "../server/admin/audit.js";
import { createMemoryMfaRecoveryStore } from "../server/admin/mfa-recovery.js";
import { currentCode, decryptSecret } from "../server/admin/mfa.js";
import { hashPassword } from "../server/admin/password.js";

class Client {
  constructor(url) { this.url = url; this.cookies = new Map(); this.csrf = null; }
  async request(method, path, body) {
    const headers = {};
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k,v]) => `${k}=${v}`).join("; ");
    if (body !== undefined) headers["content-type"] = "application/json";
    if (method !== "GET" && this.csrf) headers["x-csrf-token"] = this.csrf;
    const response = await fetch(this.url + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const raw of response.headers.getSetCookie?.() || []) {
      const [name, ...rest] = raw.split(";")[0].split("=");
      const value = rest.join("=");
      if (value) this.cookies.set(name, value); else this.cookies.delete(name);
    }
    const data = await response.json();
    if (data.csrfToken) this.csrf = data.csrfToken;
    return { status: response.status, data };
  }
  get(path) { return this.request("GET", path); }
  post(path, data = {}) { return this.request("POST", path, data); }
}

test("owner MFA recovery requires CSRF, password and one-use authorization, and replaces only after TOTP proof", async (t) => {
  const key = randomBytes(32);
  const ownerStore = createMemoryOwnerStore();
  const sessions = createMemoryOwnerSessions();
  const audit = createMemoryAdminAudit();
  const recovery = createMemoryMfaRecoveryStore();
  const logs = [];
  await ownerStore.create({ username: "owner", passwordHash: await hashPassword("correct-horse-battery") });
  const app = await createApp({ memoryOnly: true, origins: [], ownerStore, ownerSessions: sessions, audit, mfaRecovery: recovery,
    mfaKey: { configured: true, key }, mfaIssuer: "Ninety Club", log: (...args) => logs.push(args) });
  const port = await app.listen(0);
  t.after(() => app.closeServer());
  const base = `http://127.0.0.1:${port}`;

  const initial = new Client(base); await initial.get("/api/admin/session");
  const login = await initial.post("/api/admin/signin", { username: "owner", password: "correct-horse-battery" });
  assert.equal(login.data.authenticated, true);
  const enrollment = await initial.post("/api/admin/settings/mfa/enroll", {});
  const oldSecret = enrollment.data.secret;
  assert.ok(oldSecret);
  assert.equal((await initial.post("/api/admin/settings/mfa/confirm", { code: currentCode({ secret: oldSecret }) })).status, 200);
  await initial.post("/api/admin/signout", {});

  const stale = new Client(base); await stale.get("/api/admin/session");
  const staleLogin = await stale.post("/api/admin/signin", { username: "owner", password: "correct-horse-battery" });
  assert.equal((await stale.post("/api/admin/signin/mfa", { challengeToken: staleLogin.data.challengeToken, code: currentCode({ secret: oldSecret, now: Date.now() + 30_000 }) })).status, 200);
  const staleCookie = stale.cookies.get("tambola_owner");

  const authorizationToken = "a".repeat(64);
  await recovery.issueAuthorization({ ownerId: (await ownerStore.getByUsername("owner")).ownerId, authorizationToken });
  const browser = new Client(base); await browser.get("/api/admin/session");
  const badCsrf = new Client(base);
  assert.equal((await badCsrf.post("/api/admin/mfa/recovery/authorize", { username: "owner", password: "correct-horse-battery", authorization: authorizationToken })).status, 403);
  assert.equal((await browser.post("/api/admin/mfa/recovery/authorize", { username: "owner", password: "wrong-password", authorization: authorizationToken })).status, 401);

  const started = await browser.post("/api/admin/mfa/recovery/authorize", { username: "owner", password: "correct-horse-battery", authorization: authorizationToken });
  assert.equal(started.status, 200);
  const setup = await browser.post("/api/admin/mfa/recovery/enroll", {});
  assert.equal(setup.status, 200);
  assert.match(setup.data.uri, /^otpauth:\/\/totp\/Ninety%20Club:/);
  assert.match(setup.data.qr, /^data:image\/png;base64,/);
  assert.equal((await browser.post("/api/admin/mfa/recovery/enroll", {})).status, 409, "QR material can only be revealed once");
  assert.equal((await browser.post("/api/admin/mfa/recovery/confirm", { code: "000000" })).status, 401);
  assert.equal(decryptSecret({ envelope: (await ownerStore.getForMfa({ ownerId: (await ownerStore.getByUsername("owner")).ownerId })).totpSecretEnc, ownerId: (await ownerStore.getByUsername("owner")).ownerId, key }), oldSecret, "old factor remains active before valid confirmation");

  const newSecret = setup.data.secret;
  const confirmed = await browser.post("/api/admin/mfa/recovery/confirm", { code: currentCode({ secret: newSecret }) });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.data.recoveryCodes.length, 10);
  assert.equal(browser.cookies.has("tambola_mfa_recovery"), false);
  const owner = await ownerStore.getByUsername("owner");
  assert.equal(decryptSecret({ envelope: owner.totpSecretEnc, ownerId: owner.ownerId, key }), newSecret);
  assert.equal((await sessions.verify({ token: staleCookie })).ok, false, "existing owner session is revoked");
  assert.equal((await browser.post("/api/admin/mfa/recovery/confirm", { code: currentCode({ secret: newSecret, now: Date.now() + 30_000 }) })).status, 401, "the QR recovery flow is consumed");

  const oldFactorLogin = new Client(base); await oldFactorLogin.get("/api/admin/session");
  const oldChallenge = await oldFactorLogin.post("/api/admin/signin", { username: "owner", password: "correct-horse-battery" });
  assert.equal((await oldFactorLogin.post("/api/admin/signin/mfa", { challengeToken: oldChallenge.data.challengeToken, code: currentCode({ secret: oldSecret, now: Date.now() + 60_000 }) })).status, 401, "old authenticator no longer signs in");

  const codeBrowser = new Client(base); await codeBrowser.get("/api/admin/session");
  const challenge = await codeBrowser.post("/api/admin/signin", { username: "owner", password: "correct-horse-battery" });
  const recoveryCode = confirmed.data.recoveryCodes[0];
  assert.equal((await codeBrowser.post("/api/admin/signin/mfa", { challengeToken: challenge.data.challengeToken, code: recoveryCode })).status, 200);
  assert.equal(logs.flat().some((value) => String(value).includes(oldSecret) || String(value).includes(newSecret) || String(value).includes(authorizationToken) || confirmed.data.recoveryCodes.some((code) => String(value).includes(code))), false, "secrets are not logged");

  const reused = new Client(base); await reused.get("/api/admin/session");
  const nextChallenge = await reused.post("/api/admin/signin", { username: "owner", password: "correct-horse-battery" });
  assert.equal((await reused.post("/api/admin/signin/mfa", { challengeToken: nextChallenge.data.challengeToken, code: recoveryCode })).status, 401, "recovery codes are one-use");
  const auditEvents = await audit.recent({ limit: 100 });
  assert.equal(auditEvents.some((event) => event.action === "owner.mfa.recovery-start"), true);
  assert.equal(auditEvents.some((event) => event.action === "owner.mfa.recovery-confirm-failure"), true);
  assert.equal(auditEvents.some((event) => event.action === "owner.mfa.recovery-complete"), true);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await reused.post("/api/admin/mfa/recovery/authorize", { username: "owner", password: "correct-horse-battery", authorization: "f".repeat(64) });
    assert.equal(result.status, 401);
  }
  assert.equal((await reused.post("/api/admin/mfa/recovery/authorize", { username: "owner", password: "correct-horse-battery", authorization: "f".repeat(64) })).status, 429, "recovery guesses are rate limited");
});
