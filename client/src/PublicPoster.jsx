import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Header from "./Header.jsx";
import PosterArt from "./admin/PosterArt.jsx";
import { applyInstanceBranding, applyRuntimeTheme, clearRuntimeTheme } from "./theme-runtime.js";
import "./admin/posters.css";

export default function PublicPoster() {
  const { posterId } = useParams();
  const [poster, setPoster] = useState(null);
  const [template, setTemplate] = useState(null);
  const [state, setState] = useState("loading");
  const [bookingOpen, setBookingOpen] = useState(false);
  const [shareMessage, setShareMessage] = useState("");

  useEffect(() => {
    const abort = new AbortController();
    Promise.all([
      fetch(`/api/public/posters/${encodeURIComponent(posterId)}`, { signal: abort.signal }).then(async (response) => { const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error || "Poster not found"); return body.poster; }),
      fetch("/api/public/poster-templates", { signal: abort.signal }).then(async (response) => { const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error || "Poster templates unavailable"); return body.templates || []; }),
    ]).then(([published, templates]) => {
      setPoster(published);
      const selected = templates.find((item) => item.templateVersionId === published.templateVersionId) || null;
      setTemplate(selected);
      published.data.artworkUrl = published.data.artworkAssetId ? `/api/public/posters/${encodeURIComponent(published.posterId)}/artwork` : null;
      setState("ready");
      applyInstanceBranding(published.branding, published.instanceName);
      document.title = `${published.data.title} · ${published.instanceName}`;
      const description = [published.data.details, published.data.schedule, (published.data.eventFacts?.winningPatterns || []).map((item) => `${item.label}: ${item.points} points`).join(" · ")].filter(Boolean).join(" · ").slice(0, 300);
      document.querySelector('meta[name="description"]')?.setAttribute("content", description);
      document.querySelector('meta[property="og:title"]')?.setAttribute("content", published.data.title);
      document.querySelector('meta[property="og:description"]')?.setAttribute("content", description);
      document.querySelector('meta[property="og:image"]')?.setAttribute("content", new URL(published.data.artworkUrl || "/brand/tambola-house-social-card.svg", window.location.origin).href);
      document.querySelector('meta[property="og:url"]')?.setAttribute("content", window.location.href);
      if (published.data.sessionId) fetch(`/api/public/sessions/${encodeURIComponent(published.data.sessionId)}`, { signal: abort.signal, cache: "no-store" }).then(async (response) => {
        setBookingOpen(response.ok);
        if (response.ok) { const data = await response.json().catch(() => ({})); if (data.session) setPoster((current) => current ? { ...current, data: { ...current.data, eventFacts: { ...current.data.eventFacts, available: data.session.available, ticketAvailability: `${data.session.available} of ${data.session.capacity} free tickets available` } } } : current); }
      }).catch(() => setBookingOpen(false));
      if (published.data?.themeVersionId) fetch("/api/public/themes", { signal: abort.signal }).then((response) => response.json()).then((result) => { const theme = result.themes?.find((item) => item.themeVersionId === published.data.themeVersionId); if (theme) applyRuntimeTheme(theme); }).catch(() => {});
    }).catch((error) => { if (error.name !== "AbortError") setState("error"); });
    return () => { abort.abort(); clearRuntimeTheme(); };
  }, [posterId]);

  const eventFacts = poster?.data?.eventFacts;
  const announcement = useMemo(() => {
    if (!poster) return "";
    const facts = poster.data.eventFacts;
    const prizes = facts?.winningPatterns?.map((item) => `• ${item.label}: ${item.points} game points`).join("\n") || poster.data.patterns;
    const join = facts?.publicJoinUrl ? new URL(facts.publicJoinUrl, window.location.origin).href : `${window.location.origin}/games/${poster.instanceSlug}`;
    return [poster.data.title, poster.data.details, poster.data.schedule, facts?.gameType, facts?.roomCode ? `Room code: ${facts.roomCode}` : null, `Winning patterns:\n${prizes}`, `Tickets: ${facts?.ticketAvailability || "See the game hall"}`, `Join free: ${join}`].filter(Boolean).join("\n\n");
  }, [poster]);

  async function copy(value, label) {
    try { await navigator.clipboard.writeText(value); setShareMessage(`${label} copied.`); }
    catch { setShareMessage("Clipboard access is unavailable in this browser."); }
  }

  async function nativeShare() {
    if (!navigator.share) return setShareMessage("Native sharing is not available on this device.");
    try { await navigator.share({ title: poster.data.title, text: announcement, url: window.location.href }); setShareMessage("The system share sheet was opened."); }
    catch (error) { if (error.name !== "AbortError") setShareMessage("Sharing could not be opened."); }
  }

  if (state === "loading") return <div className="public-page"><Header /><main id="main-content" tabIndex="-1" className="public-poster-page"><p>Loading published poster…</p></main></div>;
  if (state === "error" || !poster || !template) return <div className="public-page"><Header /><main id="main-content" tabIndex="-1" className="public-poster-page"><section className="public-error"><h1>Poster unavailable</h1><p>This poster may have been unpublished or the link may be incorrect.</p><Link to="/games">Browse games</Link></section></main></div>;

  const joinPath = eventFacts?.sessionId ? `/sessions/${encodeURIComponent(eventFacts.sessionId)}?instance=${encodeURIComponent(poster.instanceSlug)}` : `/games/${encodeURIComponent(poster.instanceSlug)}`;
  const shareUrl = typeof window === "undefined" ? "" : window.location.href;
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`${announcement}\n\n${shareUrl}`)}`;
  const telegram = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(announcement)}`;
  const facebook = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`;
  return <div className="public-page"><Header /><main id="main-content" tabIndex="-1" className="public-poster-page"><section className="public-poster-head"><p className="oh-eyebrow">{poster.instanceName} · {eventFacts?.gameType || "Free-to-play Tambola"}</p><h1 className="oh-display">{poster.data.title}</h1><p>{poster.data.schedule} · {poster.templateName}</p></section><div className="public-poster-art"><PosterArt template={template} poster={poster.data} instance={{ display_name: poster.instanceName }} /></div>
    {eventFacts ? <section className="public-poster-event" aria-labelledby="event-facts-title"><h2 id="event-facts-title">Event details</h2><p>{poster.data.details}</p><p>{eventFacts.roomCode ? `Room code ${eventFacts.roomCode} · ` : ""}{eventFacts.ticketAvailability}</p><h3>Winning patterns · game points</h3><ul>{(eventFacts.winningPatterns || []).map((item) => <li key={item.id}><span>{item.label}</span><strong>{item.points} points</strong></li>)}</ul><p>Free to play · no cash prizes.</p></section> : null}
    <div className="public-poster-actions"><Link className="public-event-join" to={joinPath}>{eventFacts?.sessionId ? bookingOpen ? (poster.data.cta || "Join event") : "View event details" : `Explore ${poster.instanceName}`}</Link><button type="button" onClick={() => copy(shareUrl, "Event link")}>Copy event link</button><button type="button" onClick={() => copy(announcement, "Announcement")}>Copy announcement</button><button type="button" onClick={nativeShare}>Share…</button><a href={whatsapp} target="_blank" rel="noreferrer noopener">WhatsApp</a><a href={telegram} target="_blank" rel="noreferrer noopener">Telegram</a><a href={facebook} target="_blank" rel="noreferrer noopener">Facebook</a></div>
    {shareMessage ? <p role="status" className="public-poster-share-status">{shareMessage}</p> : null}<p className="public-poster-link"><Link to={`/games/${poster.instanceSlug}`}>Explore {poster.instanceName}</Link></p></main></div>;
}
