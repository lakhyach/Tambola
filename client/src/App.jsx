import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Header from "./Header";
import GameJourney from "./components/GameJourney.jsx";
import { usePlatformBranding } from "./platform-branding.js";
import { PATTERN_CATALOG, PATTERN_TICKET, getPatternDisplayCells, getPatternDisplayNote } from "./pattern-display.js";
import "./landing-festival.css";
import "./themes-public.css";

const LINK_LABELS = [["terms", "Terms"], ["privacy", "Privacy"], ["support", "Support"]];

const formatSessionDate = (value, timeZone) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", ...(timeZone ? { timeZone } : {}) }).format(date);
};

function countdownTarget(session, now) {
  const opens = Date.parse(session.bookingOpensAt);
  const closes = Date.parse(session.bookingClosesAt);
  const starts = Date.parse(session.startsAt);
  if (session.gameStatus === "live") return { label: "Live now", remaining: null };
  if (session.gameStatus === "starting") return { label: "Starting now", remaining: null };
  if (session.gameStatus === "waiting") return { label: "Waiting for the game to start", remaining: null };
  if (session.gameStatus === "completed") return { label: "Game completed", remaining: null };
  if (session.status === "paused") return { label: "Bookings paused", remaining: null };
  if (opens > now) return { label: "Bookings open in", remaining: opens - now };
  if (closes > now && session.bookingStatus === "open") return { label: "Bookings close in", remaining: closes - now };
  if (starts > now) return { label: "Game starts in", remaining: starts - now };
  return { label: "Session unavailable", remaining: null };
}

function formatRemaining(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "00:00:00";
  const seconds = Math.floor(milliseconds / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return days ? `${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m` : `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function UpcomingSessions() {
  const [sessions, setSessions] = useState([]);
  const [status, setStatus] = useState("loading");
  const [now, setNow] = useState(Date.now());
  const serverOffset = useRef(0);

  useEffect(() => {
    const abort = new AbortController();
    const headers = { Accept: "application/json" };
    let active = true;
    async function load() {
      const hallResponse = await fetch("/api/admin/public/instances", { signal: abort.signal, headers, cache: "no-store" });
      const hallData = await hallResponse.json().catch(() => ({}));
      if (!hallResponse.ok || !hallData.ok || !Array.isArray(hallData.instances)) throw new Error("Game halls unavailable");
      const groups = await Promise.all(hallData.instances.map(async (hall) => {
        const response = await fetch(`/api/public/instances/${encodeURIComponent(hall.slug)}/sessions`, { signal: abort.signal, headers, cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok || !Array.isArray(data.sessions)) throw new Error("Published sessions unavailable");
        return data.sessions.map((session) => ({ ...session, hallSlug: hall.slug, hallName: hall.display_name }));
      }));
      if (!active) return;
      const published = groups.flat().sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt)).slice(0, 3);
      const serverTime = Date.parse(published[0]?.serverTime);
      if (Number.isFinite(serverTime)) serverOffset.current = serverTime - Date.now();
      setSessions(published); setStatus("ready");
    }
    const refresh = () => load().catch((error) => { if (active && error.name !== "AbortError") setStatus("unavailable"); });
    refresh();
    const interval = window.setInterval(refresh, 30_000);
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; abort.abort(); window.clearInterval(interval); document.removeEventListener("visibilitychange", visible); };
  }, []);

  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now() + serverOffset.current), 1000); return () => window.clearInterval(timer); }, []);

  return <div className="fest-upcoming__content">
    {status === "loading" ? <p className="fest-state" role="status">Checking published game sessions…</p> : null}
    {status === "unavailable" ? <div className="fest-empty"><p>Published sessions could not be loaded right now.</p><Link className="fest-button fest-button--quiet" to="/games">Browse game halls</Link></div> : null}
    {status === "ready" && sessions.length === 0 ? <article className="fest-announcement" aria-labelledby="fest-announcement-title">
      <div className="fest-announcement__topline"><span className="fest-announcement__seal" aria-hidden="true">90</span><span className="fest-eyebrow">A LITTLE ANTICIPATION, A LOT OF JOY</span><span className="fest-announcement__spark" aria-hidden="true">✦</span></div>
      <h3 id="fest-announcement-title" className="fest-display">Let the Good Times Roll!</h3>
      <p>Your next Tambola night is just around the corner. Stay tuned for upcoming game sessions!</p>
      <Link className="fest-announcement__link" to="/games">Explore our game halls <span aria-hidden="true">→</span></Link>
      <div className="fest-announcement__marquee" aria-hidden="true"><div className="fest-announcement__track">
        {[0, 1].map((copy) => <span className="fest-announcement__group" key={copy}>
          <b>LET THE GOOD TIMES ROLL</b><i>✦</i><b>YOUR NEXT GAME NIGHT AWAITS</b><i>✦</i><b>NUMBERS, FRIENDS &amp; A LITTLE SPARKLE</b><i>✦</i>
        </span>)}
      </div></div>
    </article> : null}
    {status === "ready" && sessions.length > 0 ? <div className="fest-session-grid">{sessions.map((session) => <article className="fest-session-card" key={session.sessionId}>
      {(() => { const countdown = countdownTarget(session, now); return <>
        <span className="fest-session-card__spark" aria-hidden="true">✦</span><p className="fest-eyebrow">{session.hallName} · {session.bookingStatus.replaceAll("_", " ")}</p><h3>{session.title}</h3>
        <p className="fest-session-card__time">{formatSessionDate(session.startsAt, session.timeZone)}</p>
        <p className="fest-session-card__time">Bookings: {formatSessionDate(session.bookingOpensAt, session.timeZone)} – {formatSessionDate(session.bookingClosesAt, session.timeZone)}</p>
        <p className="fest-session-card__free">{Math.max(0, Number(session.available) || 0)} of {Number(session.capacity) || 0} tickets available</p>
        <p className="fest-session-countdown" aria-live="off"><span>{countdown.label}</span>{countdown.remaining == null ? null : <time>{formatRemaining(countdown.remaining)}</time>}</p>
        <Link className="fest-text-link" to={`/sessions/${encodeURIComponent(session.sessionId)}?instance=${encodeURIComponent(session.hallSlug)}`}>{session.bookingStatus === "open" && Number(session.available) > 0 ? "Book tickets" : "View session"} <span aria-hidden="true">→</span></Link>
      </>; })()}
    </article>)}</div> : null}
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
          <p className="fest-eyebrow fest-hero__kicker">YOUR NEXT GAME NIGHT</p>
          <h1 id="festival-hero-title" className="fest-display">{brand.name}</h1>
          <p className="fest-hero__subtitle">A little sparkle. A lot of good company. Your next Tambola night starts here.</p>
          <div className="fest-hero__actions">
            <Link className="fest-button fest-button--play" to="/host"><span aria-hidden="true">✦</span> Host a game</Link>
            <Link className="fest-button fest-button--pink" to="/player">Join a game</Link>
            <Link className="fest-button fest-button--quiet" to="/games">Browse tickets</Link>
          </div>
          <p className="fest-hero__promise"><span>FREE TO PLAY</span><i /> No purchases · No wagers · No cash prizes</p>
        </div>
        <div className="fest-hero__stage" aria-label="Original illustrated host and decorative Tambola number balls">
          <div className="fest-hero__halo" aria-hidden="true" />
          <span className="fest-diya fest-diya--left" aria-hidden="true">✺</span><span className="fest-diya fest-diya--right" aria-hidden="true">✺</span>
          <span className="fest-ball fest-ball--45" aria-hidden="true">45</span>
          <span className="fest-ball fest-ball--11" aria-hidden="true">11</span>
          <span className="fest-ball fest-ball--67" aria-hidden="true">67</span>
          <img className="fest-hero__host" src="/brand/festival-host-illustration-v1.png" alt="Original illustration of a festive Tambola host holding a ticket" width="1312" height="1199" />
          <div className="fest-hero__ticket-mini" aria-hidden="true"><span>YOUR LUCKY TICKET</span>{[7, 18, 24, 42, 13, 31, 56, 72, 5, 38, 61, 89].map((number, index) => <b key={index}>{number}</b>)}</div>
        </div>
        <a className="fest-scroll-cue" href="#choose-your-game">Explore the game night <span aria-hidden="true">↓</span></a>
      </section>

      <section className="fest-section fest-welcome" id="choose-your-game" aria-labelledby="choose-title">
        <div className="fest-section-heading"><p className="fest-eyebrow">ONE GAME NIGHT · MANY WAYS TO PLAY</p><h2 id="choose-title" className="fest-display">Gather round, the numbers are waiting</h2><p>Choose an Owner-published game hall, book a published session, or join with a room code. Every game stays free to play.</p></div>
        <div className="fest-game-types">
          <article className="fest-type-card fest-type-card--regular"><div className="fest-type-card__crest"><img src="/brand/regular-mark.svg" alt="Regular Tambola emblem" width="58" height="58" /></div><p className="fest-eyebrow">THE CLASSIC ROUND</p><h3>Regular Tambola</h3><p>Pick a published game hall or enter the room code shared with you to play the familiar 1–90 game together.</p><Link className="fest-text-link" to="/games">Find a game hall <span aria-hidden="true">→</span></Link></article>
          <article className="fest-type-card fest-type-card--bumper"><div className="fest-type-card__crest"><img src="/brand/bumper-mark.svg" alt="Bumper Tambola emblem" width="58" height="58" /></div><p className="fest-eyebrow">OWNER-PUBLISHED SPECIALS</p><h3>Bumper Tambola</h3><p>Browse published sessions to see each game’s format, time, and seat availability.</p><Link className="fest-text-link" to="/games">Explore published games <span aria-hidden="true">→</span></Link></article>
        </div>
      </section>

      <section className="fest-how fest-section" aria-labelledby="how-title">
        <div className="fest-how__art" aria-hidden="true"><div className="fest-orbit"><span>1</span><span>2</span><span>3</span></div><div className="fest-call-ball">90</div><div className="fest-how__sparkles">✦ <span>✧</span> ✦</div></div>
        <div className="fest-how__copy"><p className="fest-eyebrow">ONE CLEAR PATH · THREE SIMPLE STEPS</p><h2 id="how-title" className="fest-display">Setup. Tickets. Play.</h2><GameJourney current="setup" /><div className="fest-how__actions"><Link className="fest-button fest-button--gold" to="/host">Set up a game <span aria-hidden="true">→</span></Link><Link className="fest-text-link" to="/games">Choose a game hall</Link></div></div>
      </section>

      <section className="fest-pattern-section fest-section" aria-labelledby="patterns-title">
        <div className="fest-section-heading fest-section-heading--center"><p className="fest-eyebrow">EVERY MARK HAS A MOMENT</p><h2 id="patterns-title" className="fest-display">A little pattern, a lot of cheer</h2><p>Supported patterns are shown. Each published game lists the winning patterns active for that session.</p></div>
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

      <section className="fest-upcoming fest-section" id="upcoming-games" aria-labelledby="upcoming-title"><div className="fest-section-heading"><p className="fest-eyebrow">PUBLISHED BY GAME HALLS</p><h2 id="upcoming-title" className="fest-display">Upcoming games</h2><p>Only sessions published by a hall appear here. Availability and booking details come from the session listing.</p></div><UpcomingSessions /></section>

      <section className="fest-live fest-section" aria-labelledby="live-title"><div className="fest-live__ball" aria-hidden="true"><span>90</span></div><div className="fest-live__copy"><p className="fest-eyebrow"><span className="fest-live-dot" /> REAL ROOMS · PRIVATE INVITES</p><h2 id="live-title" className="fest-display">The live call belongs to your room</h2><p>Room codes are shared with invited players. Join with your code to see its official call, history, ticket and claims.</p><Link className="fest-button fest-button--gold" to="/player">Enter a room code <span aria-hidden="true">→</span></Link></div></section>

      <section className="fest-winners fest-section" aria-labelledby="winners-title"><div className="fest-winners__ornament" aria-hidden="true">✹</div><div className="fest-winners__copy"><p className="fest-eyebrow">A CHEER FOR EVERY CLAIM</p><h2 id="winners-title" className="fest-display">Celebrate the moment, together</h2><p>Pattern claims and awards are verified by the server in each room. The public page doesn’t publish winner names or prize totals; this platform is free to play and has no cash prizes.</p><div className="fest-winners__badges"><span>Server-checked claims</span><span>Room-specific patterns</span><span>Free to play</span></div><Link className="fest-text-link" to="/games">Browse published games <span aria-hidden="true">→</span></Link></div></section>

      <section className="fest-voice fest-section" aria-labelledby="voice-title"><div className="fest-voice__icon" aria-hidden="true"><span>♫</span><i /><i /><i /></div><div className="fest-voice__copy"><p className="fest-eyebrow">CALLS WITH A LITTLE CHARACTER</p><h2 id="voice-title" className="fest-display">Hear the numbers your way</h2><p>Published games may include voice calls in English or Hindi. Voice depends on the device and browser; calls remain visible on screen.</p><div className="fest-voice__chips"><span>English</span><span>Hindi</span><span>Optional speech</span><span>Visible call history</span></div></div></section>

      <section className="fest-faq fest-section" id="faq" aria-labelledby="faq-title"><div className="fest-section-heading"><p className="fest-eyebrow">A FEW THINGS TO KNOW</p><h2 id="faq-title" className="fest-display">Frequently asked questions</h2><p>Good game nights start with clear rules.</p></div><div className="fest-faq-list">
        <details><summary>Is Tambola free to play?</summary><p>Yes. The platform is free to play. It does not offer purchases, wagers or cash prizes.</p></details>
        <details><summary>How do I join a live room?</summary><p>Open Enter a room, add your name and the code shared by the host. Your room controls what happens next.</p><p><Link to="/player">Go to room entry →</Link></p></details>
        <details><summary>Can I book a seat in advance?</summary><p>When a hall publishes a bookable session, its page lists the time and availability. A reservation is confirmed by the booking flow.</p><p><Link to="/games">Find a published session →</Link></p></details>
        <details><summary>How are wins checked?</summary><p>The server validates a claim against the official calls and that player’s ticket. Hosts can configure room patterns before play.</p></details>
        <details><summary>How do I get a room code?</summary><p>Join a published game or use a room code shared with you by the game organizer.</p></details>
        <details><summary>Will voice calling work on my device?</summary><p>Hosts may use supported browser speech voices in English or Hindi. Available voices differ by device; the visible number board and call history remain available.</p></details>
      </div></section>

      <section className="fest-final-cta" aria-labelledby="final-cta-title"><div className="fest-final-cta__lights" aria-hidden="true" /><p className="fest-eyebrow">YOUR PEOPLE ARE ONE CALL AWAY</p><h2 className="fest-display" id="final-cta-title">Make tonight a game night</h2><p>Find an Owner-published hall, book a session or join a room with an invitation.</p><div className="fest-final-cta__actions"><Link className="fest-button fest-button--play" to="/games">Play Now <span aria-hidden="true">✦</span></Link><Link className="fest-button fest-button--outline" to="/player">Join a Game</Link></div></section>
    </main>
    <footer className="fest-footer"><div className="fest-footer__brand"><span className="fest-footer__diya" aria-hidden="true">✺</span><span className="fest-display">{brand.name}</span></div><p>{brand.footerNotice}</p>{links.length ? <nav aria-label="Legal and support links">{links.map((link) => <a key={link.key} href={link.href} target="_blank" rel="noreferrer noopener">{link.label}</a>)}</nav> : null}<a className="fest-footer__top" href="#main-content">Back to the lights ↑</a></footer>
  </div>;
}

export default Landing;
