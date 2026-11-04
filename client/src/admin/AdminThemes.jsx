import { useCallback, useEffect, useMemo, useState } from "react";
import Button from "../components/Button.jsx";
import { api } from "./api.js";
import { Banner, ErrorNote, Loading, Section, StatusPill } from "./ui.jsx";
import ThemePreview from "./ThemePreview.jsx";

const CATEGORIES = ["classic", "premium", "festive", "seasonal", "celebration", "minimal", "modern", "traditional", "special"];

export default function AdminThemes() {
  const [themes, setThemes] = useState([]);
  const [active, setActive] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [releases, setReleases] = useState([]);
  const [instances, setInstances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [draft, setDraft] = useState({ themeId: "evening-garden", name: "Evening Garden", description: "A calm green game-night theme with a clear warm ticket and bright called-number states.", category: "classic", baseVersionId: "", accent: "#56d6a5" });
  const [instanceSelection, setInstanceSelection] = useState({ instanceId: "", mode: "latest", themeVersionId: "" });

  const approved = useMemo(() => themes.filter((theme) => theme.status === "approved"), [themes]);
  const currentDraftBase = themes.find((theme) => theme.themeVersionId === draft.baseVersionId) || approved[0] || null;

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [store, activeData, scheduleData, releaseData, instanceData] = await Promise.all([
        api.themes(), api.activeTheme(), api.themeSchedule(), api.themeReleases({ limit: 20 }), api.instances(),
      ]);
      const list = store.themes || [];
      setThemes(list); setActive(activeData.theme || null); setSchedule(scheduleData.schedule || null);
      setReleases(releaseData.releases || []); setInstances(instanceData.instances || []);
      if (!draft.baseVersionId && list.length) setDraft((previous) => ({ ...previous, baseVersionId: list.find((theme) => theme.status === "approved")?.themeVersionId || "" }));
      if (!instanceSelection.instanceId && instanceData.instances?.length) setInstanceSelection((previous) => ({ ...previous, instanceId: instanceData.instances[0].instance_id }));
    } catch (failure) { setError(failure); }
    finally { setLoading(false); }
  }, [draft.baseVersionId, instanceSelection.instanceId]);

  useEffect(() => { load(); }, [load]);

  async function run(action, success) {
    setBusy(true); setError(null); setMessage("");
    try { await action(); setMessage(success); await load(); }
    catch (failure) { setError(failure); }
    finally { setBusy(false); }
  }

  async function createDraft(event) {
    event.preventDefault();
    if (!currentDraftBase) return;
    const packageValue = structuredClone(currentDraftBase.package);
    packageValue.tokens.gold = draft.accent;
    packageValue.tokens.goldBright = draft.accent;
    await run(() => api.createThemeDraft({ themeId: draft.themeId, name: draft.name, description: draft.description, category: draft.category, package: packageValue }), "Draft created. Review its preview, then approve it before release.");
  }

  async function saveSchedule(event) {
    event.preventDefault();
    await run(async () => {
      const payload = { enabled: schedule.enabled, timeZone: schedule.timeZone, releaseTime: schedule.releaseTime, rotationVersionIds: schedule.rotationVersionIds };
      const result = await api.saveThemeSchedule(payload);
      setSchedule(result.schedule);
    }, "Daily theme schedule saved.");
  }

  function toggleRotation(versionId) {
    setSchedule((current) => {
      const selected = new Set(current.rotationVersionIds || []);
      if (selected.has(versionId)) selected.delete(versionId); else selected.add(versionId);
      return { ...current, rotationVersionIds: [...selected] };
    });
  }

  if (loading && !themes.length) return <div className="adm-page"><Loading block label="Loading reviewed themes…" /></div>;

  return <div className="adm-page adm-theme-page">
    <header className="adm-page-head"><div><p className="oh-eyebrow">Platform design</p><h1 className="oh-display adm-page-title">Theme store</h1><p className="adm-sub">Review immutable theme versions, preview the actual game surfaces, schedule a daily rotation, and roll back without changing a running room’s snapshot.</p></div><Button variant="ghost" size="sm" onClick={load} disabled={loading}>Refresh</Button></header>
    {message ? <Banner tone="success" title="Theme store updated">{message}</Banner> : null}
    {error ? <ErrorNote title="Theme operation failed" error={error} onRetry={load} /> : null}

    <Section title="Active platform theme" description="New rooms snapshot their instance’s resolved theme version. Existing games keep the snapshot stored with the room.">
      <div className="adm-theme-active">
        {active ? <><ThemePreview theme={active} /><div><p className="oh-eyebrow">CURRENT RELEASE</p><h2>{active.name} <small>v{active.version}</small></h2><p>{active.description}</p><p className="adm-sub">{active.themeVersionId}</p><Button variant="ghost" disabled={busy || !releases.some((release) => release.publicationId !== releases[0]?.publicationId)} onClick={() => run(() => api.rollbackTheme(), "Previous published theme restored.")}>Roll back to previous release</Button></div></> : <p>No theme has been published.</p>}
      </div>
    </Section>

    <Section title="Reviewed library" description="Drafts never reach public pages until approved. Published versions are immutable; create a new version to change a package.">
      <div className="adm-theme-grid">
        {themes.map((theme) => <article className="adm-theme-card" key={theme.themeVersionId}>
          <ThemePreview theme={theme} />
          <div className="adm-theme-card__body"><div className="adm-theme-card__title"><div><p className="oh-eyebrow">{theme.category} · {theme.themeVersionId}</p><h3>{theme.name} <small>v{theme.version}</small></h3></div><StatusPill status={theme.status} /></div>
            <p>{theme.description}</p>
            <div className="adm-theme-actions"><Button size="sm" variant="ghost" onClick={() => setPreview(theme)}>Preview</Button>
              {theme.status === "draft" && theme.catalogStatus === "draft" ? <Button size="sm" variant="gold" disabled={busy} onClick={() => run(() => api.approveTheme(theme.themeId), `${theme.name} approved for publication.`)}>Approve theme</Button> : null}
              {theme.status === "draft" && theme.catalogStatus === "approved" ? <Button size="sm" variant="gold" disabled={busy} onClick={() => run(() => api.approveThemeVersion(theme.themeId, theme.themeVersionId), `${theme.name} version ${theme.version} approved for publication.`)}>Approve version</Button> : null}
              {theme.status === "approved" && theme.catalogStatus === "approved" ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => { const packageValue = structuredClone(theme.package); packageValue.tokens.gold = draft.accent; packageValue.tokens.goldBright = draft.accent; return run(() => api.createThemeVersion(theme.themeId, { package: packageValue }), `Version ${theme.version + 1} created as a draft for review.`); }}>Create next version</Button> : null}
              {theme.status === "approved" && !theme.isActive ? <Button size="sm" variant="gold" disabled={busy} onClick={() => run(() => api.publishTheme(theme.themeVersionId), `${theme.name} published.`)}>Publish now</Button> : null}
              {theme.status === "approved" ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => api.retireTheme(theme.themeId), `${theme.name} retired from new selections.`)}>Retire</Button> : null}
            </div>
          </div>
        </article>)}
      </div>
      {!themes.length ? <p className="adm-sub">No themes are available yet.</p> : null}
    </Section>

    <Section title="Create a reviewed draft" description="Start from an approved full design package, change its accent, then preview and approve it before any publication.">
      <form className="adm-theme-draft-form" onSubmit={createDraft}>
        <label>Theme name<input required minLength={2} maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>Theme ID<input required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={48} value={draft.themeId} onChange={(event) => setDraft({ ...draft, themeId: event.target.value.toLowerCase() })} /></label>
        <label>Category<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>{CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
        <label>Base package<select required value={draft.baseVersionId} onChange={(event) => setDraft({ ...draft, baseVersionId: event.target.value })}>{approved.map((theme) => <option key={theme.themeVersionId} value={theme.themeVersionId}>{theme.name} · v{theme.version}</option>)}</select></label>
        <label>Description<textarea required minLength={10} maxLength={500} rows={3} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
        <label>Accent color<input type="color" value={draft.accent} onChange={(event) => setDraft({ ...draft, accent: event.target.value })} /></label>
        <Button type="submit" variant="gold" disabled={busy || !currentDraftBase}>Save as draft</Button>
      </form>
    </Section>

    {schedule ? <Section title="Daily release schedule" description="One release per calendar day in the selected IANA timezone. The scheduler runs only while this database’s single-process lease is held.">
      <form className="adm-theme-draft-form" onSubmit={saveSchedule}>
        <label className="adm-theme-checkbox"><input type="checkbox" checked={schedule.enabled} onChange={(event) => setSchedule({ ...schedule, enabled: event.target.checked })} /> Enable automatic release</label>
        <label>Time zone<input required maxLength={80} placeholder="Asia/Kolkata" value={schedule.timeZone} onChange={(event) => setSchedule({ ...schedule, timeZone: event.target.value })} /></label>
        <label>Release time<input required type="time" value={schedule.releaseTime} onChange={(event) => setSchedule({ ...schedule, releaseTime: event.target.value })} /></label>
        <fieldset className="adm-theme-rotation"><legend>Approved rotation (select one or more immutable versions)</legend>{approved.map((theme) => <label key={theme.themeVersionId}><input type="checkbox" checked={schedule.rotationVersionIds.includes(theme.themeVersionId)} onChange={() => toggleRotation(theme.themeVersionId)} /> {theme.name} · v{theme.version}</label>)}</fieldset>
        <Button type="submit" variant="gold" disabled={busy}>Save release schedule</Button>
      </form>
    </Section> : null}

    <Section title="Instance appearance" description="Choose the latest reviewed release, the scheduled global rotation, or pin an approved version to an instance.">
      <div className="adm-theme-instance-form">
        <label>Instance<select value={instanceSelection.instanceId} onChange={(event) => setInstanceSelection({ ...instanceSelection, instanceId: event.target.value })}>{instances.map((instance) => <option value={instance.instance_id} key={instance.instance_id}>{instance.display_name}</option>)}</select></label>
        <label>Theme behavior<select value={instanceSelection.mode} onChange={(event) => setInstanceSelection({ ...instanceSelection, mode: event.target.value, themeVersionId: event.target.value === "fixed" ? approved[0]?.themeVersionId || "" : "" })}><option value="latest">Latest published</option><option value="rotation">Scheduled rotation</option><option value="fixed">Fixed approved version</option></select></label>
        {instanceSelection.mode === "fixed" ? <label>Theme version<select value={instanceSelection.themeVersionId} onChange={(event) => setInstanceSelection({ ...instanceSelection, themeVersionId: event.target.value })}>{approved.map((theme) => <option value={theme.themeVersionId} key={theme.themeVersionId}>{theme.name} · v{theme.version}</option>)}</select></label> : null}
        <Button variant="gold" disabled={busy || !instanceSelection.instanceId} onClick={() => run(() => api.setInstanceTheme(instanceSelection.instanceId, { mode: instanceSelection.mode, themeVersionId: instanceSelection.mode === "fixed" ? instanceSelection.themeVersionId : null }), "Instance theme selection saved.")}>Save instance theme</Button>
      </div>
    </Section>

    <Section title="Publication history" description="Append-only record of seed, manual, scheduled, and rollback releases.">
      <div className="adm-theme-release-list">{releases.map((release) => <div key={release.publicationId}><strong>{release.name} · v{release.version}</strong><span>{release.source}{release.releaseDate ? ` · ${release.releaseDate}` : ""}</span><time>{new Date(release.publishedAt).toLocaleString()}</time></div>)}{!releases.length ? <p className="adm-sub">No releases yet.</p> : null}</div>
    </Section>

    {preview ? <div className="adm-theme-modal-backdrop" role="presentation" onClick={() => setPreview(null)}><section className="adm-theme-modal" role="dialog" aria-modal="true" aria-labelledby="theme-preview-title" onClick={(event) => event.stopPropagation()}><button className="adm-theme-modal__close" onClick={() => setPreview(null)} aria-label="Close theme preview">×</button><p className="oh-eyebrow">INTERACTIVE PREVIEW · {preview.category}</p><h2 id="theme-preview-title">{preview.name} · version {preview.version}</h2><p>{preview.description}</p><ThemePreview theme={preview} /><Button variant="ghost" onClick={() => setPreview(null)}>Close preview</Button></section></div> : null}
  </div>;
}
