import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Header from "./Header.jsx";
import BookingLanguageSelect from "./i18n/BookingLanguageSelect.jsx";
import { bookingCopy, formatBookingDate, formatBookingNumber, setBookingLanguage, useBookingLanguage } from "./i18n/booking-locale.js";
import "./booking.css";

export default function PublicSessions() {
  const { slug = "" } = useParams();
  const [sessions, setSessions] = useState([]);
  const [state, setState] = useState("loading");
  const language = useBookingLanguage();

  useEffect(() => {
    const abort = new AbortController();
    fetch(`/api/public/instances/${encodeURIComponent(slug)}/sessions`, {
      signal: abort.signal, headers: { Accept: "application/json" }, cache: "no-store",
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok || !Array.isArray(data.sessions)) throw new Error("Sessions are unavailable.");
      return data.sessions;
    }).then((rows) => {
      setSessions(rows);
      setState("ready");
    }).catch((error) => {
      if (error.name !== "AbortError") setState("error");
    });
    return () => abort.abort();
  }, [slug]);

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
            {sessions.map((session) => (
              <article className="booking-session" key={session.sessionId}>
                <div className="booking-session__topline">
                  <span className="booking-session__badge">{bookingCopy(language, "freePlay")}</span>
                  <span className="booking-session__availability">{Math.max(0, Number(session.available) || 0) ? bookingCopy(language, "ticketsOpen", { count: formatBookingNumber(Math.max(0, Number(session.available) || 0), language) }) : bookingCopy(language, "soldOut")}</span>
                </div>
                <h2>{session.title}</h2>
                <dl className="booking-session__facts">
                  <div><dt>{bookingCopy(language, "starts")}</dt><dd>{formatBookingDate(session.startsAt, language)}</dd></div>
                  <div><dt>{bookingCopy(language, "bookingCloses")}</dt><dd>{formatBookingDate(session.bookingClosesAt, language)}</dd></div>
                  <div><dt>{bookingCopy(language, "ticketsAvailable")}</dt><dd>{formatBookingNumber(Math.max(0, Number(session.available) || 0), language)} / {formatBookingNumber(Number(session.capacity) || 0, language)}</dd></div>
                </dl>
                <p className="booking-timezone-note">{bookingCopy(language, "localTime")}</p>
                {Number(session.available) > 0 ? <Link className="public-link-button public-link-button--primary" to={`/sessions/${encodeURIComponent(session.sessionId)}?instance=${encodeURIComponent(slug)}`}>
                  {bookingCopy(language, "reserveTickets")} <span aria-hidden="true">→</span>
                </Link> : <button className="public-link-button" disabled type="button">{bookingCopy(language, "noCapacity")}</button>}
              </article>
            ))}
          </div>
        ) : null}
        <p className="booking-legal">{bookingCopy(language, "sessionLegal")}</p>
      </main>
      <footer className="public-footer">{bookingCopy(language, "footer")}</footer>
    </div>
  );
}
