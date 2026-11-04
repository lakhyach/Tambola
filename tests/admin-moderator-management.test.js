import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createApp } from "../server/index.js";
import { hashPassword } from "../server/admin/password.js";

const hasDatabase = Boolean(process.env.DATABASE_URL);

class OwnerClient {
  constructor(base, username = "owner.test", password = "owner-test-password") { this.base = base; this.username = username; this.password = password; this.cookies = new Map(); this.csrf = null; }
  async request(method, path, body) {
    const headers = {};
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; ");
    if (body !== undefined) headers["content-type"] = "application/json";
    if (method !== "GET" && this.csrf) headers["x-csrf-token"] = this.csrf;
    const response = await fetch(this.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const cookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
    for (const raw of cookies) {
      const pair = raw.split(";")[0]; const split = pair.indexOf("=");
      if (split < 0) continue;
      const key = pair.slice(0, split); const value = pair.slice(split + 1);
      if (value) this.cookies.set(key, value); else this.cookies.delete(key);
    }
    const data = await response.json().catch(() => null);
    if (data?.csrfToken) this.csrf = data.csrfToken;
    return { status: response.status, body: data };
  }
  get(path) { return this.request("GET", path); }
  post(path, body = {}) { return this.request("POST", path, body); }
  put(path, body = {}) { return this.request("PUT", path, body); }
  delete(path) { return this.request("DELETE", path); }
  async signIn() { await this.get("/api/admin/session"); return this.post("/api/admin/signin", { username: this.username, password: this.password }); }
}

describe("Super Admin moderator management HTTP API", { skip: !hasDatabase }, () => {
  let db;
  let controlDb;
  let schema;
  let app;
  let base;
  let auth;

  before(async () => {
    const [{ createPool }, { migrate }, { createStore }, { createSessionStore }, { createGameController }, { createOwnerStore }, { createOwnerSessionStore }, { createAdminAudit }, moderatorAuth] = await Promise.all([
      import("../server/db/pool.js"), import("../server/db/migrate.js"), import("../server/persist/store.js"),
      import("../server/persist/sessions.js"), import("../server/persist/controller.js"), import("../server/admin/owner-store.js"),
      import("../server/admin/owner-sessions.js"), import("../server/admin/audit.js"), import("../server/moderator/auth.js"),
    ]);
    schema = `tambola_admin_mod_${randomBytes(4).toString("hex")}`;
    const connectionString = process.env.DATABASE_URL;
    controlDb = createPool({ connectionString });
    await controlDb.query(`CREATE SCHEMA "${schema}"`);
    db = createPool({ connectionString, schema });
    await migrate({ db });
    const store = createStore({ db });
    const sessions = createSessionStore({ db });
    const controller = createGameController({ store, sessions });
    const ownerStore = createOwnerStore({ db });
    await ownerStore.create({ username: "owner.test", passwordHash: await hashPassword("owner-test-password"), role: "super_admin" });
    const ownerSessions = createOwnerSessionStore({ db });
    const audit = createAdminAudit({ db });
    auth = moderatorAuth.createModeratorAuth({ db, mfaKey: null });
    app = await createApp({ store, sessions, controller, db, ownerStore, ownerSessions, audit, mfaKey: { configured: false, key: null }, origins: [], log: () => {} });
    base = `http://127.0.0.1:${await app.listen(0)}`;
  });

  after(async () => {
    if (app) await app.closeServer();
    if (db && db.pool?.ended !== true) await db.end().catch(() => {});
    if (controlDb) {
      if (schema) await controlDb.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
      await controlDb.end();
    }
  });

  test("owner gate, explicit grants, invitation activation, revocation, sessions, suspension and recovery", async () => {
    const anonymous = new OwnerClient(base);
    assert.equal((await anonymous.get("/api/admin/moderators")).status, 401);
    const owner = new OwnerClient(base);
    assert.equal((await owner.signIn()).status, 200);

    const limitedPassword = "owner-limited-test-password";
    const limited = await app.admin.ownerStore.create({ username: `owner.${randomBytes(3).toString("hex")}`, passwordHash: await hashPassword(limitedPassword), role: "owner" });
    const ownerOnly = new OwnerClient(base, limited.username, limitedPassword);
    const ownerSignIn = await ownerOnly.signIn();
    assert.equal(ownerSignIn.status, 200);
    assert.equal(ownerSignIn.body.owner.role, "owner");
    for (const path of ["/api/admin/overview", "/api/admin/instances", "/api/admin/moderators", "/api/admin/reports/instances"]) {
      assert.equal((await ownerOnly.get(path)).status, 403, `Owner is denied platform-wide endpoint ${path}`);
    }
    const ownerSettings = await ownerOnly.get("/api/admin/settings");
    assert.equal(ownerSettings.status, 200);
    assert.deepEqual(ownerSettings.body.owners.map((account) => account.username), [limited.username], "Owner settings disclose only its own account");
    assert.equal((await ownerOnly.post("/api/admin/instances", { slug: "owner-forged" })).status, 403, "CSRF-valid Owner still cannot create a platform instance");

    const malformedModeratorId = "a".repeat(36);
    const auditBeforeMalformedIds = Number((await db.query("SELECT count(*) AS n FROM platform_audit")).rows[0].n);
    const malformedModeratorRequests = [
      owner.get(`/api/admin/moderators/${malformedModeratorId}`),
      owner.request("PATCH", `/api/admin/moderators/${malformedModeratorId}/profile`, { username: "invalid.probe" }),
      owner.request("PATCH", `/api/admin/moderators/${malformedModeratorId}/status`, { status: "suspended" }),
      owner.post(`/api/admin/moderators/${malformedModeratorId}/recovery`),
      owner.post(`/api/admin/moderators/${malformedModeratorId}/sessions/revoke`),
      owner.put(`/api/admin/moderators/${malformedModeratorId}/grants/regular`, { permissions: ["room.read"] }),
      owner.delete(`/api/admin/moderators/${malformedModeratorId}/grants/regular`),
    ];
    const malformedModeratorResults = await Promise.all(malformedModeratorRequests);
    assert.ok(malformedModeratorResults.every((result) => result.status === 404 && result.body?.code === "MODERATOR_NOT_FOUND"),
      "all moderator-ID routes reject malformed UUID shapes before database queries or mutations");
    assert.equal(Number((await db.query("SELECT count(*) AS n FROM platform_audit")).rows[0].n), auditBeforeMalformedIds,
      "malformed moderator-ID probes do not create audit or mutation records");

    const noAccess = await owner.post("/api/admin/moderators", { username: `wait.${randomBytes(3).toString("hex")}` });
    assert.equal(noAccess.status, 201);
    const listedPending = await owner.get("/api/admin/moderators");
    const pendingRow = listedPending.body.moderators.find((item) => item.moderator_id === noAccess.body.moderator.moderatorId);
    assert.equal(pendingRow.status, "invited");
    assert.equal(pendingRow.assignments.some((item) => item.instanceId), false, "provisioning without an explicit grant provides no instance access");

    const username = `mod.${randomBytes(3).toString("hex")}`;
    const created = await owner.post("/api/admin/moderators", { username, instanceId: "regular", permissions: ["room.read", "bookings.read", "bookings.assign"] });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.match(created.body.inviteToken, /^[0-9a-f]{64}$/);
    const moderatorId = created.body.moderator.moderatorId;
    const ownerActor = await db.query(
      "SELECT actor_role FROM platform_audit WHERE action='moderator.provision' AND metadata->>'moderatorId'=$1 ORDER BY event_id DESC LIMIT 1",
      [moderatorId],
    );
    assert.equal(ownerActor.rows[0]?.actor_role, "super_admin", "platform moderator changes are attributed to the separately authenticated Super Admin");
    const storedInvite = await db.query("SELECT token_hash FROM moderator_invites WHERE moderator_id=$1", [moderatorId]);
    assert.notEqual(storedInvite.rows[0].token_hash, created.body.inviteToken, "only a hash of the one-time invitation token is stored");

    const accepted = await auth.acceptInvite({ token: created.body.inviteToken, password: "moderator-initial-password" });
    assert.equal(accepted.ok, true);
    let detail = await owner.get(`/api/admin/moderators/${moderatorId}`);
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.body.grants[0].permissions.sort(), ["bookings.assign", "bookings.read", "room.read"]);

    const invalid = await owner.put(`/api/admin/moderators/${moderatorId}/grants/regular`, { permissions: ["room.read", "not-a-permission"] });
    assert.equal(invalid.status, 400);
    const updated = await owner.put(`/api/admin/moderators/${moderatorId}/grants/regular`, { permissions: ["instance.read", "reports.read"] });
    assert.equal(updated.status, 200);
    assert.deepEqual(updated.body.permissions.sort(), ["instance.read", "reports.read"]);

    const issuedSession = await auth.issueSession(moderatorId);
    assert.ok(issuedSession.token);
    const revokedSessions = await owner.post(`/api/admin/moderators/${moderatorId}/sessions/revoke`);
    assert.equal(revokedSessions.status, 200);
    assert.equal(revokedSessions.body.revoked, 1);
    assert.equal(await auth.verifySession({ token: issuedSession.token }), null);

    const suspended = await owner.request("PATCH", `/api/admin/moderators/${moderatorId}/status`, { status: "suspended" });
    assert.equal(suspended.status, 200);
    assert.equal(suspended.body.moderator.status, "suspended");
    const reactivated = await owner.request("PATCH", `/api/admin/moderators/${moderatorId}/status`, { status: "active" });
    assert.equal(reactivated.status, 200);
    assert.equal(reactivated.body.moderator.status, "active");

    const recovery = await owner.post(`/api/admin/moderators/${moderatorId}/recovery`);
    assert.equal(recovery.status, 201);
    assert.match(recovery.body.recoveryToken, /^[0-9a-f]{64}$/);
    const account = await db.query("SELECT status FROM moderator_accounts WHERE moderator_id=$1", [moderatorId]);
    assert.equal(account.rows[0].status, "suspended");
    const recovered = await auth.completeRecovery({ token: recovery.body.recoveryToken, password: "moderator-recovered-password" });
    assert.equal(recovered.ok, true);
    const revokedGrant = await owner.delete(`/api/admin/moderators/${moderatorId}/grants/regular`);
    assert.equal(revokedGrant.status, 200);
    detail = await owner.get(`/api/admin/moderators/${moderatorId}`);
    assert.ok(detail.body.grants[0].revoked_at);
    assert.ok(detail.body.activity.some((event) => event.action === "moderator.grant.revoke"));
  });
});
