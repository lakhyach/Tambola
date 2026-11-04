import express from "express";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "./password.js";
import { MODERATOR_PERMISSIONS } from "../moderator/authorization.js";
import { isUuid } from "../identifiers.js";

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function createModeratorAdminRouter({ db, audit, spendMutationBudget } = {}) {
  const router = express.Router();
  router.param("moderatorId", (req, res, next, moderatorId) => {
    if (!isUuid(moderatorId)) return res.status(404).json({ ok: false, code: "MODERATOR_NOT_FOUND", error: "moderator not found" });
    next();
  });
  async function auditPlatform(req, action, { moderatorId = null, instanceId = null, metadata = {} } = {}) {
    await db.query(`INSERT INTO platform_audit(actor,actor_role,instance_id,action,result,metadata,request_id)
      VALUES($1,'super_admin',$2,$3,'success',$4,$5)`, [req.owner.username, instanceId, action, JSON.stringify({ ...metadata, moderatorId }), req.id || null]);
    await audit.record({ actor: req.owner.username, action, targetType: moderatorId ? "moderator" : "instance", targetId: moderatorId || instanceId, metadata }).catch(() => {});
  }
  const budget = async (req, res) => await spendMutationBudget(req, res);

  router.get("/", wrap(async (_req, res) => {
    const result = await db.query(`SELECT a.moderator_id,a.username,a.status,a.totp_confirmed_at,a.created_at,a.updated_at,
      COALESCE(jsonb_agg(jsonb_build_object('instanceId',i.instance_id,'slug',i.slug,'name',i.display_name,'permissions',g.permissions)
        ORDER BY i.display_name) FILTER (WHERE g.revoked_at IS NULL), '[]'::jsonb) AS assignments,
      (SELECT count(*)::int FROM moderator_sessions s WHERE s.moderator_id=a.moderator_id AND s.revoked_at IS NULL AND s.expires_at>now() AND s.absolute_expires_at>now()) AS active_sessions
      FROM moderator_accounts a LEFT JOIN moderator_instance_grants g ON g.moderator_id=a.moderator_id
      LEFT JOIN game_instances i ON i.instance_id=g.instance_id GROUP BY a.moderator_id ORDER BY a.created_at DESC`);
    res.json({ ok: true, moderators: result.rows });
  }));

  router.post("/", wrap(async (req, res) => {
    if (!(await budget(req, res))) return;
    const username = typeof req.body?.username === "string" ? req.body.username.trim().toLowerCase() : "";
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) return res.status(400).json({ ok: false, code: "INVALID_INPUT", error: "username must be 3-40 lowercase letters, digits, dot, underscore or hyphen" });
    const moderatorId = randomUUID(); const inviteId = randomUUID(); const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const passwordHash = await hashPassword(randomBytes(48).toString("base64url"));
    const grant = req.body?.instanceId ? { instanceId: String(req.body.instanceId), permissions: req.body.permissions } : null;
    if (grant && (!Array.isArray(grant.permissions) || new Set(grant.permissions).size !== grant.permissions.length || grant.permissions.some((p) => !MODERATOR_PERMISSIONS.includes(p)))) {
      return res.status(400).json({ ok: false, code: "INVALID_PERMISSION", error: "permissions must be an explicit list of known capabilities" });
    }
    try {
      await db.withTransaction(async (client) => {
        if (grant) {
          const instance = await client.query("SELECT 1 FROM game_instances WHERE instance_id=$1", [grant.instanceId]);
          if (!instance.rowCount) { const error = new Error("INSTANCE_NOT_FOUND"); error.code = "INSTANCE_NOT_FOUND"; throw error; }
        }
        await client.query(`INSERT INTO moderator_accounts(moderator_id,username,password_hash,status,created_by)
          VALUES($1,$2,$3,'invited',$4)`, [moderatorId, username, passwordHash, req.owner.username]);
        await client.query(`INSERT INTO moderator_invites(invite_id,moderator_id,token_hash,created_by,expires_at)
          VALUES($1,$2,$3,$4,now()+interval '72 hours')`, [inviteId, moderatorId, tokenHash, req.owner.username]);
        if (grant) await client.query(`INSERT INTO moderator_instance_grants(moderator_id,instance_id,permissions,granted_by)
          VALUES($1,$2,$3,$4)`, [moderatorId, grant.instanceId, grant.permissions, req.owner.username]);
        await client.query(`INSERT INTO platform_audit(actor,actor_role,instance_id,action,result,metadata,request_id)
          VALUES($1,'super_admin',$2,'moderator.provision','success',$3,$4)`, [req.owner.username, grant?.instanceId || null, JSON.stringify({ moderatorId, username }), req.id || null]);
      });
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ ok: false, code: "USERNAME_EXISTS", error: "that moderator username is already reserved" });
      if (error.code === "INSTANCE_NOT_FOUND") return res.status(404).json({ ok: false, code: error.code, error: "instance not found" });
      throw error;
    }
    await audit.record({ actor: req.owner.username, action: "moderator.provision", targetType: "moderator", targetId: moderatorId, metadata: { username, initialGrant: Boolean(grant) } }).catch(() => {});
    res.status(201).json({ ok: true, moderator: { moderatorId, username, status: "invited" }, inviteToken: token, expiresInHours: 72 });
  }));

  router.get("/:moderatorId", wrap(async (req, res) => {
    const [account, grants, events] = await Promise.all([
      db.query("SELECT moderator_id,username,status,totp_confirmed_at,created_at,updated_at FROM moderator_accounts WHERE moderator_id=$1", [req.params.moderatorId]),
      db.query(`SELECT i.instance_id,i.slug,i.display_name,g.permissions,g.granted_by,g.granted_at,g.revoked_by,g.revoked_at
        FROM moderator_instance_grants g JOIN game_instances i USING(instance_id) WHERE g.moderator_id=$1 ORDER BY g.granted_at DESC`, [req.params.moderatorId]),
      db.query("SELECT event_id,instance_id,room_code,action,result,metadata,occurred_at FROM platform_audit WHERE metadata->>'moderatorId'=$1 ORDER BY event_id DESC LIMIT 100", [req.params.moderatorId]),
    ]);
    if (!account.rowCount) return res.status(404).json({ ok: false, code: "MODERATOR_NOT_FOUND", error: "moderator not found" });
    res.json({ ok: true, moderator: account.rows[0], grants: grants.rows, activity: events.rows });
  }));

  router.patch("/:moderatorId/profile", wrap(async (req, res) => {
    if (!(await budget(req, res))) return;
    const username = typeof req.body?.username === "string" ? req.body.username.trim().toLowerCase() : "";
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) return res.status(400).json({ ok: false, code: "INVALID_INPUT", error: "username must be 3-40 lowercase letters, digits, dot, underscore or hyphen" });
    try {
      const result = await db.query("UPDATE moderator_accounts SET username=$2 WHERE moderator_id=$1 RETURNING moderator_id,username,status", [req.params.moderatorId, username]);
      if (!result.rowCount) return res.status(404).json({ ok: false, code: "MODERATOR_NOT_FOUND", error: "moderator not found" });
      await auditPlatform(req, "moderator.profile.update", { moderatorId: req.params.moderatorId, metadata: { username } });
      res.json({ ok: true, moderator: result.rows[0] });
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ ok: false, code: "USERNAME_EXISTS", error: "that moderator username is already reserved" });
      throw error;
    }
  }));

  router.post("/:moderatorId/recovery", wrap(async (req, res) => {
    if (!(await budget(req, res))) return;
    const recoveryId = randomUUID();
    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const result = await db.withTransaction(async (client) => {
      const account = await client.query("SELECT username,status FROM moderator_accounts WHERE moderator_id=$1 FOR UPDATE", [req.params.moderatorId]);
      if (!account.rowCount || account.rows[0].status === "invited") return null;
      await client.query("UPDATE moderator_accounts SET status='suspended' WHERE moderator_id=$1", [req.params.moderatorId]);
      await client.query(`UPDATE moderator_sessions SET revoked_at=COALESCE(revoked_at,now()),revoke_reason='super-admin-recovery'
        WHERE moderator_id=$1`, [req.params.moderatorId]);
      await client.query(`UPDATE moderator_socket_tickets SET consumed_at=COALESCE(consumed_at,now())
        WHERE moderator_session_id IN (SELECT session_id FROM moderator_sessions WHERE moderator_id=$1)`, [req.params.moderatorId]);
      await client.query(`UPDATE moderator_recovery_tokens SET revoked_at=now()
        WHERE moderator_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL`, [req.params.moderatorId]);
      await client.query(`INSERT INTO moderator_recovery_tokens(recovery_id,moderator_id,token_hash,created_by,expires_at)
        VALUES($1,$2,$3,$4,now()+interval '30 minutes')`, [recoveryId, req.params.moderatorId, tokenHash, req.owner.username]);
      await client.query(`INSERT INTO platform_audit(actor,actor_role,action,result,metadata,request_id)
        VALUES($1,'super_admin','moderator.recovery.issue','success',$2,$3)`, [req.owner.username, JSON.stringify({ moderatorId: req.params.moderatorId, expiresMinutes: 30 }), req.id || null]);
      return { username: account.rows[0].username };
    });
    if (!result) return res.status(404).json({ ok: false, code: "MODERATOR_NOT_FOUND", error: "active or suspended moderator not found" });
    await audit.record({ actor: req.owner.username, action: "moderator.recovery.issue", targetType: "moderator", targetId: req.params.moderatorId }).catch(() => {});
    res.status(201).json({ ok: true, recoveryToken: token, expiresInMinutes: 30, requiresMfaReenrollment: true });
  }));

  router.patch("/:moderatorId/status", wrap(async (req, res) => {
    if (!(await budget(req, res))) return;
    const status = req.body?.status;
    if (!['active','suspended'].includes(status)) return res.status(400).json({ ok: false, code: "INVALID_INPUT", error: "status must be active or suspended" });
    const result = await db.withTransaction(async (client) => {
      const changed = await client.query("UPDATE moderator_accounts SET status=$2 WHERE moderator_id=$1 RETURNING username,status", [req.params.moderatorId, status]);
      if (!changed.rowCount) return null;
      const sessions = status === "suspended" ? await client.query(`UPDATE moderator_sessions SET revoked_at=now(),revoke_reason='account-suspended'
        WHERE moderator_id=$1 AND revoked_at IS NULL RETURNING session_id`, [req.params.moderatorId]) : { rowCount: 0 };
      await client.query(`INSERT INTO platform_audit(actor,actor_role,action,result,metadata,request_id)
        VALUES($1,'super_admin',$2,'success',$3,$4)`, [req.owner.username, `moderator.${status}`, JSON.stringify({ moderatorId: req.params.moderatorId, username: changed.rows[0].username, revokedSessions: sessions.rowCount }), req.id || null]);
      return { moderator: changed.rows[0], revoked: sessions.rowCount };
    });
    if (!result) return res.status(404).json({ ok: false, code: "MODERATOR_NOT_FOUND", error: "moderator not found" });
    await audit.record({ actor: req.owner.username, action: `moderator.${status}`, targetType: "moderator", targetId: req.params.moderatorId, metadata: { revokedSessions: result.revoked } }).catch(() => {});
    res.json({ ok: true, moderator: result.moderator, revokedSessions: result.revoked });
  }));

  router.post("/:moderatorId/sessions/revoke", wrap(async (req, res) => {
    if (!(await budget(req, res))) return;
    const result = await db.query(`UPDATE moderator_sessions SET revoked_at=now(),revoke_reason='super-admin-revoked'
      WHERE moderator_id=$1 AND revoked_at IS NULL RETURNING session_id`, [req.params.moderatorId]);
    if (!result.rowCount && !(await db.query("SELECT 1 FROM moderator_accounts WHERE moderator_id=$1", [req.params.moderatorId])).rowCount)
      return res.status(404).json({ ok: false, code: "MODERATOR_NOT_FOUND", error: "moderator not found" });
    await auditPlatform(req, "moderator.sessions.revoke", { moderatorId: req.params.moderatorId, metadata: { count: result.rowCount } });
    res.json({ ok: true, revoked: result.rowCount });
  }));

  router.put("/:moderatorId/grants/:instanceId", wrap(async (req, res) => {
    if (!(await budget(req, res))) return;
    const permissions = req.body?.permissions;
    if (!Array.isArray(permissions) || new Set(permissions).size !== permissions.length || permissions.some((p) => !MODERATOR_PERMISSIONS.includes(p)))
      return res.status(400).json({ ok: false, code: "INVALID_PERMISSION", error: "permissions must be an explicit list of known capabilities" });
    try {
      await db.withTransaction(async (client) => {
        const mod = await client.query("SELECT 1 FROM moderator_accounts WHERE moderator_id=$1 FOR UPDATE", [req.params.moderatorId]);
        const instance = await client.query("SELECT 1 FROM game_instances WHERE instance_id=$1", [req.params.instanceId]);
        if (!mod.rowCount || !instance.rowCount) { const error = new Error("NOT_FOUND"); error.code = "NOT_FOUND"; throw error; }
        await client.query(`INSERT INTO moderator_instance_grants(moderator_id,instance_id,permissions,granted_by)
          VALUES($1,$2,$3,$4) ON CONFLICT(moderator_id,instance_id) DO UPDATE
          SET permissions=EXCLUDED.permissions,granted_by=EXCLUDED.granted_by,granted_at=now(),revoked_at=NULL,revoked_by=NULL`,
        [req.params.moderatorId, req.params.instanceId, permissions, req.owner.username]);
        await client.query(`INSERT INTO platform_audit(actor,actor_role,instance_id,action,result,metadata,request_id)
          VALUES($1,'super_admin',$2,'moderator.grant.update','success',$3,$4)`,
        [req.owner.username, req.params.instanceId, JSON.stringify({ moderatorId: req.params.moderatorId, permissions }), req.id || null]);
      });
    } catch (error) {
      if (error.code === "NOT_FOUND") return res.status(404).json({ ok: false, code: "NOT_FOUND", error: "moderator or instance not found" });
      throw error;
    }
    await audit.record({ actor: req.owner.username, action: "moderator.grant.update", targetType: "moderator", targetId: req.params.moderatorId, metadata: { instanceId: req.params.instanceId, permissions } }).catch(() => {});
    res.json({ ok: true, moderatorId: req.params.moderatorId, instanceId: req.params.instanceId, permissions });
  }));

  router.delete("/:moderatorId/grants/:instanceId", wrap(async (req, res) => {
    if (!(await budget(req, res))) return;
    const result = await db.query(`UPDATE moderator_instance_grants SET revoked_at=now(),revoked_by=$3
      WHERE moderator_id=$1 AND instance_id=$2 AND revoked_at IS NULL RETURNING moderator_id`, [req.params.moderatorId, req.params.instanceId, req.owner.username]);
    if (!result.rowCount) return res.status(404).json({ ok: false, code: "GRANT_NOT_FOUND", error: "active grant not found" });
    await auditPlatform(req, "moderator.grant.revoke", { moderatorId: req.params.moderatorId, instanceId: req.params.instanceId });
    res.json({ ok: true, revoked: true });
  }));

  return router;
}
