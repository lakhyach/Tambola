/**
 * One room, in full.
 *
 * Lifecycle actions here are the same server-authoritative transitions a host
 * triggers: the API resolves the room, proves the owner session, and calls the
 * persistence controller with the room's own managed credential. The page never
 * writes state itself, so a stale tab can be refused rather than corrupting a
 * round.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Button from "../components/Button.jsx";
import { api } from "./api.js";
import { useAdmin } from "./useAdmin.js";
import {
  claimTone,
  enabledPatternIds,
  formatClock,
  formatDateTime,
  formatInterval,
  formatNumber,
  formatRelative,
  patternLabel,
  statusLabel,
} from "./format.js";
import {
  Badge,
  Banner,
  ConfirmDialog,
  CopyButton,
  Empty,
  ErrorNote,
  KeyValue,
  Loading,
  ProgressBar,
  Section,
  StatusPill,
  Table,
} from "./ui.jsx";

const POLL_MS = 12000;

function summarizeDetail(detail) {
  if (detail === null || detail === undefined) return "—";
  if (typeof detail === "string") return detail;
  try {
    const text = JSON.stringify(detail);
    return text.length > 140 ? `${text.slice(0, 137)}…` : text;
  } catch {
    return "—";
  }
}

export default function AdminGameDetail() {
  const { roomId = "" } = useParams();
  const { toast } = useAdmin();
  const navigate = useNavigate();

  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [invitation, setInvitation] = useState({ loading: true, error: null, data: null });
  const [adminAudit, setAdminAudit] = useState({ error: null, events: [] });
  const [busy, setBusy] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const alive = useRef(true);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const detail = await api.game(roomId);
        if (!alive.current) return;
        setState({ loading: false, error: null, data: detail });
        const room = detail && detail.room;
        if (room && !room.closedAt) {
          try {
            const invite = await api.invitation(roomId);
            if (alive.current) setInvitation({ loading: false, error: null, data: invite.invitation });
          } catch (error) {
            if (alive.current) setInvitation({ loading: false, error, data: null });
          }
        } else {
          setInvitation({ loading: false, error: null, data: null });
        }
        try {
          const audit = await api.audit({ roomCode: roomId, limit: 40 });
          if (alive.current) setAdminAudit({ error: null, events: audit.events || [] });
        } catch (error) {
          if (alive.current) setAdminAudit({ error, events: [] });
        }
      } catch (error) {
        if (alive.current) setState((prev) => ({ loading: false, error, data: prev.data }));
      }
    },
    [roomId]
  );

  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  const room = state.data && state.data.room;
  const live = Boolean(room && room.liveInProcess);

  useEffect(() => {
    if (!live) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load(true);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [live, load]);

  async function runAction(label, fn, message) {
    if (busy) return;
    setBusy(label);
    try {
      await fn();
      toast(message, "success");
      await load(true);
    } catch (error) {
      toast((error && error.message) || "The server refused that action.", "danger");
    } finally {
      setBusy(null);
    }
  }

  async function confirmClose() {
    setConfirmBusy(true);
    try {
      await api.closeRoom(roomId);
      toast(`Room ${roomId} closed.`, "success");
      setConfirm(null);
      await load(true);
    } catch (error) {
      toast((error && error.message) || "The room could not be closed.", "danger");
    } finally {
      setConfirmBusy(false);
    }
  }

  async function confirmRemove() {
    if (!confirm) return;
    const target = confirm;
    setConfirmBusy(true);
    try {
      await api.removeMember(roomId, target.playerId);
      toast(`${target.name} was removed from the room.`, "success");
      setConfirm(null);
      await load(true);
    } catch (error) {
      toast((error && error.message) || "That participant could not be removed.", "danger");
    } finally {
      setConfirmBusy(false);
    }
  }

  async function handleShare() {
    const data = invitation.data;
    if (!data || !data.url) return;
    try {
      await navigator.share({ title: "Tambola", text: data.message || "Join my Tambola room", url: data.url });
    } catch (error) {
      if (error && error.name === "AbortError") return;
      toast("Sharing is not available on this device.", "warn");
    }
  }

  if (state.loading && !state.data) {
    return (
      <div className="adm-page">
        <Loading block label="Reading the room…" />
      </div>
    );
  }

  if (state.error && !state.data) {
    return (
      <div className="adm-page">
        <ErrorNote title="The room could not load" error={state.error} onRetry={() => load()} />
        <div className="adm-actions">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin/games")}>
            Back to games
          </Button>
        </div>
      </div>
    );
  }

  if (!room) return null;

  const config = room.config || {};
  const closed = Boolean(room.closedAt);
  const status = closed ? "CLOSED" : room.status;
  const called = room.calledNumbers || [];
  const calledSet = new Set(called.map((entry) => entry.number));
  const members = room.members || [];
  const tickets = room.tickets || [];
  const claims = room.claims || [];
  const awards = room.awards || [];
  const rounds = room.rounds || [];
  const gameAudit = room.gameAudit || [];
  const patternsOn = enabledPatternIds(config);
  const autoCall = Boolean(config.autoCall);
  const ticketsThisRound = tickets.filter((ticket) => ticket.gameNumber === room.gameNumber).length;
  const invite = invitation.data;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const actionsLocked = busy !== null;

  return (
    <div className="adm-page">
      <header className="adm-page-head">
        <div>
          <p className="oh-eyebrow">
            <Link className="adm-link" to="/admin/games">
              Games
            </Link>{" "}
            / Room
          </p>
          <h1 className="oh-display adm-page-title adm-title-room oh-num">{room.roomId}</h1>
          <p className="adm-sub">
            {config.name || "Unnamed room"} · Round {formatNumber(room.gameNumber)} ·{" "}
            {room.liveInProcess ? "loaded in this server process" : "not loaded in this server process"}
          </p>
        </div>
        <div className="adm-actions">
          <StatusPill status={status} />
          {room.liveInProcess ? <Badge tone="info">in process</Badge> : <Badge tone="muted">historical</Badge>}
          {live ? <Badge tone={room.hostConnected ? "ok" : "muted"}>{room.hostConnected ? "host connected" : "no host socket"}</Badge> : null}
          <Button variant="ghost" size="sm" onClick={() => load()} disabled={state.loading}>
            {state.loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </header>

      {state.error ? <ErrorNote title="The last refresh failed" error={state.error} onRetry={() => load()} /> : null}
      {room.recoveryError ? (
        <Banner tone="danger" title="Recovery required">
          {room.recoveryError}
        </Banner>
      ) : null}
      {closed ? (
        <Banner tone="info" title="This room is closed">
          It no longer appears in the lobby and invites are disabled. Tickets, claims and awards remain in durable history.
        </Banner>
      ) : null}
      {!live && !closed ? (
        <Banner tone="warn" title="Not loaded in this process">
          This room exists in durable history but is not open in the running server, so lifecycle actions are unavailable.
        </Banner>
      ) : null}

      <Section
        eyebrow="Control"
        title="Round actions"
        actions={
          <div className="adm-actions">
            {!closed && live && room.status === "WAITING" ? (
              <Button variant="gold" size="sm" onClick={() => runAction("start", () => api.action(roomId, "start"), "Round started.")} disabled={actionsLocked}>
                Start round
              </Button>
            ) : null}
            {!closed && live && room.status === "RUNNING" ? (
              <>
                <Button variant="gold" size="sm" onClick={() => runAction("call", () => api.action(roomId, "call"), "Next number called.")} disabled={actionsLocked}>
                  Call next number
                </Button>
                <Button variant="ghost" size="sm" onClick={() => runAction("pause", () => api.action(roomId, "pause"), "Round paused.")} disabled={actionsLocked}>
                  Pause
                </Button>
              </>
            ) : null}
            {!closed && live && room.status === "PAUSED" ? (
              <Button variant="gold" size="sm" onClick={() => runAction("resume", () => api.action(roomId, "resume"), "Round resumed.")} disabled={actionsLocked}>
                Resume
              </Button>
            ) : null}
            {!closed && live && (room.status === "RUNNING" || room.status === "PAUSED") ? (
              <Button variant="danger" size="sm" onClick={() => runAction("end", () => api.action(roomId, "end"), "Round ended.")} disabled={actionsLocked}>
                End round
              </Button>
            ) : null}
            {!closed && live && room.status === "COMPLETED" ? (
              <Button variant="ghost" size="sm" onClick={() => runAction("reset", () => api.action(roomId, "reset"), "Room reset to waiting.")} disabled={actionsLocked}>
                Reset for next round
              </Button>
            ) : null}
            {!closed && live && (room.status === "RUNNING" || room.status === "PAUSED") ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  runAction(
                    "autocall",
                    () => api.action(roomId, "autocall", { enabled: !autoCall }),
                    autoCall ? "Automatic calling turned off." : "Automatic calling turned on."
                  )
                }
                disabled={actionsLocked}
              >
                {autoCall ? "Turn auto-call off" : "Turn auto-call on"}
              </Button>
            ) : null}
            {!closed ? (
              <Button variant="danger" size="sm" onClick={() => setConfirm({ kind: "close" })} disabled={actionsLocked}>
                Close room
              </Button>
            ) : null}
          </div>
        }
      >
        <div className="adm-columns adm-columns--fit">
          <KeyValue
            items={[
              ["State", <StatusPill key="state" status={status} />],
              ["Round", formatNumber(room.gameNumber)],
              ["Call interval", formatInterval(config.callIntervalMs)],
              ["Auto-call", <Badge key="auto" tone={autoCall ? "ok" : "muted"}>{autoCall ? "on" : "off"}</Badge>],
              ["Patterns", patternsOn.length ? patternsOn.map(patternLabel).join(", ") : "—"],
              ["Tickets this round", formatNumber(ticketsThisRound)],
            ]}
          />
          <KeyValue
            items={[
              ["Created", formatDateTime(room.createdAt)],
              ["Updated", formatDateTime(room.updatedAt)],
              ["Closed", room.closedAt ? formatDateTime(room.closedAt) : "—"],
              ["Host seat", room.hostPlayerId || "—"],
              ["Data source", state.data && state.data.durable ? "Durable records" : "Live process"],
              ["Max players", formatNumber(config.maxPlayers)],
            ]}
          />
        </div>
        <div className="adm-progress-row">
          <span className="adm-sub">
            Calls this round: {formatNumber(called.length)} of 90
          </span>
          <ProgressBar value={called.length} max={90} label="Numbers called this round" />
        </div>
      </Section>

      {!closed ? (
        <Section
          eyebrow="Invitations"
          title="Share this room"
          actions={
            invite && invite.url ? (
              <div className="adm-actions">
                <CopyButton
                  value={invite.url}
                  label="Copy invite link"
                  onResult={(ok) => toast(ok ? "Invite link copied." : "The invite link could not be copied.", ok ? "success" : "danger")}
                />
                <Button as="a" href={invite.whatsappUrl} target="_blank" rel="noreferrer" variant="ghost" size="sm">
                  Share on WhatsApp
                </Button>
                {canShare ? (
                  <Button variant="ghost" size="sm" onClick={handleShare}>
                    Share…
                  </Button>
                ) : null}
              </div>
            ) : null
          }
        >
          {invitation.loading ? <Loading label="Preparing the invite…" /> : null}
          {invitation.error ? <ErrorNote title="The invite could not be prepared" error={invitation.error} onRetry={() => load(true)} /> : null}
          {invite ? (
            <div className="adm-invite">
              {invite.warning ? (
                <Banner tone="warn" title="Public origin not configured">
                  {invite.warning}
                </Banner>
              ) : null}
              {invite.url ? (
                <div className="adm-invite__grid">
                  <div className="adm-invite__details">
                    <p className="adm-field__label">Invite URL</p>
                    <code className="adm-code">{invite.url}</code>
                    <p className="adm-sub">Players open this link to join room {invite.roomId}.</p>
                    {invite.message ? <p className="adm-note">{invite.message}</p> : null}
                  </div>
                  {invite.qrDataUrl ? (
                    <figure className="adm-invite__qr">
                      <img className="adm-qr" src={invite.qrDataUrl} alt={`QR code linking to ${invite.url}`} width={168} height={168} />
                      <figcaption className="oh-eyebrow">Scan to join</figcaption>
                    </figure>
                  ) : null}
                </div>
              ) : (
                <Empty title="No invite link yet">{invite.warning || "Set PUBLIC_ORIGIN on the server to generate a shareable link."}</Empty>
              )}
            </div>
          ) : null}
        </Section>
      ) : null}

      <div className="adm-columns">
        <Section eyebrow="Called" title="Number board" actions={<Badge tone="muted">{called.length}/90</Badge>}>
          <div className="adm-board" aria-hidden="true">
            {Array.from({ length: 90 }, (_, index) => index + 1).map((number) => (
              <span key={number} className="adm-board__cell oh-num" data-called={calledSet.has(number)}>
                {number}
              </span>
            ))}
          </div>
          {called.length ? (
            <details className="adm-details">
              <summary>Called history ({called.length})</summary>
              <Table>
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Number</th>
                    <th scope="col">Source</th>
                    <th scope="col">Called</th>
                  </tr>
                </thead>
                <tbody>
                  {called.map((entry) => (
                    <tr key={entry.index}>
                      <td className="oh-num">{entry.index}</td>
                      <td className="oh-num">{entry.number}</td>
                      <td>{entry.source || "—"}</td>
                      <td>{entry.at ? formatClock(entry.at) : "this process"}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </details>
          ) : (
            <Empty title="No numbers called">The board fills as the engine calls numbers.</Empty>
          )}
        </Section>

        <Section eyebrow="Seats" title="Participants" actions={<Badge tone="muted">{members.length}</Badge>}>
          {members.length ? (
            <Table>
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col">Role</th>
                  <th scope="col">Seat</th>
                  <th scope="col">Joined</th>
                  <th scope="col">
                    <span className="adm-visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.playerId}>
                    <td>
                      <span className="adm-cell-title">{member.displayName || member.playerId}</span>
                      <span className="adm-note oh-num">{member.playerId.slice(0, 10)}</span>
                    </td>
                    <td>
                      <Badge tone={member.role === "host" ? "gold" : "muted"}>{member.role}</Badge>
                    </td>
                    <td>
                      {member.leftAt ? (
                        <Badge tone="muted">left</Badge>
                      ) : member.connected ? (
                        <Badge tone="ok">connected</Badge>
                      ) : (
                        <Badge tone="warn">away</Badge>
                      )}
                    </td>
                    <td>{member.joinedAt ? formatDateTime(member.joinedAt) : "—"}</td>
                    <td>
                      {!member.leftAt && member.role !== "host" && live && !closed ? (
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => setConfirm({ kind: "remove", playerId: member.playerId, name: member.displayName || member.playerId })}
                          disabled={actionsLocked}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <Empty title="No participants yet">Players appear here after they join.</Empty>
          )}
        </Section>
      </div>

      <div className="adm-columns">
        <Section eyebrow="Arbitration" title="Claims" actions={<Badge tone="muted">{claims.length}</Badge>}>
          {claims.length ? (
            <Table>
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col">Pattern</th>
                  <th scope="col">Verdict</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Call</th>
                  <th scope="col">Decided</th>
                </tr>
              </thead>
              <tbody>
                {claims.map((claim, index) => (
                  <tr key={claim.claimId || `${claim.playerId}-${claim.pattern}-${index}`}>
                    <td>{claim.displayName || claim.playerId}</td>
                    <td>{patternLabel(claim.pattern)}</td>
                    <td>
                      <Badge tone={claimTone(claim.status)}>{statusLabel(claim.status)}</Badge>
                    </td>
                    <td>{claim.reason || "—"}</td>
                    <td className="oh-num">{formatNumber(claim.callIndex)}</td>
                    <td>{claim.decidedAt ? formatDateTime(claim.decidedAt) : "this process"}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <Empty title="No claims in this room" />
          )}
        </Section>

        <Section eyebrow="Arbitration" title="Awards" actions={<Badge tone="muted">{awards.length}</Badge>}>
          {awards.length ? (
            <Table>
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col">Pattern</th>
                  <th scope="col">Points</th>
                  <th scope="col">Call</th>
                  <th scope="col">Awarded</th>
                </tr>
              </thead>
              <tbody>
                {awards.map((award, index) => (
                  <tr key={`${award.gameNumber}-${award.playerId}-${award.pattern}-${index}`}>
                    <td>{award.displayName || award.playerId}</td>
                    <td>{patternLabel(award.pattern)}</td>
                    <td className="oh-num">{formatNumber(award.points)}</td>
                    <td className="oh-num">{formatNumber(award.callIndex)}</td>
                    <td>{award.awardedAt ? formatDateTime(award.awardedAt) : "this process"}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <Empty title="No awards in this room" />
          )}
        </Section>
      </div>

      <div className="adm-columns">
        <Section eyebrow="Rounds" title="Game records" actions={<Badge tone="muted">{rounds.length}</Badge>}>
          {rounds.length ? (
            <Table>
              <thead>
                <tr>
                  <th scope="col">Round</th>
                  <th scope="col">State</th>
                  <th scope="col">Started</th>
                  <th scope="col">Completed</th>
                  <th scope="col">Ended because</th>
                </tr>
              </thead>
              <tbody>
                {rounds.map((round) => (
                  <tr key={round.gameNumber}>
                    <td className="oh-num">{round.gameNumber}</td>
                    <td>
                      <StatusPill status={round.status} />
                    </td>
                    <td>{formatDateTime(round.startedAt)}</td>
                    <td>{formatDateTime(round.completedAt)}</td>
                    <td>{round.endReason || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <Empty title="No durable rounds">
              {state.data && state.data.durable ? "Rounds are recorded when they start." : "A database is required to record rounds."}
            </Empty>
          )}
        </Section>

        <Section eyebrow="Security" title="Room audit" actions={<Badge tone="muted">{gameAudit.length}</Badge>}>
          {gameAudit.length ? (
            <div className="adm-scroll">
              <Table>
                <thead>
                  <tr>
                    <th scope="col">Event</th>
                    <th scope="col">Player</th>
                    <th scope="col">Detail</th>
                    <th scope="col">When</th>
                  </tr>
                </thead>
                <tbody>
                  {gameAudit.map((event) => (
                    <tr key={event.eventId}>
                      <td>{event.type}</td>
                      <td className="oh-num">{event.playerId ? event.playerId.slice(0, 10) : "—"}</td>
                      <td>
                        <code className="adm-code adm-code--inline">{summarizeDetail(event.detail)}</code>
                      </td>
                      <td>{formatRelative(event.occurredAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ) : (
            <Empty title="No engine events recorded" />
          )}
        </Section>
      </div>

      <Section eyebrow="Security" title="Owner actions on this room" actions={<Badge tone="muted">{adminAudit.events.length}</Badge>}>
        {adminAudit.error ? <ErrorNote title="The owner audit could not be read" error={adminAudit.error} /> : null}
        {adminAudit.events.length ? (
          <Table>
            <thead>
              <tr>
                <th scope="col">Action</th>
                <th scope="col">Actor</th>
                <th scope="col">Target</th>
                <th scope="col">Detail</th>
                <th scope="col">When</th>
              </tr>
            </thead>
            <tbody>
              {adminAudit.events.map((event) => (
                <tr key={event.eventId}>
                  <td>
                    <code className="adm-code adm-code--inline">{event.action}</code>
                  </td>
                  <td>{event.actor || "—"}</td>
                  <td className="oh-num">{event.targetId || event.roomCode || "—"}</td>
                  <td>
                    <code className="adm-code adm-code--inline">{summarizeDetail(event.metadata)}</code>
                  </td>
                  <td>{formatRelative(event.occurredAt)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty title="No owner actions recorded for this room">
            {state.data && state.data.durable ? null : "Owner actions are kept in durable audit storage."}
          </Empty>
        )}
      </Section>

      <ConfirmDialog
        open={Boolean(confirm && confirm.kind === "close")}
        title={`Close room ${room.roomId}?`}
        description="The room leaves the lobby and its sessions are revoked. Tickets, claims, awards and history are kept."
        confirmLabel="Close room"
        busy={confirmBusy}
        onConfirm={confirmClose}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={Boolean(confirm && confirm.kind === "remove")}
        title={`Remove ${confirm ? confirm.name : "this player"}?`}
        description="The seat and session are revoked immediately. Anything they already earned stays attached to the historical record."
        confirmLabel="Remove player"
        busy={confirmBusy}
        onConfirm={confirmRemove}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
