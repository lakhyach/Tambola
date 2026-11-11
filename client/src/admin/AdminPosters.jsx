import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Button from "../components/Button.jsx";
import { api } from "./api.js";
import { ErrorNote, Loading, Section, StatusPill } from "./ui.jsx";
import PosterArt from "./PosterArt.jsx";
import { exportPoster } from "./poster-export.js";
import "./posters.css";

const freshPoster = () => ({ title: "", schedule: "", details: "", patterns: "", themeVersionId: null, accent: null, layoutSize: "portrait", cta: "Join the game", eventDetails: "", venue: "", organizerName: "", contactInfo: "", bookingUrl: null });
const emptyTemplate = () => ({ templateId: "", name: "", description: "", category: "classic", layout: "classic" });
function sessionDateTime(value, timeZone, options) {
  if (!value || !timeZone || !Number.isFinite(Date.parse(value))) return "Not scheduled";
  try { return new Intl.DateTimeFormat("en-IN", { ...options, timeZone }).format(new Date(value)); }
  catch { return "Invalid session timezone"; }
}
const POSTER_DIRECTIONS = [
  {
    id: "bollywood-masala", name: "Bollywood Masala", templateVersionId: "bollywood-masala-v1", accent: "#f6da37",
    prompt: "Bollywood Masala Tambola night, dramatic near-black stage, glowing green and saffron spotlights, fanned paper Tambola tickets and glossy numbered bingo balls, energetic Indian cinema marquee atmosphere, rich gold trim, premium print-art direction, keep the center and lower third calm for crisp editable event copy. Background art only; no letters, words, numbers, logos or QR codes.",
  },
  {
    id: "royal-festive", name: "Royal Festive", templateVersionId: "royal-festive-v1", accent: "#f1c83c",
    prompt: "Royal Festive Indian Tambola celebration, deep cobalt and royal blue with luminous gold, elegant palace arches, diya glow, fine rangoli and marigold accents, refined festive editorial poster art, generous quiet center and lower third for crisp editable event copy. Background art only; no letters, words, numbers, logos or QR codes.",
  },
  {
    id: "desi-street-food", name: "Desi Street Food", templateVersionId: "desi-street-food-v1", accent: "#ffdf32",
    prompt: "Desi Street Food Tambola night bazaar, vivid fuchsia and plum with warm haldi yellow, charming Indian street-food cart details, chai steam, festive bulbs, glossy numbered Tambola balls and a ticket motif, playful premium poster illustration, clear quiet center and lower third for crisp editable event copy. Background art only; no letters, words, numbers, logos or QR codes.",
  },
];

export default function AdminPosters() {
  const [templates, setTemplates] = useState([]);
  const [posters, setPosters] = useState([]);
  const [instances, setInstances] = useState([]);
  const [themes, setThemes] = useState([]);
  const [schedule, setSchedule] = useState(null);
  const [eventSessions, setEventSessions] = useState([]);
  const [sessionId, setSessionId] = useState("");
  const [eventContext, setEventContext] = useState(null);
  const [providerStatus, setProviderStatus] = useState(null);
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [instanceId, setInstanceId] = useState("");
  const [templateVersionId, setTemplateVersionId] = useState("");
  const [poster, setPoster] = useState(freshPoster);
  const [posterId, setPosterId] = useState("");
  const [posterStatus, setPosterStatus] = useState("draft");
  const [selectedSize, setSelectedSize] = useState("desktop");
  const [templateDraft, setTemplateDraft] = useState(emptyTemplate);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState("");
  const svgRef = useRef(null);
  const template = useMemo(() => templates.find((item) => item.templateVersionId === templateVersionId) || templates.find((item) => item.status === "approved") || null, [templates, templateVersionId]);
  const instance = useMemo(() => instances.find((item) => item.instance_id === instanceId) || null, [instances, instanceId]);
  const sessionPoster = useMemo(() => eventContext ? {
    ...poster,
    title: eventContext.title,
    schedule: eventContext.schedule,
    details: poster.eventDetails || `${eventContext.gameType} · ${eventContext.ticketAvailability}`,
    patterns: eventContext.prizesDescription || "No published winning patterns",
    bookingUrl: eventContext.publicJoinUrl,
    eventFacts: eventContext,
  } : poster, [eventContext, poster]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [templateData, posterData, instanceData, themeData, scheduleData, providerData] = await Promise.all([api.posterTemplates(), api.posters(), api.instances(), api.themes(), api.posterTemplateSchedule(), api.posterProvider()]);
      const nextTemplates = templateData.templates || [];
      setTemplates(nextTemplates); setPosters(posterData.posters || []); setInstances(instanceData.instances || []); setThemes(themeData.themes || []);
      setSchedule(scheduleData.schedule || null);
      setProviderStatus(providerData.provider || null);
      setTemplateVersionId((current) => current || nextTemplates.find((item) => item.status === "approved")?.templateVersionId || "");
      setInstanceId((current) => current || instanceData.instances?.[0]?.instance_id || "");
    } catch (failure) { setError(failure); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!instanceId) { setEventSessions([]); setSessionId(""); setEventContext(null); return; }
    let active = true;
    setEventContext(null);
    api.posterSessions(instanceId).then((result) => { if (!active) return; const rows = result.sessions || []; setEventSessions(rows); setSessionId((current) => rows.some((row) => row.sessionId === current) ? current : rows[0]?.sessionId || ""); })
      .catch(() => { if (active) { setEventSessions([]); setEventContext(null); } });
    return () => { active = false; };
  }, [instanceId]);

  useEffect(() => {
    if (!instanceId || !sessionId) { setEventContext(null); return; }
    let active = true;
    setEventContext(null);
    api.posterSessionContext(instanceId, sessionId).then((result) => { if (active) setEventContext(result.context); })
      .catch(() => { if (active) setEventContext(null); });
    return () => { active = false; };
  }, [instanceId, sessionId]);

  function resetEditor() {
    setPosterId(""); setPosterStatus("draft"); setPoster(freshPoster()); setPrompt(""); setMessage("");
  }

  function chooseDirection(direction) {
    setPrompt(direction.prompt);
    setTemplateVersionId(direction.templateVersionId);
    setPoster((current) => ({ ...current, accent: direction.accent, layoutSize: "portrait" }));
  }

  async function perform(action, success) {
    setBusy(true); setError(null); setMessage("");
    try { const result = await action(); setMessage(success); await load(); return result; }
    catch (failure) { setError(failure); return null; }
    finally { setBusy(false); }
  }

  async function saveDraft() {
    if (!instanceId || !template || !sessionId || eventContext?.sessionId !== sessionId) return null;
    let id = posterId;
    const savedPoster = Object.fromEntries(Object.entries(sessionPoster).filter(([key]) => key !== "artworkDataUrl" && key !== "artworkUrl"));
    const payload = { instanceId, templateVersionId: template.templateVersionId, data: { ...savedPoster, ...(eventContext ? { sessionId: eventContext.sessionId } : {}) } };
    if (id) await api.savePoster(id, payload);
    else { const created = await api.createPoster(payload); id = created.posterId; setPosterId(id); }
    setPosterStatus("draft");
    return id;
  }

  async function onSave() {
    await perform(async () => { const id = await saveDraft(); if (!id) throw new Error("Choose an active instance and an approved template."); return id; }, "Draft saved in this instance.");
  }

  async function onPublish() {
    await perform(async () => { const id = await saveDraft(); if (!id) throw new Error("Choose an active instance and an approved template."); const result = await api.publishPoster(id); setPosterStatus("published"); return result; }, "Poster published. Its template and content are retained in the publication record.");
  }

  async function duplicate(id) {
    const result = await perform(() => api.duplicatePoster(id), "A separate draft copy is ready to edit.");
    if (result?.poster) openPoster(result.poster);
  }

  async function openPoster(item) {
    if (item.status !== "draft") return;
    setPosterId(item.posterId); setPosterStatus(item.status); setInstanceId(item.instanceId); setTemplateVersionId(item.templateVersionId); setPoster({ ...item.data, ...(item.data.artworkAssetId ? { artworkUrl: `/api/admin/posters/artworks/${item.data.artworkAssetId}` } : {}) }); setPrompt(item.data.prompt || ""); setEventContext(item.data.eventFacts || null); setSessionId(item.data.sessionId || ""); setMessage(`Editing draft for ${item.instanceName}.`);
  }

  async function generate() {
    setGenerating(true); setError(null); setMessage("");
    try {
      const result = await api.generatePosterArtwork({ instanceId, sessionId, prompt, size: poster.layoutSize === "landscape" ? "1536x1024" : "1024x1536" });
      const response = await fetch(result.artwork.imageUrl, { credentials: "same-origin" });
      if (!response.ok) throw new Error("Generated background could not be loaded for preview.");
      const imageBlob = await response.blob();
      const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error("Generated background could not be read.")); reader.readAsDataURL(imageBlob); });
      const context = result.artwork.context;
      const nextPoster = { ...poster, title: context.title, schedule: context.schedule, details: `${context.gameType} · ${context.ticketAvailability}`, patterns: context.prizesDescription || context.missingFields.join(" "), sessionId: context.sessionId, bookingUrl: poster.bookingUrl || context.publicJoinUrl, artworkAssetId: result.artwork.assetId, artworkUrl: result.artwork.imageUrl, artworkDataUrl: dataUrl, prompt };
      setPoster(nextPoster); setEventContext(context); setMessage(`Original background generated with ${result.artwork.provider} (${result.artwork.model}). Event facts were loaded from the selected session.`);
    } catch (failure) { setError(failure); }
    finally { setGenerating(false); }
  }

  async function download(format) {
    try { const result = await exportPoster({ svg: svgRef.current, poster, format }); setMessage(`Poster downloaded as ${format.toUpperCase()} · ${result.dimensions}.`); }
    catch (failure) { setError(failure); }
  }

  async function createTemplateDraft(event) {
    event.preventDefault();
    const base = template || templates.find((item) => item.status === "approved");
    if (!base) return;
    const payload = { ...templateDraft, palette: { ...base.palette } };
    await perform(() => api.createPosterTemplate(payload), "Template draft created. Approve and publish it to add it to the public library.");
  }

  async function saveSchedule(event) {
    event.preventDefault();
    await perform(async () => { const result = await api.savePosterTemplateSchedule(schedule); setSchedule(result.schedule); return result; }, "Daily poster-template schedule saved.");
  }

  async function rollbackTemplateVersion(item) {
    if (!window.confirm(`Restore ${item.name} version ${item.version} as a new published version? Existing template versions and published posters remain unchanged.`)) return;
    await perform(() => api.rollbackPosterTemplate(item.templateId, item.templateVersionId), `Restored ${item.name} from version ${item.version} as a new immutable published version.`);
  }

  function toggleScheduledTemplate(versionId) {
    setSchedule((current) => {
      const selected = new Set(current.rotationVersionIds || []);
      if (selected.has(versionId)) selected.delete(versionId); else selected.add(versionId);
      return { ...current, rotationVersionIds: [...selected] };
    });
  }

  if (loading && !templates.length) return <div className="adm-page"><Loading block label="Loading poster studio…" /></div>;

  return <div className="adm-page adm-poster-page">
    <header className="adm-page-head"><div><p className="oh-eyebrow">Instance creative studio</p><h1 className="oh-display adm-page-title">Poster studio</h1><p className="adm-sub">Build an instance-branded announcement from reviewed layouts. Drafts can be revised; published posters keep their exact template version and content.</p></div><Button variant="ghost" size="sm" onClick={load} disabled={loading}>Refresh</Button></header>
    {message ? <p className="adm-poster-message" role="status">{message}</p> : null}
    {error ? <ErrorNote title="Poster studio request failed" error={error} onRetry={load} /> : null}

    <Section title="Create a poster from a prompt" description="Describe the visual direction. The server generates background art; verified session facts are typeset separately and never delegated to the image model.">
      <div className="adm-poster-form">
        <label>Event / session<select value={sessionId} onChange={(event) => { setSessionId(event.target.value); setEventContext(null); }} disabled={!eventSessions.length}><option value="">Choose a scheduled session</option>{eventSessions.map((item) => <option key={item.sessionId} value={item.sessionId}>{item.title} · {new Date(item.startsAt).toLocaleString()} · {item.status}</option>)}</select></label>
        <label className="poster-form-wide">Visual direction<textarea value={prompt} maxLength={1200} rows={4} placeholder="Premium Diwali night, deep plum and luminous gold, elegant palace arches, warm diya light, sophisticated editorial art…" onChange={(event) => setPrompt(event.target.value)} /><small>{prompt.length}/1200 · no factual copy is placed inside generated artwork</small></label>
        <div className="poster-form-wide adm-poster-directions" role="group" aria-label="Poster art direction presets">
          <span className="oh-eyebrow">Choose a visual direction</span>
          {POSTER_DIRECTIONS.map((direction) => <button key={direction.id} type="button" aria-pressed={prompt === direction.prompt} onClick={() => chooseDirection(direction)}>{direction.name}</button>)}
        </div>
      </div>
      {providerStatus?.configured ? <p className="adm-poster-message" role="status">Image provider ready: {providerStatus.provider} · {providerStatus.model}</p> : <p className="adm-poster-empty" role="status">Image generation is not configured on this server. Set OPENAI_API_KEY server-side to enable it; no generated art or mock result will be shown.</p>}
      {eventContext ? <div className="adm-poster-event-facts"><strong>{eventContext.title}</strong><span>{eventContext.gameType} · {eventContext.schedule}</span><span>Room: {eventContext.roomCode || "Not assigned"} · {eventContext.ticketAvailability}</span><span>{eventContext.prizesDescription || "No room prize configuration is available yet."}</span><span>Join URL: {eventContext.publicJoinUrl}</span>{eventContext.missingFields.map((item) => <small key={item}>{item}</small>)}</div> : <p className="adm-sub">Choose a session in this instance to load its real schedule, availability, room, and configured game-point awards.</p>}
      <Button variant="gold" disabled={generating || !instanceId || !sessionId || prompt.trim().length < 12 || !providerStatus?.configured} onClick={generate}>{generating ? "Generating background…" : poster.artworkAssetId ? "Regenerate background" : "Generate poster background"}</Button>
      {generating ? <p role="status" aria-live="polite">Generating festival artwork. Keep this page open; factual event text stays editable and separate.</p> : null}
    </Section>

    <Section title="Optional composition library" description="Choose a reviewed typography and layout system for accurate event details. Generated artwork remains the visual background.">
      <div className="adm-poster-template-grid">{templates.filter((item) => item.status === "approved").map((item) => <button type="button" key={item.templateVersionId} className={`adm-poster-template ${templateVersionId === item.templateVersionId ? "is-selected" : ""}`} aria-pressed={templateVersionId === item.templateVersionId} onClick={() => setTemplateVersionId(item.templateVersionId)}><span className="adm-poster-template__art" style={{ aspectRatio: sessionPoster.layoutSize === "square" ? "1 / 1" : sessionPoster.layoutSize === "landscape" ? "5 / 4" : sessionPoster.layoutSize === "story" ? "9 / 16" : "4 / 5" }}><PosterArt template={item} poster={sessionPoster} instance={instance} preview /></span><strong>{item.name}</strong><small>{item.category} · version {item.version}</small></button>)}</div>
      {!templates.some((item) => item.status === "approved") && !error ? <p className="adm-poster-empty" role="status">No reviewed poster templates are available yet. Approved original layouts will appear here.</p> : null}
    </Section>

    <div className="adm-poster-workspace">
      <Section title="Poster details" description="Text is escaped as SVG text. Only built-in vector artwork and approved instance/theme data are used.">
        <div className="adm-poster-form">
          <label>Instance<select value={instanceId} onChange={(event) => { setInstanceId(event.target.value); setSessionId(""); setEventContext(null); }}>{instances.map((item) => <option key={item.instance_id} value={item.instance_id}>{item.display_name}</option>)}</select></label>
          <label>Game title<input value={eventContext?.title ?? poster.title} maxLength={90} readOnly={Boolean(eventContext)} onChange={(event) => setPoster({ ...poster, title: event.target.value })} /></label>
          <label>Game date<input value={eventContext ? sessionDateTime(eventContext.startsAt, eventContext.timeZone, { dateStyle: "full" }) : "Choose a scheduled session above"} readOnly /><small>Set the authoritative date in Scheduled sessions.</small></label>
          <label>Game start time<input value={eventContext ? sessionDateTime(eventContext.startsAt, eventContext.timeZone, { timeStyle: "short", timeZoneName: "short" }) : "Choose a scheduled session above"} readOnly /></label>
          <label>Timezone<input value={eventContext?.timeZone || "Select a session to view its timezone"} readOnly /></label>
          <label className="poster-form-wide">Schedule label<input value={eventContext?.schedule ?? poster.schedule} maxLength={120} readOnly={Boolean(eventContext)} onChange={(event) => setPoster({ ...poster, schedule: event.target.value })} /><small>Linked poster date and time come from the persisted session schedule.</small></label>
          <label>Venue<input value={poster.venue || ""} maxLength={140} onChange={(event) => setPoster({ ...poster, venue: event.target.value })} placeholder="Venue or online" /></label>
          <label>Organizer name<input value={poster.organizerName || ""} maxLength={100} onChange={(event) => setPoster({ ...poster, organizerName: event.target.value })} /></label>
          <label>Contact information<input value={poster.contactInfo || ""} maxLength={120} onChange={(event) => setPoster({ ...poster, contactInfo: event.target.value })} placeholder="Phone, email, or WhatsApp" /></label>
          <label className="poster-form-wide">Booking URL<input value={poster.bookingUrl ?? eventContext?.publicJoinUrl ?? ""} maxLength={500} onChange={(event) => setPoster({ ...poster, bookingUrl: event.target.value })} placeholder="Session booking link or https://…" /><small>Defaults to the selected session&apos;s public booking page. Custom links must use HTTPS or a same-site path.</small></label>
          <label>Game details<input value={poster.details} maxLength={240} onChange={(event) => setPoster({ ...poster, details: event.target.value })} /></label>
          <label>Event details<textarea value={poster.eventDetails || ""} maxLength={500} rows={2} onChange={(event) => setPoster({ ...poster, eventDetails: event.target.value })} /></label>
          <label>Call to action<input value={poster.cta || "Join the game"} maxLength={48} onChange={(event) => setPoster({ ...poster, cta: event.target.value })} /></label>
          <label className="poster-form-wide">Winning patterns and game-point rewards<textarea value={poster.patterns} maxLength={1200} rows={4} onChange={(event) => setPoster({ ...poster, patterns: event.target.value })} /></label>
          <label>Approved game theme<select value={poster.themeVersionId || ""} onChange={(event) => { const themeVersionId = event.target.value || null; const theme = themes.find((item) => item.themeVersionId === themeVersionId); setPoster({ ...poster, themeVersionId, ...(theme ? { accent: theme.package.tokens.gold } : {}) }); }}><option value="">Use template palette</option>{themes.filter((item) => item.status === "approved").map((item) => <option key={item.themeVersionId} value={item.themeVersionId}>{item.name} · v{item.version}</option>)}</select></label>
          <label>Accent color<input type="color" value={poster.accent || template?.palette.accent || "#42c98a"} onChange={(event) => setPoster({ ...poster, accent: event.target.value })} /></label>
          <label>Export layout<select value={poster.layoutSize} onChange={(event) => setPoster({ ...poster, layoutSize: event.target.value })}><option value="square">Square · social post</option><option value="portrait">Portrait · poster</option><option value="landscape">Landscape · website</option><option value="story">Story · mobile share</option></select></label>
        </div>
        <div className="adm-poster-actions"><Button variant="ghost" disabled={busy || posterStatus === "published" || !instance || !template || !sessionId || eventContext?.sessionId !== sessionId} onClick={onSave}>Save draft</Button><Button variant="gold" disabled={busy || posterStatus === "published" || !instance || !template || !sessionId || eventContext?.sessionId !== sessionId} onClick={onPublish}>Publish poster</Button><Button variant="ghost" disabled={!posterId || busy} onClick={() => duplicate(posterId)}>Duplicate</Button><Button variant="ghost" onClick={resetEditor}>New poster</Button></div>
        {posterId ? <p className="adm-sub">{posterId} · <StatusPill status={posterStatus} /></p> : null}
        <div className="adm-poster-export"><Button size="sm" variant="ghost" onClick={() => download("svg")}>Download SVG</Button><Button size="sm" variant="ghost" onClick={() => download("png")}>Download PNG</Button>{posterStatus === "published" ? <a href={`/poster/${posterId}`} target="_blank" rel="noreferrer">Open public poster</a> : <span>Publish to create a shareable link.</span>}</div>
      </Section>
      <Section title="Live preview" description="Switch the preview frame while preserving the selected export dimensions.">
        <div className="adm-poster-preview-tools"><button type="button" className={selectedSize === "desktop" ? "is-active" : ""} aria-pressed={selectedSize === "desktop"} onClick={() => setSelectedSize("desktop")}>Desktop</button><button type="button" className={selectedSize === "mobile" ? "is-active" : ""} aria-pressed={selectedSize === "mobile"} onClick={() => setSelectedSize("mobile")}>Mobile</button></div>
        <div className={`adm-poster-preview-stage is-${selectedSize}`}>{template ? <PosterArt template={template} poster={sessionPoster} instance={instance} preview svgRef={svgRef} /> : <p className="adm-poster-empty" role="status">A poster preview will appear when a reviewed template and active instance are available.</p>}</div>
      </Section>
    </div>

    <Section title="Saved posters" description="Drafts can be edited. Published records are immutable; duplicate one to prepare a revised announcement.">
      <div className="adm-poster-saved">{posters.map((item) => <article key={item.posterId}><div><strong>{item.data.title}</strong><span>{item.instanceName} · {item.templateName} · {new Date(item.updatedAt).toLocaleString()}</span></div><StatusPill status={item.status} /><div>{item.status === "draft" ? <Button size="sm" variant="ghost" onClick={() => openPoster(item)}>Edit</Button> : null}<Button size="sm" variant="ghost" disabled={busy} onClick={() => duplicate(item.posterId)}>Make a copy</Button></div></article>)}{!posters.length ? <p className="adm-sub">No posters saved yet.</p> : null}</div>
    </Section>

    <Section title="Template review and publishing" description="New original layouts are isolated drafts until reviewed. Published template versions remain attached to existing posters.">
      <form className="adm-poster-template-form" onSubmit={createTemplateDraft}>
        <label>Template name<input required minLength={2} maxLength={80} value={templateDraft.name} onChange={(event) => setTemplateDraft({ ...templateDraft, name: event.target.value })} /></label>
        <label>Template ID<input required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={48} value={templateDraft.templateId} onChange={(event) => setTemplateDraft({ ...templateDraft, templateId: event.target.value.toLowerCase() })} /></label>
        <label>Category<select value={templateDraft.category} onChange={(event) => setTemplateDraft({ ...templateDraft, category: event.target.value })}>{["classic", "premium", "festive", "celebration", "seasonal", "bumper", "regular", "special", "minimal", "traditional"].map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Composition<select value={templateDraft.layout} onChange={(event) => setTemplateDraft({ ...templateDraft, layout: event.target.value })}>{["classic", "festival", "spotlight", "minimal"].map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="poster-form-wide">Description<textarea required minLength={10} maxLength={500} rows={2} value={templateDraft.description} onChange={(event) => setTemplateDraft({ ...templateDraft, description: event.target.value })} /></label>
        <Button type="submit" variant="gold" disabled={busy || !template}>Create template draft</Button>
      </form>
      <div className="adm-poster-review-list">{templates.filter((item) => item.status === "draft" || item.catalogStatus === "approved" && !item.publishedAt).map((item) => <article key={item.templateVersionId}><div><strong>{item.name} · v{item.version}</strong><span>{item.description}</span></div>{item.catalogStatus === "draft" ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => perform(() => api.approvePosterTemplate(item.templateId), "Template approved.")}>Approve template</Button> : null}{item.status === "draft" && item.catalogStatus === "approved" ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => perform(() => api.approvePosterTemplateVersion(item.templateId, item.templateVersionId), "Template version approved.")}>Approve version</Button> : null}{item.catalogStatus === "approved" && item.status === "approved" && !item.publishedAt ? <Button size="sm" variant="gold" disabled={busy} onClick={() => perform(() => api.publishPosterTemplate(item.templateVersionId), "Template published.")}>Publish template</Button> : null}</article>)}</div>
      <div className="adm-poster-review-list">{templates.filter((item) => item.status === "approved" && item.catalogStatus === "approved" && item.isCurrent).map((item) => <article key={`next-${item.templateVersionId}`}><div><strong>{item.name} · current v{item.version}</strong><span>Create an immutable next version with this original composition and palette.</span></div><Button size="sm" variant="ghost" disabled={busy} onClick={() => perform(() => api.createPosterTemplateVersion(item.templateId, { layout: item.layout, palette: item.palette }), `Version ${item.version + 1} created for review.`)}>Create next version</Button></article>)}</div>
    </Section>

    <Section title="Published template history and rollback" description="Restore a previously published design by creating and publishing a new immutable version. Existing versions and posters keep their original snapshots.">
      <div className="adm-poster-review-list">{templates.filter((item) => item.status === "approved" && item.catalogStatus === "approved" && item.publishedAt && !item.isCurrent).map((item) => <article key={`rollback-${item.templateVersionId}`}><div><strong>{item.name} · v{item.version}{item.isCurrent ? " · current" : ""}</strong><span>{item.layout} composition · last published {new Date(item.publishedAt).toLocaleString()}</span></div><Button size="sm" variant="ghost" disabled={busy} onClick={() => rollbackTemplateVersion(item)}>Restore as new version</Button></article>)}{!templates.some((item) => item.status === "approved" && item.catalogStatus === "approved" && item.publishedAt && !item.isCurrent) ? <p className="adm-sub">No earlier published versions are available to restore.</p> : null}</div>
    </Section>

    {schedule ? <Section title="Daily template additions" description="At the configured local time, add one approved template version to the public library. Retries publish once per local date, using the same single-process database lease as the theme scheduler.">
      <form className="adm-poster-template-form" onSubmit={saveSchedule}>
        <label className="adm-theme-checkbox"><input type="checkbox" checked={schedule.enabled} onChange={(event) => setSchedule({ ...schedule, enabled: event.target.checked })} /> Enable daily addition</label>
        <label>Time zone<input required maxLength={80} value={schedule.timeZone} onChange={(event) => setSchedule({ ...schedule, timeZone: event.target.value })} /></label>
        <label>Local release time<input required type="time" value={schedule.releaseTime} onChange={(event) => setSchedule({ ...schedule, releaseTime: event.target.value })} /></label>
        <fieldset className="adm-theme-rotation"><legend>Approved template versions</legend>{templates.filter((item) => item.catalogStatus === "approved" && item.status === "approved").map((item) => <label key={item.templateVersionId}><input type="checkbox" checked={schedule.rotationVersionIds.includes(item.templateVersionId)} onChange={() => toggleScheduledTemplate(item.templateVersionId)} /> {item.name} · v{item.version}</label>)}</fieldset>
        <Button type="submit" variant="gold" disabled={busy}>Save addition schedule</Button>
      </form>
    </Section> : null}
  </div>;
}
