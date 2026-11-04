import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Button from "../components/Button.jsx";
import { api } from "./api.js";
import { formatDateTime, formatNumber } from "./format.js";
import { Badge, Empty, ErrorNote, Loading, Section, Stat, StatusPill, Table } from "./ui.jsx";

function basePath() {
  return window.location.pathname.startsWith("/super-admin") ? "/super-admin" : "/admin";
}

export default function AdminInstanceDetail() {
  const { instanceId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await api.instanceOverview(instanceId)); }
    catch (err) { setError(err); }
    finally { setLoading(false); }
  }, [instanceId]);
  useEffect(() => { load(); }, [load]);

  const instance = data?.instance;
  const counts = data?.counts || {};
  return <div className="adm-page">
    <header className="adm-page-head"><div><p className="oh-eyebrow">Instance control center</p><h1 className="oh-display adm-page-title">{instance?.displayName || "Instance details"}</h1><p className="adm-sub">Persisted tenant health, activity, rooms, and moderator assignments.</p></div><div className="adm-actions"><Link className="adm-link" to={`${basePath()}/instances`}>All instances</Link><Button variant="ghost" size="sm" onClick={load} disabled={loading}>Refresh</Button></div></header>
    {error ? <ErrorNote title="Instance details could not be loaded" error={error} onRetry={load} /> : null}
    {loading && !data ? <Loading block label="Loading persisted instance details…" /> : null}
    {data ? <>
      <Section title="Lifecycle and health" description={`Created ${formatDateTime(instance.createdAt)} · Updated ${formatDateTime(instance.updatedAt)}`}>
        <div className="adm-actions"><StatusPill status={instance.status} /><Badge tone={instance.publicVisible && instance.status === "active" ? "gold" : "muted"}>{instance.publicVisible && instance.status === "active" ? "Public directory" : "Hidden from directory"}</Badge><Badge tone={data.health.ok ? "gold" : "danger"}>{data.health.ok ? "Database connected" : "Database unavailable"}</Badge></div>
        <p className="adm-sub">/{instance.slug} · {instance.description || "No description"}</p>
        <div className="adm-stats" aria-label="Instance totals">
          <Stat label="Rooms" value={formatNumber(counts.rooms)} /><Stat label="Open rooms" value={formatNumber(counts.open_rooms)} />
          <Stat label="Running" value={formatNumber(counts.running_rooms)} /><Stat label="Games" value={formatNumber(counts.games)} />
          <Stat label="Participants" value={formatNumber(counts.participants)} /><Stat label="Claims" value={formatNumber(counts.claims)} />
          <Stat label="Awards" value={formatNumber(counts.awards)} />
        </div>
        <p className="adm-sub">Database probe checked {formatDateTime(data.health.checkedAt)}. Reports are available in <Link className="adm-link" to={`${basePath()}/reports?instanceId=${encodeURIComponent(instance.instanceId)}`}>instance activity</Link>.</p>
      </Section>
      <Section title="Recent rooms" description="The latest 20 persisted rooms belonging to this instance.">
        {data.rooms.length ? <Table className="adm-table--mobile-cards"><thead><tr><th>Room</th><th>Status</th><th>Round</th><th>Active players</th><th>Updated</th><th>Closed</th></tr></thead><tbody>{data.rooms.map((room) => <tr key={room.roomId}><th scope="row" data-label="Room"><span className="adm-mobile-label" aria-hidden="true">Room</span><Link className="adm-link" to={`${basePath()}/games/${encodeURIComponent(room.roomId)}`}>{room.name || room.roomId}</Link><small className="adm-table-sub">{room.roomId}</small></th><td data-label="Status"><span className="adm-mobile-label" aria-hidden="true">Status</span><StatusPill status={room.status} /></td><td data-label="Round"><span className="adm-mobile-label" aria-hidden="true">Round</span>{formatNumber(room.gameNumber)}</td><td data-label="Active players"><span className="adm-mobile-label" aria-hidden="true">Active players</span>{formatNumber(room.activeMembers)}</td><td data-label="Updated"><span className="adm-mobile-label" aria-hidden="true">Updated</span>{formatDateTime(room.updatedAt)}</td><td data-label="Closed"><span className="adm-mobile-label" aria-hidden="true">Closed</span>{formatDateTime(room.closedAt)}</td></tr>)}</tbody></Table> : <Empty title="No rooms in this instance">Rooms will appear here after they are created.</Empty>}
      </Section>
      <Section title="Recent games" description="The latest 20 rounds from rooms owned by this instance.">
        {data.games.length ? <Table className="adm-table--mobile-cards"><thead><tr><th>Room</th><th>Round</th><th>Status</th><th>Started</th><th>Completed</th><th>Participants</th><th>Awards</th></tr></thead><tbody>{data.games.map((game) => <tr key={`${game.roomId}-${game.gameNumber}`}><th scope="row" data-label="Room"><span className="adm-mobile-label" aria-hidden="true">Room</span><Link className="adm-link" to={`${basePath()}/games/${encodeURIComponent(game.roomId)}`}>{game.roomName || game.roomId}</Link><small className="adm-table-sub">{game.roomId}</small></th><td data-label="Round"><span className="adm-mobile-label" aria-hidden="true">Round</span>{formatNumber(game.gameNumber)}</td><td data-label="Status"><span className="adm-mobile-label" aria-hidden="true">Status</span><StatusPill status={game.status} /></td><td data-label="Started"><span className="adm-mobile-label" aria-hidden="true">Started</span>{formatDateTime(game.startedAt)}</td><td data-label="Completed"><span className="adm-mobile-label" aria-hidden="true">Completed</span>{formatDateTime(game.completedAt)}</td><td data-label="Participants"><span className="adm-mobile-label" aria-hidden="true">Participants</span>{formatNumber(game.participants)}</td><td data-label="Awards"><span className="adm-mobile-label" aria-hidden="true">Awards</span>{formatNumber(game.awards)}</td></tr>)}</tbody></Table> : <Empty title="No games have started">Round history will appear here after a room starts its first game.</Empty>}
      </Section>
      <Section title="Recent players" description="Players with activity in this instance’s rooms, ordered by their most recent join.">
        {data.players.length ? <Table className="adm-table--mobile-cards"><thead><tr><th>Display name</th><th>Recent join</th><th>Rooms</th><th>Claims</th><th>Awards</th></tr></thead><tbody>{data.players.map((player) => <tr key={player.playerId}><th scope="row" data-label="Display name"><span className="adm-mobile-label" aria-hidden="true">Display name</span>{player.displayName}</th><td data-label="Recent join"><span className="adm-mobile-label" aria-hidden="true">Recent join</span>{formatDateTime(player.lastJoinedAt)}</td><td data-label="Rooms"><span className="adm-mobile-label" aria-hidden="true">Rooms</span>{formatNumber(player.roomCount)}</td><td data-label="Claims"><span className="adm-mobile-label" aria-hidden="true">Claims</span>{formatNumber(player.claims)}</td><td data-label="Awards"><span className="adm-mobile-label" aria-hidden="true">Awards</span>{formatNumber(player.awards)}</td></tr>)}</tbody></Table> : <Empty title="No players in this instance">Player activity will appear when someone joins an instance room.</Empty>}
      </Section>
      <Section title="Moderator access" description="Current unrevoked assignments for this instance, with account and session state.">
        {data.moderators.length ? <Table className="adm-table--mobile-cards"><thead><tr><th>Account</th><th>Status</th><th>MFA</th><th>Capabilities</th><th>Live sessions</th><th>Granted</th></tr></thead><tbody>{data.moderators.map((mod) => <tr key={mod.moderatorId}><th scope="row" data-label="Account"><span className="adm-mobile-label" aria-hidden="true">Account</span><Link className="adm-link" to={`${basePath()}/moderators`}>{mod.username}</Link></th><td data-label="Status"><span className="adm-mobile-label" aria-hidden="true">Status</span><StatusPill status={mod.status} /></td><td data-label="MFA"><span className="adm-mobile-label" aria-hidden="true">MFA</span>{mod.mfaEnabled ? "Enrolled" : "Not enrolled"}</td><td data-label="Capabilities"><span className="adm-mobile-label" aria-hidden="true">Capabilities</span>{mod.permissions.join(", ") || "None"}</td><td data-label="Live sessions"><span className="adm-mobile-label" aria-hidden="true">Live sessions</span>{formatNumber(mod.activeSessions)}</td><td data-label="Granted"><span className="adm-mobile-label" aria-hidden="true">Granted</span>{formatDateTime(mod.grantedAt)}</td></tr>)}</tbody></Table> : <Empty title="No active moderator assignments">Grant history and access changes remain available in moderator management.</Empty>}
      </Section>
      <Section title="Recent audit" description="Up to 50 owner, moderator, and system events scoped to this instance and its persisted rooms.">
        {data.audit.length ? <Table className="adm-table--mobile-cards"><thead><tr><th>When</th><th>Source</th><th>Action</th><th>Actor</th><th>Result</th><th>Room</th><th>Metadata</th></tr></thead><tbody>{data.audit.map((event) => <tr key={`${event.source}-${event.event_id}`}><td data-label="When"><span className="adm-mobile-label" aria-hidden="true">When</span>{formatDateTime(event.occurred_at)}</td><td data-label="Source"><span className="adm-mobile-label" aria-hidden="true">Source</span>{event.source} · {event.role}</td><td data-label="Action"><span className="adm-mobile-label" aria-hidden="true">Action</span>{event.action}</td><td data-label="Actor"><span className="adm-mobile-label" aria-hidden="true">Actor</span>{event.actor || "system"}</td><td data-label="Result"><span className="adm-mobile-label" aria-hidden="true">Result</span>{event.result}</td><td data-label="Room"><span className="adm-mobile-label" aria-hidden="true">Room</span>{event.room_code || "—"}</td><td data-label="Metadata"><span className="adm-mobile-label" aria-hidden="true">Metadata</span><code>{JSON.stringify(event.metadata)}</code></td></tr>)}</tbody></Table> : <Empty title="No audit events">Instance and room actions will be recorded here.</Empty>}
      </Section>
    </> : null}
  </div>;
}
