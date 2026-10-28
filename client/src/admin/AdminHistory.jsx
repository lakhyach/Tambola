/**
 * Durable history and the owner audit trail.
 *
 * History is a room-level view that survives closure; per-round call history,
 * claims and awards live on the room page it links to. The audit trail is the
 * separate admin_audit table, so sign-ins and password rotations are visible
 * even though they belong to no room.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Button from "../components/Button.jsx";
import { api } from "./api.js";
import { useAdmin } from "./useAdmin.js";
import { formatDateTime, formatNumber, formatRelative, statusLabel } from "./format.js";
import { Badge, Banner, Empty, ErrorNote, Loading, Pagination, Section, StatusPill, Table } from "./ui.jsx";

const PAGE = 30;
const STATES = [
  { value: "all", label: "All rooms" },
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "WAITING", label: "Waiting" },
  { value: "RUNNING", label: "Live" },
  { value: "PAUSED", label: "Paused" },
  { value: "COMPLETED", label: "Completed" },
];

function summarizeMetadata(metadata) {
  if (!metadata) return "—";
  if (typeof metadata === "string") return metadata;
  try {
    const text = JSON.stringify(metadata);
    return text === "{}" ? "—" : text.length > 120 ? `${text.slice(0, 117)}…` : text;
  } catch {
    return "—";
  }
}

export default function AdminHistory() {
  const { durable } = useAdmin();

  const [draft, setDraft] = useState({ state: "all", q: "", from: "", to: "" });
  const [applied, setApplied] = useState({ state: "all", q: "", from: "", to: "" });
  const [offset, setOffset] = useState(0);
  const [state, setState] = useState({ loading: true, error: null, data: null });

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await api.history({
        state: applied.state === "all" ? undefined : applied.state,
        q: applied.q || undefined,
        from: applied.from || undefined,
        to: applied.to || undefined,
        limit: PAGE,
        offset,
      });
      setState({ loading: false, error: null, data });
    } catch (error) {
      setState((prev) => ({ loading: false, error, data: prev.data }));
    }
  }, [applied.state, applied.q, applied.from, applied.to, offset]);

  useEffect(() => {
    load();
  }, [load]);

  function applyFilters(event) {
    event.preventDefault();
    setOffset(0);
    setApplied({ ...draft, q: draft.q.trim() });
  }

  const [auditRoomDraft, setAuditRoomDraft] = useState("");
  const [auditRoom, setAuditRoom] = useState("");
  const [audit, setAudit] = useState({ loading: true, error: null, events: [] });

  const loadAudit = useCallback(async () => {
    setAudit((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await api.audit({ roomCode: auditRoom || undefined, limit: 50 });
      setAudit({ loading: false, error: null, events: data.events || [] });
    } catch (error) {
      setAudit((prev) => ({ loading: false, error, events: prev.events }));
    }
  }, [auditRoom]);

  useEffect(() => {
    loadAudit();
  }, [loadAudit]);

  const data = state.data;
  const rooms = (data && data.games) || [];

  return (
    <div className="adm-page">
      <header className="adm-page-head">
        <div>
          <p className="oh-eyebrow">History</p>
          <h1 className="oh-display adm-page-title">Every room that has run</h1>
          <p className="adm-sub">Closing a room never deletes its record. Open a room for calls, claims and awards.</p>
        </div>
        <div className="adm-actions">
          <Badge tone={durable ? "gold" : "muted"}>{durable ? "Durable records" : "Live process only"}</Badge>
          <Button variant="ghost" size="sm" onClick={() => load()} disabled={state.loading}>
            {state.loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </header>

      {!durable ? (
        <Banner tone="warn" title="A database is required">
          This server runs without durable storage, so there is no recorded history. Rooms are only visible while the
          process that holds them is running.
        </Banner>
      ) : null}

      <Section
        eyebrow="Records"
        title="Room history"
        actions={
          <form className="adm-filters adm-filters--wrap" onSubmit={applyFilters}>
            <label className="adm-visually-hidden" htmlFor="adm-history-q">
              Room code
            </label>
            <input
              id="adm-history-q"
              className="oh-field adm-field--compact"
              type="search"
              placeholder="Room code"
              value={draft.q}
              onChange={(event) => setDraft((prev) => ({ ...prev, q: event.target.value }))}
            />
            <label className="adm-visually-hidden" htmlFor="adm-history-state">
              State
            </label>
            <select
              id="adm-history-state"
              className="oh-field adm-field--compact"
              value={draft.state}
              onChange={(event) => setDraft((prev) => ({ ...prev, state: event.target.value }))}
            >
              {STATES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <label className="adm-visually-hidden" htmlFor="adm-history-from">
              From date
            </label>
            <input
              id="adm-history-from"
              className="oh-field adm-field--compact"
              type="date"
              value={draft.from}
              onChange={(event) => setDraft((prev) => ({ ...prev, from: event.target.value }))}
            />
            <label className="adm-visually-hidden" htmlFor="adm-history-to">
              To date
            </label>
            <input
              id="adm-history-to"
              className="oh-field adm-field--compact"
              type="date"
              value={draft.to}
              onChange={(event) => setDraft((prev) => ({ ...prev, to: event.target.value }))}
            />
            <Button type="submit" variant="ghost" size="sm">
              Apply
            </Button>
          </form>
        }
      >
        {state.loading && !data ? <Loading label="Reading history…" /> : null}
        {state.error && !data ? <ErrorNote title="History could not load" error={state.error} onRetry={() => load()} /> : null}
        {state.error && data ? <ErrorNote title="The last refresh failed" error={state.error} onRetry={() => load()} /> : null}

        {data ? (
          rooms.length ? (
            <>
              <Table>
                <thead>
                  <tr>
                    <th scope="col">Room</th>
                    <th scope="col">Name</th>
                    <th scope="col">State</th>
                    <th scope="col">Rounds</th>
                    <th scope="col">Participants</th>
                    <th scope="col">Awards</th>
                    <th scope="col">Created</th>
                    <th scope="col">Closed</th>
                    <th scope="col">
                      <span className="adm-visually-hidden">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rooms.map((room) => (
                    <tr key={room.roomId}>
                      <td>
                        <Link className="adm-link oh-num" to={`/admin/games/${room.roomId}`}>
                          {room.roomId}
                        </Link>
                      </td>
                      <td>{room.gameName || "—"}</td>
                      <td>
                        <div className="adm-inline">
                          <StatusPill status={room.closedAt ? "CLOSED" : room.status} />
                          {room.closedAt ? <Badge tone="muted">sealed</Badge> : null}
                        </div>
                      </td>
                      <td className="oh-num">{formatNumber(room.roundsPlayed)}</td>
                      <td className="oh-num">{formatNumber(room.participants)}</td>
                      <td className="oh-num">{formatNumber(room.awards)}</td>
                      <td>{formatDateTime(room.createdAt)}</td>
                      <td>{room.closedAt ? formatDateTime(room.closedAt) : "—"}</td>
                      <td>
                        <Link className="adm-link" to={`/admin/games/${room.roomId}`}>
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <Pagination total={data.total} limit={data.limit} offset={data.offset} onChange={setOffset} />
            </>
          ) : (
            <Empty title="No rooms match">
              {data.durableRequired
                ? data.note || "History needs durable storage."
                : applied.q
                  ? `No room code contains “${applied.q}”.`
                  : `No ${statusLabel(applied.state).toLowerCase()} rooms recorded.`}
            </Empty>
          )
        ) : null}
      </Section>

      <Section
        eyebrow="Security"
        title="Owner audit trail"
        actions={
          <form
            className="adm-filters"
            onSubmit={(event) => {
              event.preventDefault();
              setAuditRoom(auditRoomDraft.trim().toUpperCase());
            }}
          >
            <label className="adm-visually-hidden" htmlFor="adm-audit-room">
              Room code
            </label>
            <input
              id="adm-audit-room"
              className="oh-field adm-field--compact"
              type="search"
              placeholder="Filter by room code"
              value={auditRoomDraft}
              onChange={(event) => setAuditRoomDraft(event.target.value)}
            />
            <Button type="submit" variant="ghost" size="sm">
              Filter
            </Button>
            {auditRoom ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAuditRoomDraft("");
                  setAuditRoom("");
                }}
              >
                Clear
              </Button>
            ) : null}
          </form>
        }
      >
        {audit.loading && !audit.events.length ? <Loading label="Reading the audit trail…" /> : null}
        {audit.error ? <ErrorNote title="The audit trail could not be read" error={audit.error} onRetry={() => loadAudit()} /> : null}
        {audit.events.length ? (
          <Table>
            <thead>
              <tr>
                <th scope="col">Action</th>
                <th scope="col">Actor</th>
                <th scope="col">Room</th>
                <th scope="col">Target</th>
                <th scope="col">Detail</th>
                <th scope="col">When</th>
              </tr>
            </thead>
            <tbody>
              {audit.events.map((event) => (
                <tr key={event.eventId}>
                  <td>
                    <code className="adm-code adm-code--inline">{event.action}</code>
                  </td>
                  <td>{event.actor || "—"}</td>
                  <td className="oh-num">{event.roomCode || "—"}</td>
                  <td className="oh-num">{event.targetId || "—"}</td>
                  <td>
                    <code className="adm-code adm-code--inline">{summarizeMetadata(event.metadata)}</code>
                  </td>
                  <td title={formatDateTime(event.occurredAt)}>{formatRelative(event.occurredAt)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : !audit.loading ? (
          <Empty title="No audit events">
            {durable ? "Owner actions and sign-in decisions are recorded here." : "The audit trail needs durable storage."}
          </Empty>
        ) : null}
      </Section>
    </div>
  );
}
