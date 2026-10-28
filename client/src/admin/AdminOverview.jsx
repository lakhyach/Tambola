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
  formatRelative,
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

export default function AdminOverview() {
  const { toast } = useAdmin();
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
  const completed = (data && data.recentCompleted) || [];
  const health = (data && data.health) || {};
  const live = (data && data.live) || {};
  const durable = Boolean(data && data.durable);

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

          <section className="adm-stats" aria-label="Room and game totals">
            <Stat label="Waiting" value={formatNumber(countOf(counts, "waiting"))} hint="Rooms open for players" />
            <Stat label="Live" value={formatNumber(countOf(counts, "running"))} hint="Rounds in progress" />
            <Stat label="Paused" value={formatNumber(countOf(counts, "paused"))} hint="Rounds on hold" />
            <Stat label="Open rooms" value={formatNumber(countOf(counts, "openTotal"))} hint="Not yet closed" />
            <Stat label="Total games" value={formatNumber(countOf(counts, "total_games", "totalGames"))} hint="All recorded rounds" />
            <Stat
              label="Completed"
              value={formatNumber(countOf(counts, "completed_games", "completedGames"))}
              hint="Finished rounds"
            />
            <Stat label="Participants" value={formatNumber(countOf(counts, "participants"))} hint="Distinct players" />
            <Stat label="Awards" value={formatNumber(countOf(counts, "awards"))} hint="Patterns won" />
            <Stat
              label="Valid claims"
              value={formatNumber(countOf(counts, "valid_claims", "validClaims"))}
              hint="Accepted by the engine"
            />
            <Stat
              label="Rejected claims"
              value={formatNumber(countOf(counts, "rejected_claims", "rejectedClaims"))}
              hint="Refused by the engine"
            />
          </section>

          <div className="adm-columns">
            <Section
              eyebrow="In the hall"
              title="Open rooms"
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
                            {room.liveInProcess ? <Badge tone="info">in process</Badge> : null}
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
                <Empty title="No open rooms">New rooms appear here as soon as they are created.</Empty>
              )}
            </Section>

            <div className="adm-stack">
              <Section eyebrow="Runtime" title="Health">
                <KeyValue
                  items={[
                    ["Database", <Badge key="db" tone={healthTone(health.database)}>{healthLabel(health.database)}</Badge>],
                    ["Application", <Badge key="app" tone={healthTone(health.app)}>{healthLabel(health.app)}</Badge>],
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

          <div className="adm-columns">
            <Section eyebrow="Arbitration" title="Recent awards" actions={<Badge tone="muted">{winners.length}</Badge>}>
              {winners.length ? (
                <Table>
                  <thead>
                    <tr>
                      <th scope="col">Player</th>
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
