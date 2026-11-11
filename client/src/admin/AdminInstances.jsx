import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Button from "../components/Button.jsx";
import { usePlatformBranding } from "../platform-branding.js";
import { api } from "./api.js";
import { Badge, Banner, ErrorNote, Loading, Section, StatusPill, Table } from "./ui.jsx";

export default function AdminInstances() {
  const platformBranding = usePlatformBranding();
  const [instances, setInstances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ displayName: "", slug: "", description: "" });
  const [appearance, setAppearance] = useState({});

function agentContactsFromText(text) {
  return text.split(/\r?\n/).map((line) => line.split("|").map((part) => part.trim())).filter(([name, phone]) => name && phone).slice(0, 10).map(([name, phone]) => ({ name, phone }));
}

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { const data = await api.instances(); setInstances(data.instances || []); setAppearance(Object.fromEntries((data.instances || []).map(instance => [instance.instance_id, { displayName: instance.display_name, publicVisible: instance.public_visible, branding: { ...(instance.branding || {}) }, roomDefaults: { maxPlayers: 100, callIntervalMs: 8000, autoCall: true, ...(instance.config?.roomDefaults || {}) } }]))); }
    catch (err) { setError(err); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create(event) {
    event.preventDefault(); setBusy(true); setMessage(""); setError(null);
    try { await api.createInstance(form); setForm({ displayName: "", slug: "", description: "" }); setMessage("Instance created."); await load(); }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  }
  async function setStatus(instance, status) {
    if (status === "archived" && !window.confirm(`Archive ${instance.display_name}? Existing rooms and history will be retained.`)) return;
    setBusy(true); setError(null); setMessage("");
    try { await api.updateInstance(instance.instance_id, { status }); setMessage(`${instance.display_name} is now ${status}.`); await load(); }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  }
  async function saveAppearance(event, instance) {
    event.preventDefault();
    const draft = appearance[instance.instance_id];
    if (!draft) return;
    setBusy(true); setError(null); setMessage("");
    try {
      await api.updateInstance(instance.instance_id, { displayName: draft.displayName, publicVisible: draft.publicVisible, branding: draft.branding, roomDefaults: draft.roomDefaults });
      setMessage(`${draft.displayName} identity and room defaults saved.`); await load();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }
  function patchAppearance(instanceId, patch) { setAppearance(current => ({ ...current, [instanceId]: { ...current[instanceId], ...patch } })); }
  function patchBranding(instanceId, patch) { setAppearance(current => ({ ...current, [instanceId]: { ...current[instanceId], branding: { ...(current[instanceId]?.branding || {}), ...patch } } })); }
  function patchRoomDefaults(instanceId, patch) { setAppearance(current => ({ ...current, [instanceId]: { ...current[instanceId], roomDefaults: { ...(current[instanceId]?.roomDefaults || {}), ...patch } } })); }

  return <div className="adm-page">
    <header className="adm-page-head"><div><p className="oh-eyebrow">Platform</p><h1 className="oh-display adm-page-title">Game instances</h1><p className="adm-sub">Each instance has a stable identity and its own room boundary. Historical rooms remain under Legacy rooms because their original product cannot be established.</p></div><Button variant="ghost" size="sm" onClick={load} disabled={loading}>Refresh</Button></header>
    {message ? <Banner tone="success" title="Saved">{message}</Banner> : null}
    {error ? <ErrorNote title="Instance operation failed" error={error} onRetry={load} /> : null}
    <Section title="Create an instance">
      <p className="adm-sub">Slugs are unique and reserved for the lifetime of the instance.</p>
      <form className="adm-form" onSubmit={create}>
        <label>Display name<input required maxLength={80} value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} /></label>
        <label>URL slug<input required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={48} value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase() })} /></label>
        <label>Description<input maxLength={500} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
        <Button type="submit" variant="gold" disabled={busy}>Create instance</Button>
      </form>
    </Section>
    <Section title="Instances" description="Persisted records and actual room counts.">
      {loading ? <Loading block label="Loading instances…" /> : <Table>
        <thead><tr><th>Instance</th><th>Status</th><th>Rooms</th><th>Public</th><th>Actions</th></tr></thead>
        <tbody>
        {instances.map(instance => <tr key={instance.instance_id}>
          <td><strong>{instance.display_name}</strong><small className="adm-table-sub">/{instance.slug} · {instance.description || "No description"}</small><small className="adm-table-sub"><Link className="adm-link" to={`${window.location.pathname.startsWith("/super-admin") ? "/super-admin" : "/admin"}/instances/${encodeURIComponent(instance.instance_id)}`}>Open instance details</Link> · <Link className="adm-link" to={`${window.location.pathname.startsWith("/super-admin") ? "/super-admin" : "/admin"}/reports?instanceId=${encodeURIComponent(instance.instance_id)}`}>View instance report</Link></small><details className="adm-instance-appearance"><summary>Identity & new-room defaults</summary><form onSubmit={event => saveAppearance(event, instance)}>
            <label>Display name<input maxLength={80} value={appearance[instance.instance_id]?.displayName || ""} onChange={event => patchAppearance(instance.instance_id, { displayName: event.target.value })} /></label>
            <label>Logo<select value={appearance[instance.instance_id]?.branding.logo || ""} onChange={event => patchBranding(instance.instance_id, { logo: event.target.value })}><option value="">Use platform mark</option><option value="tambola-house-mark.svg">{platformBranding.name} mark</option><option value="tambola-house-lockup.svg">{platformBranding.name} horizontal lockup</option><option value="regular-mark.svg">Regular instance mark</option><option value="bumper-mark.svg">Bumper instance mark</option></select></label>
            <label>Browser icon<select value={appearance[instance.instance_id]?.branding.icon || ""} onChange={event => patchBranding(instance.instance_id, { icon: event.target.value })}><option value="">Use logo / platform icon</option><option value="tambola-house-icon.svg">{platformBranding.name} app icon</option><option value="regular-mark.svg">Regular instance mark</option><option value="bumper-mark.svg">Bumper instance mark</option></select></label>
            <label>Tagline<input maxLength={100} value={appearance[instance.instance_id]?.branding.tagline || ""} onChange={event => patchBranding(instance.instance_id, { tagline: event.target.value })} /></label>
            <fieldset className="adm-instance-defaults"><legend>Public host and agent contacts</legend>
              <label>Host name<input maxLength={60} value={appearance[instance.instance_id]?.branding.contacts?.hostName || ""} onChange={event => patchBranding(instance.instance_id, { contacts: { ...(appearance[instance.instance_id]?.branding.contacts || {}), hostName: event.target.value } })} /></label>
              <label>Host phone<input type="tel" maxLength={20} placeholder="+91 98765 43210" value={appearance[instance.instance_id]?.branding.contacts?.hostPhone || ""} onChange={event => patchBranding(instance.instance_id, { contacts: { ...(appearance[instance.instance_id]?.branding.contacts || {}), hostPhone: event.target.value } })} /></label>
              <label>WhatsApp phone<input type="tel" maxLength={20} placeholder="+91 98765 43210" value={appearance[instance.instance_id]?.branding.contacts?.hostWhatsapp || ""} onChange={event => patchBranding(instance.instance_id, { contacts: { ...(appearance[instance.instance_id]?.branding.contacts || {}), hostWhatsapp: event.target.value } })} /></label>
              <label>Host email<input type="email" maxLength={120} value={appearance[instance.instance_id]?.branding.contacts?.hostEmail || ""} onChange={event => patchBranding(instance.instance_id, { contacts: { ...(appearance[instance.instance_id]?.branding.contacts || {}), hostEmail: event.target.value } })} /></label>
              <label>Agents (one per line: name | phone)<textarea rows={4} maxLength={1000} value={(appearance[instance.instance_id]?.branding.contacts?.agents || []).map(agent => `${agent.name} | ${agent.phone}`).join("\n")} onChange={event => patchBranding(instance.instance_id, { contacts: { ...(appearance[instance.instance_id]?.branding.contacts || {}), agents: agentContactsFromText(event.target.value) } })} /></label>
              <p className="adm-sub">Only details entered here appear on public game pages. These contact details are visible to anyone with the game link.</p>
            </fieldset>
            <div className="adm-instance-colors">{[["accent","Primary"],["accentBright","Bright"],["accentDeep","Deep"],["coral","Highlight"]].map(([key,label]) => <label key={key}>{label}<input type="color" value={appearance[instance.instance_id]?.branding[key] || "#42c98a"} onChange={event => patchBranding(instance.instance_id, { [key]: event.target.value })} /></label>)}</div>
            <label className="adm-instance-public"><input type="checkbox" checked={appearance[instance.instance_id]?.publicVisible ?? false} onChange={event => patchAppearance(instance.instance_id, { publicVisible: event.target.checked })} /> Show in public hall directory</label>
            <fieldset className="adm-instance-defaults">
              <legend>Defaults for new rooms</legend>
              <label>Room capacity <input type="number" min="2" max="500" step="1" value={appearance[instance.instance_id]?.roomDefaults.maxPlayers ?? 100} onChange={event => patchRoomDefaults(instance.instance_id, { maxPlayers: Number(event.target.value) })} /></label>
              <label>Automatic call interval (seconds) <input type="number" min="1" max="120" step="1" value={(appearance[instance.instance_id]?.roomDefaults.callIntervalMs ?? 8000) / 1000} onChange={event => patchRoomDefaults(instance.instance_id, { callIntervalMs: Number(event.target.value) * 1000 })} /></label>
              <label className="adm-instance-public"><input type="checkbox" checked={appearance[instance.instance_id]?.roomDefaults.autoCall ?? true} onChange={event => patchRoomDefaults(instance.instance_id, { autoCall: event.target.checked })} /> Start new rooms with automatic calls enabled</label>
              <p className="adm-sub">Changing defaults affects newly created rooms only. Existing rooms keep their saved settings.</p>
            </fieldset>
            <Button size="sm" variant="gold" disabled={busy} type="submit">Save identity and defaults</Button>
          </form></details></td>
          <td><StatusPill status={instance.status} /></td>
          <td>{instance.total_rooms} total · {instance.running_rooms} running</td>
          <td><Badge tone={instance.public_visible && instance.status === "active" ? "gold" : "muted"}>{instance.public_visible && instance.status === "active" ? "Visible" : "Hidden"}</Badge></td>
          <td className="adm-actions">{instance.status === "active" ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStatus(instance, "paused")}>Pause</Button> : instance.status === "paused" ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStatus(instance, "active")}>Activate</Button> : <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStatus(instance, "active")}>Restore</Button>}{instance.status !== "archived" && instance.instance_id !== "legacy" ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStatus(instance, "archived")}>Archive</Button> : null}</td>
        </tr>)}
        </tbody>
      </Table>}
    </Section>
  </div>;
}
