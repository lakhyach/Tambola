import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Button from "../components/Button.jsx";
import TambolaTicket from "../components/TambolaTicket.jsx";
import "../booking.css";
import { api } from "./api.js";
import { Badge, Empty, ErrorNote, Section, StatusPill, Table } from "./ui.jsx";
import { localInput, toIso, validateSchedule } from "./time-zone.js";
import { PATTERN_META, OPTIONAL_PATTERNS } from "../brand.js";
import { call, on } from "../net.js";

const SESSION_PATTERNS = { ...PATTERN_META, ...Object.fromEntries(OPTIONAL_PATTERNS.map((pattern) => [pattern.id, pattern])) };

function formatDate(value, timeZone) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Invalid date" : new Intl.DateTimeFormat(undefined, timeZone ? { weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone, timeZoneName: "short" } : { dateStyle: "medium", timeStyle: "short" }).format(date);
}

const freshForm = () => {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  start.setSeconds(0, 0);
  const close = new Date(start.getTime() - 10 * 60 * 1000);
  const open = new Date(Date.now() + 5 * 60 * 1000);
  open.setSeconds(0, 0);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return { title: "", startsAt: localInput(start, timeZone), bookingOpensAt: localInput(open, timeZone), bookingClosesAt: localInput(close, timeZone), capacity: "100", roomCode: "", timeZone, autoStartEnabled: false, winningPatterns: Object.fromEntries(Object.entries(SESSION_PATTERNS).map(([id, pattern]) => [id, { enabled: pattern.points > 0 && !["star", "box", "earlySeven", "secondFullHouse", "halfSheet"].includes(id), points: pattern.points }])) };
};
const timezoneChoices = () => [
  "UTC", "Asia/Kolkata", "Asia/Calcutta", "Asia/Dubai", "Asia/Singapore", "Europe/London", "Europe/Paris", "America/New_York", "America/Los_Angeles",
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
];

export default function AdminSessions() {
  const [instances, setInstances] = useState([]);
  const [instanceId, setInstanceId] = useState("");
  const [sessions, setSessions] = useState([]);
  const [form, setForm] = useState(freshForm);
  const [editingId, setEditingId] = useState("");
  const [inventoryCapacityLocked, setInventoryCapacityLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState("");
  const [noticePosterHref, setNoticePosterHref] = useState("");
  const [reservations, setReservations] = useState([]);
  const [reservationStatus, setReservationStatus] = useState("");
  const [reservationSearch, setReservationSearch] = useState("");
  const [reservationBusy, setReservationBusy] = useState(false);
  const [selectedReservation, setSelectedReservation] = useState(null);
  const [inventorySession, setInventorySession] = useState(null);
  const [inventoryPage, setInventoryPage] = useState(1);
  const [inventorySearch, setInventorySearch] = useState("");
  const [inventorySearchInput, setInventorySearchInput] = useState("");
  const [inventoryStatus, setInventoryStatus] = useState("");
  const [inventoryData, setInventoryData] = useState(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [assistedName, setAssistedName] = useState("");
  const [assistedMode, setAssistedMode] = useState("random");
  const [assistedSelection, setAssistedSelection] = useState([]);
  const [assistedResult, setAssistedResult] = useState(null);
  const [assistedBusy, setAssistedBusy] = useState(false);
  const assistedToken = useRef("");
  const [generationTask, setGenerationTask] = useState(null);
  const [generationBusy, setGenerationBusy] = useState(false);
  const inventoryRequest = useRef(0);
  const sessionLoadRequest = useRef(0);
  const selectedInstanceRef = useRef("");
  const sessionCreateRequest = useRef(null);
  const noticeRef = useRef(null);

  const activeInstances = useMemo(() => instances.filter((item) => item.status === "active"), [instances]);
  const { startsAt: scheduleStartsAt, bookingOpensAt: scheduleOpensAt, bookingClosesAt: scheduleClosesAt, timeZone: scheduleTimeZone } = form;
  const scheduleValidation = useMemo(() => validateSchedule({
    startsAt: scheduleStartsAt, bookingOpensAt: scheduleOpensAt, bookingClosesAt: scheduleClosesAt, timeZone: scheduleTimeZone,
  }), [scheduleStartsAt, scheduleOpensAt, scheduleClosesAt, scheduleTimeZone]);

  function scheduleSummary(value) {
    const instant = scheduleValidation.instants[value];
    if (!instant) return "Choose a valid local date and time";
    return new Intl.DateTimeFormat(undefined, {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
      hour: "numeric", minute: "2-digit", timeZone: form.timeZone, timeZoneName: "short",
    }).format(new Date(instant));
  }

  const load = useCallback(async () => {
    const requestId = ++sessionLoadRequest.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api.instances();
      const available = (result.instances || []).filter((item) => item.status === "active");
      const preferred = selectedInstanceRef.current || instanceId;
      const selected = available.some((item) => item.instance_id === preferred) ? preferred : available[0]?.instance_id || "";
      if (requestId !== sessionLoadRequest.current) return;
      selectedInstanceRef.current = selected;
      setInstances(available);
      setInstanceId(selected);
      if (!selected) {
        setSessions([]);
        setReservations([]);
      } else {
        const [rows, booked] = await Promise.all([api.sessions(selected), api.reservations(selected)]);
        if (requestId !== sessionLoadRequest.current || selectedInstanceRef.current !== selected) return;
        setReservations(booked.reservations || []);
        setSessions(rows.sessions || []);
      }
    } catch (err) {
      if (requestId === sessionLoadRequest.current) setError(err);
    } finally {
      if (requestId === sessionLoadRequest.current) setLoading(false);
    }
  }, [instanceId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (notice) noticeRef.current?.focus(); }, [notice]);

  useEffect(() => {
    if (!instanceId) return undefined;
    let active = true;
    let subscribing = false;
    const refreshInventory = async () => {
      try {
        const [sessionRows, bookingRows] = await Promise.all([api.sessions(instanceId), api.reservations(instanceId, { status: reservationStatus, search: reservationSearch })]);
        if (!active) return;
        setSessions(sessionRows.sessions || []);
        setReservations(bookingRows.reservations || []);
        if (inventorySession) {
          const result = await api.sessionTickets(instanceId, inventorySession.sessionId, { page: inventoryPage, pageSize: 24, search: inventorySearch.trim(), status: inventoryStatus });
          if (active) setInventoryData(result.inventory || result);
        }
      } catch (err) { if (active) setError(err); }
    };
    const subscribe = async () => {
      if (subscribing || !active) return;
      subscribing = true;
      try {
        const { ticket } = await api.bookingEventTicket(instanceId);
        if (!active || !ticket) return;
        const result = await call("admin:booking-subscribe", { ticket });
        if (active && result.ok) await refreshInventory();
      } catch (err) { if (active) setError(err); }
      finally { subscribing = false; }
    };
    const stopEvents = on("admin:booking-changed", (event) => {
      if (event?.instanceId === instanceId) refreshInventory();
    });
    const stopConnect = on("connect", subscribe);
    const reconcileTimer = window.setInterval(refreshInventory, 20_000);
    const renewTimer = window.setInterval(subscribe, 60_000);
    subscribe();
    return () => { active = false; window.clearInterval(reconcileTimer); window.clearInterval(renewTimer); stopEvents(); stopConnect(); call("admin:booking-unsubscribe", { instanceId }, 1000); };
  }, [instanceId, inventorySession, inventoryPage, inventorySearch, inventoryStatus, reservationStatus, reservationSearch]);

  const loadInventory = useCallback(async () => {
    if (!instanceId || !inventorySession) return;
    const requestId = ++inventoryRequest.current;
    setInventoryLoading(true);
    setError(null);
    try {
      const response = await api.sessionTickets(instanceId, inventorySession.sessionId, {
        page: inventoryPage, pageSize: 24, search: inventorySearch.trim(), status: inventoryStatus,
      });
      if (requestId !== inventoryRequest.current) return;
      const result = response.inventory || response;
      setInventoryData(result);
    } catch (err) {
      if (requestId === inventoryRequest.current) setError(err);
    } finally {
      if (requestId === inventoryRequest.current) setInventoryLoading(false);
    }
  }, [instanceId, inventorySession, inventoryPage, inventorySearch, inventoryStatus]);

  useEffect(() => { loadInventory(); }, [loadInventory]);

  async function changeInstance(nextId) {
    sessionLoadRequest.current += 1;
    selectedInstanceRef.current = nextId;
    setInstanceId(nextId);
    setEditingId("");
    setInventoryCapacityLocked(false);
    setForm(freshForm());
    setInventorySession(null); setInventoryData(null); setInventorySearch(""); setInventorySearchInput("");
    setLoading(true);
    setError(null);
    setSessions([]);
    setReservations([]);
  }

  async function loadReservations() {
    if (!instanceId) return;
    setReservationBusy(true); setError(null);
    try {
      const result = await api.reservations(instanceId, { status: reservationStatus, search: reservationSearch });
      setReservations(result.reservations || []);
    } catch (err) { setError(err); }
    finally { setReservationBusy(false); }
  }

  async function inspectReservation(reservationId) {
    setReservationBusy(true); setError(null);
    try {
      const result = await api.reservation(instanceId, reservationId);
      setSelectedReservation(result.reservation);
    } catch (err) { setError(err); }
    finally { setReservationBusy(false); }
  }

  async function cancelReservation(reservation) {
    if (!window.confirm(`Cancel this ${reservation.ticketCount}-ticket reservation for ${reservation.displayName}?`)) return;
    setReservationBusy(true); setError(null); setNotice("");
    try {
      await api.cancelReservation(instanceId, reservation.reservationId);
      setNotice("Reservation cancelled and capacity released.");
      const result = await api.reservations(instanceId, { status: reservationStatus, search: reservationSearch });
      setReservations(result.reservations || []);
      if (selectedReservation?.reservationId === reservation.reservationId) {
        const detail = await api.reservation(instanceId, reservation.reservationId);
        setSelectedReservation(detail.reservation);
      }
    } catch (err) { setError(err); }
    finally { setReservationBusy(false); }
  }

  async function create(event) {
    event.preventDefault();
    if (!instanceId) return;
    if (!scheduleValidation.valid) return;
    const capacity = Number(form.capacity);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000) {
      setError(new Error("Capacity must be from 1 to 10,000 tickets."));
      return;
    }
    if (editingId && form.autoStartEnabled && !form.roomCode.trim()) {
      setError(new Error("Choose a waiting room before enabling automatic start."));
      return;
    }
    setBusy(true); setError(null); setNotice("");
    try {
      const winningPatterns = Object.entries(form.winningPatterns).filter(([, item]) => item.enabled).map(([id, item]) => ({ id, points: Number(item.points) }));
      if (!winningPatterns.length || winningPatterns.some((item) => !Number.isInteger(item.points) || item.points < 0 || item.points > 100000)) throw new Error("Select at least one supported winning pattern and enter point values from 0 to 100,000.");
      const roomCode = form.roomCode.trim().toUpperCase() || null;
      // Send the exact wall-clock values the operator entered. The server
      // interprets them in this IANA zone and enforces the instant ordering.
      const payload = { title: form.title.trim(), startsAt: form.startsAt, bookingOpensAt: form.bookingOpensAt, bookingClosesAt: form.bookingClosesAt, capacity, timeZone: form.timeZone, roomCode, autoStartEnabled: Boolean(form.autoStartEnabled), winningPatterns, ...(!editingId ? { inventoryMode: "numbered", createRoom: !roomCode } : {}) };
      if (editingId) await api.updateSession(instanceId, editingId, payload);
      else {
        const requestFingerprint = JSON.stringify({ instanceId, payload });
        let createRequest = sessionCreateRequest.current;
        if (!createRequest || createRequest.fingerprint !== requestFingerprint) {
          const bytes = new Uint8Array(32);
          if (!globalThis.crypto?.getRandomValues) throw new Error("Secure session creation is unavailable in this browser.");
          globalThis.crypto.getRandomValues(bytes);
          createRequest = {
            fingerprint: requestFingerprint,
            idempotencyKey: Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""),
          };
          sessionCreateRequest.current = createRequest;
        }
        const created = await api.createSession(instanceId, { ...payload, idempotencyKey: createRequest.idempotencyKey });
        sessionCreateRequest.current = null;
        const bytes = new Uint8Array(24);
        if (!globalThis.crypto?.getRandomValues) throw new Error("Secure inventory generation is unavailable in this browser.");
        globalThis.crypto.getRandomValues(bytes);
        const idempotencyKey = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
        const session = created.session;
        const task = { instanceId, sessionId: session.sessionId, title: session.title, roomCode: session.roomCode, requestedCount: capacity, idempotencyKey };
        setGenerationTask(task);
        setSessions((current) => [{ ...session, inventoryMode: "numbered" }, ...current.filter((row) => (row.session_id || row.sessionId) !== session.sessionId)]);
        setInventoryData(null); setInventoryPage(1);
        setForm(freshForm()); setEditingId("");
        setNotice(`Session draft created${session.roomCode ? ` · room ${session.roomCode}` : ""}. Generating ${capacity.toLocaleString()} numbered tickets…`);
        await runGeneration(task);
        return;
      }
      setForm(freshForm());
      setNotice(editingId ? "Session details updated." : "Session saved as a draft. Publish it when its details are ready.");
      setEditingId("");
      setInventoryCapacityLocked(false);
      const result = await api.sessions(instanceId);
      setSessions(result.sessions || []);
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  async function runGeneration(task) {
    setGenerationBusy(true); setError(null); setNotice("");
    try {
      const response = await api.generateSessionInventory(task.instanceId, task.sessionId, {
        requestedCount: task.requestedCount, idempotencyKey: task.idempotencyKey,
      });
      const result = response.inventory || response;
      const generatedCount = Number(result.generatedCount);
      if (generatedCount !== task.requestedCount || result.status !== "ready") throw new Error(`The server reported ${Number.isFinite(generatedCount) ? generatedCount : 0} of ${task.requestedCount} tickets (${result.status || "unknown state"}). Inventory is not marked complete.`);
      setGenerationTask(null);
      setNotice(`${task.title}${task.roomCode ? ` · room ${task.roomCode}` : ""}: ${generatedCount.toLocaleString()} of ${task.requestedCount.toLocaleString()} tickets generated and saved.`);
      setInventorySession({ sessionId: task.sessionId, title: task.title });
      const [rows, booked] = await Promise.all([api.sessions(task.instanceId), api.reservations(task.instanceId)]);
      setSessions(rows.sessions || []); setReservations(booked.reservations || []);
    } catch (err) {
      setError(err);
      setGenerationTask(task);
      setNotice("Generation is not yet confirmed. Retry using the same request key; the server will return the committed result if the first request completed.");
    } finally { setGenerationBusy(false); }
  }

  function retrySessionGeneration(session) {
    if (!globalThis.crypto?.getRandomValues) {
      setError(new Error("Secure inventory generation is unavailable in this browser."));
      return;
    }
    const bytes = new Uint8Array(24);
    globalThis.crypto.getRandomValues(bytes);
    const idempotencyKey = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    const task = {
      instanceId,
      sessionId: session.session_id || session.sessionId,
      title: session.title,
      requestedCount: Number(session.capacity || session.ticket_capacity),
      idempotencyKey,
    };
    setGenerationTask(task);
    runGeneration(task);
  }

  function openInventory(session) {
    const id = session.session_id || session.sessionId;
    if (session.inventoryMode !== "numbered" && session.inventory_mode !== "numbered" && session.inventoryTotal == null && session.inventory_total == null) return;
    setInventorySession({ sessionId: id, title: session.title });
    setInventoryPage(1); setInventorySearch(""); setInventorySearchInput(""); setInventoryStatus(""); setInventoryData(null);
    setAssistedSelection([]); setAssistedResult(null); setAssistedName(""); assistedToken.current = "";
  }

  function toggleAssistedTicket(ticket) {
    if (assistedMode !== "random" && (!ticket.sheetId || ticket.sheetPosition == null)) return;
    const tickets = inventoryData?.tickets || [];
    const bundle = assistedMode === "random" ? [ticket] : tickets.filter((item) => item.sheetId === ticket.sheetId && (assistedMode === "full" || (Number(item.sheetPosition) <= 3) === (Number(ticket.sheetPosition) <= 3)));
    const expected = assistedMode === "full" ? 6 : assistedMode === "half" ? 3 : 1;
    if (bundle.length !== expected || bundle.some((item) => item.status !== "available")) return;
    const ids = bundle.map((item) => item.ticketId);
    if (ids.every((id) => assistedSelection.includes(id))) setAssistedSelection((current) => current.filter((id) => !ids.includes(id)));
    else if (assistedSelection.length + expected <= 12) setAssistedSelection((current) => [...current, ...ids]);
  }

  async function submitAssistedBooking(event) {
    event.preventDefault();
    if (!instanceId || !inventorySession || assistedSelection.length === 0) return;
    setAssistedBusy(true); setError(null); setNotice("");
    try {
      if (!assistedToken.current) {
        if (!globalThis.crypto?.getRandomValues) throw new Error("Secure booking is unavailable in this browser.");
        const bytes = new Uint8Array(32); globalThis.crypto.getRandomValues(bytes);
        assistedToken.current = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      }
      const response = await api.bookOnBehalf(instanceId, inventorySession.sessionId, {
        displayName: assistedName.trim(), ticketIds: assistedSelection, ticketCount: assistedSelection.length,
        bookingMode: assistedMode, bookingToken: assistedToken.current,
      });
      setAssistedResult(response.reservation); setNotice("Organizer-assisted booking created. Share the booking reference and recovery token privately with the player.");
      assistedToken.current = ""; setAssistedSelection([]);
      const refreshed = await api.sessionTickets(instanceId, inventorySession.sessionId, { page: inventoryPage, pageSize: 24, search: inventorySearch.trim(), status: inventoryStatus });
      setInventoryData(refreshed.inventory || refreshed);
    } catch (err) { setError(err); }
    finally { setAssistedBusy(false); }
  }

  function editSession(session) {
    setEditingId(session.session_id || session.sessionId);
    setInventoryCapacityLocked((session.inventoryState || session.inventory_state) === "ready");
    setForm({
      title: session.title || "",
      startsAt: localInput(session.starts_at || session.startsAt, session.timeZone || session.time_zone || "UTC"),
      bookingOpensAt: localInput(session.booking_opens_at || session.bookingOpensAt, session.timeZone || session.time_zone || "UTC"),
      bookingClosesAt: localInput(session.booking_closes_at || session.bookingClosesAt, session.timeZone || session.time_zone || "UTC"),
      capacity: String(session.capacity || ""),
      roomCode: session.roomCode || session.room_code || "",
      timeZone: session.timeZone || session.time_zone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      autoStartEnabled: Boolean(session.autoStartEnabled ?? session.auto_start_enabled),
      winningPatterns: Object.fromEntries(Object.entries(SESSION_PATTERNS).map(([id, pattern]) => {
        const configured = (session.winningPatterns || []).find((item) => item.id === id);
        return [id, { enabled: configured ? true : (session.winningPatterns === null ? pattern.points > 0 && !["star", "box", "earlySeven", "secondFullHouse", "halfSheet"].includes(id) : false), points: configured?.points ?? pattern.points }];
      })),
    });
    setError(null);
    setNotice("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function changeTimeZone(nextZone) {
    const values = ["startsAt", "bookingOpensAt", "bookingClosesAt"];
    const converted = {};
    for (const key of values) {
      const instant = toIso(form[key], form.timeZone);
      converted[key] = instant ? localInput(instant, nextZone) : form[key];
    }
    setForm({ ...form, ...converted, timeZone: nextZone });
  }

  function cancelEdit() {
    setEditingId("");
    setInventoryCapacityLocked(false);
    setForm(freshForm());
    setError(null);
  }

  async function updateStatus(session, status) {
    if (status === "cancelled" && !window.confirm(`Cancel “${session.title}”? Confirmed reservations will be retained for history.`)) return;
    setBusy(true); setError(null); setNotice(""); setNoticePosterHref("");
    try {
      const updated = await api.updateSession(instanceId, session.session_id || session.sessionId, { status });
      const automaticPoster = updated.automaticPoster;
      setNotice(status === "open" && automaticPoster?.error
        ? "Session published, but the automatic poster could not be made. Review the Posters page and retry."
        : status === "open" && automaticPoster?.posterId
          ? "Session published. Its poster is ready to share."
          : `Session ${status}.`);
      if (automaticPoster?.posterId) setNoticePosterHref(automaticPoster.publicUrl || `/poster/${encodeURIComponent(automaticPoster.posterId)}`);
      const result = await api.sessions(instanceId);
      setSessions(result.sessions || []);
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  return <div className="adm-page">
    <header className="adm-page-head">
      <div><p className="oh-eyebrow">Ticket operations</p><h1 className="oh-display adm-page-title">Sessions, tickets & bookings</h1><p className="adm-sub">Create a session, publish its player link, and manage ticket capacity and reservations. The game server generates every official ticket grid.</p></div>
      <Button variant="ghost" size="sm" onClick={load} disabled={loading}>Refresh</Button>
    </header>
    {notice ? <div ref={noticeRef} tabIndex={-1} className="adm-banner" data-tone="success" role="status"><p className="adm-banner__title">Saved</p><div className="adm-banner__body">{notice}{noticePosterHref ? <p><a className="adm-link" href={noticePosterHref} target="_blank" rel="noreferrer">Open and share the automatic poster ↗</a></p> : null}</div></div> : null}
    {error ? <ErrorNote title="Session operation failed" error={error} onRetry={load} /> : null}
    {activeInstances.length > 1 ? <div className="adm-session-filter"><label htmlFor="session-instance">Game instance</label><select id="session-instance" value={instanceId} onChange={(event) => changeInstance(event.target.value)}>{activeInstances.map((item) => <option key={item.instance_id} value={item.instance_id}>{item.display_name}</option>)}</select></div> : null}
    <Section title={editingId ? "Edit session" : "Create a session"} description="New sessions are private drafts until you publish them. Enter local date and time values for the selected event timezone; the server converts them to exact instants.">
      {!instanceId ? <Empty title="No active game instance">Activate an instance before scheduling a public session.</Empty> : <form className="adm-form" onSubmit={create}>
        <label>Session name<input required maxLength={100} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
        <label className={scheduleValidation.errors.startsAt ? "adm-field-invalid" : ""}>Game starts — local date and time<input id="session-starts-at" required type="datetime-local" step="60" value={form.startsAt} aria-invalid={Boolean(scheduleValidation.errors.startsAt)} aria-describedby={scheduleValidation.errors.startsAt ? "session-start-error" : "session-timezone-help"} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} />{scheduleValidation.errors.startsAt ? <small id="session-start-error" className="adm-field-error" role="status">{scheduleValidation.errors.startsAt}</small> : null}</label>
        <label className={scheduleValidation.errors.timeZone ? "adm-field-invalid" : ""}>Event timezone<select value={form.timeZone} aria-invalid={Boolean(scheduleValidation.errors.timeZone)} aria-describedby="session-timezone-help" onChange={(event) => changeTimeZone(event.target.value)}>{[...new Set([...timezoneChoices(), form.timeZone])].map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select><small id="session-timezone-help">All three date/time fields below are wall-clock times in this IANA timezone. The server stores exact UTC instants.</small>{scheduleValidation.errors.timeZone ? <small className="adm-field-error" role="alert">{scheduleValidation.errors.timeZone}</small> : null}</label>
        <label className={scheduleValidation.errors.bookingOpensAt ? "adm-field-invalid" : ""}>Booking opens — local date and time<input id="session-booking-opens-at" required type="datetime-local" step="60" value={form.bookingOpensAt} aria-invalid={Boolean(scheduleValidation.errors.bookingOpensAt)} aria-describedby={scheduleValidation.errors.bookingOpensAt ? "session-booking-opens-error" : undefined} onChange={(event) => setForm({ ...form, bookingOpensAt: event.target.value })} />{scheduleValidation.errors.bookingOpensAt ? <small id="session-booking-opens-error" className="adm-field-error" role="status">{scheduleValidation.errors.bookingOpensAt}</small> : null}</label>
        <label className={scheduleValidation.errors.bookingClosesAt ? "adm-field-invalid" : ""}>Booking closes — local date and time<input id="session-booking-closes-at" required type="datetime-local" step="60" value={form.bookingClosesAt} aria-invalid={Boolean(scheduleValidation.errors.bookingClosesAt)} aria-describedby={scheduleValidation.errors.bookingClosesAt ? "session-booking-closes-error" : undefined} onChange={(event) => setForm({ ...form, bookingClosesAt: event.target.value })} />{scheduleValidation.errors.bookingClosesAt ? <small id="session-booking-closes-error" className="adm-field-error" role="status">{scheduleValidation.errors.bookingClosesAt}</small> : null}</label>
        <div className="adm-session-schedule" aria-live="polite" aria-label="Schedule summary">
          <p><strong>Booking opens</strong><span>{scheduleSummary("bookingOpensAt")}</span></p>
          <p><strong>Booking closes</strong><span>{scheduleSummary("bookingClosesAt")}</span></p>
          <p><strong>Game starts</strong><span>{scheduleSummary("startsAt")}</span></p>
          <small>{scheduleValidation.valid ? "Order: opens → closes → game starts" : "Correct the highlighted date or time before creating this session."}</small>
        </div>
        <label>{editingId ? "Ticket capacity" : "Tickets to generate"}<input required type="number" min="1" max="10000" step="1" value={form.capacity} disabled={Boolean(editingId && inventoryCapacityLocked)} onChange={(event) => setForm({ ...form, capacity: event.target.value })} /><small>{inventoryCapacityLocked ? "Generated ticket quantity is fixed for this inventory." : "Free-to-play inventory; exactly this many numbered tickets will be generated and saved. Maximum 10,000."}</small></label>
        <label>Waiting room code<input maxLength="12" autoCapitalize="characters" autoComplete="off" spellCheck="false" value={form.roomCode} onChange={(event) => setForm({ ...form, roomCode: event.target.value.toUpperCase() })} /><small>{form.roomCode ? "The selected waiting room is associated with this session." : editingId ? "No room is linked; link a valid waiting room before enabling automatic start." : "Leave blank to create a private waiting room and generate its code automatically."}</small></label>
        <label className="adm-check-row"><input type="checkbox" checked={Boolean(form.autoStartEnabled)} onChange={(event) => setForm({ ...form, autoStartEnabled: event.target.checked })} /> Automatically start this game at the scheduled time</label>
        <small className="adm-sub">The server starts the linked waiting room at the scheduled time. Its timezone is shown above. Existing sessions remain host controlled unless you enable this for that session.</small>
        <fieldset className="adm-session-patterns"><legend>Winning patterns and rewards</legend><p className="adm-sub">These session rules are persisted independently. Changing them is allowed only before a linked room starts.</p>{Object.entries(SESSION_PATTERNS).map(([id, pattern]) => <div className="adm-session-pattern" key={id}><label><input type="checkbox" checked={Boolean(form.winningPatterns[id]?.enabled)} onChange={(event) => setForm({ ...form, winningPatterns: { ...form.winningPatterns, [id]: { ...form.winningPatterns[id], enabled: event.target.checked } } })} /> {pattern.label}</label><label>Points<input type="number" min="0" max="100000" step="1" disabled={!form.winningPatterns[id]?.enabled} value={form.winningPatterns[id]?.points ?? pattern.points} onChange={(event) => setForm({ ...form, winningPatterns: { ...form.winningPatterns, [id]: { ...form.winningPatterns[id], points: event.target.value } } })} /></label></div>)}</fieldset>
        <div className="adm-actions"><Button type="submit" variant="gold" disabled={busy || generationBusy || !scheduleValidation.valid}>{busy ? (generationBusy ? "Generating inventory…" : "Saving…") : editingId ? "Save changes" : "Create and generate tickets"}</Button>{editingId ? <Button type="button" variant="ghost" disabled={busy} onClick={cancelEdit}>Cancel edit</Button> : null}</div>
      </form>}
    </Section>
    <Section title="Sessions" description="Availability is read from transactional reservation records, not a cached counter.">
      {loading ? <p className="adm-sub" role="status">Loading sessions…</p> : sessions.length === 0 ? <Empty title="No sessions yet">Create a draft above, then publish it when you are ready to accept reservations.</Empty> : <Table className="adm-table--booking-ops" wrapClassName="adm-table-wrap--booking-sessions">
        <thead><tr><th>Session</th><th>Room</th><th>Schedule</th><th>Capacity</th><th>Booking</th><th>Game start</th><th>Actions</th></tr></thead>
        <tbody>{sessions.map((session) => {
          const id = session.session_id || session.sessionId;
          const held = Number(session.held_ticket_count ?? session.heldTicketCount ?? 0);
          const confirmed = Number(session.confirmed_ticket_count ?? session.confirmedTicketCount ?? 0);
          const capacity = Number(session.capacity || 0);
          const numbered = session.inventoryMode === "numbered" || session.inventory_mode === "numbered";
          const reportedInventory = Number(session.inventoryTotal ?? session.inventory_total ?? session.generatedCount ?? session.generated_count ?? 0);
          const inventoryReady = (session.inventoryState || session.inventory_state) === "ready";
          const inventoryTotal = inventoryReady ? (reportedInventory || capacity) : reportedInventory;
          const autoStartState = session.scheduledStartStatus || session.auto_start_state || "disabled";
          const gameStartLabel = session.status === "cancelled" || autoStartState === "cancelled" ? "Cancelled"
            : session.status === "completed" || autoStartState === "completed" ? "Completed"
              : session.gameStatus === "live" || autoStartState === "started" ? "Running"
                : autoStartState === "failed" ? `Failed${session.scheduledStartError ? ` · ${session.scheduledStartError}` : ""}`
                  : autoStartState === "waiting" ? "Waiting for players"
                    : autoStartState === "starting" ? "Starting"
                      : session.status === "draft" ? "Draft"
                        : session.gameStatus === "waiting" ? (session.autoStartEnabled ? "Waiting for start" : "Waiting for host")
                          : session.autoStartEnabled ? "Scheduled" : "Scheduled · host controlled";
          return <tr key={id}>
            <td data-label="Session"><span className="adm-mobile-label" aria-hidden="true">Session</span><strong>{session.title}</strong><small className="adm-table-sub">{formatDate(session.starts_at || session.startsAt, session.timeZone || session.time_zone || "UTC")}</small></td>
            <td data-label="Room"><span className="adm-mobile-label" aria-hidden="true">Room</span>{session.roomCode || session.room_code ? <><code>{session.roomCode || session.room_code}</code><Button size="sm" variant="ghost" onClick={() => navigator.clipboard?.writeText(session.roomCode || session.room_code).then(() => setNotice("Room code copied."), () => setError(new Error("Could not copy the room code.")))}>Copy</Button></> : "Not assigned"}</td>
            <td data-label="Schedule"><span className="adm-mobile-label" aria-hidden="true">Schedule</span><span>Starts {formatDate(session.startsAt || session.starts_at, session.timeZone || session.time_zone || "UTC")}</span><small className="adm-table-sub">Opens {formatDate(session.booking_opens_at || session.bookingOpensAt)}</small><small className="adm-table-sub">Closes {formatDate(session.booking_closes_at || session.bookingClosesAt)}</small></td>
            <td data-label="Capacity"><span className="adm-mobile-label" aria-hidden="true">Capacity</span>{numbered ? `${inventoryTotal.toLocaleString()} / ${capacity.toLocaleString()} generated` : `${Math.max(0, capacity - held - confirmed)} available`}<small className="adm-table-sub">{held} held · {confirmed} confirmed of {capacity}</small></td>
            <td data-label="Booking"><span className="adm-mobile-label" aria-hidden="true">Booking</span><StatusPill status={session.status} /></td>
            <td data-label="Game start"><span className="adm-mobile-label" aria-hidden="true">Game start</span>{gameStartLabel}{session.scheduledStartedAt ? <small className="adm-table-sub">Started {formatDate(session.scheduledStartedAt, session.timeZone || session.time_zone || "UTC")}</small> : null}</td>
            <td data-label="Actions"><span className="adm-mobile-label" aria-hidden="true">Actions</span><div className="adm-actions">{numbered && !inventoryReady && session.inventoryState !== "generating" && session.inventory_state !== "generating" ? <Button size="sm" variant="gold" disabled={busy || generationBusy} onClick={() => retrySessionGeneration(session)}>Generate inventory</Button> : null}{numbered ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => openInventory(session)}>Inventory</Button> : null}{!["cancelled", "completed"].includes(session.status) ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => editSession(session)}>Edit</Button> : null}{session.status === "draft" ? <Button size="sm" variant="gold" disabled={busy} onClick={() => updateStatus(session, "open")}>Publish</Button> : null}{session.status === "open" ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => updateStatus(session, "paused")}>Pause</Button> : null}{session.status === "paused" ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => updateStatus(session, "open")}>Reopen</Button> : null}{!["cancelled", "completed"].includes(session.status) ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => updateStatus(session, "cancelled")}>Cancel</Button> : <Badge tone="muted">Closed</Badge>}</div></td>
          </tr>;
        })}</tbody>
      </Table>}
    </Section>
    {generationTask ? <Section title="Ticket generation" description="The server reports completion only after the full batch is durably saved.">
      <div className="adm-inventory-generation" role={generationBusy ? "status" : "group"} aria-live="polite">
        <div><strong>{generationTask.title}</strong><p>{generationBusy ? `Generating ${generationTask.requestedCount.toLocaleString()} numbered tickets. Please keep this page open.` : `The result for ${generationTask.requestedCount.toLocaleString()} tickets is not confirmed yet.`}</p></div>
        {generationBusy ? <span className="adm-inventory-spinner" aria-hidden="true" /> : <Button variant="gold" disabled={busy} onClick={() => runGeneration(generationTask)}>Retry same generation request</Button>}
      </div>
    </Section> : null}
    {inventorySession ? <Section title={`Ticket inventory · ${inventorySession.title}`} description="Server-issued serials and player assignments for this session. Browse the complete inventory in pages.">
      <div className="adm-session-filter adm-ticket-inventory-filter">
        <label htmlFor="admin-ticket-search">Serial or ticket number</label>
        <input id="admin-ticket-search" value={inventorySearchInput} maxLength={80} onChange={(event) => setInventorySearchInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { setInventorySearch(inventorySearchInput); setInventoryPage(1); } }} />
        <label htmlFor="admin-ticket-status">Status</label>
        <select id="admin-ticket-status" value={inventoryStatus} onChange={(event) => { setInventoryStatus(event.target.value); setInventoryPage(1); }}>
          <option value="">All statuses</option><option value="available">Available</option><option value="reserved">Reserved</option><option value="booked">Booked</option><option value="assigned">Assigned</option>
        </select>
        <Button variant="ghost" size="sm" disabled={inventoryLoading} onClick={() => { setInventorySearch(inventorySearchInput); setInventoryPage(1); }}>Search</Button>
      </div>
      {inventoryLoading && !inventoryData ? <p className="adm-sub" role="status">Loading ticket inventory…</p> : null}
      {inventoryData && Number(inventoryData.inventoryTotal) === 0 ? <Empty title="No numbered inventory">This session does not have generated ticket inventory.</Empty> : null}
      {inventoryData && Number(inventoryData.inventoryTotal) > 0 ? <>
        <p className="adm-sub" role="status">Showing {inventoryData.tickets.length ? (inventoryData.page - 1) * inventoryData.pageSize + 1 : 0}–{Math.min(inventoryData.page * inventoryData.pageSize, inventoryData.total)} of {Number(inventoryData.total).toLocaleString()} matching tickets · {Number(inventoryData.inventoryTotal).toLocaleString()} total</p>
        <form className="adm-session-filter" onSubmit={submitAssistedBooking}>
          <label htmlFor="assisted-player-name">Book on behalf of</label><input id="assisted-player-name" required minLength={3} maxLength={20} value={assistedName} onChange={(event) => setAssistedName(event.target.value)} placeholder="Player display name" />
          <label htmlFor="assisted-booking-mode">Booking style</label><select id="assisted-booking-mode" value={assistedMode} onChange={(event) => { setAssistedMode(event.target.value); setAssistedSelection([]); }}><option value="random">Random tickets</option><option value="half">Half-sheet · 3 tickets</option><option value="full">Full-sheet · 6 tickets</option></select>
          <span>{assistedSelection.length} selected</span><Button variant="gold" size="sm" disabled={assistedBusy || assistedSelection.length === 0}>Create reservation</Button>
        </form>
        <p className="adm-sub">Select available tickets below. Half-sheet/full-sheet choices require a complete available sheet. Reservation recovery token is shown once after booking; share it privately with the player.</p>
        {assistedResult ? <div className="adm-reservation-detail" role="status"><strong>Reservation created for {assistedResult.displayName || assistedName}</strong><p>Reference: <code>{assistedResult.reservationId}</code></p><p>Recovery token: <code>{assistedResult.bookingToken}</code></p><p>Tickets: {(assistedResult.tickets || []).map((ticket) => ticket.serial).join(", ")}</p><Button variant="ghost" size="sm" onClick={() => setAssistedResult(null)}>Hide credentials</Button></div> : null}
        <div className="adm-issued-ticket-catalog" aria-label="Server-issued ticket catalog">
          {(inventoryData.tickets || []).map((ticket) => {
            const group = assistedMode === "random" ? [ticket] : inventoryData.tickets.filter((item) => item.sheetId === ticket.sheetId && (assistedMode === "full" || (Number(item.sheetPosition) <= 3) === (Number(ticket.sheetPosition) <= 3)));
            const expected = assistedMode === "full" ? 6 : assistedMode === "half" ? 3 : 1;
            const groupIds = group.map((item) => item.ticketId);
            const selected = groupIds.length === expected && groupIds.every((id) => assistedSelection.includes(id));
            const selectable = (assistedMode === "random" || (ticket.sheetId && ticket.sheetPosition != null)) && groupIds.length === expected && group.every((item) => (assistedMode === "random" || item.sheetPosition != null) && item.status === "available");
            return <article className="adm-issued-ticket" key={ticket.ticketId}>
            <header><div><strong>{ticket.serial}</strong><span className="booking-ticket-status" data-status={String(ticket.status || "").toLowerCase() === "available" ? "available" : ["reserved", "held", "pending"].includes(String(ticket.status || "").toLowerCase()) ? "reserved" : ["booked", "confirmed"].includes(String(ticket.status || "").toLowerCase()) ? "booked" : String(ticket.status || "").toLowerCase() === "assigned" ? "assigned" : "unavailable"}>{ticket.status}</span></div><small>{ticket.playerName ? `Assigned to ${ticket.playerName}` : ticket.reservationId ? `Reservation ${ticket.reservationId}` : "Available to book"}{ticket.expiresAt ? ` · until ${formatDate(ticket.expiresAt)}` : ""}</small></header>
            <Button variant={selected ? "gold" : "ghost"} size="sm" disabled={!selectable || (!selected && assistedSelection.length + expected > 12)} aria-pressed={selected} onClick={() => toggleAssistedTicket(ticket)}>{selected ? "Selected" : selectable ? `Select ${assistedMode === "random" ? "ticket" : assistedMode + " sheet"}` : "Bundle unavailable"}</Button>
            <TambolaTicket ticket={ticket.grid} ticketNo={ticket.serial} language="en" />
          </article>;
          })}
        </div>
        <div className="booking-catalog-pager" aria-label="Ticket inventory pages">
          <Button variant="ghost" size="sm" disabled={inventoryLoading || inventoryData.page <= 1} onClick={() => setInventoryPage((page) => Math.max(1, page - 1))}>Previous</Button>
          <span>Page {inventoryData.page} of {Math.max(1, inventoryData.pageCount)}</span>
          <Button variant="ghost" size="sm" disabled={inventoryLoading || inventoryData.page >= inventoryData.pageCount} onClick={() => setInventoryPage((page) => page + 1)}>Next</Button>
        </div>
      </> : null}
    </Section> : null}
    <Section title="Reservations" description="Private booking references are never shown with recovery codes. Ticket grids are generated by the game server when the player joins.">
      <div className="adm-session-filter adm-reservation-filters">
        <label htmlFor="reservation-status">Status</label>
        <select id="reservation-status" value={reservationStatus} onChange={(event) => setReservationStatus(event.target.value)}>
          <option value="">All statuses</option><option value="held">Held</option><option value="confirmed">Confirmed</option><option value="cancelled">Cancelled</option><option value="expired">Expired</option>
        </select>
        <label htmlFor="reservation-search">Name or reference</label>
        <input id="reservation-search" value={reservationSearch} maxLength={80} onChange={(event) => setReservationSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") loadReservations(); }} />
        <Button variant="ghost" size="sm" disabled={reservationBusy || !instanceId} onClick={loadReservations}>Search</Button>
      </div>
      {reservationBusy && reservations.length === 0 ? <p className="adm-sub" role="status">Loading reservations…</p> : reservations.length === 0 ? <Empty title="No reservations match">Reservations appear here when players hold or confirm tickets.</Empty> : <Table className="adm-table--booking-ops" wrapClassName="adm-table-wrap--booking-reservations">
        <thead><tr><th>Player</th><th>Session</th><th>Tickets</th><th>Status</th><th>Allocation</th><th>Actions</th></tr></thead>
        <tbody>{reservations.map((reservation) => <tr key={reservation.reservationId}>
          <td data-label="Player"><span className="adm-mobile-label" aria-hidden="true">Player</span><strong>{reservation.displayName}</strong><small className="adm-table-sub">{reservation.reservationId}</small></td>
          <td data-label="Session"><span className="adm-mobile-label" aria-hidden="true">Session</span>{reservation.sessionTitle}<small className="adm-table-sub">{reservation.sessionRoomCode ? `Room ${reservation.sessionRoomCode}` : "Room not attached"}</small></td>
          <td data-label="Tickets"><span className="adm-mobile-label" aria-hidden="true">Tickets</span>{reservation.ticketCount}</td>
          <td data-label="Status"><span className="adm-mobile-label" aria-hidden="true">Status</span><StatusPill status={reservation.status} /></td>
          <td data-label="Allocation"><span className="adm-mobile-label" aria-hidden="true">Allocation</span>{reservation.allocationStatus === "assigned" ? `Joined${reservation.assignedRoomCode ? ` · ${reservation.assignedRoomCode}` : ""}` : reservation.allocationStatus === "awaiting-player-join" ? "Awaiting player join" : "Not allocated"}</td>
          <td data-label="Actions"><span className="adm-mobile-label" aria-hidden="true">Actions</span><div className="adm-actions"><Button size="sm" variant="ghost" disabled={reservationBusy} onClick={() => inspectReservation(reservation.reservationId)}>Details</Button>{["held", "confirmed"].includes(reservation.status) && !reservation.assignedRoomCode ? <Button size="sm" variant="ghost" disabled={reservationBusy} onClick={() => cancelReservation(reservation)}>Cancel</Button> : null}</div></td>
        </tr>)}</tbody>
      </Table>}
      {selectedReservation ? <div className="adm-reservation-detail" aria-live="polite">
        <h3>{selectedReservation.displayName} · {selectedReservation.sessionTitle}</h3>
        <p>{selectedReservation.ticketCount} tickets · {selectedReservation.status} · {selectedReservation.allocationStatus === "assigned" ? `joined ${selectedReservation.assignedRoomCode}` : selectedReservation.allocationStatus}</p>
        <p>Reservation: <code>{selectedReservation.reservationId}</code></p>
        <h4>Activity</h4>
        {selectedReservation.history?.length ? <ol>{selectedReservation.history.map((event) => <li key={event.eventId}>{formatDate(event.occurredAt)} · {event.action.replaceAll(".", " ")} · {event.actorType}</li>)}</ol> : <p>No recorded activity.</p>}
      </div> : null}
    </Section>
  </div>;
}
