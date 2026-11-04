import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Header from "./Header";
import { usePlatformBranding } from "./platform-branding.js";
import { ThemeArtwork } from "./admin/theme-art.js";
import { PATTERN_CATALOG, PATTERN_TICKET, getPatternDisplayCells, getPatternDisplayNote } from "./pattern-display.js";
import "./landing-festival.css";
import "./themes-public.css";

const LINK_LABELS = [["terms", "Terms"], ["privacy", "Privacy"], ["support", "Support"]];

// This is a deliberately labelled visual sample, not a ticket issued by a room.
const PREVIEW_TICKET = [
  [3, null, 20, 29, null, 51, null, 63, 74],
  [8, 15, null, null, 38, 42, 59, null, 88],
  [null, 12, 27, null, 33, null, 66, 79, 90],
];
const PREVIEW_MARKS = new Set([3, 15, 29, 42, 66, 79]);

const FESTIVAL_MOODBOARD = [
  { id: "diwali-celebration", title: "Diwali", note: "Diyas · marigold light · gold foil", tone: "diwali" },
  { id: "holi-colours", title: "Holi", note: "Gulal clouds · joyful jewel colour", tone: "holi" },
  { id: "navratri-garba", title: "Navratri", note: "Mirrorwork · dandiya sparkle", tone: "navratri" },
  { id: "durga-puja", title: "Durga Puja", note: "Dhak rhythm · vermilion red", tone: "durga" },
  { id: "ganesh-chaturthi", title: "Ganesh Chaturthi", note: "Mandap lights · marigold and rangoli", tone: "ganesh" },
  { id: "onam-pookalam", title: "Onam", note: "Kerala courtyard · pookalam and lamps", tone: "onam" },
  { id: "pongal-harvest", title: "Pongal", note: "Harvest morning · sugarcane and kolam", tone: "pongal" },
  { id: "halloween-night", title: "Halloween", note: "Pumpkin glow · midnight violet", tone: "halloween" },
  { id: "christmas-winter", title: "Christmas", note: "Evergreen · holly · warm lights", tone: "christmas" },
  { id: "eid-moonlight", title: "Eid", note: "Crescent arches · moonlit teal", tone: "eid" },
  { id: "new-year-celebration", title: "New Year", note: "Firework trails · midnight gold", tone: "newyear" },
];

function formatSessionDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time shown by the game hall";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function UpcomingSessions() {
  const [sessions, setSessions] = useState([]);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    const abort = new AbortController();
    const headers = { Accept: "application/json" };
    async function load() {
      const hallResponse = await fetch("/api/admin/public/instances", { signal: abort.signal, headers, cache: "no-store" });
      const hallData = await hallResponse.json().catch(() => ({}));
      if (!hallResponse.ok || !hallData.ok || !Array.isArray(hallData.instances)) throw new Error("Game halls unavailable");
      const groups = await Promise.all(hallData.instances.map(async (hall) => {
        const response = await fetch(`/api/public/instances/${encodeURIComponent(hall.slug)}/sessions`, { signal: abort.signal, headers, cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok || !Array.isArray(data.sessions)) return [];
        return data.sessions.map((session) => ({ ...session, hallSlug: hall.slug, hallName: hall.display_name }));
      }));
      const published = groups.flat().sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt)).slice(0, 3);
      setSessions(published);
      setStatus("ready");
    }
    load().catch((error) => { if (error.name !== "AbortError") setStatus("unavailable"); });
    return () => abort.abort();
  }, []);

  return <div className="fest-upcoming__content">
    {status === "loading" ? <p className="fest-state" role="status">Checking published game sessions…</p> : null}
    {status === "unavailable" ? <div className="fest-empty"><p>Published sessions could not be loaded right now.</p><Link className="fest-button fest-button--quiet" to="/games">Browse game halls</Link></div> : null}
    {status === "ready" && sessions.length === 0 ? <div className="fest-empty"><p>No upcoming sessions have been published yet. Browse a game hall or join a host with a room code.</p><Link className="fest-button fest-button--gold" to="/games">Browse game halls <span aria-hidden="true">↗</span></Link></div> : null}
    {status === "ready" && sessions.length > 0 ? <div className="fest-session-grid">{sessions.map((session) => <article className="fest-session-card" key={session.sessionId}>
      <span className="fest-session-card__spark" aria-hidden="true">✦</span><p className="fest-eyebrow">{session.hallName}</p><h3>{session.title}</h3>
      <p className="fest-session-card__time">{formatSessionDate(session.startsAt)}</p><p className="fest-session-card__free">Free to play</p>
      <Link className="fest-text-link" to={`/sessions/${encodeURIComponent(session.sessionId)}?instance=${encodeURIComponent(session.hallSlug)}`}>View session &amp; booking <span aria-hidden="true">→</span></Link>
    </article>)}</div> : null}
  </div>;
}

function TicketPreview() {
  return <div className="fest-ticket-wrap">
    <div className="fest-ticket" role="img" aria-label="Decorative sample Tambola ticket, not an issued ticket">
      <div className="fest-ticket__heading"><span>✦</span><div><strong>Tambola</strong><small>VISUAL PREVIEW · NOT A LIVE TICKET</small></div><span>✦</span></div>
      <div className="fest-ticket__grid">{PREVIEW_TICKET.flatMap((row, rowIndex) => row.map((number, colIndex) => <span key={`${rowIndex}-${colIndex}`} className={`${number == null ? "is-blank" : ""} ${number != null && PREVIEW_MARKS.has(number) ? "is-marked" : ""}`}>{number ?? ""}</span>))}</div>
      <div className="fest-ticket__footer"><span>15 NUMBERS</span><span>1–90</span><span>✺</span></div>
    </div>
    <div className="fest-ticket-note"><span className="fest-note-icon" aria-hidden="true">✦</span><span>On your ticket, the server keeps every number and called mark in sync.</span></div>
  </div>;
}

function Landing() {
  const brand = usePlatformBranding();
  const links = useMemo(() => LINK_LABELS.flatMap(([key, label]) => {
    const href = String(brand[`${key}Url`] || "");
    return /^https:\/\//i.test(href) ? [{ key, label, href }] : [];
  }), [brand]);

  return <div className="festival-landing">
    <Header />
    <main id="main-content" tabIndex="-1" className="festival-landing__main">
      <section className="fest-hero" aria-labelledby="festival-hero-title">
        <div className="fest-hero__lights" aria-hidden="true" />
        <div className="fest-hero__copy">
          <p className="fest-eyebrow fest-hero__kicker"><span aria-hidden="true">✦</span> {brand.tagline} <span aria-hidden="true">✦</span></p>
          <h1 id="festival-hero-title" className="fest-display">{brand.name}</h1>
          <p className="fest-hero__subtitle">A little sparkle. A lot of good company. Your next Tambola night starts here.</p>
          <p className="fest-hero__support">{brand.subtitle}</p>
          <div className="fest-hero__actions">
            <Link className="fest-button fest-button--play" to="/games"><span aria-hidden="true">✦</span> Play Now</Link>
            <Link className="fest-button fest-button--pink" to="/games">Book a Seat</Link>
            <Link className="fest-button fest-button--outline" to="/host">Host a Game</Link>
          </div>
          <p className="fest-hero__promise"><span>FREE TO PLAY</span><i /> No purchases · No wagers · No cash prizes</p>
        </div>
        <div className="fest-hero__stage" aria-label="Original illustrated host and decorative Tambola number balls">
          <div className="fest-hero__halo" aria-hidden="true" />
          <span className="fest-diya fest-diya--left" aria-hidden="true">✺</span><span className="fest-diya fest-diya--right" aria-hidden="true">✺</span>
          <span className="fest-ball fest-ball--45" aria-hidden="true">45</span><span className="fest-ball fest-ball--11" aria-hidden="true">11</span><span className="fest-ball fest-ball--67" aria-hidden="true">67</span>
          <img className="fest-hero__host" src="/brand/festival-host-illustration-v1.png" alt="Original illustration of a festive Tambola host holding a ticket" width="1312" height="1199" />
          <div className="fest-hero__ticket-mini" aria-hidden="true"><span>YOUR NEXT GAME</span><b>15</b><b>45</b><b>67</b><b>90</b></div>
        </div>
        <a className="fest-scroll-cue" href="#choose-your-game">Explore the game night <span aria-hidden="true">↓</span></a>
      </section>

      <section className="fest-section fest-welcome" id="choose-your-game" aria-labelledby="choose-title">
        <div className="fest-section-heading"><p className="fest-eyebrow">ONE GAME NIGHT · MANY WAYS TO PLAY</p><h2 id="choose-title" className="fest-display">Gather round, the numbers are waiting</h2><p>Choose a public game hall, book a published session, or bring a room code from your host. Every game stays free to play.</p></div>
        <div className="fest-game-types">
          <article className="fest-type-card fest-type-card--regular"><div className="fest-type-card__crest" aria-hidden="true">90</div><p className="fest-eyebrow">THE CLASSIC ROUND</p><h3>Regular Tambola</h3><p>Pick a public hall or enter a host’s room code to play the familiar 1–90 game together.</p><Link className="fest-text-link" to="/games">Find a game hall <span aria-hidden="true">→</span></Link></article>
          <article className="fest-type-card fest-type-card--bumper"><div className="fest-type-card__crest" aria-hidden="true">✹</div><p className="fest-eyebrow">A HOST-LED SPECIAL</p><h3>Special &amp; hosted rounds</h3><p>Hosts can set up a themed game night and choose supported patterns before play. Check each published session for its format.</p><Link className="fest-text-link" to="/games">Explore published games <span aria-hidden="true">→</span></Link></article>
          <article className="fest-type-card fest-type-card--host"><div className="fest-type-card__crest" aria-hidden="true">♛</div><p className="fest-eyebrow">YOUR PEOPLE · YOUR ROOM</p><h3>Host the celebration</h3><p>Open a room, choose its hall and invite people you know. Calls and claims are run by the game server.</p><Link className="fest-text-link" to="/host">Create a room <span aria-hidden="true">→</span></Link></article>
        </div>
      </section>

      <section className="fest-how fest-section" aria-labelledby="how-title">
        <div className="fest-how__art" aria-hidden="true"><div className="fest-orbit"><span>1</span><span>2</span><span>3</span></div><div className="fest-call-ball">90</div><div className="fest-how__sparkles">✦ <span>✧</span> ✦</div></div>
        <div className="fest-how__copy"><p className="fest-eyebrow">EASY TO JOIN · JOYFUL TO PLAY</p><h2 id="how-title" className="fest-display">How to play</h2><ol className="fest-steps"><li><b>01</b><span><strong>Find a game</strong><small>Choose an available hall or a published session.</small></span></li><li><b>02</b><span><strong>Take your seat</strong><small>Join with the room code, or reserve through a session listing.</small></span></li><li><b>03</b><span><strong>Follow each call</strong><small>Your ticket reconnects with the room and reflects official calls.</small></span></li><li><b>04</b><span><strong>Claim when ready</strong><small>The server checks your claim against its game history.</small></span></li></ol><Link className="fest-button fest-button--gold" to="/games">Let’s play <span aria-hidden="true">→</span></Link></div>
      </section>

      <section className="fest-pattern-section fest-section" aria-labelledby="patterns-title">
        <div className="fest-section-heading fest-section-heading--center"><p className="fest-eyebrow">EVERY MARK HAS A MOMENT</p><h2 id="patterns-title" className="fest-display">A little pattern, a lot of cheer</h2><p>All eleven patterns supported by this game are shown. A host chooses which optional prizes are active in each room.</p></div>
        <div className="fest-patterns">{PATTERN_CATALOG.map((pattern) => {
          const hits = new Set(getPatternDisplayCells(pattern).map(([row, col]) => `${row}-${col}`));
          const note = getPatternDisplayNote(pattern);
          const ticketDiagram = (ticketIndex) => <div className="fest-pattern-card__mini" key={ticketIndex}>{PATTERN_TICKET.flatMap((row, r) => row.map((number, c) => <span key={`${r}-${c}`} className={hits.has(`${r}-${c}`) ? "hit" : ""} data-empty={number == null ? "true" : "false"}>{number ?? ""}</span>))}</div>;
          return <article className={`fest-pattern-card${pattern.kind === "halfSheet" ? " fest-pattern-card--half-sheet" : ""}`} key={pattern.id}>
            {pattern.kind === "halfSheet" ? <div className="fest-pattern-card__ticket-set" role="img" aria-label={`${pattern.title}: three tickets, with two example called cells on each.`}>{[0, 1, 2].map(ticketDiagram)}</div> : <div role="img" aria-label={`${pattern.title}: ${note}`}>{ticketDiagram(0)}</div>}
            <h3>{pattern.title}</h3><p>{pattern.description}</p><small className="fest-pattern-card__note">{note}</small>
          </article>;
        })}</div>
      </section>

      <section className="fest-themes-section fest-section" aria-labelledby="themes-title">
        <div className="fest-section-heading"><p className="fest-eyebrow">A FESTIVAL FOR EVERY KIND OF GAME NIGHT</p><h2 id="themes-title" className="fest-display">Choose your celebration</h2><p>Explore the visual collection. Only reviewed themes in the live library are available to preview; new festival designs may still be under review.</p></div>
        <div className="fest-theme-grid">{FESTIVAL_MOODBOARD.map((theme) => <article className={`fest-theme-card fest-theme-card--${theme.tone}`} key={theme.id}><div className="fest-theme-card__art" aria-hidden="true"><ThemeArtwork themeId={theme.id} /><span className="fest-theme-card__shine" /></div><div className="fest-theme-card__copy"><h3>{theme.title}</h3><p>{theme.note}</p><span className="fest-theme-card__status">Festival lookbook</span></div></article>)}</div>
        <div className="fest-center-action"><Link className="fest-button fest-button--pink" to="/themes">Open the reviewed theme library <span aria-hidden="true">↗</span></Link></div>
      </section>

      <section className="fest-specials fest-section" aria-labelledby="specials-title">
        <div className="fest-specials__copy"><p className="fest-eyebrow">FROM LIGHTS TO COLOUR</p><h2 id="specials-title" className="fest-display">Bring your festival to the table</h2><p>Diwali diyas, Holi colour, Navratri mirrorwork, Durga Puja vermilion and winter celebrations each bring their own mood to Tambola.</p><Link className="fest-text-link" to="/themes">See reviewed looks in the theme library <span aria-hidden="true">→</span></Link></div>
        <div className="fest-specials__collage" aria-label="Festival theme illustration preview">{FESTIVAL_MOODBOARD.slice(0, 4).map((theme) => <div className={`fest-special-tile fest-special-tile--${theme.tone}`} key={theme.id}><ThemeArtwork themeId={theme.id} /><span>{theme.title}</span></div>)}</div>
      </section>

      <section className="fest-upcoming fest-section" id="upcoming-games" aria-labelledby="upcoming-title"><div className="fest-section-heading"><p className="fest-eyebrow">PUBLISHED BY GAME HALLS</p><h2 id="upcoming-title" className="fest-display">Upcoming games</h2><p>Only sessions published by a hall appear here. Availability and booking details come from the session listing.</p></div><UpcomingSessions /></section>

      <section className="fest-live fest-section" aria-labelledby="live-title"><div className="fest-live__ball" aria-hidden="true"><span>90</span></div><div className="fest-live__copy"><p className="fest-eyebrow"><span className="fest-live-dot" /> REAL ROOMS · PRIVATE INVITES</p><h2 id="live-title" className="fest-display">The live call belongs to your room</h2><p>Room codes are shared by hosts and aren’t published on the landing page. Join a room with your code to see its official call, history, ticket and claims.</p><Link className="fest-button fest-button--gold" to="/player">Enter a room code <span aria-hidden="true">→</span></Link></div></section>

      <section className="fest-ticket-section fest-section" aria-labelledby="ticket-title"><div className="fest-ticket-section__copy"><p className="fest-eyebrow">PAPER-LIGHT · NUMBER-READY</p><h2 id="ticket-title" className="fest-display">Your ticket, dressed for the occasion</h2><p>Every ticket stays clear and readable while festival accents add a little personality. The sample is decorative; your actual ticket is assigned in the game room.</p><Link className="fest-text-link" to="/player">Join a game to get a ticket <span aria-hidden="true">→</span></Link></div><TicketPreview /></section>

      <section className="fest-winners fest-section" aria-labelledby="winners-title"><div className="fest-winners__ornament" aria-hidden="true">✹</div><div className="fest-winners__copy"><p className="fest-eyebrow">A CHEER FOR EVERY CLAIM</p><h2 id="winners-title" className="fest-display">Celebrate the moment, together</h2><p>Pattern claims and awards are verified by the server in each room. The public page doesn’t publish winner names or prize totals; this platform is free to play and has no cash prizes.</p><div className="fest-winners__badges"><span>Server-checked claims</span><span>Room-specific patterns</span><span>Free to play</span></div><Link className="fest-text-link" to="/host">Open a room for your group <span aria-hidden="true">→</span></Link></div></section>

      <section className="fest-voice fest-section" aria-labelledby="voice-title"><div className="fest-voice__icon" aria-hidden="true"><span>♫</span><i /><i /><i /></div><div className="fest-voice__copy"><p className="fest-eyebrow">CALLS WITH A LITTLE CHARACTER</p><h2 id="voice-title" className="fest-display">Hear the numbers your way</h2><p>Hosts can choose English or Hindi, browser voices and a calling style in the caller console. Voice depends on the device and browser; calls remain visible on screen.</p><div className="fest-voice__chips"><span>English</span><span>Hindi</span><span>Optional speech</span><span>Visible call history</span></div><Link className="fest-text-link" to="/host">Explore host controls <span aria-hidden="true">→</span></Link></div></section>

      <section className="fest-faq fest-section" id="faq" aria-labelledby="faq-title"><div className="fest-section-heading"><p className="fest-eyebrow">A FEW THINGS TO KNOW</p><h2 id="faq-title" className="fest-display">Frequently asked questions</h2><p>Good game nights start with clear rules.</p></div><div className="fest-faq-list">
        <details><summary>Is Tambola free to play?</summary><p>Yes. The platform is free to play. It does not offer purchases, wagers or cash prizes.</p></details>
        <details><summary>How do I join a live room?</summary><p>Open Enter a room, add your name and the code shared by the host. Your room controls what happens next.</p><p><Link to="/player">Go to room entry →</Link></p></details>
        <details><summary>Can I book a seat in advance?</summary><p>When a hall publishes a bookable session, its page lists the time and availability. A reservation is confirmed by the booking flow.</p><p><Link to="/games">Find a published session →</Link></p></details>
        <details><summary>How are wins checked?</summary><p>The server validates a claim against the official calls and that player’s ticket. Hosts can configure room patterns before play.</p></details>
        <details><summary>Can I host a private game?</summary><p>Yes. Create a room and share its code with your group. The public directory does not reveal private room codes.</p><p><Link to="/host">Start hosting →</Link></p></details>
        <details><summary>Will voice calling work on my device?</summary><p>Hosts may use supported browser speech voices in English or Hindi. Available voices differ by device; the visible number board and call history remain available.</p></details>
      </div></section>

      <section className="fest-final-cta" aria-labelledby="final-cta-title"><div className="fest-final-cta__lights" aria-hidden="true" /><p className="fest-eyebrow">YOUR PEOPLE ARE ONE CALL AWAY</p><h2 className="fest-display" id="final-cta-title">Make tonight a game night</h2><p>Find a hall, book a published session or invite your friends to your room.</p><div className="fest-final-cta__actions"><Link className="fest-button fest-button--play" to="/games">Play Now <span aria-hidden="true">✦</span></Link><Link className="fest-button fest-button--outline" to="/host">Host a Game</Link></div></section>
    </main>
    <footer className="fest-footer"><div className="fest-footer__brand"><span className="fest-footer__diya" aria-hidden="true">✺</span><span className="fest-display">{brand.name}</span><span>{brand.mark}</span></div><p>{brand.footerNotice}</p>{links.length ? <nav aria-label="Legal and support links">{links.map((link) => <a key={link.key} href={link.href} target="_blank" rel="noreferrer noopener">{link.label}</a>)}</nav> : null}<a className="fest-footer__top" href="#main-content">Back to the lights ↑</a></footer>
  </div>;
}

export default Landing;
