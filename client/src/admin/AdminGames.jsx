/**
 * Game and lobby management.
 *
 * Creating a room and every later lifecycle change go through the admin API,
 * which drives the same persistence controller a connected host uses. This page
 * only collects intent; the server validates it and owns the resulting state.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Button from "../components/Button.jsx";
import { PATTERN_META, OPTIONAL_PATTERNS } from "../brand.js";
import { PATTERN_CATALOG, PATTERN_TICKET, getPatternDisplayCells, getPatternDisplayNote } from "../pattern-display.js";
import { api } from "./api.js";
import { useAdmin } from "./useAdmin.js";
import { formatDateTime, formatNumber, formatRelative, statusLabel } from "./format.js";
import { Badge, Empty, ErrorNote, Field, Loading, Pagination, Section, StatusPill, Table } from "./ui.jsx";

const PAGE = 25;
const PATTERN_POINTS = { ...PATTERN_META, ...Object.fromEntries(OPTIONAL_PATTERNS.map((pattern) => [pattern.id, pattern])) };
const DEFAULT_ENABLED_PATTERNS = PATTERN_CATALOG.map((pattern) => pattern.id);
const STATES = [
  { value: "open", label: "Open rooms" },
  { value: "all", label: "All rooms" },
  { value: "WAITING", label: "Waiting" },
  { value: "RUNNING", label: "Live" },
  { value: "PAUSED", label: "Paused" },
  { value: "COMPLETED", label: "Completed" },
  { value: "closed", label: "Closed" },
];

/* eslint-disable react/prop-types */
function AdminPatternDiagram({ pattern }) {
  const cells = new Set(getPatternDisplayCells(pattern).map(([row, col]) => `${row}-${col}`));
  const ticket = (index) => <div className="adm-pattern-ticket" key={index} aria-hidden="true">
    {PATTERN_TICKET.flatMap((row, r) => row.map((number, c) => <span key={`${r}-${c}`} className={cells.has(`${r}-${c}`) ? "is-pattern" : ""} data-empty={number == null ? "true" : "false"}>{number ?? ""}</span>))}
  </div>;
  return <div className={`adm-pattern-diagram${pattern.kind === "halfSheet" ? " is-half-sheet" : ""}`} role="img" aria-label={`${pattern.title}: ${getPatternDisplayNote(pattern)}`}>
    {pattern.kind === "halfSheet" ? [0, 1, 2].map(ticket) : ticket(0)}
  </div>;
}

export default function AdminGames() {
  const { durable, toast } = useAdmin();
  const navigate = useNavigate();

  const [filters, setFilters] = useState({ state: "open", q: "" });
  const [draftQuery, setDraftQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [state, setState] = useState({ loading: true, error: null, data: null });

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await api.games({ state: filters.state, q: filters.q, limit: PAGE, offset });
      setState({ loading: false, error: null, data });
    } catch (error) {
      setState((prev) => ({ loading: false, error, data: prev.data }));
    }
  }, [filters.state, filters.q, offset]);

  useEffect(() => {
    load();
  }, [load]);

  const [instanceOptions, setInstanceOptions] = useState([]);
  useEffect(() => {
    if (durable) api.instances().then((data) => setInstanceOptions((data.instances || []).filter((item) => item.status === "active"))).catch(() => {});
  }, [durable]);

  const [form, setForm] = useState({
    name: "Operator Table",
    seconds: 8,
    autoCall: true,
    patterns: DEFAULT_ENABLED_PATTERNS,
    instanceId: "regular",
  });
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState(null);

  function togglePattern(id) {
    setForm((prev) => ({
      ...prev,
      patterns: prev.patterns.includes(id) ? prev.patterns.filter((item) => item !== id) : [...prev.patterns, id],
    }));
  }

  async function handleCreate(event) {
    event.preventDefault();
    if (creating) return;
    const seconds = Number(form.seconds);
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 120) {
      setFormError(new Error("The call interval must be between 1 and 120 seconds."));
      return;
    }
    if (form.patterns.length === 0) {
      setFormError(new Error("Enable at least one winning pattern."));
      return;
    }
    setCreating(true);
    setFormError(null);
    try {
      const created = await api.createGame({
        name: form.name.trim() || undefined,
        callIntervalMs: Math.round(seconds * 1000),
        autoCall: Boolean(form.autoCall),
        enabledPatterns: form.patterns,
        instanceId: form.instanceId,
      });
      toast(`Room ${created.roomId} created.`, "success");
      const base = window.location.pathname.startsWith("/super-admin") ? "/super-admin" : "/admin";
      navigate(`${base}/games/${created.roomId}`);
    } catch (error) {
      setFormError(error);
    } finally {
      setCreating(false);
    }
  }

  function applySearch(event) {
    event.preventDefault();
    setOffset(0);
    setFilters((prev) => ({ ...prev, q: draftQuery.trim() }));
  }

  const data = state.data;
  const rooms = (data && data.rooms) || [];

  return (
    <div className="adm-page">
      <header className="adm-page-head">
        <div>
          <p className="oh-eyebrow">Games</p>
          <h1 className="oh-display adm-page-title">Rooms and rounds</h1>
          <p className="adm-sub">Create a room, then run its lifecycle from the room page.</p>
        </div>
        <div className="adm-actions">
          <Badge tone={durable ? "gold" : "muted"}>{durable ? "Durable records" : "Live process only"}</Badge>
          <Button variant="ghost" size="sm" onClick={() => load()} disabled={state.loading}>
            {state.loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </header>

      <Section eyebrow="New room" title="Create a room">
        <form className="adm-form" onSubmit={handleCreate}>
          <div className="adm-form-row">
            <Field label="Room name" htmlFor="adm-room-name" hint="Shown to players. Defaults to Operator Table.">
              <input
                id="adm-room-name"
                className="oh-field"
                type="text"
                maxLength={40}
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                disabled={creating}
              />
            </Field>
            <Field label="Call interval (s)" htmlFor="adm-room-interval" hint="1–120 seconds between numbers.">
              <input
                id="adm-room-interval"
                className="oh-field"
                type="number"
                min={1}
                max={120}
                step={1}
                value={form.seconds}
                onChange={(event) => setForm((prev) => ({ ...prev, seconds: event.target.value }))}
                disabled={creating}
              />
            </Field>
            {durable ? <Field label="Game instance" htmlFor="adm-instance" hint="Room ownership is fixed at creation.">
              <select id="adm-instance" className="oh-field" value={form.instanceId} onChange={(event) => setForm((prev) => ({ ...prev, instanceId: event.target.value }))} disabled={creating}>
                {instanceOptions.map((instance) => <option key={instance.instance_id} value={instance.instance_id}>{instance.display_name}</option>)}
              </select>
            </Field> : null}
          </div>

          <fieldset className="adm-fieldset">
            <legend className="adm-field__label">Winning patterns</legend>
            <p className="adm-check__hint" style={{ margin: "0 0 8px" }}>
              All eleven server-supported patterns start enabled for a new room. Review the exact prize conditions below and adjust this room’s list before creating it.
            </p>
            <div className="adm-pattern-options">
              {PATTERN_CATALOG.map((pattern) => (
                <label key={pattern.id} className="adm-pattern-option">
                  <input
                    type="checkbox"
                    checked={form.patterns.includes(pattern.id)}
                    onChange={() => togglePattern(pattern.id)}
                    disabled={creating}
                  />
                  <span className="adm-pattern-option__body">
                    <span className="adm-pattern-option__heading">
                      <strong>{pattern.title}</strong>
                      <span className="adm-check__hint">{PATTERN_POINTS[pattern.id].points} pts</span>
                    </span>
                    <AdminPatternDiagram pattern={pattern} />
                    <span className="adm-pattern-option__description">{pattern.description}</span>
                    <span className="adm-pattern-option__note">{getPatternDisplayNote(pattern)}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="adm-check">
            <input
              type="checkbox"
              checked={form.autoCall}
              onChange={(event) => setForm((prev) => ({ ...prev, autoCall: event.target.checked }))}
              disabled={creating}
            />
            <span>Call numbers automatically once the round starts</span>
          </label>
          <p className="adm-sub">Automatic calling begins after you start the round from its room page. Publishing a booking session opens reservations; it does not start the live round.</p>

          {formError ? <ErrorNote title="The room was not created" error={formError} /> : null}

          <div className="adm-actions">
            <Button type="submit" variant="gold" disabled={creating}>
              {creating ? "Creating…" : "Create room"}
            </Button>
          </div>
        </form>
      </Section>

      <Section
        eyebrow="Directory"
        title="All rooms"
        actions={
          <form className="adm-filters" onSubmit={applySearch} role="search">
            <label className="adm-visually-hidden" htmlFor="adm-room-search">
              Search by room code
            </label>
            <input
              id="adm-room-search"
              className="oh-field adm-field--compact"
              type="search"
              placeholder="Room code"
              value={draftQuery}
              onChange={(event) => setDraftQuery(event.target.value)}
            />
            <label className="adm-visually-hidden" htmlFor="adm-room-state">
              Filter by state
            </label>
            <select
              id="adm-room-state"
              className="oh-field adm-field--compact"
              value={filters.state}
              onChange={(event) => {
                setOffset(0);
                setFilters((prev) => ({ ...prev, state: event.target.value }));
              }}
            >
              {STATES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <Button type="submit" variant="ghost" size="sm">
              Search
            </Button>
          </form>
        }
      >
        {state.loading && !data ? <Loading label="Reading rooms…" /> : null}
        {state.error && !data ? <ErrorNote title="Rooms could not load" error={state.error} onRetry={() => load()} /> : null}
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
                    <th scope="col">Round</th>
                    <th scope="col">Seats</th>
                    <th scope="col">Calls</th>
                    <th scope="col">Created</th>
                    <th scope="col">Updated</th>
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
                          <StatusPill status={room.status} />
                          {room.closedAt ? <Badge tone="muted">closed</Badge> : null}
                          {room.liveInProcess ? <Badge tone="info">in process</Badge> : null}
                        </div>
                      </td>
                      <td className="oh-num">{formatNumber(room.gameNumber)}</td>
                      <td className="oh-num">{formatNumber(room.seatedPlayers)}</td>
                      <td className="oh-num">{formatNumber(room.callsThisRound)}</td>
                      <td>{formatDateTime(room.createdAt)}</td>
                      <td>{formatRelative(room.updatedAt || room.createdAt)}</td>
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
              {filters.q
                ? `No room code contains “${filters.q}”.`
                : filters.state === "closed" && !durable
                  ? "Closed rooms are not retained without a database."
                  : `No ${statusLabel(filters.state).toLowerCase()} rooms right now.`}
            </Empty>
          )
        ) : null}
      </Section>
    </div>
  );
}
