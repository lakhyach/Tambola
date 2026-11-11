/**
 * Overview.
 *
 * Every figure here comes from GET /api/admin/overview, which either queries
 * the durable tables or reads the live room registry. The page labels which
 * source it is showing and never fills a gap with a fabricated number.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Button from "../components/Button.jsx";
import { api } from "./api.js";
import { useAdmin } from "./useAdmin.js";
import {
  formatDateTime,
  formatNumber,
  awardTicketLabel,
  formatRelative,
  formatInterval,
  healthLabel,
  healthTone,
  patternLabel,
  claimTone,
  statusLabel,
} from "./format.js";
import { Badge, Banner, Empty, ErrorNote, KeyValue, Loading, Section, Stat, StatusPill, Table } from "./ui.jsx";

const REFRESH_MS = 20000;

function countOf(counts, ...keys) {
  for (const key of keys) {
    const value = counts[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function backupSummary(status) {
  if (status.directoryStatus !== "available") return statusLabel(status.directoryStatus);
  const count = Number.isFinite(status.backupCount) ? status.backupCount : 0;
  if (!count) return "No archives found";
  const latest = status.backups?.[0];
  if (!latest) return `${formatNumber(count)} archive${count === 1 ? "" : "s"}`;
  if (latest.restoreCheck?.status === "failed") return `${formatNumber(count)} · latest restore check failed`;
  if (latest.manifestStatus !== "valid") return `${formatNumber(count)} · latest manifest ${statusLabel(latest.manifestStatus)}`;
  if (latest.restoreCheck?.status === "passed") return `${formatNumber(count)} · latest restore check passed`;
  return `${formatNumber(count)} · restore check pending`;
}

function backupTone(status) {
  if (status.directoryStatus !== "available" || !status.backupCount) return "muted";
  const latest = status.backups?.[0];
  if (latest?.restoreCheck?.status === "failed") return "danger";
  if (latest?.manifestStatus !== "valid" || latest?.restoreCheck?.status !== "passed") return "warn";
  return "ok";
}

function schedulerSummary(scheduler) {
  if (!scheduler) return "Not running";
  const cadence = scheduler.nextDueInMs == null ? "no pending call" : `next call in ${formatInterval(scheduler.nextDueInMs)}`;
  return `${formatNumber(scheduler.armed)} timer${scheduler.armed === 1 ? "" : "s"} · ${cadence}${scheduler.overdue ? " · overdue" : scheduler.ticking ? " · ticking" : " · paused"}`;
}

function poolSummary(pool) {
  if (!pool) return "Not configured";
  const capacity = pool.max == null ? formatNumber(pool.total) : `${formatNumber(pool.total)} / ${formatNumber(pool.max)}`;
  return `${capacity} connections · ${formatNumber(pool.waiting)} waiting${pool.errors ? ` · ${formatNumber(pool.errors)} errors` : ""}`;
}

export default function AdminOverview() {
  const { toast } = useAdmin();
  const base = window.location.pathname.startsWith("/super-admin") ? "/super-admin" : "/admin";
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const alive = useRef(true);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await api.overview();
      if (alive.current) setState({ loading: false, error: null, data });
    } catch (error) {
      if (alive.current) setState((prev) => ({ loading: false, error, data: prev.data }));
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load(true);
    }, REFRESH_MS);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
    };
  }, [load]);

  const { data, error, loading } = state;
  const counts = (data && data.counts) || {};
  const rooms = (data && data.rooms) || [];
  const winners = (data && data.recentWinners) || [];
  const claims = (data && data.recentClaims) || [];
  const activity = (data && data.recentPlatformActivity) || [];
  const completed = (data && data.recentCompleted) || [];
  const health = (data && data.health) || {};
  const backupStatus = (data && data.backupStatus) || {};
  const live = (data && data.live) || {};
  const durable = Boolean(data && data.durable);
  const roomStateValues = [
    { label: "Waiting", value: countOf(counts, "waiting"), tone: "waiting" },
    { label: "Live", value: countOf(counts, "running"), tone: "live" },
    { label: "Paused", value: countOf(counts, "paused"), tone: "paused" },
  ];
  const hasRoomStateCounts = roomStateValues.every((item) => item.value !== null);
  const visibleRoomTotal = hasRoomStateCounts ? roomStateValues.reduce((sum, item) => sum + item.value, 0) : null;

  return (
    <div className="adm-page">
      <header className="adm-page-head">
        <div>
          <p className="oh-eyebrow">Overview</p>
          <h1 className="oh-display adm-page-title">The hall at a glance</h1>
          <p className="adm-sub">
            {data ? `Updated ${formatDateTime(data.generatedAt)} · ${data.source === "durable" ? "durable records" : "live process state"}` : "Reading server state…"}
          </p>
        </div>
        <div className="adm-actions">
          {data ? <Badge tone={durable ? "gold" : "muted"}>{durable ? "Durable records" : "Live process state"}</Badge> : null}
          <Button variant="ghost" size="sm" onClick={() => load()} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </header>

      {loading && !data ? <Loading block label="Reading the dashboard…" /> : null}
      {error && !data ? <ErrorNote title="The dashboard could not load" error={error} onRetry={() => load()} /> : null}

      {data ? (
        <>
          {error ? <ErrorNote title="The last refresh failed" error={error} onRetry={() => load()} /> : null}
          {!durable ? (
            <Banner tone="warn" title="Live process data">
              {data.note || "This server is running without a database, so history and lifetime totals are unavailable."}
            </Banner>
          ) : null}

          <section className="adm-overview-hero" aria-label="Festival control room">
            <div className="adm-overview-hero__copy">
              <p className="oh-eyebrow">Festival control room</p>
              <h2>Every room, in rhythm.</h2>
              <p>Watch the halls move from first seat to final call. Game numbers and status below come from {durable ? "durable records" : "the live process"}.</p>
              <nav className="adm-overview-hero__links" aria-label="Control room shortcuts">
                <Link to={`${base}/games`}>Game rooms <span aria-hidden="true">↗</span></Link>
                <Link to={`${base}/bookings`}>Bookings <span aria-hidden="true">↗</span></Link>
                <Link to={`${base}/themes`}>Festival themes <span aria-hidden="true">↗</span></Link>
              </nav>
            </div>
            <div className="adm-overview-hero__display">
              <div className="adm-overview-hero__ball" role="img" aria-label="Tambola ticket numbers run from 1 to 90">
                <span>90</span>
              </div>
              <div className="adm-overview-hero__caption">
                <span className="oh-eyebrow">Rooms in play</span>
                <strong className="oh-num">{formatNumber(visibleRoomTotal)}</strong>
                <span>waiting · live · paused</span>
              </div>
            </div>
            <div className="adm-overview-pulse" role="img" aria-label={`Room state: ${roomStateValues.map((item) => `${item.label} ${formatNumber(item.value)}`).join(", ")}`}>
              {roomStateValues.map((item) => {
                const value = item.value || 0;
                const width = visibleRoomTotal ? (value / visibleRoomTotal) * 100 : 0;
                return <span key={item.tone} className={`adm-overview-pulse__segment is-${item.tone}`} style={{ width: `${width}%` }} />;
              })}
              {visibleRoomTotal === 0 ? <span className="adm-overview-pulse__empty" /> : null}
            </div>
            <div className="adm-overview-pulse__legend" aria-hidden="true">
              {roomStateValues.map((item) => <span key={item.tone}><i className={`is-${item.tone}`} />{item.label}<b>{formatNumber(item.value)}</b></span>)}
            </div>
          </section>

          <section className="adm-stats" aria-label="Room and game totals">
            <Stat label="Waiting" value={formatNumber(countOf(counts, "waiting"))} hint="Rooms open for players" tone="info" />
            <Stat label="Live" value={formatNumber(countOf(counts, "running"))} hint="Rounds in progress" tone="danger" />
            <Stat label="Paused" value={formatNumber(countOf(counts, "paused"))} hint="Rounds on hold" tone="warn" />
            <Stat label="Active rooms" value={formatNumber(countOf(counts, "openTotal"))} hint="Waiting, live or paused" tone="gold" />
            <Stat label="Total games" value={formatNumber(countOf(counts, "total_games", "totalGames"))} hint="All recorded rounds" tone="silver" />
            <Stat
              label="Completed"
              value={formatNumber(countOf(counts, "completed_games", "completedGames"))}
              hint="Finished rounds"
              tone="ok"
            />
            <Stat label="Participants" value={formatNumber(countOf(counts, "participants"))} hint="Distinct players" tone="info" />
            <Stat label="Awards" value={formatNumber(countOf(counts, "awards"))} hint="Patterns won" tone="gold" />
            <Stat
              label="Valid claims"
              value={formatNumber(countOf(counts, "valid_claims", "validClaims"))}
              hint="Accepted by the engine"
              tone="ok"
            />
            <Stat
              label="Rejected claims"
              value={formatNumber(countOf(counts, "rejected_claims", "rejectedClaims"))}
              hint="Refused by the engine"
              tone="danger"
            />
          </section>

          {durable && data.platform ? <Section eyebrow="Platform" title="Instances and moderator access">
            <div className="adm-stats" role="group" aria-label="Platform instance and moderator totals">
              <Stat label="Instances" value={formatNumber(data.platform.total_instances)} hint={`${formatNumber(data.platform.active_instances)} active · ${formatNumber(data.platform.paused_instances)} paused · ${formatNumber(data.platform.archived_instances)} archived`} />
              <Stat label="Moderators" value={formatNumber(data.platform.total_moderators)} hint={`${formatNumber(data.platform.active_moderators)} active · ${formatNumber(data.platform.invited_moderators)} invited · ${formatNumber(data.platform.suspended_moderators)} suspended`} />
              <Stat label="Effective grants" value={formatNumber(data.platform.active_moderator_grants)} hint="Unrevoked assignments for active accounts" />
              <Stat label="Live sessions" value={formatNumber(data.platform.active_moderator_sessions)} hint="Unrevoked, unexpired, active accounts" />
            </div>
          </Section> : null}

          <div className="adm-columns">
            <Section
              eyebrow="In the hall"
              title="Unclosed room records"
              actions={<Badge tone="muted">{rooms.length}</Badge>}
            >
              {rooms.length ? (
                <Table>
                  <thead>
                    <tr>
                      <th scope="col">Room</th>
                      <th scope="col">Name</th>
                      <th scope="col">State</th>
                      <th scope="col">Round</th>
                      <th scope="col">Seats</th>
                      <th scope="col">Calls</th>
                      <th scope="col">Updated</th>
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
                            {room.liveInProcess ? <Badge tone="info">not closed</Badge> : null}
                          </div>
                        </td>
                        <td className="oh-num">{formatNumber(room.gameNumber)}</td>
                        <td className="oh-num">{formatNumber(room.seatedPlayers)}</td>
                        <td className="oh-num">{formatNumber(room.callsThisRound)}</td>
                        <td>{formatRelative(room.updatedAt || room.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <Empty title="No unclosed room records">New rooms appear here as soon as they are created.</Empty>
              )}
            </Section>

            <div className="adm-stack">
              <Section eyebrow="Runtime" title="Health">
                <KeyValue
                  items={[
                    ["Readiness", <Badge key="ready" tone={health.readiness === "ready" ? "ok" : health.readiness === "degraded" ? "warn" : health.readiness === "not-ready" ? "danger" : "muted"}>{health.readiness || "Unknown"}</Badge>],
                    ["Database", <Badge key="db" tone={healthTone(health.database)}>{healthLabel(health.database)}</Badge>],
                    ["Application", <Badge key="app" tone={healthTone(health.application || health.app)}>{healthLabel(health.application || health.app)}</Badge>],
                    ["Schema", health.migrations ? (health.migrations.current ? `Current · ${health.migrations.latest || "latest"}` : `${formatNumber(health.migrations.pending.length)} pending`) : "Not checked"],
                    ["Instance lease", health.lease ? (health.lease.lost ? "Lost" : health.lease.held ? "Held" : "Not held") : "Not applicable"],
                    ["Scheduler", schedulerSummary(health.scheduler)],
                    ["Frozen rooms", formatNumber(health.rooms?.frozen)],
                    ["Database pool", poolSummary(health.pool)],
                    ["Process uptime", health.uptimeSeconds == null ? "—" : `${formatNumber(health.uptimeSeconds)} seconds`],
                    ["Backups", <Badge key="backups" tone={backupTone(backupStatus)}>{backupSummary(backupStatus)}</Badge>],
                    ["Rooms in process", formatNumber(live.processRooms)],
                    ["Players connected", formatNumber(live.livePlayers)],
                    ["Data source", durable ? "Durable records" : "Live process only"],
                  ]}
                />
              </Section>

              <Section eyebrow="Finished" title="Recently completed">
                {completed.length ? (
                  <ul className="adm-list">
                    {completed.map((item) => (
                      <li key={`${item.roomId}-${item.gameNumber}`}>
                        <Link className="adm-link oh-num" to={`/admin/games/${item.roomId}`}>
                          {item.roomId}
                        </Link>
                        <span className="adm-list__meta">
                          Round {item.gameNumber} · {formatRelative(item.completedAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty title="No completed rounds">
                    {durable ? "Completed games are recorded here." : "A database is required to record completed games."}
                  </Empty>
                )}
              </Section>
            </div>
          </div>

          <Section
            eyebrow="Security and operations"
            title="Recent platform activity"
            actions={<Link className="adm-link" to={`${base}/history`}>View audit history</Link>}
          >
            {activity.length ? (
              <ul className="adm-list">
                {activity.map((event) => (
                  <li key={`${event.source}-${event.eventId}`}>
                    <code className="adm-code adm-code--inline">{event.action}</code>
                    <Badge tone={event.result === "failure" ? "danger" : event.result === "success" ? "ok" : "muted"}>
                      {event.result}
                    </Badge>
                    <span className="adm-list__meta">
                      {event.actor || "System"}{event.actorRole ? ` · ${event.actorRole.replaceAll("_", " ")}` : ""}
                      {event.instanceId ? ` · ${event.instanceId}` : ""}
                      {event.roomCode ? ` · ${event.roomCode}` : ""}
                      {` · ${formatRelative(event.occurredAt)}`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="No platform activity yet">Administrative actions and security decisions will appear here.</Empty>
            )}
          </Section>

          <div className="adm-columns">
            <Section eyebrow="Arbitration" title="Recent awards" actions={<Badge tone="muted">{winners.length}</Badge>}>
              {winners.length ? (
                <Table>
                  <thead>
                    <tr>
                      <th scope="col">Player</th>
                      <th scope="col">Ticket</th>
                      <th scope="col">Pattern</th>
                      <th scope="col">Room</th>
                      <th scope="col">Points</th>
                      <th scope="col">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {winners.map((award, index) => (
                      <tr key={`${award.roomId}-${award.gameNumber}-${award.playerId}-${award.pattern}-${index}`}>
                        <td>{award.displayName || award.playerId}</td>
                        <td className="oh-num">{awardTicketLabel(award)}</td>
                        <td>{patternLabel(award.pattern)}</td>
                        <td>
                          <Link className="adm-link oh-num" to={`/admin/games/${award.roomId}`}>
                            {award.roomId}
                          </Link>
                        </td>
                        <td className="oh-num">{formatNumber(award.points)}</td>
                        <td>{award.awardedAt ? formatRelative(award.awardedAt) : "this process"}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <Empty title="No awards yet">An award is written only when the engine accepts a claim.</Empty>
              )}
            </Section>

            <Section eyebrow="Arbitration" title="Recent claims" actions={<Badge tone="muted">{claims.length}</Badge>}>
              {claims.length ? (
                <Table>
                  <thead>
                    <tr>
                      <th scope="col">Player</th>
                      <th scope="col">Pattern</th>
                      <th scope="col">Room</th>
                      <th scope="col">Verdict</th>
                      <th scope="col">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {claims.map((claim, index) => (
                      <tr key={`${claim.roomId}-${claim.playerId}-${claim.pattern}-${index}`}>
                        <td>{claim.displayName || claim.playerId}</td>
                        <td>{patternLabel(claim.pattern)}</td>
                        <td>
                          <Link className="adm-link oh-num" to={`/admin/games/${claim.roomId}`}>
                            {claim.roomId}
                          </Link>
                        </td>
                        <td>
                          <Badge tone={claimTone(claim.status)}>{statusLabel(claim.status)}</Badge>
                          {claim.reason ? <span className="adm-note">{claim.reason}</span> : null}
                        </td>
                        <td>{claim.decidedAt ? formatRelative(claim.decidedAt) : "this process"}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <Empty title="No claims yet">Claims and their verdicts are listed here.</Empty>
              )}
            </Section>
          </div>

          <p className="adm-footnote">
            Refreshes quietly every {Math.round(REFRESH_MS / 1000)} seconds while this tab is visible.
            <button type="button" className="adm-link adm-link--button" onClick={() => load().then(() => toast("Dashboard refreshed.", "success"))}>
              Refresh now
            </button>
          </p>
        </>
      ) : null}
    </div>
  );
}
