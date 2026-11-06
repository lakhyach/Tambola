import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hashPassword, verifyPassword } from "../admin/password.js";
import { decryptSecret, encryptSecret, generateSecret, provisioningUri, verifyCode } from "../admin/mfa.js";

const TOKEN_RE = /^[0-9a-f]{64}$/;
const digest = (token) => createHash("sha256").update(String(token || "")).digest("hex");
const rawToken = () => randomBytes(32).toString("hex");
const dummyHash = "scrypt$16384$8$1$00$00";
const IDLE_MS = 12 * 60 * 60 * 1000;
const ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;

export function createModeratorAuth({ db, mfaKey = null } = {}) {
  if (!db) throw new Error("createModeratorAuth requires PostgreSQL");

  async function verifyCredentials({ username, password }) {
    const result = await db.query(`SELECT moderator_id,username,password_hash,status,totp_secret_enc,totp_confirmed_at
      FROM moderator_accounts WHERE username=$1`, [String(username || "").trim().toLowerCase()]);
    const row = result.rows[0];
    const valid = await verifyPassword(password || "", row?.password_hash || dummyHash);
    if (!row || !valid || row.status !== "active") return { ok: false };
    return { ok: true, moderatorId: row.moderator_id, username: row.username, mfaEnrolled: Boolean(row.totp_confirmed_at) };
  }

  async function account(moderatorId) {
    const result = await db.query(`SELECT moderator_id,username,status,totp_secret_enc,totp_confirmed_at,totp_last_step
      FROM moderator_accounts WHERE moderator_id=$1`, [moderatorId]);
    return result.rows[0] || null;
  }

  async function issueSession(moderatorId) {
    const token = rawToken();
    const sessionId = randomUUID();
    await db.query(`INSERT INTO moderator_sessions(session_id,moderator_id,token_hash,expires_at,absolute_expires_at)
      VALUES($1,$2,$3,now()+($4 * interval '1 millisecond'),now()+($5 * interval '1 millisecond'))`,
    [sessionId, moderatorId, digest(token), IDLE_MS, ABSOLUTE_MS]);
    return { token, sessionId };
  }

  async function verifySession({ token, sessionId } = {}) {
    if (token && !TOKEN_RE.test(token)) return null;
    const result = await db.query(`SELECT s.session_id,s.moderator_id,s.expires_at,s.absolute_expires_at,s.revoked_at,
        s.expires_at <= now() AS idle_expired,s.absolute_expires_at <= now() AS hard_expired,
        a.username,a.status,a.totp_confirmed_at
      FROM moderator_sessions s JOIN moderator_accounts a USING(moderator_id)
      WHERE ${sessionId ? "s.session_id=$1" : "s.token_hash=$1"}`, [sessionId || digest(token)]);
    const row = result.rows[0];
    if (!row || row.revoked_at || row.status !== "active") return null;
    if (row.idle_expired || row.hard_expired) {
      await db.query(`UPDATE moderator_sessions SET revoked_at=COALESCE(revoked_at,now()),revoke_reason=COALESCE(revoke_reason,'expired')
        WHERE session_id=$1 AND revoked_at IS NULL`, [row.session_id]);
      return null;
    }
    const touched = await db.query(`UPDATE moderator_sessions SET last_used_at=now(),expires_at=LEAST(now()+($2 * interval '1 millisecond'),absolute_expires_at)
      WHERE session_id=$1 AND revoked_at IS NULL AND expires_at>now() AND absolute_expires_at>now()
      RETURNING session_id`, [row.session_id, IDLE_MS]);
    if (!touched.rowCount) return null;
    return { sessionId: row.session_id, moderatorId: row.moderator_id, username: row.username, mfaEnrolled: Boolean(row.totp_confirmed_at) };
  }

  async function revokeSession(sessionId, reason = "logout") {
    await db.query("UPDATE moderator_sessions SET revoked_at=now(),revoke_reason=$2 WHERE session_id=$1 AND revoked_at IS NULL", [sessionId, reason]);
  }
  async function revokeAll(moderatorId, reason = "revoked") {
    const result = await db.query(`UPDATE moderator_sessions SET revoked_at=now(),revoke_reason=$2
      WHERE moderator_id=$1 AND revoked_at IS NULL RETURNING session_id`, [moderatorId, reason]);
    return result.rowCount;
  }

  async function changePassword({ moderatorId, sessionId, currentPassword, newPassword }) {
    const nextToken = rawToken();
    const nextSessionId = randomUUID();
    return db.withTransaction(async (client) => {
      const accountRow = await client.query(`SELECT password_hash,status,totp_confirmed_at
        FROM moderator_accounts WHERE moderator_id=$1 FOR UPDATE`, [moderatorId]);
      const account = accountRow.rows[0];
      if (!account || account.status !== "active") return { ok: false, code: "ACCOUNT_INACTIVE" };
      if (!account.totp_confirmed_at) return { ok: false, code: "MFA_REQUIRED" };
      const verified = await verifyPassword(currentPassword || "", account.password_hash || dummyHash);
      if (!verified) return { ok: false, code: "INVALID_CREDENTIALS" };
      if (await verifyPassword(newPassword, account.password_hash)) return { ok: false, code: "PASSWORD_UNCHANGED" };
      const activeSession = await client.query(`SELECT 1 FROM moderator_sessions
        WHERE session_id=$1 AND moderator_id=$2 AND revoked_at IS NULL
          AND expires_at>now() AND absolute_expires_at>now() FOR UPDATE`, [sessionId, moderatorId]);
      if (!activeSession.rowCount) return { ok: false, code: "SESSION_INVALID" };

      const passwordHash = await hashPassword(newPassword);
      await client.query("UPDATE moderator_accounts SET password_hash=$2 WHERE moderator_id=$1", [moderatorId, passwordHash]);
      await client.query(`UPDATE moderator_sessions SET revoked_at=now(),revoke_reason='password-changed'
        WHERE moderator_id=$1 AND revoked_at IS NULL`, [moderatorId]);
      await client.query(`UPDATE moderator_socket_tickets SET consumed_at=COALESCE(consumed_at,now())
        WHERE moderator_session_id IN (SELECT session_id FROM moderator_sessions WHERE moderator_id=$1)`, [moderatorId]);
      await client.query(`INSERT INTO moderator_sessions(session_id,moderator_id,token_hash,expires_at,absolute_expires_at)
        VALUES($1,$2,$3,now()+interval '12 hours',now()+interval '7 days')`, [nextSessionId, moderatorId, digest(nextToken)]);
      return { ok: true, token: nextToken, sessionId: nextSessionId };
    });
  }

  async function createInvite({ username, createdBy, expiresHours = 72 }) {
    const moderatorId = randomUUID();
    const inviteId = randomUUID();
    const token = rawToken();
    const passwordHash = await hashPassword(randomBytes(48).toString("base64url"));
    await db.withTransaction(async (client) => {
      await client.query(`INSERT INTO moderator_accounts(moderator_id,username,password_hash,status,created_by)
        VALUES($1,$2,$3,'invited',$4)`, [moderatorId, username.trim().toLowerCase(), passwordHash, createdBy]);
      await client.query(`INSERT INTO moderator_invites(invite_id,moderator_id,token_hash,created_by,expires_at)
        VALUES($1,$2,$3,$4,now()+($5 * interval '1 hour'))`, [inviteId, moderatorId, digest(token), createdBy, expiresHours]);
    });
    return { moderatorId, inviteToken: token, expiresHours };
  }

  async function acceptInvite({ token, password }) {
    if (!TOKEN_RE.test(token || "")) return { ok: false };
    const passwordHash = await hashPassword(password);
    return db.withTransaction(async (client) => {
      const result = await client.query(`SELECT i.invite_id,i.moderator_id FROM moderator_invites i
        JOIN moderator_accounts a USING(moderator_id)
        WHERE i.token_hash=$1 AND i.consumed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now() AND a.status='invited'
        FOR UPDATE OF i,a`, [digest(token)]);
      const row = result.rows[0];
      if (!row) return { ok: false };
      await client.query("UPDATE moderator_accounts SET password_hash=$2,status='active' WHERE moderator_id=$1", [row.moderator_id, passwordHash]);
      await client.query("UPDATE moderator_invites SET consumed_at=now() WHERE invite_id=$1", [row.invite_id]);
      return { ok: true, moderatorId: row.moderator_id };
    });
  }

  async function completeRecovery({ token, password }) {
    if (!TOKEN_RE.test(token || "")) return { ok: false };
    const passwordHash = await hashPassword(password);
    return db.withTransaction(async (client) => {
      const found = await client.query(`SELECT r.recovery_id,r.moderator_id FROM moderator_recovery_tokens r
        JOIN moderator_accounts a USING(moderator_id)
        WHERE r.token_hash=$1 AND r.consumed_at IS NULL AND r.revoked_at IS NULL AND r.expires_at>now() AND a.status='suspended'
        FOR UPDATE OF r,a`, [digest(token)]);
      const row = found.rows[0];
      if (!row) return { ok: false };
      await client.query(`UPDATE moderator_accounts SET password_hash=$2,status='active',totp_secret_enc=NULL,totp_confirmed_at=NULL,totp_last_step=NULL
        WHERE moderator_id=$1`, [row.moderator_id, passwordHash]);
      await client.query("UPDATE moderator_recovery_tokens SET consumed_at=now() WHERE recovery_id=$1", [row.recovery_id]);
      await client.query(`UPDATE moderator_sessions SET revoked_at=COALESCE(revoked_at,now()),revoke_reason='account-recovery'
        WHERE moderator_id=$1`, [row.moderator_id]);
      await client.query(`UPDATE moderator_socket_tickets SET consumed_at=COALESCE(consumed_at,now())
        WHERE moderator_session_id IN (SELECT session_id FROM moderator_sessions WHERE moderator_id=$1)`, [row.moderator_id]);
      await client.query(`INSERT INTO platform_audit(actor,actor_role,action,result,metadata)
        VALUES('system','system','moderator.recovery.complete','success',$1)`, [JSON.stringify({ moderatorId: row.moderator_id, mfaResetRequired: true })]);
      return { ok: true, moderatorId: row.moderator_id };
    });
  }

  async function beginMfa(moderatorId) {
    if (!mfaKey) return { ok: false, code: "MFA_UNAVAILABLE" };
    const current = await account(moderatorId);
    if (!current || current.status !== "active") return { ok: false, code: "ACCOUNT_INACTIVE" };
    if (current.totp_confirmed_at) return { ok: false, code: "MFA_ALREADY_ENROLLED" };
    const secret = generateSecret();
    const envelope = encryptSecret({ secret, ownerId: moderatorId, key: mfaKey });
    await db.query("UPDATE moderator_accounts SET totp_secret_enc=$2,totp_last_step=NULL WHERE moderator_id=$1 AND totp_confirmed_at IS NULL", [moderatorId, envelope]);
    return { ok: true, secret, uri: provisioningUri({ secret, username: current.username, issuer: "Ninety Club Moderator" }) };
  }

  async function confirmMfa(moderatorId, code) {
    const current = await account(moderatorId);
    const secret = decryptSecret({ envelope: current?.totp_secret_enc, ownerId: moderatorId, key: mfaKey });
    const checked = verifyCode({ secret, code, lastStep: current?.totp_last_step });
    if (!checked.ok) return { ok: false, code: checked.reason === "REPLAY" ? "MFA_REPLAY" : "MFA_INVALID_CODE" };
    const updated = await db.query(`UPDATE moderator_accounts SET totp_confirmed_at=now(),totp_last_step=$2
      WHERE moderator_id=$1 AND status='active' AND totp_secret_enc IS NOT NULL AND totp_confirmed_at IS NULL`, [moderatorId, checked.step]);
    return updated.rowCount ? { ok: true } : { ok: false, code: "MFA_NOT_PENDING" };
  }

  async function createChallenge(moderatorId, ipHash) {
    const challengeId = randomUUID();
    const token = rawToken();
    await db.query(`INSERT INTO moderator_mfa_challenges(challenge_id,moderator_id,token_hash,expires_at,ip_hash)
      VALUES($1,$2,$3,now()+interval '5 minutes',$4)`, [challengeId, moderatorId, digest(token), ipHash]);
    return { challengeToken: token };
  }

  async function verifyChallenge({ token, code, ipHash }) {
    if (!TOKEN_RE.test(token || "")) return null;
    return db.withTransaction(async (client) => {
      const found = await client.query(`SELECT c.challenge_id,c.moderator_id,c.attempts,c.ip_hash,a.username,a.totp_secret_enc,a.totp_last_step
        FROM moderator_mfa_challenges c JOIN moderator_accounts a USING(moderator_id)
        WHERE c.token_hash=$1 AND c.consumed_at IS NULL AND c.expires_at>now() AND c.attempts<5 AND a.status='active'
        FOR UPDATE OF c,a`, [digest(token)]);
      const row = found.rows[0];
      if (!row) return null;
      if (ipHash && row.ip_hash !== ipHash) {
        await client.query("UPDATE moderator_mfa_challenges SET attempts=attempts+1,consumed_at=CASE WHEN attempts>=4 THEN now() ELSE consumed_at END WHERE challenge_id=$1", [row.challenge_id]);
        return null;
      }
      const secret = decryptSecret({ envelope: row.totp_secret_enc, ownerId: row.moderator_id, key: mfaKey });
      const check = verifyCode({ secret, code, lastStep: row.totp_last_step });
      if (!check.ok) {
        await client.query("UPDATE moderator_mfa_challenges SET attempts=attempts+1,consumed_at=CASE WHEN attempts>=4 THEN now() ELSE consumed_at END WHERE challenge_id=$1", [row.challenge_id]);
        return null;
      }
      const advanced = await client.query(`UPDATE moderator_accounts SET totp_last_step=$2
        WHERE moderator_id=$1 AND (totp_last_step IS NULL OR totp_last_step<$2)`, [row.moderator_id, check.step]);
      if (!advanced.rowCount) return null;
      await client.query("UPDATE moderator_mfa_challenges SET consumed_at=now() WHERE challenge_id=$1", [row.challenge_id]);
      return { moderatorId: row.moderator_id, username: row.username };
    });
  }

  async function issueSocketTicket(sessionId) {
    const ticketId = randomUUID();
    const token = rawToken();
    await db.query(`INSERT INTO moderator_socket_tickets(ticket_id,moderator_session_id,token_hash,expires_at)
      VALUES($1,$2,$3,now()+interval '90 seconds')`, [ticketId, sessionId, digest(token)]);
    return token;
  }

  async function consumeSocketTicket(token) {
    if (!TOKEN_RE.test(token || "")) return null;
    const result = await db.query(`UPDATE moderator_socket_tickets SET consumed_at=now()
      WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now() RETURNING moderator_session_id`, [digest(token)]);
    if (!result.rowCount) return null;
    return verifySession({ sessionId: result.rows[0].moderator_session_id });
  }

  return { verifyCredentials, account, issueSession, verifySession, revokeSession, revokeAll, changePassword, createInvite, acceptInvite, completeRecovery, beginMfa, confirmMfa, createChallenge, verifyChallenge, issueSocketTicket, consumeSocketTicket };
}
