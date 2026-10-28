/**
 * Player directory.
 *
 * Read-only on purpose: removing someone from a live room is a room-scoped
 * action with a seat and a ticket attached, so it lives on the room page. Here
 * the owner can search identities, see memberships and awards, and reach the
 * room that owns the seat.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Button from "../components/Button.jsx";
import { api } from "./api.js";
import { useAdmin } from "./useAdmin.js";
import { formatDateTime, formatNumber, formatRelative, patternLabel } from "./format.js";
import { Badge, Empty, ErrorNote, Loading, Pagination, Section, Table } from "./ui.jsx";

const PAGE = 25;

export default function AdminPlayers() {
  const { durable } = useAdmin();
  const [applied, setApplied] = useState({ q: "" });
  const [draftQuery, setDraftQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [state, setState] = useState({ loading: true, error: null, data: null });

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await api.players({ q: applied.q, limit: PAGE, offset });
      setState({ loading: false, error: null, data });
    } catch (error) {
      setState((prev) => ({ loading: false, error, data: prev.data }));
    }
  }, [applied.q, offset]);

  useEffect(() => {
    load();
  }, [load]);

  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState({ loading: false, error: null, data: null });

  useEffect(() => {
    if (!selected) {
      setDetail({ loading: false, error: null, data: null });
      return undefined;
    }
    let alive = true;
    setDetail({ loading: true, error: null, data: null });
    api
      .player(selected)
      .then((result) => {
        if (alive) setDetail({ loading: false, error: null, data: result.player });
      })
      .catch((error) => {
        if (alive) setDetail({ loading: false, error, data: null });
      });
    return () => {
      alive = false;
    };
  }, [selected]);

  function applySearch(event) {
    event.preventDefault();
    setOffset(0);
    setSelected(null);
    setApplied({ q: draftQuery.trim() });
  }

  const data = state.data;
  const players = (data && data.players) || [];

  return (
    <div className="adm-page">
      <header className="adm-page-head">
        <div>
          <p className="oh-eyebrow">Players</p>
          <h1 className="oh-display adm-page-title">Who plays here</h1>
          <p className="adm-sub">Search by display name or player id. Removing a seat is done from its room.</p>
        </div>
        <div className="adm-actions">
          <Badge tone={durable ? "gold" : "muted"}>{durable ? "Durable records" : "Live process only"}</Badge>
          <Button variant="ghost" size="sm" onClick={() => load()} disabled={state.loading}>
            {state.loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </header>

      <Section
        eyebrow="Directory"
        title="Players"
        actions={
          <form className="adm-filters" onSubmit={applySearch} role="search">
            <label className="adm-visually-hidden" htmlFor="adm-player-search">
              Search players
            </label>
            <input
              id="adm-player-search"
              className="oh-field adm-field--compact"
              type="search"
              placeholder="Name or player id"
              value={draftQuery}
              onChange={(event) => setDraftQuery(event.target.value)}
            />
            <Button type="submit" variant="ghost" size="sm">
              Search
            </Button>
          </form>
        }
      >
        {state.loading && !data ? <Loading label="Reading players…" /> : null}
        {state.error && !data ? <ErrorNote title="Players could not load" error={state.error} onRetry={() => load()} /> : null}
        {state.error && data ? <ErrorNote title="The last refresh failed" error={state.error} onRetry={() => load()} /> : null}

        {data ? (
          players.length ? (
            <>
              <Table>
                <thead>
                  <tr>
                    <th scope="col">Player</th>
                    <th scope="col">Player id</th>
                    <th scope="col">Rooms</th>
                    <th scope="col">Awards</th>
                    <th scope="col">Rejected claims</th>
                    <th scope="col">First seen</th>
                    <th scope="col">
                      <span className="adm-visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((player) => (
                    <tr key={player.playerId}>
                      <td>
                        <span className="adm-cell-title">{player.displayName || "Unnamed"}</span>
                      </td>
                      <td>
                        <code className="adm-code adm-code--inline oh-num">{player.playerId}</code>
                      </td>
                      <td className="oh-num">{formatNumber(player.roomCount)}</td>
                      <td className="oh-num">{formatNumber(player.awardsWon)}</td>
                      <td className="oh-num">{formatNumber(player.rejectedClaims)}</td>
                      <td>{player.createdAt ? formatDateTime(player.createdAt) : "this process"}</td>
                      <td>
                        <Button variant="ghost" size="sm" onClick={() => setSelected(player.playerId)}>
                          {selected === player.playerId ? "Selected" : "View"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <Pagination total={data.total} limit={data.limit} offset={data.offset} onChange={setOffset} />
            </>
          ) : (
            <Empty title="No players match">
              {applied.q ? `Nothing matches “${applied.q}”.` : "Players appear once they join a room."}
            </Empty>
          )
        ) : null}
      </Section>

      {selected ? (
        <Section
          eyebrow="Player record"
          title={detail.data ? detail.data.displayName || detail.data.playerId : selected}
          actions={
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
              Close
            </Button>
          }
        >
          {detail.loading ? <Loading label="Reading the player…" /> : null}
          {detail.error ? <ErrorNote title="The player record could not load" error={detail.error} onRetry={() => setSelected(null)} /> : null}
          {detail.data ? (
            <div className="adm-columns">
              <div>
                <p className="adm-field__label">Memberships</p>
                {detail.data.memberships && detail.data.memberships.length ? (
                  <Table>
                    <thead>
                      <tr>
                        <th scope="col">Room</th>
                        <th scope="col">Role</th>
                        <th scope="col">Joined</th>
                        <th scope="col">Seat</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.data.memberships.map((membership) => (
                        <tr key={`${membership.roomId}-${membership.joinedAt || "now"}`}>
                          <td>
                            <Link className="adm-link oh-num" to={`/admin/games/${membership.roomId}`}>
                              {membership.roomId}
                            </Link>
                          </td>
                          <td>
                            <Badge tone={membership.role === "host" ? "gold" : "muted"}>{membership.role}</Badge>
                          </td>
                          <td>{membership.joinedAt ? formatDateTime(membership.joinedAt) : "—"}</td>
                          <td>{membership.leftAt ? <Badge tone="muted">left</Badge> : <Badge tone="ok">seated</Badge>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                ) : (
                  <Empty title="No memberships recorded" />
                )}
              </div>
              <div>
                <p className="adm-field__label">Awards</p>
                {detail.data.awards && detail.data.awards.length ? (
                  <Table>
                    <thead>
                      <tr>
                        <th scope="col">Room</th>
                        <th scope="col">Round</th>
                        <th scope="col">Pattern</th>
                        <th scope="col">Points</th>
                        <th scope="col">When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.data.awards.map((award, index) => (
                        <tr key={`${award.roomId}-${award.gameNumber}-${award.pattern}-${index}`}>
                          <td>
                            <Link className="adm-link oh-num" to={`/admin/games/${award.roomId}`}>
                              {award.roomId}
                            </Link>
                          </td>
                          <td className="oh-num">{formatNumber(award.gameNumber)}</td>
                          <td>{patternLabel(award.pattern)}</td>
                          <td className="oh-num">{formatNumber(award.points)}</td>
                          <td>{award.awardedAt ? formatRelative(award.awardedAt) : "this process"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                ) : (
                  <Empty title="No awards">{"Awards appear when the engine accepts this player's claim."}</Empty>
                )}
              </div>
            </div>
          ) : null}
        </Section>
      ) : null}

      <p className="adm-footnote">
        {durable
          ? "Player rows are durable and survive room closure."
          : "This server runs without a database, so only players currently seated are listed."}
      </p>
    </div>
  );
}
