import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Header from "./Header.jsx";
import PublicBack from "./components/PublicBack.jsx";
import BookingLanguageSelect from "./i18n/BookingLanguageSelect.jsx";
import TambolaTicket from "./components/TambolaTicket.jsx";
import { bookingCopy, bookingRefusalText, bookingStatus, formatBookingDate, formatBookingNumber, setBookingLanguage, useBookingLanguage } from "./i18n/booking-locale.js";
import "./booking.css";

async function call(path, body, signal, language) {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal,
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(bookingRefusalText(language, { ...data, error: data.error || "That booking action could not be completed." }));
  return data;
}

const inventoryCopy = {
  title: ["Choose numbered tickets", "क्रमांकित टिकट चुनें"],
  intro: ["Browse the full server-issued ticket catalog. Only available tickets can be selected.", "सर्वर द्वारा जारी सभी टिकट देखें। केवल उपलब्ध टिकट चुने जा सकते हैं।"],
  search: ["Search ticket serial", "टिकट क्रमांक खोजें"],
  status: ["Availability", "उपलब्धता"],
  all: ["All statuses", "सभी स्थितियाँ"],
  available: ["Available", "उपलब्ध"],
  reserved: ["Reserved", "आरक्षित"],
  booked: ["Booked", "बुक किया गया"],
  assigned: ["Assigned", "खिलाड़ी को दिया गया"],
  unavailable: ["Unavailable", "उपलब्ध नहीं"],
  showing: ["Showing", "दिखाए जा रहे हैं"],
  of: ["of", "में से"],
  tickets: ["tickets", "टिकट"],
  page: ["Page", "पृष्ठ"],
  previous: ["Previous", "पिछला"],
  next: ["Next", "अगला"],
  select: ["Book Ticket", "टिकट बुक करें"],
  selected: ["Selected tickets", "चुने गए टिकट"],
  none: ["No tickets match these filters.", "इन फ़िल्टरों से कोई टिकट नहीं मिला।"],
  loading: ["Loading ticket catalog…", "टिकट सूची लोड हो रही है…"],
  refresh: ["Refresh availability", "उपलब्धता ताज़ा करें"],
  stale: ["Availability changed. Refresh the catalog, then choose an available ticket and try again.", "उपलब्धता बदल गई है। सूची ताज़ा करें, फिर उपलब्ध टिकट चुनकर दोबारा प्रयास करें।"],
};

function inventoryStatus(status) {
  const value = String(status || "").toLowerCase();
  if (value === "available") return "available";
  if (["reserved", "held", "pending"].includes(value)) return "reserved";
  if (["booked", "confirmed"].includes(value)) return "booked";
  if (value === "assigned") return "assigned";
  return "unavailable";
}

export default function PublicBooking() {
  const { sessionId = "", slug = "" } = useParams();
  const language = useBookingLanguage();
  const t = (key, variables) => bookingCopy(language, key, variables);
  const [session, setSession] = useState(null);
  const [loadState, setLoadState] = useState("loading");
  const [displayName, setDisplayName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [ticketCount, setTicketCount] = useState(1);
  const [hold, setHold] = useState(null);
  const [confirmed, setConfirmed] = useState(null);
  const [reservationId, setReservationId] = useState("");
  const [bookingToken, setBookingToken] = useState("");
  const [found, setFound] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [catalog, setCatalog] = useState(null);
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogStatus, setCatalogStatus] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [selectedTicketIds, setSelectedTicketIds] = useState([]);
  const [bookingMode, setBookingMode] = useState("random");
  const [selectedTicketDetails, setSelectedTicketDetails] = useState({});
  const [clockNow, setClockNow] = useState(Date.now());
  const serverOffset = useRef(0);
  const requestSignal = useRef(null);
  const catalogSequence = useRef(0);
  const reservationIntent = useRef("");
  const focusedSessionId = useRef(sessionId);

  useEffect(() => { const timer = window.setInterval(() => setClockNow(Date.now() + serverOffset.current), 1000); return () => window.clearInterval(timer); }, []);

  useEffect(() => {
    if (focusedSessionId.current !== sessionId) {
      focusedSessionId.current = sessionId;
      document.getElementById("main-content")?.focus({ preventScroll: true });
    }
    const abort = new AbortController();
    requestSignal.current = abort;
    reservationIntent.current = "";
    setSession(null);
    setLoadState("loading");
    setDisplayName("");
    setPhoneNumber("");
    setTicketCount(1);
    setHold(null);
    setConfirmed(null);
    setReservationId("");
    setBookingToken("");
    setFound(null);
    setBusy(false);
    setError("");
    setMessage("");
    setCopied(false);
    setCatalog(null); setCatalogPage(1); setCatalogSearch(""); setCatalogQuery(""); setCatalogStatus(""); setSelectedTicketIds([]); setSelectedTicketDetails({}); setBookingMode("random"); setCatalogError("");
    call(`/api/public/sessions/${encodeURIComponent(sessionId)}`, undefined, abort.signal, language)
      .then((data) => {
        if (!data.session || (slug && data.session.instanceSlug !== slug)) throw new Error("This session is unavailable.");
        const serverTime = Date.parse(data.session.serverTime);
        if (Number.isFinite(serverTime)) serverOffset.current = serverTime - Date.now();
        setSession(data.session);
        setLoadState("ready");
      }).catch((failure) => {
        if (failure.name !== "AbortError") setLoadState("error");
      });
    return () => {
      abort.abort();
      if (requestSignal.current === abort) requestSignal.current = null;
    };
  }, [language, sessionId, slug]);

  const numberedInventory = session?.sessionId === sessionId && (session?.inventoryMode === "numbered" || session?.inventory_mode === "numbered");

  const reloadCatalog = useCallback(async (page = catalogPage, search = catalogQuery, status = catalogStatus) => {
    if (!numberedInventory) return;
    const sequence = ++catalogSequence.current;
    setCatalogLoading(true); setCatalogError("");
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "12" });
      if (search.trim()) params.set("search", search.trim());
      if (status) params.set("status", status);
      const data = await call(`/api/public/sessions/${encodeURIComponent(sessionId)}/tickets?${params}`, undefined, undefined, language);
      if (sequence === catalogSequence.current) setCatalog(data.catalog || data);
    } catch (failure) {
      if (sequence === catalogSequence.current) setCatalogError(failure.message);
    } finally {
      if (sequence === catalogSequence.current) setCatalogLoading(false);
    }
  }, [numberedInventory, catalogPage, catalogQuery, catalogStatus, sessionId, language]);

  useEffect(() => {
    if (numberedInventory) reloadCatalog(catalogPage, catalogQuery, catalogStatus);
    return () => { catalogSequence.current += 1; };
  }, [numberedInventory, reloadCatalog, catalogPage, catalogQuery, catalogStatus]);

  useEffect(() => {
    if (!numberedInventory) return undefined;
    const timer = window.setInterval(() => reloadCatalog(), 8_000);
    return () => window.clearInterval(timer);
  }, [numberedInventory, reloadCatalog]);

  function chooseTicket(ticket) {
    if (bookingMode !== "random" && (!ticket.sheetId || ticket.sheetPosition == null || !Number.isInteger(Number(ticket.sheetPosition)))) return;
    const groupTickets = bookingMode === "random" ? [ticket] : (catalog?.tickets || []).filter((item) => item.sheetId === ticket.sheetId && (bookingMode === "full" || (Number(item.sheetPosition) <= 3) === (Number(ticket.sheetPosition) <= 3)));
    const expected = bookingMode === "full" ? 6 : bookingMode === "half" ? 3 : 1;
    if (groupTickets.length !== expected || groupTickets.some((item) => inventoryStatus(item.status) !== "available")) return;
    const groupIds = groupTickets.map((item) => item.ticketId);
    const selected = groupIds.every((id) => selectedTicketIds.includes(id));
    if (selected) {
      setSelectedTicketIds((current) => current.filter((id) => !groupIds.includes(id)));
      return;
    }
    if (inventoryStatus(ticket.status) !== "available" || busy || reservationIntent.current) return;
    if (selectedTicketIds.length + expected > maxTickets) return;
    setSelectedTicketIds((current) => [...current, ...groupIds]);
    setSelectedTicketDetails((current) => ({ ...current, ...Object.fromEntries(groupTickets.map((item) => [item.ticketId, item])) }));
  }

  async function createHold(event) {
    event.preventDefault();
    const activeRequest = requestSignal.current;
    if (numberedInventory && selectedTicketIds.length === 0) {
      setError(language === "hi" ? "बुकिंग से पहले उपलब्ध टिकट चुनें।" : "Choose at least one available ticket before booking.");
      return;
    }
    setBusy(true); setError(""); setMessage("");
    try {
      if (!reservationIntent.current) {
        const bytes = new Uint8Array(32);
        if (!globalThis.crypto?.getRandomValues) throw new Error("Secure booking is unavailable in this browser. Please try again in a secure browser context.");
        globalThis.crypto.getRandomValues(bytes);
        reservationIntent.current = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      }
      const data = await call(`/api/public/sessions/${encodeURIComponent(sessionId)}/reservations`, {
        displayName: displayName.trim(), ...(activeSession?.phoneLookupEnabled && phoneNumber.trim() ? { phoneNumber: phoneNumber.trim() } : {}), ticketCount: numberedInventory ? selectedTicketIds.length : Number(ticketCount),
        ...(numberedInventory ? { ticketIds: selectedTicketIds, bookingMode } : {}), bookingToken: reservationIntent.current,
      }, activeRequest?.signal, language);
      if (activeRequest !== requestSignal.current) return;
      if (!data.reservation?.bookingToken || !data.reservation?.reservationId) throw new Error("The server did not return a reservation credential. Please try again.");
      setReservationId(data.reservation.reservationId);
      setBookingToken(data.reservation.bookingToken);
      if (data.reservation.status === "held") setHold(data.reservation);
      else setFound(data.reservation);
      if (numberedInventory) await reloadCatalog();
    } catch (failure) { if (activeRequest === requestSignal.current && failure.name !== "AbortError") setError(failure.message); }
    finally { if (activeRequest === requestSignal.current) setBusy(false); }
  }

  async function confirmHold() {
    if (!hold || !bookingToken) return;
    const activeRequest = requestSignal.current;
    setBusy(true); setError(""); setMessage("");
    try {
      const data = await call(`/api/public/reservations/${encodeURIComponent(hold.reservationId)}/confirm`, { bookingToken }, activeRequest?.signal, language);
      if (activeRequest !== requestSignal.current) return;
      setConfirmed(data.reservation || { ...hold, status: "confirmed" });
      setHold(null);
      setFound(null);
      if (numberedInventory) await reloadCatalog();
    } catch (failure) { if (activeRequest === requestSignal.current && failure.name !== "AbortError") setError(failure.message); }
    finally { if (activeRequest === requestSignal.current) setBusy(false); }
  }

  async function cancelHold() {
    if (!hold || !bookingToken) return;
    const activeRequest = requestSignal.current;
    setBusy(true); setError("");
    try {
      const data = await call(`/api/public/reservations/${encodeURIComponent(hold.reservationId)}/cancel`, { bookingToken }, activeRequest?.signal, language);
      if (activeRequest !== requestSignal.current) return;
      setFound((current) => current?.reservationId === hold.reservationId
        ? (data.reservation || { ...current, status: "cancelled" })
        : current);
      setHold(null); setBookingToken(""); reservationIntent.current = ""; setMessage("releasedMessage");
      if (numberedInventory) await reloadCatalog();
    } catch (failure) { if (activeRequest === requestSignal.current && failure.name !== "AbortError") setError(failure.message); }
    finally { if (activeRequest === requestSignal.current) setBusy(false); }
  }

  async function lookup(event) {
    event.preventDefault();
    const activeRequest = requestSignal.current;
    setBusy(true); setError(""); setMessage(""); setFound(null);
    try {
      const data = await call(`/api/public/reservations/${encodeURIComponent(reservationId.trim())}/lookup`, { bookingToken: bookingToken.trim() }, activeRequest?.signal, language);
      if (activeRequest !== requestSignal.current) return;
      if (hold?.reservationId === data.reservation?.reservationId) setHold(null);
      setConfirmed(null);
      setFound(data.reservation || null);
      if (!data.reservation) throw new Error("No booking was found with those details.");
    } catch (failure) { if (activeRequest === requestSignal.current && failure.name !== "AbortError") setError(failure.message); }
    finally { if (activeRequest === requestSignal.current) setBusy(false); }
  }

  async function cancelFound() {
    if (!found || !reservationId.trim() || !bookingToken.trim()) return;
    if (!window.confirm("Cancel this reservation and release its ticket capacity?")) return;
    const activeRequest = requestSignal.current;
    setBusy(true); setError(""); setMessage("");
    try {
      await call(`/api/public/reservations/${encodeURIComponent(reservationId.trim())}/cancel`, { bookingToken: bookingToken.trim() }, activeRequest?.signal, language);
      if (activeRequest !== requestSignal.current) return;
      setFound((current) => current ? { ...current, status: "cancelled" } : current);
      setMessage("cancelledMessage");
      if (numberedInventory) await reloadCatalog();
    } catch (failure) { if (activeRequest === requestSignal.current && failure.name !== "AbortError") setError(failure.message); }
    finally { if (activeRequest === requestSignal.current) setBusy(false); }
  }

  async function cancelConfirmed() {
    if (!confirmed || !bookingToken || !reservationId) return;
    if (!window.confirm("Cancel this reservation and release its ticket capacity?")) return;
    const activeRequest = requestSignal.current;
    setBusy(true); setError(""); setMessage("");
    try {
      const data = await call(`/api/public/reservations/${encodeURIComponent(reservationId)}/cancel`, { bookingToken }, activeRequest?.signal, language);
      if (activeRequest !== requestSignal.current) return;
      setConfirmed(data.reservation || { ...confirmed, status: "cancelled" });
      setMessage("cancelledMessage");
      if (numberedInventory) await reloadCatalog();
    } catch (failure) { if (activeRequest === requestSignal.current && failure.name !== "AbortError") setError(failure.message); }
    finally { if (activeRequest === requestSignal.current) setBusy(false); }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(bookingToken);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Copy was unavailable. Select and copy the booking code manually.");
    }
  }

  const activeSession = session?.sessionId === sessionId ? session : null;
  const bookingOpenNow = Boolean(activeSession && activeSession.status === "open"
    && Date.parse(activeSession.bookingOpensAt) <= clockNow
    && Date.parse(activeSession.bookingClosesAt) > clockNow
    && Date.parse(activeSession.startsAt) > clockNow);
  const sessionCapacity = Math.max(0, Number(activeSession?.ticketCapacity) || Number(activeSession?.ticketLimit) || 0);
  const maxTickets = numberedInventory
    ? Math.min(12, sessionCapacity, Math.max(0, Number(activeSession?.available) || 0))
    : Math.min(sessionCapacity, Math.max(0, Number(activeSession?.available) || 0));
  const copyInventory = (key) => inventoryCopy[key]?.[language === "hi" ? 1 : 0] || inventoryCopy[key]?.[0] || key;
  const reservationTicketRows = (reservation) => {
    const explicit = reservation?.tickets || reservation?.selectedTickets || reservation?.ticketSerials;
    if (Array.isArray(explicit) && explicit.length) return explicit;
    if (reservation?.reservationId && [hold?.reservationId, confirmed?.reservationId].includes(reservation.reservationId)) {
      return selectedTicketIds.map((id) => selectedTicketDetails[id]).filter(Boolean);
    }
    return [];
  };
  const ticketLabel = (ticket) => typeof ticket === "string" ? ticket : ticket.serial || ticket.ticketId;

  return (
    <div className="public-page">
      <Header />
      <main id="main-content" lang={language === "hi" ? "hi" : "en"} tabIndex="-1" className="public-container booking-page">
        <div className="booking-topbar"><PublicBack to={activeSession ? `/games/${encodeURIComponent(activeSession.instanceSlug)}/sessions` : "/games"}>← {t("allSessions")}</PublicBack><BookingLanguageSelect language={language} onChange={setBookingLanguage} /></div>
        {loadState === "loading" || (loadState === "ready" && !activeSession) ? <p className="booking-notice" role="status">{t("loadingSession")}</p> : null}
        {loadState === "error" ? (
          <section className="booking-empty" role="alert">
            <p className="oh-eyebrow">{t("unavailable")}</p><h1>{t("sessionUnavailable")}</h1>
            <p>{t("sessionUnavailableHelp")}</p><Link className="public-link-button" to="/games">{t("returnHalls")}</Link>
            <button className="booking-text-button" onClick={() => window.location.reload()} type="button">{t("tryAgain")}</button>
          </section>
        ) : null}

        {loadState === "ready" && activeSession ? (
          <>
            <p className="oh-eyebrow public-kicker">{t("freeBooking")} · {activeSession.instanceName}</p>
            <h1 className="oh-display public-title booking-heading">{activeSession.title}</h1>
            <p className="booking-timezone-note">{t("localTime")}</p>
            <div className="booking-detail-grid">
              <section className="booking-panel booking-panel--session" aria-labelledby="session-facts-title">
                <p className="booking-session__badge">{t("noPayment")}</p>
                <h2 id="session-facts-title">{t("sessionDetails")}</h2>
                <dl className="booking-session__facts">
                  <div><dt>{t("starts")}</dt><dd>{formatBookingDate(activeSession.startsAt, language)}</dd></div>
                  <div><dt>Bookings open</dt><dd>{formatBookingDate(activeSession.bookingOpensAt, language)}</dd></div>
                  <div><dt>{t("bookingCloses")}</dt><dd>{formatBookingDate(activeSession.bookingClosesAt, language)}</dd></div>
                  <div><dt>{t("ticketsAvailable")}</dt><dd>{formatBookingNumber(Math.max(0, Number(activeSession.available) || 0), language)} / {formatBookingNumber(Number(activeSession.capacity) || 0, language)}</dd></div>
                </dl>
                <div className="booking-actions"><button className="public-link-button" type="button" onClick={async () => { const gameLink = new URL(`/games/${encodeURIComponent(activeSession.instanceSlug)}/sessions/${encodeURIComponent(activeSession.sessionId)}`, window.location.origin).href; try { await navigator.clipboard.writeText(gameLink); setMessage("Shareable game link copied."); } catch { setMessage(gameLink); } }}>Copy branded game link</button></div>
                {(activeSession.contacts?.hostName || activeSession.contacts?.hostPhone || activeSession.contacts?.hostWhatsapp || activeSession.contacts?.hostEmail || activeSession.contacts?.agents?.length) ? <aside className="booking-result"><h3>Contact host / agents</h3>
                  {activeSession.contacts.hostName ? <p>{activeSession.contacts.hostName}</p> : null}
                  <div className="booking-actions">{activeSession.contacts.hostPhone ? <a className="public-link-button" href={`tel:${encodeURIComponent(activeSession.contacts.hostPhone)}`}>Call host</a> : null}{activeSession.contacts.hostWhatsapp ? <a className="public-link-button" href={`https://wa.me/${activeSession.contacts.hostWhatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">WhatsApp host</a> : null}{activeSession.contacts.hostEmail ? <a className="public-link-button" href={`mailto:${encodeURIComponent(activeSession.contacts.hostEmail)}`}>Email host</a> : null}</div>
                  {activeSession.contacts.agents?.map((agent) => <p key={`${agent.name}-${agent.phone}`}>Agent {agent.name} · <a href={`tel:${encodeURIComponent(agent.phone)}`}>Call {agent.name}</a></p>)}
                </aside> : null}
                <p className="booking-hint">{t("bookingHint")}</p>
                {Number(activeSession.available) < 1 ? <p className="booking-alert" role="status">{t("full")}</p> : null}
                {!bookingOpenNow && Number(activeSession.available) > 0 ? <p className="booking-notice" role="status">{activeSession.status === "paused" ? "Bookings are paused by the game organizer." : Date.parse(activeSession.bookingOpensAt) > clockNow ? "Bookings have not opened yet." : "The booking window is closed."}</p> : null}
              </section>

              <section className="booking-panel" aria-labelledby="reserve-title">
                <p className="oh-eyebrow">{t("reservePlace")}</p>
                <h2 id="reserve-title">{t("chooseTickets")}</h2>
                {numberedInventory ? <section className="booking-catalog" aria-labelledby="ticket-catalog-title">
                  <div className="booking-catalog__head"><h3 id="ticket-catalog-title">{copyInventory("title")}</h3><p>{copyInventory("intro")}</p></div>
                  <label className="booking-field">Booking style
                    <select value={bookingMode} disabled={Boolean(reservationIntent.current)} onChange={(event) => { setBookingMode(event.target.value); setSelectedTicketIds([]); setSelectedTicketDetails({}); }}>
                      <option value="random">Random · choose individual tickets</option>
                      <option value="half">Half-sheet · 3 consecutive tickets</option>
                      <option value="full">Full-sheet · 6 consecutive tickets</option>
                    </select>
                  </label>
                  <form className="booking-catalog__filters" onSubmit={(event) => { event.preventDefault(); setCatalogQuery(catalogSearch.trim()); setCatalogPage(1); }}>
                    <label>{copyInventory("search")}<input value={catalogSearch} maxLength={40} onChange={(event) => setCatalogSearch(event.target.value)} /></label>
                    <label>{copyInventory("status")}<select value={catalogStatus} onChange={(event) => { setCatalogStatus(event.target.value); setCatalogPage(1); }}>
                      <option value="">{copyInventory("all")}</option><option value="available">{copyInventory("available")}</option><option value="reserved">{copyInventory("reserved")}</option><option value="booked">{copyInventory("booked")}</option><option value="assigned">{copyInventory("assigned")}</option>
                    </select></label>
                    <button className="public-link-button" type="submit">{copyInventory("search")}</button>
                  </form>
                  {catalogLoading && !catalog ? <p className="booking-notice" role="status">{copyInventory("loading")}</p> : null}
                  {catalogError ? <div className="booking-alert" role="alert">{catalogError}<button className="booking-text-button" type="button" onClick={() => reloadCatalog()}>{copyInventory("refresh")}</button></div> : null}
                  {catalog && <>
                    <p className="booking-catalog__count" role="status">{copyInventory("showing")} {catalog.tickets.length ? (catalog.page - 1) * catalog.pageSize + 1 : 0}–{Math.min(catalog.page * catalog.pageSize, catalog.total)} {copyInventory("of")} {Number(catalog.total).toLocaleString()} {copyInventory("tickets")} · {Number(catalog.inventoryTotal).toLocaleString()} {copyInventory("tickets")}</p>
                    {!catalog.tickets.length ? <p className="booking-empty-inline">{copyInventory("none")}</p> : <ul className="booking-ticket-catalog">
                      {catalog.tickets.map((ticket) => {
                        const modeIds = bookingMode === "random" ? [ticket.ticketId] : (catalog.tickets || []).filter((item) => item.sheetId === ticket.sheetId && (bookingMode === "full" || (Number(item.sheetPosition) <= 3) === (Number(ticket.sheetPosition) <= 3))).map((item) => item.ticketId);
                        const selected = modeIds.length > 0 && modeIds.every((id) => selectedTicketIds.includes(id));
                        const requiredCount = bookingMode === "full" ? 6 : bookingMode === "half" ? 3 : 1;
                        const validBundle = bookingMode === "random" ? statusKey === "available" : Boolean(ticket.sheetId) && ticket.sheetPosition != null && modeIds.length === requiredCount && (catalog.tickets || []).filter((item) => modeIds.includes(item.ticketId)).every((item) => item.sheetPosition != null && Number.isInteger(Number(item.sheetPosition)) && inventoryStatus(item.status) === "available");
                        const statusKey = inventoryStatus(ticket.status);
                        return <li key={ticket.ticketId} className="booking-ticket-item" data-status={statusKey} data-selected={String(selected)}>
                          <div className="booking-ticket-card-head"><div className="booking-ticket-item__identity"><strong>{ticket.serial}</strong><span className="booking-ticket-status" data-status={statusKey}>{copyInventory(statusKey)}</span>{ticket.playerName ? <small>{ticket.playerName}</small> : null}</div>
                            <button className="booking-ticket-select" type="button" disabled={busy || Boolean(reservationIntent.current) || (!selected && (!validBundle || statusKey !== "available" || selectedTicketIds.length + requiredCount > maxTickets))} aria-pressed={selected} onClick={() => chooseTicket(ticket)}>{selected ? (language === "hi" ? "चुना गया" : "Selected bundle") : statusKey === "available" ? (validBundle ? copyInventory("select") : "Bundle unavailable") : copyInventory(statusKey)}</button>
                          </div>
                          <div className="booking-ticket-actual"><TambolaTicket ticket={ticket.grid} ticketNo={ticket.serial} language={language} /></div>
                        </li>;
                      })}
                    </ul>}
                    <div className="booking-catalog-pager" aria-label="Ticket catalog pages">
                      <button className="booking-text-button" type="button" disabled={catalogLoading || catalog.page <= 1} onClick={() => setCatalogPage((page) => Math.max(1, page - 1))}>{copyInventory("previous")}</button>
                      <span>{copyInventory("page")} {catalog.page} {copyInventory("of")} {Math.max(1, catalog.pageCount)}</span>
                      <button className="booking-text-button" type="button" disabled={catalogLoading || catalog.page >= catalog.pageCount} onClick={() => setCatalogPage((page) => page + 1)}>{copyInventory("next")}</button>
                    </div>
                  </>}
                  <div className="booking-ticket-selection" aria-live="polite">
                    <strong>{copyInventory("selected")}: {selectedTicketIds.length}/{maxTickets}</strong>
                    {selectedTicketIds.length ? <ul>{selectedTicketIds.map((id) => <li key={id}>{selectedTicketDetails[id]?.serial || id}</li>)}</ul> : null}
                  </div>
                </section> : null}
                {!hold && !confirmed && bookingOpenNow ? (
                  <form className="booking-form" onSubmit={createHold}>
                    <label className="booking-field">{t("playerName")}
                    <input autoComplete="nickname" maxLength={20} minLength={3} required disabled={Boolean(reservationIntent.current)} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
                    </label>
                    {activeSession.phoneLookupEnabled ? <label className="booking-field">Phone number for live ticket lookup (optional)
                      <input type="tel" inputMode="tel" autoComplete="tel" maxLength={24} placeholder="+919876543210" disabled={Boolean(reservationIntent.current)} value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} />
                      <span className="booking-hint">Enter country code. We store a protected lookup digest, never display your number, and only use it to find your confirmed ticket in this live game.</span>
                    </label> : null}
                    {!numberedInventory ? <label className="booking-field">{t("ticketCount")}
                      <input type="number" inputMode="numeric" min="1" max={maxTickets} step="1" required disabled={Boolean(reservationIntent.current)} value={ticketCount} onChange={(event) => setTicketCount(event.target.value)} />
                    </label> : <p className="booking-hint">{copyInventory("selected")}: {selectedTicketIds.length} / {maxTickets}</p>}
                    <p className="booking-hint">Maximum for this session: {formatBookingNumber(maxTickets, language)} tickets, based on remaining capacity.</p>
                    <button className="public-link-button public-link-button--primary booking-submit" disabled={busy || !Number(activeSession.available) || (numberedInventory && selectedTicketIds.length === 0)} type="submit">
                      {busy ? t("creatingHold") : t("holdTickets")}
                    </button>
                    <p className="booking-hint">{t("holdDuration")}</p>
                    {error && reservationIntent.current ? <button className="booking-text-button" onClick={() => { reservationIntent.current = ""; setError(""); if (numberedInventory) reloadCatalog(); }} type="button">{numberedInventory ? copyInventory("stale") : t("newRequest")}</button> : null}
                  </form>
                ) : null}

                {hold ? (
                  <div className="booking-result" role="status">
                    <h3>{t("heldForYou")}</h3>
                    <p>{t("heldUntil", { count: formatBookingNumber(hold.ticketCount, language), tickets: t(hold.ticketCount === 1 ? "ticket" : "tickets"), verb: t(hold.ticketCount === 1 ? "is" : "are") })} <strong>{formatBookingDate(hold.expiresAt, language)}</strong>.</p>
                    {reservationTicketRows(hold).length ? <p className="booking-ticket-reference"><strong>Ticket serials:</strong> {reservationTicketRows(hold).map(ticketLabel).join(", ")}</p> : null}
                    <div className="booking-actions">
                      <button className="public-link-button public-link-button--primary" disabled={busy} onClick={confirmHold} type="button">{busy ? t("confirming") : t("confirmReservation")}</button>
                      <button className="booking-text-button" disabled={busy} onClick={cancelHold} type="button">{t("releaseHold")}</button>
                    </div>
                    <p className="booking-hint">{t("expiryHint")}</p>
                  </div>
                ) : null}

                {found && !hold && !confirmed && reservationId === found.reservationId ? (
                  <div className="booking-result" role="status">
                    <h3>{t("alreadyProcessed")}</h3>
                    <p>{t("currentStatus", { status: bookingStatus(language, found.status) })}</p>
                  </div>
                ) : null}

                {confirmed ? (
                  <div className="booking-result" role="status">
                    <h3>{t("confirmed")}</h3>
                    <p>{t("confirmedCopy", { count: formatBookingNumber(confirmed.ticketCount, language), tickets: t(confirmed.ticketCount === 1 ? "ticket" : "tickets") })}</p>
                    {reservationTicketRows(confirmed).length ? <div className="booking-ticket-reference"><strong>Assigned ticket serials</strong><ul>{reservationTicketRows(confirmed).map((ticket) => <li key={ticketLabel(ticket)}>{ticketLabel(ticket)}</li>)}</ul></div> : null}
                    <label className="booking-field">{t("privateCode")}
                      <span className="booking-code-row"><input aria-label={t("privateCode")} readOnly value={bookingToken} /><button className="booking-copy" onClick={copyCode} type="button">{copied ? t("copied") : t("copy")}</button></span>
                    </label>
                    <p className="booking-code-warning"><strong>{t("saveCode")}</strong></p>
                    <p className="booking-reference">{t("bookingReference")}: <code>{confirmed.reservationId}</code></p>
                    {confirmed.session?.roomCode ? <div className="booking-join-next"><p>{t("assignedCopy")}</p><Link className="public-link-button public-link-button--primary" to={`/player?instance=${encodeURIComponent(confirmed.session.instanceSlug)}&room=${encodeURIComponent(confirmed.session.roomCode)}`}>{t("joinGame")}</Link></div> : <p className="booking-hint">{t("roomAssignedLater")}</p>}
                    {confirmed.status === "confirmed" ? <button className="booking-text-button" disabled={busy} onClick={cancelConfirmed} type="button">{t("cancelReservation")}</button> : null}
                  </div>
                ) : null}
              </section>
            </div>

            <section className="booking-panel booking-manage" aria-labelledby="manage-title">
              <p className="oh-eyebrow">{t("alreadyBooked")}</p>
              <h2 id="manage-title">{t("lookupTitle")}</h2>
              <form className="booking-form booking-form--manage" onSubmit={lookup}>
                <label className="booking-field">{t("bookingReference")}
                  <input autoComplete="off" maxLength={80} required value={reservationId} onChange={(event) => setReservationId(event.target.value)} />
                </label>
                <label className="booking-field">{t("privateBookingCode")}
                  <input autoComplete="off" maxLength={128} required type="password" value={bookingToken} onChange={(event) => setBookingToken(event.target.value)} />
                </label>
                <button className="public-link-button" disabled={busy} type="submit">{busy ? t("lookingUp") : t("findBooking")}</button>
              </form>
              {found ? (
                <div className="booking-result booking-result--lookup" aria-live="polite">
                  <h3>{t("reservation", { status: bookingStatus(language, found.status) })}</h3>
                  <p>{formatBookingNumber(found.ticketCount, language)} {t(found.ticketCount === 1 ? "ticket" : "tickets")} · {found.session?.title || session.title}</p>
                  {reservationTicketRows(found).length ? <div className="booking-ticket-reference"><strong>{language === "hi" ? "टिकट क्रमांक" : "Ticket serials"}</strong><ul>{reservationTicketRows(found).map((ticket) => <li key={ticketLabel(ticket)}>{ticketLabel(ticket)}</li>)}</ul></div> : null}
                  {found.expiresAt ? <p>{t("holdExpires")} {formatBookingDate(found.expiresAt, language)}</p> : null}
                  {found.status === "confirmed" && found.session?.roomCode ? <Link className="public-link-button public-link-button--primary" to={`/player?instance=${encodeURIComponent(found.session.instanceSlug)}&room=${encodeURIComponent(found.session.roomCode)}`}>{t("joinGame")}</Link> : null}
                  {found.status === "confirmed" ? <button className="booking-text-button" disabled={busy} onClick={cancelFound} type="button">{t("cancelReservation")}</button> : null}
                </div>
              ) : null}
            </section>
          </>
        ) : null}
        {error ? <p className="booking-alert" role="alert">{error}</p> : null}
        {message ? <p className="booking-notice" role="status">{message.startsWith("cancelled") || message === "releasedMessage" ? t(message) : message}</p> : null}
      </main>
      <footer className="public-footer">{t("bookingLegal")}</footer>
    </div>
  );
}
