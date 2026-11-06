import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Header from "./Header.jsx";
import BookingLanguageSelect from "./i18n/BookingLanguageSelect.jsx";
import { bookingCopy, formatBookingDate, formatBookingNumber, setBookingLanguage, useBookingLanguage } from "./i18n/booking-locale.js";
import "./booking.css";

export default function PublicSessions() {
  const { slug = "" } = useParams();
  const [sessions, setSessions] = useState([]);
  const [state, setState] = useState("loading");
  const [now, setNow] = useState(Date.now());
  const serverOffset = useRef(0);
  const language = useBookingLanguage();

  useEffect(() => {
    let active = true;
    let pending = false;
    const controllers = new Set();
    const load = async () => {
      if (pending) return;
      pending = true;
      const abort = new AbortController(); controllers.add(abort);
      try {
        const response = await fetch(`/api/public/instances/${encodeURIComponent(slug)}/sessions`, {
          signal: abort.signal, headers: { Accept: "application/json" }, cache: "no-store",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok || !Array.isArray(data.sessions)) throw new Error("Sessions are unavailable.");
        if (!active) return;
        const serverTime = Date.parse(data.sessions[0]?.serverTime);
        if (Number.isFinite(serverTime)) serverOffset.current = serverTime - Date.now();
        setSessions(data.sessions); setState("ready");
      } catch (error) {
        if (active && error.name !== "AbortError") setState("error");
      } finally { pending = false; controllers.delete(abort); }
    };
    load();
    const interval = window.setInterval(load, 30_000);
    const visible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; window.clearInterval(interval); document.removeEventListener("visibilitychange", visible); controllers.forEach((controller) => controller.abort()); };
  }, [slug]);

  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now() + serverOffset.current), 1000); return () => window.clearInterval(timer); }, []);

  const instanceName = sessions[0]?.instanceName;

  return (
    <div className="public-page">
      <Header />
      <main id="main-content" lang={language === "hi" ? "hi" : "en"} tabIndex="-1" className="public-container booking-page">
        <div className="booking-topbar"><Link className="public-back" to={`/games/${encodeURIComponent(slug)}`}>{bookingCopy(language, "allSessions")}</Link><BookingLanguageSelect language={language} onChange={setBookingLanguage} /></div>
        <p className="oh-eyebrow public-kicker">{bookingCopy(language, "upcomingGames")}</p>
        <h1 className="oh-display public-title">{instanceName ? bookingCopy(language, "sessionsTitle", { name: instanceName }) : bookingCopy(language, "findSession")}</h1>
        <p className="public-lede">{bookingCopy(language, "sessionsLede")}</p>

        {state === "loading" ? <p className="booking-notice" role="status">{bookingCopy(language, "loadingSessions")}</p> : null}
        {state === "error" ? <div className="booking-notice booking-notice--error" role="alert"><p>{bookingCopy(language, "sessionsError")}</p><button className="booking-text-button" onClick={() => window.location.reload()} type="button">{bookingCopy(language, "tryAgain")}</button></div> : null}
        {state === "ready" && sessions.length === 0 ? (
          <section className="booking-empty" aria-live="polite">
            <span className="booking-empty__number" aria-hidden="true">90</span>
            <h2>{bookingCopy(language, "noSessions")}</h2>
            <p>{bookingCopy(language, "checkBack")}</p>
            <Link className="public-link-button" to={`/player?instance=${encodeURIComponent(slug)}`}>{bookingCopy(language, "joinWithCode")}</Link>
          </section>
        ) : null}
        {state === "ready" && sessions.length > 0 ? (
          <div className="booking-session-grid">
            {sessions.map((session) => {
              const current = Number.isFinite(now) ? now : Date.now();
              const opens = Date.parse(session.bookingOpensAt); const closes = Date.parse(session.bookingClosesAt); const starts = Date.parse(session.startsAt);
              const bookingOpen = session.status === "open" && opens <= current && closes > current && starts > current && Number(session.available) > 0;
              const bookingLabel = session.status === "paused" ? "Bookings paused" : starts <= current ? "Bookings closed" : opens > current ? "Bookings not open" : closes <= current ? "Bookings closed" : Number(session.available) <= 0 ? "Sold out" : "Bookings open";
              const gameLabel = session.gameStatus === "live" ? "Live" : starts > current ? "Upcoming" : session.gameStatus;
              return <article className="booking-session" key={session.sessionId}>
                <div className="booking-session__topline">
                  <span className="booking-session__badge">{gameLabel} · {bookingLabel}</span>
                  <span className="booking-session__availability">{bookingOpen ? bookingCopy(language, "ticketsOpen", { count: formatBookingNumber(Number(session.available), language) }) : `${formatBookingNumber(Math.max(0, Number(session.available) || 0), language)} available`}</span>
                </div>
                <h2>{session.title}</h2>
                <dl className="booking-session__facts">
                  <div><dt>{bookingCopy(language, "starts")}</dt><dd>{formatBookingDate(session.startsAt, language)}</dd></div>
                  <div><dt>Bookings open</dt><dd>{formatBookingDate(session.bookingOpensAt, language)}</dd></div>
                  <div><dt>{bookingCopy(language, "bookingCloses")}</dt><dd>{formatBookingDate(session.bookingClosesAt, language)}</dd></div>
                  <div><dt>Game status</dt><dd>{session.gameStatus === "live" ? "Live" : session.gameStatus === "upcoming" ? "Upcoming" : session.gameStatus}</dd></div>
                  <div><dt>{bookingCopy(language, "ticketsAvailable")}</dt><dd>{formatBookingNumber(Math.max(0, Number(session.available) || 0), language)} / {formatBookingNumber(Number(session.capacity) || 0, language)}</dd></div>
                </dl>
                <p className="booking-timezone-note">{bookingCopy(language, "localTime")}</p>
                {bookingOpen ? <Link className="public-link-button public-link-button--primary" to={`/sessions/${encodeURIComponent(session.sessionId)}?instance=${encodeURIComponent(slug)}`}>
                  {bookingCopy(language, "reserveTickets")} <span aria-hidden="true">→</span>
                </Link> : <Link className="public-link-button" to={`/sessions/${encodeURIComponent(session.sessionId)}?instance=${encodeURIComponent(slug)}`}>View session</Link>}
              </article>
            })}
          </div>
        ) : null}
        <p className="booking-legal">{bookingCopy(language, "sessionLegal")}</p>
      </main>
      <footer className="public-footer">{bookingCopy(language, "footer")}</footer>
    </div>
  );
}
