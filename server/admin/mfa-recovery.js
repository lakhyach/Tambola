/** Owner MFA recovery primitives. Durable backend stores only SHA-256 token
 * hashes; memory backend exists only for isolated tests. */
import { createHash, randomBytes, randomUUID } from "node:crypto";

const hash = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const token = () => randomBytes(32).toString("hex");

export function createMfaRecoveryStore({ db, now = () => Date.now(), ttlMs = 15 * 60_000 } = {}) {
  if (!db) throw new Error("createMfaRecoveryStore needs a database handle");
  return {
    backend: "database",
    async issueAuthorization({ ownerId, username }) {
      const value = token();
      const expiresAt = await db.withTransaction(async (client) => {
        await client.query("UPDATE owner_mfa_recovery_authorizations SET consumed_at=now() WHERE owner_id=$1 AND consumed_at IS NULL", [ownerId]);
        const cancelled = await client.query("DELETE FROM owner_mfa_recovery_flows WHERE owner_id=$1 RETURNING flow_id", [ownerId]);
        if (cancelled.rowCount) {
          await client.query(`INSERT INTO admin_audit(actor,action,target_type,target_id,metadata)
            VALUES($1,'owner.mfa.recovery-flow-cancelled','owner',$2,$3::jsonb)`, [`cli:${username}`, ownerId, JSON.stringify({ reason: "new-authorization", count: cancelled.rowCount })]);
        }
        const inserted = await client.query("INSERT INTO owner_mfa_recovery_authorizations(authorization_id,owner_id,token_hash,expires_at) VALUES($1,$2,$3,now()+($4*interval '1 millisecond')) RETURNING expires_at", [randomUUID(), ownerId, hash(value), ttlMs]);
        const deadline = inserted.rows[0].expires_at;
        await client.query(`INSERT INTO admin_audit(actor,action,target_type,target_id,metadata)
          VALUES($1,'owner.mfa.recovery-authorized','owner',$2,$3::jsonb)`, [`cli:${username}`, ownerId, JSON.stringify({ expiresAt: deadline })]);
        return deadline;
      });
      return { token: value, expiresAt };
    },
    async begin({ ownerId, authorization, username, ipHash }) {
      const value = token();
      return db.withTransaction(async (client) => {
        const used = await client.query(`UPDATE owner_mfa_recovery_authorizations SET consumed_at=now()
          WHERE owner_id=$1 AND token_hash=$2 AND consumed_at IS NULL AND expires_at>now() RETURNING owner_id`, [ownerId, hash(authorization || "")]);
        if (!used.rows.length) return { ok: false };
        const cancelled = await client.query("DELETE FROM owner_mfa_recovery_flows WHERE owner_id=$1 RETURNING flow_id", [ownerId]);
        if (cancelled.rowCount) {
          await client.query(`INSERT INTO admin_audit(actor,action,target_type,target_id,metadata)
            VALUES($1,'owner.mfa.recovery-flow-cancelled','owner',$2,$3::jsonb)`, [username, ownerId, JSON.stringify({ ip: ipHash, reason: "new-flow", count: cancelled.rowCount })]);
        }
        const flowId = randomUUID();
        const result = await client.query(`INSERT INTO owner_mfa_recovery_flows(flow_id,owner_id,token_hash,expires_at)
          VALUES($1,$2,$3,now()+($4*interval '1 millisecond')) RETURNING expires_at`, [flowId, ownerId, hash(value), ttlMs]);
        await client.query(`INSERT INTO admin_audit(actor,action,target_type,target_id,metadata)
          VALUES($1,'owner.mfa.recovery-start','owner',$2,$3::jsonb)`, [username, ownerId, JSON.stringify({ ip: ipHash })]);
        return { ok: true, token: value, flowId, expiresAt: result.rows[0].expires_at };
      });
    },
    async flow({ token: value }) {
      const result = await db.query("SELECT flow_id,owner_id,expires_at,pending_secret_enc,qr_revealed_at,attempts FROM owner_mfa_recovery_flows WHERE token_hash=$1 AND expires_at>now() AND attempts<5", [hash(value || "")]);
      const row = result.rows[0];
      return row ? { ok: true, flowId: row.flow_id, ownerId: row.owner_id, expiresAt: row.expires_at, secretEnc: row.pending_secret_enc, qrRevealedAt: row.qr_revealed_at, attempts: row.attempts } : { ok: false };
    },
    async cancel({ flowId }) {
      await db.query("DELETE FROM owner_mfa_recovery_flows WHERE flow_id=$1", [flowId]);
      return { ok: true };
    },
    async setPending({ flowId, secretEnc }) {
      const r = await db.query("UPDATE owner_mfa_recovery_flows SET pending_secret_enc=$2,qr_revealed_at=NULL WHERE flow_id=$1 AND pending_secret_enc IS NULL AND expires_at>now() RETURNING flow_id", [flowId, secretEnc]);
      return { ok: r.rowCount === 1 };
    },
    async revealQr({ flowId }) {
      const r = await db.query("UPDATE owner_mfa_recovery_flows SET qr_revealed_at=now() WHERE flow_id=$1 AND qr_revealed_at IS NULL AND pending_secret_enc IS NOT NULL AND expires_at>now() RETURNING flow_id", [flowId]);
      return { ok: r.rowCount === 1 };
    },
    async fail({ flowId }) {
      await db.query("UPDATE owner_mfa_recovery_flows SET attempts=LEAST(attempts+1,5) WHERE flow_id=$1 AND expires_at>now()", [flowId]);
    },
    async consumeAttempt({ flowId }) {
      const r = await db.query("UPDATE owner_mfa_recovery_flows SET attempts=attempts+1 WHERE flow_id=$1 AND attempts<5 AND expires_at>now() RETURNING attempts", [flowId]);
      return { ok: r.rowCount === 1, attempts: r.rows[0]?.attempts ?? 5 };
    },
    async complete({ flowId, ownerId, secretEnc, step, codes, username, ipHash }) {
      return db.withTransaction(async (client) => {
        const locked = await client.query("SELECT owner_id,pending_secret_enc,qr_revealed_at,expires_at,expires_at>now() AS unexpired,attempts FROM owner_mfa_recovery_flows WHERE flow_id=$1 FOR UPDATE", [flowId]);
        const row = locked.rows[0];
        if (!row || row.owner_id !== ownerId || !row.pending_secret_enc || !row.qr_revealed_at || !row.unexpired || row.attempts > 5) return { ok: false };
        // Update is conditional on the old factor still being active. The old
        // factor is replaced only after the new TOTP has been verified.
        const updated = await client.query(`UPDATE owner_accounts SET totp_secret_enc=$2,totp_confirmed_at=now(),totp_last_step=$3
          WHERE owner_id=$1 AND totp_confirmed_at IS NOT NULL RETURNING owner_id`, [ownerId, secretEnc, step]);
        if (!updated.rows.length) return { ok: false };
        await client.query("DELETE FROM owner_mfa_recovery_codes WHERE owner_id=$1", [ownerId]);
        for (const codeHash of codes) await client.query("INSERT INTO owner_mfa_recovery_codes(owner_id,code_hash) VALUES($1,$2)", [ownerId, codeHash]);
        const sessions = await client.query("UPDATE owner_sessions SET revoked_at=now(),revoke_reason='mfa-replaced' WHERE owner_id=$1 AND revoked_at IS NULL RETURNING session_id", [ownerId]);
        const challenges = await client.query("DELETE FROM owner_mfa_challenges WHERE owner_id=$1", [ownerId]);
        await client.query(`INSERT INTO admin_audit(actor,action,target_type,target_id,metadata)
          VALUES($1,'owner.mfa.recovery-complete','owner',$2,$3::jsonb)`, [username, ownerId, JSON.stringify({ ip: ipHash, sessionsRevoked: sessions.rowCount || 0, challengesRevoked: challenges.rowCount || 0, recoveryCodes: codes.length })]);
        await client.query("DELETE FROM owner_mfa_recovery_flows WHERE flow_id=$1", [flowId]);
        return { ok: true, sessionsRevoked: sessions.rowCount || 0, challengesRevoked: challenges.rowCount || 0 };
      });
    },
    async consumeCode({ ownerId, codeHash }) {
      const r = await db.query("UPDATE owner_mfa_recovery_codes SET used_at=now() WHERE owner_id=$1 AND code_hash=$2 AND used_at IS NULL RETURNING code_hash", [ownerId, codeHash]);
      return { ok: r.rowCount === 1 };
    },
    async clearCodes({ ownerId }) { await db.query("DELETE FROM owner_mfa_recovery_codes WHERE owner_id=$1", [ownerId]); return { ok: true }; },
  };
}

export function createMemoryMfaRecoveryStore({ now = () => Date.now(), ttlMs = 15 * 60_000 } = {}) {
  const authorizations = new Map();
  const flows = new Map();
  const codes = new Map();
  return {
    backend: "memory",
    async issueAuthorization({ ownerId }) {
      for (const row of authorizations.values()) if (row.ownerId === ownerId && !row.consumed) row.consumed = true;
      for (const [key, flow] of flows) if (flow.ownerId === ownerId) flows.delete(key);
      const value = token(); authorizations.set(hash(value), { ownerId, expiresAt: now() + ttlMs, consumed: false });
      return { token: value, expiresAt: new Date(now() + ttlMs).toISOString() };
    },
    async begin({ ownerId, authorization }) {
      const row = authorizations.get(hash(authorization || ""));
      if (!row || row.ownerId !== ownerId || row.consumed || row.expiresAt <= now()) return { ok: false };
      row.consumed = true;
      for (const [key, f] of flows) if (f.ownerId === ownerId) flows.delete(key);
      const value = token(); const flowId = randomUUID();
      flows.set(hash(value), { flowId, ownerId, expiresAt: now() + ttlMs, attempts: 0, secretEnc: null, qrRevealedAt: null });
      return { ok: true, token: value, flowId, expiresAt: new Date(now() + ttlMs).toISOString() };
    },
    async flow({ token: value }) { const f = flows.get(hash(value || "")); return f && f.expiresAt > now() && f.attempts < 5 ? { ok: true, ...f } : { ok: false }; },
    async cancel({ flowId }) { for (const [key, f] of flows) if (f.flowId === flowId) flows.delete(key); return { ok: true }; },
    async setPending({ flowId, secretEnc }) { const f = [...flows.values()].find((x) => x.flowId === flowId); if (!f || f.secretEnc || f.expiresAt <= now()) return { ok: false }; f.secretEnc = secretEnc; f.qrRevealedAt = null; return { ok: true }; },
    async revealQr({ flowId }) { const f = [...flows.values()].find((x) => x.flowId === flowId); if (!f || f.qrRevealedAt || !f.secretEnc || f.expiresAt <= now()) return { ok: false }; f.qrRevealedAt = now(); return { ok: true }; },
    async fail({ flowId }) { const f = [...flows.values()].find((x) => x.flowId === flowId); if (f && f.attempts < 5) f.attempts += 1; },
    async consumeAttempt({ flowId }) { const f = [...flows.values()].find((x) => x.flowId === flowId); if (!f || f.expiresAt <= now() || f.attempts >= 5) return { ok: false, attempts: 5 }; f.attempts += 1; return { ok: true, attempts: f.attempts }; },
    async complete({ flowId, ownerId, secretEnc, step, codes: codeHashes }) { const f = [...flows.values()].find((x) => x.flowId === flowId); if (!f || f.ownerId !== ownerId || !f.secretEnc || !f.qrRevealedAt || f.expiresAt <= now() || f.attempts > 5) return { ok: false }; flows.delete([...flows].find(([,x]) => x === f)[0]); codes.set(ownerId, new Set(codeHashes)); return { ok: true, secretEnc, step }; },
    async consumeCode({ ownerId, codeHash }) { const list = codes.get(ownerId); if (!list?.has(codeHash)) return { ok: false }; list.delete(codeHash); return { ok: true }; },
    async clearCodes({ ownerId }) { codes.delete(ownerId); return { ok: true }; },
  };
}

export function generateRecoveryCodes(count = 10) {
  const values = Array.from({ length: count }, () => randomBytes(10).toString("hex").toUpperCase());
  return { values, hashes: values.map((value) => hash(value)) };
}

export function hashRecoveryCode(value) {
  const normalized = typeof value === "string" ? value.replace(/\s+/g, "").toUpperCase() : "";
  return /^[0-9A-F]{20}$/.test(normalized) ? hash(normalized) : null;
}
