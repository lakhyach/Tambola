/* eslint-disable react/prop-types */
import { useCallback, useEffect, useMemo, useState } from "react";
import Button from "../components/Button.jsx";
import { api } from "./api.js";
import { formatDateTime, formatNumber } from "./format.js";
import { useAdmin } from "./useAdmin.js";
import { Badge, Banner, ConfirmDialog, CopyButton, Empty, ErrorNote, Field, Loading, Section, StatusPill, Table } from "./ui.jsx";

const PERMISSIONS = [
  ["instance.read", "View assigned instance"], ["instance.settings.update", "Update instance description"],
  ["room.create", "Create rooms"], ["room.read", "View rooms"], ["room.start", "Start games"],
  ["room.pause", "Pause games"], ["room.end", "End games"], ["room.reset", "Reset games"],
  ["players.read", "Look up players"], ["players.manage", "Remove room members"], ["tickets.manage", "View issued ticket allocations"],
  ["bookings.read", "Read bookings"], ["bookings.manage", "Cancel bookings"], ["bookings.assign", "Assign sessions to rooms"], ["history.read", "Read game history"],
  ["reports.read", "Read reports"],
];

function PermissionPicker({ values, onChange, disabled = false }) {
  const selected = new Set(values || []);
  return <fieldset className="adm-fieldset"><legend className="adm-field__label">Explicit capabilities</legend><div className="adm-checks adm-mod-permissions">{PERMISSIONS.map(([permission, label]) => <label className="adm-check" key={permission}><input type="checkbox" checked={selected.has(permission)} disabled={disabled} onChange={(event) => onChange(event.target.checked ? [...selected, permission] : [...selected].filter((item) => item !== permission))} /><span>{label}<span className="adm-check__hint">{permission}</span></span></label>)}</div></fieldset>;
}

export default function AdminModerators() {
  const { toast } = useAdmin();
  const [moderators, setModerators] = useState([]);
  const [instances, setInstances] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState("");
  const [create, setCreate] = useState({ username: "", instanceId: "", permissions: [] });
  const [grant, setGrant] = useState({ instanceId: "", permissions: [] });
  const [oneTimeSecret, setOneTimeSecret] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async (id = "") => {
    setLoading(true); setError(null);
    try {
      const [list, instanceList] = await Promise.all([api.moderators(), api.instances()]);
      setModerators(list.moderators || []); setInstances(instanceList.instances || []);
      const nextId = id && (list.moderators || []).some((item) => item.moderator_id === id) ? id : "";
      setSelectedId(nextId);
      if (nextId) setDetail(await api.moderator(nextId)); else setDetail(null);
    } catch (err) { setError(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(""); }, [load]);

  const selected = useMemo(() => moderators.find((item) => item.moderator_id === selectedId), [moderators, selectedId]);
  const activeAssignments = detail?.grants?.filter((item) => !item.revoked_at) || [];
  const availableInstances = instances.filter((item) => !activeAssignments.some((grantItem) => grantItem.instance_id === item.instance_id));

  async function refreshDetail(id = selectedId) { await load(id); }

  async function createModerator(event) {
    event.preventDefault(); setBusy(true); setError(null); setMessage(""); setOneTimeSecret(null);
    try {
      const payload = { username: create.username.trim() };
      if (create.instanceId) { payload.instanceId = create.instanceId; payload.permissions = create.permissions; }
      const result = await api.createModerator(payload);
      setOneTimeSecret({ title: "One-time invitation token", value: result.inviteToken, acceptUrl: `${window.location.origin}/moderator/accept#token=${encodeURIComponent(result.inviteToken)}`, note: `Expires in ${result.expiresInHours} hours. Copy the secure acceptance link or token now; the token is not stored in readable form.` });
      setMessage(`Invitation created for ${result.moderator.username}.`);
      setCreate({ username: "", instanceId: "", permissions: [] });
      await load(result.moderator.moderatorId);
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  async function saveGrant(moderatorId, instanceId, permissions) {
    setBusy(true); setError(null); setMessage("");
    try { await api.updateModeratorGrant(moderatorId, instanceId, permissions); setMessage("Instance capabilities saved."); await refreshDetail(moderatorId); return true; }
    catch (err) { setError(err); return false; }
    finally { setBusy(false); }
  }

  async function addGrant(event) {
    event.preventDefault();
    if (!grant.instanceId) return;
    const result = await saveGrant(selectedId, grant.instanceId, grant.permissions);
    if (result !== false) setGrant({ instanceId: "", permissions: [] });
  }

  async function confirmAction() {
    if (!confirm || !selectedId) return;
    const action = confirm.action;
    setBusy(true); setError(null); setMessage("");
    try {
      if (action === "suspend") { const result = await api.setModeratorStatus(selectedId, "suspended"); setMessage(`Account suspended; ${result.revokedSessions} active session(s) revoked.`); }
      if (action === "activate") { await api.setModeratorStatus(selectedId, "active"); setMessage("Account reactivated. Existing grants remain unchanged."); }
      if (action === "sessions") { const result = await api.revokeModeratorSessions(selectedId); setMessage(`${result.revoked} session(s) revoked.`); }
      if (action === "recovery") { const result = await api.issueModeratorRecovery(selectedId); setOneTimeSecret({ title: "One-time recovery token", value: result.recoveryToken, acceptUrl: `${window.location.origin}/moderator/recovery#recovery=${encodeURIComponent(result.recoveryToken)}`, note: `Expires in ${result.expiresInMinutes} minutes. The account is suspended and must enroll MFA again after recovery.` }); setMessage("Recovery issued; previous sessions were revoked."); }
      if (action.startsWith("grant:")) { const instanceId = action.slice(6); await api.revokeModeratorGrant(selectedId, instanceId); setMessage("Instance grant revoked immediately."); }
      setConfirm(null); await refreshDetail(selectedId);
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  return <div className="adm-page">
    <header className="adm-page-head"><div><p className="oh-eyebrow">Super Admin</p><h1 className="oh-display adm-page-title">Moderator access</h1><p className="adm-sub">Provision accounts, assign explicit instance capabilities, and revoke access. No permission is added automatically.</p></div><Button variant="ghost" size="sm" onClick={() => load(selectedId)} disabled={loading}>Refresh</Button></header>
    {message ? <Banner tone="success" title="Access change recorded">{message}</Banner> : null}
    {error ? <ErrorNote title="Moderator operation failed" error={error} onRetry={() => load(selectedId)} /> : null}
    {oneTimeSecret ? <Banner tone="warn" title={oneTimeSecret.title}><p>{oneTimeSecret.note}</p>{oneTimeSecret.acceptUrl ? <p><code className="adm-mod-token">{oneTimeSecret.acceptUrl}</code></p> : null}<code className="adm-mod-token">{oneTimeSecret.value}</code><div className="adm-actions">{oneTimeSecret.acceptUrl ? <CopyButton value={oneTimeSecret.acceptUrl} label={oneTimeSecret.title.includes("recovery") ? "Copy recovery link" : "Copy acceptance link"} onResult={(ok) => toast(ok ? "Secure one-time link copied." : "Clipboard unavailable; select the link manually.", ok ? "success" : "warn")} /> : null}<CopyButton value={oneTimeSecret.value} label="Copy token" onResult={(ok) => toast(ok ? "Token copied." : "Clipboard unavailable; select the token manually.", ok ? "success" : "warn")} /><Button size="sm" variant="ghost" onClick={() => setOneTimeSecret(null)}>Dismiss</Button></div></Banner> : null}
    <Section title="Provision a moderator" description="The invitation token is shown once. Deliver it using your own approved channel; the platform does not send messages.">
      <form className="adm-form" onSubmit={createModerator}>
        <div className="adm-form-row"><Field label="Username" htmlFor="moderator-username" hint="3–40 lowercase letters, digits, dot, underscore or hyphen."><input id="moderator-username" className="oh-field" required minLength={3} maxLength={40} pattern="(?:[a-zA-Z0-9._]|-){3,40}" autoComplete="off" value={create.username} onChange={(event) => setCreate((old) => ({ ...old, username: event.target.value.toLowerCase() }))} /></Field><Field label="Initial instance assignment (optional)" htmlFor="moderator-instance"><select id="moderator-instance" className="oh-field" value={create.instanceId} onChange={(event) => setCreate((old) => ({ ...old, instanceId: event.target.value, permissions: [] }))}><option value="">No assignment</option>{instances.map((instance) => <option key={instance.instance_id} value={instance.instance_id}>{instance.display_name} ({instance.status})</option>)}</select></Field></div>
        {create.instanceId ? <PermissionPicker values={create.permissions} onChange={(permissions) => setCreate((old) => ({ ...old, permissions }))} disabled={busy} /> : null}
        <Button type="submit" variant="gold" disabled={busy}>{busy ? "Creating…" : "Create invitation"}</Button>
      </form>
    </Section>
    <div className="adm-mod-columns">
      <Section title="Moderator accounts" description="Assignments show active grants only; selecting an account loads grant history and recent audit activity.">
        {loading ? <Loading block label="Loading moderator accounts…" /> : moderators.length ? <Table className="adm-table--mobile-cards"><thead><tr><th>Account</th><th>Status</th><th>MFA</th><th>Sessions</th><th>Assignments</th></tr></thead><tbody>{moderators.map((item) => <tr key={item.moderator_id} data-selected={item.moderator_id === selectedId}>
          <td><span className="adm-mobile-label">Account</span><button type="button" aria-pressed={item.moderator_id === selectedId} className="adm-link adm-link--button" onClick={() => { setSelectedId(item.moderator_id); load(item.moderator_id); }}>{item.username}</button><small className="adm-table-sub">Created {formatDateTime(item.created_at)}</small></td>
          <td><span className="adm-mobile-label">Status</span><StatusPill status={item.status} /></td>
          <td><span className="adm-mobile-label">MFA</span><Badge tone={item.totp_confirmed_at ? "gold" : "muted"}>{item.totp_confirmed_at ? "Enrolled" : "Not enrolled"}</Badge></td>
          <td className="oh-num"><span className="adm-mobile-label">Sessions</span>{formatNumber(item.active_sessions)}</td>
          <td><span className="adm-mobile-label">Assignments</span>{item.assignments?.filter((a) => a.instanceId).map((a) => <span className="adm-mod-assignment" key={a.instanceId}>{a.name} · {a.permissions?.length || 0}</span>)}{!item.assignments?.some((a) => a.instanceId) ? "None" : null}</td>
        </tr>)}</tbody></Table> : <Empty title="No moderator accounts">Provision an account above. It will remain without access until you grant explicit capabilities.</Empty>}
      </Section>
      <Section title={selected ? selected.username : "Account details"} description={selected ? "Security operations take effect immediately and are recorded in platform audit." : "Select an account to inspect its grants and activity."}>
        {!selected ? <Empty title="No account selected">Account access controls and activity appear here.</Empty> : !detail ? <Loading label="Loading account details…" /> : <div className="adm-mod-detail">
          <div className="adm-actions"><StatusPill status={selected.status} /><Badge tone={selected.totp_confirmed_at ? "gold" : "warn"}>{selected.totp_confirmed_at ? "MFA enrolled" : "MFA not enrolled"}</Badge><Button size="sm" variant="ghost" disabled={busy || selected.status === "invited"} onClick={() => setConfirm({ action: selected.status === "suspended" ? "activate" : "suspend", title: selected.status === "suspended" ? "Reactivate account?" : "Suspend account?", description: selected.status === "suspended" ? "Reactivation restores sign-in, but does not change instance grants." : "This immediately blocks sign-in and revokes every active session." })}>{selected.status === "suspended" ? "Reactivate" : "Suspend"}</Button></div>
          <div className="adm-actions"><Button size="sm" variant="ghost" disabled={busy || selected.status === "invited"} onClick={() => setConfirm({ action: "sessions", title: "Revoke all sessions?", description: "Every active moderator session will stop working immediately." })}>Revoke sessions</Button><Button size="sm" variant="ghost" disabled={busy || selected.status === "invited"} onClick={() => setConfirm({ action: "recovery", title: "Issue account recovery?", description: "This suspends the account, revokes sessions, and creates a 30-minute one-time token. The moderator must enroll MFA again." })}>Issue recovery</Button></div>
          <h3 className="adm-mod-subhead">Instance grants</h3>
          {activeAssignments.length ? activeAssignments.map((item) => <GrantEditor key={item.instance_id} grant={item} busy={busy} onSave={(permissions) => saveGrant(selectedId, item.instance_id, permissions)} onRevoke={() => setConfirm({ action: `grant:${item.instance_id}`, title: "Revoke this instance grant?", description: `Access to ${item.display_name} will be removed immediately.` })} />) : <Empty title="No active instance grants">This account cannot access instance data or perform operations.</Empty>}
          {availableInstances.length ? <form className="adm-form adm-mod-add-grant" onSubmit={addGrant}><Field label="Add instance grant" htmlFor="grant-instance"><select id="grant-instance" className="oh-field" required value={grant.instanceId} onChange={(event) => setGrant({ instanceId: event.target.value, permissions: [] })}><option value="">Choose an instance</option>{availableInstances.map((item) => <option key={item.instance_id} value={item.instance_id}>{item.display_name} ({item.status})</option>)}</select></Field>{grant.instanceId ? <PermissionPicker values={grant.permissions} onChange={(permissions) => setGrant((old) => ({ ...old, permissions }))} disabled={busy} /> : null}<Button type="submit" size="sm" variant="gold" disabled={busy || !grant.instanceId}>Save explicit grant</Button></form> : null}
          <h3 className="adm-mod-subhead">Grant history</h3>{detail.grants?.length ? <Table className="adm-table--mobile-cards"><thead><tr><th>Instance</th><th>Capabilities</th><th>State</th><th>Updated</th></tr></thead><tbody>{detail.grants.map((item) => <tr key={`${item.instance_id}-${item.granted_at}`}><td><span className="adm-mobile-label">Instance</span>{item.display_name}</td><td><span className="adm-mobile-label">Capabilities</span>{item.permissions?.join(", ") || "None"}</td><td><span className="adm-mobile-label">State</span>{item.revoked_at ? "Revoked" : "Active"}</td><td><span className="adm-mobile-label">Updated</span>{formatDateTime(item.revoked_at || item.granted_at)}</td></tr>)}</tbody></Table> : <p className="adm-sub">No grant history.</p>}
          <h3 className="adm-mod-subhead">Recent activity</h3>{detail.activity?.length ? <Table className="adm-table--mobile-cards"><thead><tr><th>Action</th><th>Instance</th><th>Result</th><th>When</th></tr></thead><tbody>{detail.activity.map((item) => <tr key={item.event_id}><td><span className="adm-mobile-label">Action</span>{item.action}</td><td><span className="adm-mobile-label">Instance</span>{item.instance_id || "Platform"}</td><td><span className="adm-mobile-label">Result</span>{item.result}</td><td><span className="adm-mobile-label">When</span>{formatDateTime(item.occurred_at)}</td></tr>)}</tbody></Table> : <Empty title="No activity recorded" />}
        </div>}
      </Section>
    </div>
    <ConfirmDialog open={Boolean(confirm)} title={confirm?.title} description={confirm?.description} busy={busy} confirmLabel="Confirm access change" onCancel={() => setConfirm(null)} onConfirm={confirmAction} />
  </div>;
}

function GrantEditor({ grant, busy, onSave, onRevoke }) {
  const [permissions, setPermissions] = useState(grant.permissions || []);
  useEffect(() => setPermissions(grant.permissions || []), [grant.permissions]);
  return <div className="adm-mod-grant"><h4>{grant.display_name} <small>/{grant.slug}</small></h4><PermissionPicker values={permissions} onChange={setPermissions} disabled={busy} /><div className="adm-actions"><Button size="sm" variant="gold" disabled={busy || JSON.stringify(permissions.slice().sort()) === JSON.stringify((grant.permissions || []).slice().sort())} onClick={() => onSave(permissions)}>Save capabilities</Button><Button size="sm" variant="ghost" disabled={busy} onClick={onRevoke}>Revoke grant</Button></div></div>;
}
