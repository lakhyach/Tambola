import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Button from "../components/Button.jsx";
import TambolaTicket from "../components/TambolaTicket.jsx";
import "../booking.css";
import { api } from "./api.js";
import { Badge, Empty, ErrorNote, Section, StatusPill, Table } from "./ui.jsx";

function localInput(date) {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  const offset = value.getTimezoneOffset() * 60000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function toIso(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatDate(value, timeZone) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Invalid date" : new Intl.DateTimeFormat(undefined, timeZone ? { weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone, timeZoneName: "short" } : { dateStyle: "medium", timeStyle: "short" }).format(date);
}

const freshForm = () => {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  start.setSeconds(0, 0);
  const close = new Date(start.getTime() - 10 * 60 * 1000);
  const open = new Date(close.getTime() - 24 * 60 * 60 * 1000);
  return { title: "", startsAt: localInput(start), bookingOpensAt: localInput(open), bookingClosesAt: localInput(close), capacity: "100", roomCode: "", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" };
};

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
  const [generationTask, setGenerationTask] = useState(null);
  const [generationBusy, setGenerationBusy] = useState(false);
  const inventoryRequest = useRef(0);
  const noticeRef = useRef(null);

  const activeInstances = useMemo(() => instances.filter((item) => item.status === "active"), [instances]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.instances();
      const available = (result.instances || []).filter((item) => item.status === "active");
      setInstances(available);
      const selected = available.some((item) => item.instance_id === instanceId) ? instanceId : available[0]?.instance_id || "";
      setInstanceId(selected);
      if (!selected) {
        setSessions([]);
        setReservations([]);
      } else {
        const rows = await api.sessions(selected);
        setSessions(rows.sessions || []);
        const booked = await api.reservations(selected);
        setReservations(booked.reservations || []);
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [instanceId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (notice) noticeRef.current?.focus(); }, [notice]);

  const loadInventory = useCallback(async () => {
    if (!instanceId || !inventorySession) return;
    const requestId = ++inventoryRequest.current;
    setInventoryLoading(true);
    setError(null);
    try {
      const response = await api.sessionTickets(instanceId, inventorySession.sessionId, {
        page: inventoryPage, pageSize: 20, search: inventorySearch.trim(), status: inventoryStatus,
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
    setInstanceId(nextId);
    setEditingId("");
    setInventoryCapacityLocked(false);
    setForm(freshForm());
    setInventorySession(null); setInventoryData(null); setInventorySearch(""); setInventorySearchInput("");
    setLoading(true);
    setError(null);
    try {
      const result = await api.sessions(nextId);
      setSessions(result.sessions || []);
      const booked = await api.reservations(nextId);
      setReservations(booked.reservations || []);
    } catch (err) {
      setError(err);
      setSessions([]);
      setReservations([]);
    } finally {
      setLoading(false);
    }
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
    const startsAt = toIso(form.startsAt);
    const bookingOpensAt = toIso(form.bookingOpensAt);
    const bookingClosesAt = toIso(form.bookingClosesAt);
    const capacity = Number(form.capacity);
    if (!startsAt || !bookingOpensAt || !bookingClosesAt || bookingOpensAt >= bookingClosesAt || bookingClosesAt >= startsAt) {
      setError(new Error("Booking must open before it closes, and closing must be before the scheduled start."));
      return;
    }
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000) {
      setError(new Error("Capacity must be from 1 to 10,000 tickets."));
      return;
    }
    setBusy(true); setError(null); setNotice("");
    try {
      const payload = { title: form.title.trim(), startsAt, bookingOpensAt, bookingClosesAt, capacity, timeZone: form.timeZone, roomCode: form.roomCode.trim().toUpperCase() || null, ...(!editingId ? { inventoryMode: "numbered" } : {}) };
      if (editingId) await api.updateSession(instanceId, editingId, payload);
      else {
        const bytes = new Uint8Array(24);
        if (!globalThis.crypto?.getRandomValues) throw new Error("Secure inventory generation is unavailable in this browser.");
        globalThis.crypto.getRandomValues(bytes);
        const idempotencyKey = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
        const created = await api.createSession(instanceId, payload);
        const session = created.session;
        const task = { instanceId, sessionId: session.sessionId, title: session.title, requestedCount: capacity, idempotencyKey };
        setGenerationTask(task);
        setSessions((current) => [{ ...session, inventoryMode: "numbered" }, ...current.filter((row) => (row.session_id || row.sessionId) !== session.sessionId)]);
        setInventoryData(null); setInventoryPage(1);
        setForm(freshForm()); setEditingId("");
        setNotice(`Session draft created. Generating ${capacity.toLocaleString()} numbered tickets…`);
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
      setNotice(`${task.title}: ${generatedCount.toLocaleString()} of ${task.requestedCount.toLocaleString()} tickets generated and saved.`);
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
  }

  function editSession(session) {
    setEditingId(session.session_id || session.sessionId);
    setInventoryCapacityLocked((session.inventoryState || session.inventory_state) === "ready");
    setForm({
      title: session.title || "",
      startsAt: localInput(session.starts_at || session.startsAt),
      bookingOpensAt: localInput(session.booking_opens_at || session.bookingOpensAt),
      bookingClosesAt: localInput(session.booking_closes_at || session.bookingClosesAt),
      capacity: String(session.capacity || ""),
      roomCode: session.roomCode || session.room_code || "",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    });
    setError(null);
    setNotice("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditingId("");
    setInventoryCapacityLocked(false);
    setForm(freshForm());
    setError(null);
  }

  async function updateStatus(session, status) {
    if (status === "cancelled" && !window.confirm(`Cancel “${session.title}”? Confirmed reservations will be retained for history.`)) return;
    setBusy(true); setError(null); setNotice("");
    try {
      await api.updateSession(instanceId, session.session_id || session.sessionId, { status });
      setNotice(`Session ${status}.`);
      const result = await api.sessions(instanceId);
      setSessions(result.sessions || []);
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  return <div className="adm-page">
    <header className="adm-page-head">
      <div><p className="oh-eyebrow">Ticket operations</p><h1 className="oh-display adm-page-title">Scheduled sessions</h1><p className="adm-sub">Publish free-to-play sessions and reserve ticket capacity. The game server still generates every official ticket grid.</p></div>
      <Button variant="ghost" size="sm" onClick={load} disabled={loading}>Refresh</Button>
    </header>
    {notice ? <div ref={noticeRef} tabIndex={-1} className="adm-banner" data-tone="success" role="status"><p className="adm-banner__title">Saved</p><div className="adm-banner__body">{notice}</div></div> : null}
    {error ? <ErrorNote title="Session operation failed" error={error} onRetry={load} /> : null}
    {activeInstances.length > 1 ? <div className="adm-session-filter"><label htmlFor="session-instance">Game instance</label><select id="session-instance" value={instanceId} onChange={(event) => changeInstance(event.target.value)}>{activeInstances.map((item) => <option key={item.instance_id} value={item.instance_id}>{item.display_name}</option>)}</select></div> : null}
    <Section title={editingId ? "Edit session" : "Create a session"} description="New sessions are private drafts until you publish them. Event dates use your browser’s local timezone and the timezone is saved with the session for accurate announcements.">
      {!instanceId ? <Empty title="No active game instance">Activate an instance before scheduling a public session.</Empty> : <form className="adm-form" onSubmit={create}>
        <label>Session name<input required maxLength={100} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
        <label>Scheduled start<input required type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} /></label>
        <label>Event time zone<input value={form.timeZone} readOnly aria-readonly="true" /><small>Detected from this browser. Session time and poster announcements use this timezone.</small></label>
        <label>Booking opens<input required type="datetime-local" value={form.bookingOpensAt} onChange={(event) => setForm({ ...form, bookingOpensAt: event.target.value })} /></label>
        <label>Booking closes<input required type="datetime-local" value={form.bookingClosesAt} onChange={(event) => setForm({ ...form, bookingClosesAt: event.target.value })} /></label>
        <label>{editingId ? "Ticket capacity" : "Tickets to generate"}<input required type="number" min="1" max="10000" step="1" value={form.capacity} disabled={Boolean(editingId && inventoryCapacityLocked)} onChange={(event) => setForm({ ...form, capacity: event.target.value })} /><small>{inventoryCapacityLocked ? "Generated ticket quantity is fixed for this inventory." : "Free-to-play inventory; exactly this many numbered tickets will be generated and saved. Maximum 10,000."}</small></label>
        <label>Waiting room code<input maxLength="12" autoCapitalize="characters" autoComplete="off" spellCheck="false" value={form.roomCode} onChange={(event) => setForm({ ...form, roomCode: event.target.value.toUpperCase() })} /><small>Optional. The room must be waiting and belong to the selected instance. Public pages reveal it only to a confirmed reservation code.</small></label>
        <div className="adm-actions"><Button type="submit" variant="gold" disabled={busy || generationBusy}>{busy ? (generationBusy ? "Generating inventory…" : "Saving…") : editingId ? "Save changes" : "Create and generate tickets"}</Button>{editingId ? <Button type="button" variant="ghost" disabled={busy} onClick={cancelEdit}>Cancel edit</Button> : null}</div>
      </form>}
    </Section>
    <Section title="Sessions" description="Availability is read from transactional reservation records, not a cached counter.">
      {loading ? <p className="adm-sub" role="status">Loading sessions…</p> : sessions.length === 0 ? <Empty title="No sessions yet">Create a draft above, then publish it when you are ready to accept reservations.</Empty> : <Table className="adm-table--booking-ops" wrapClassName="adm-table-wrap--booking-sessions">
        <thead><tr><th>Session</th><th>Room</th><th>Schedule</th><th>Capacity</th><th>State</th><th>Actions</th></tr></thead>
        <tbody>{sessions.map((session) => {
          const id = session.session_id || session.sessionId;
          const held = Number(session.held_ticket_count ?? session.heldTicketCount ?? 0);
          const confirmed = Number(session.confirmed_ticket_count ?? session.confirmedTicketCount ?? 0);
          const capacity = Number(session.capacity || 0);
          const numbered = session.inventoryMode === "numbered" || session.inventory_mode === "numbered";
          const reportedInventory = Number(session.inventoryTotal ?? session.inventory_total ?? session.generatedCount ?? session.generated_count ?? 0);
          const inventoryReady = (session.inventoryState || session.inventory_state) === "ready";
          const inventoryTotal = inventoryReady ? (reportedInventory || capacity) : reportedInventory;
          return <tr key={id}>
            <td data-label="Session"><span className="adm-mobile-label" aria-hidden="true">Session</span><strong>{session.title}</strong><small className="adm-table-sub">{formatDate(session.starts_at || session.startsAt, session.timeZone || session.time_zone || "UTC")}</small></td>
            <td data-label="Room"><span className="adm-mobile-label" aria-hidden="true">Room</span>{session.roomCode || session.room_code || "Not assigned"}</td>
            <td data-label="Schedule"><span className="adm-mobile-label" aria-hidden="true">Schedule</span><span>Opens {formatDate(session.booking_opens_at || session.bookingOpensAt)}</span><small className="adm-table-sub">Closes {formatDate(session.booking_closes_at || session.bookingClosesAt)}</small></td>
            <td data-label="Capacity"><span className="adm-mobile-label" aria-hidden="true">Capacity</span>{numbered ? `${inventoryTotal.toLocaleString()} / ${capacity.toLocaleString()} generated` : `${Math.max(0, capacity - held - confirmed)} available`}<small className="adm-table-sub">{held} held · {confirmed} confirmed of {capacity}</small></td>
            <td data-label="State"><span className="adm-mobile-label" aria-hidden="true">State</span><StatusPill status={session.status} /></td>
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
        <div className="adm-issued-ticket-catalog" aria-label="Server-issued ticket catalog">
          {(inventoryData.tickets || []).map((ticket) => <article className="adm-issued-ticket" key={ticket.ticketId}>
            <header><div><strong>{ticket.serial}</strong><span className="booking-ticket-status" data-status={String(ticket.status || "").toLowerCase() === "available" ? "available" : ["reserved", "held", "pending"].includes(String(ticket.status || "").toLowerCase()) ? "reserved" : ["booked", "confirmed"].includes(String(ticket.status || "").toLowerCase()) ? "booked" : String(ticket.status || "").toLowerCase() === "assigned" ? "assigned" : "unavailable"}>{ticket.status}</span></div><small>{ticket.playerName ? `Assigned to ${ticket.playerName}` : ticket.reservationId ? `Reservation ${ticket.reservationId}` : "Available to book"}{ticket.expiresAt ? ` · until ${formatDate(ticket.expiresAt)}` : ""}</small></header>
            <TambolaTicket ticket={ticket.grid} ticketNo={ticket.serial} language="en" />
          </article>)}
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
