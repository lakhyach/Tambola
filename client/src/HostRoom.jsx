import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { call, clearSession, isSeatGone, on, resumeSession, socket } from "./net.js";
import Header from "./Header";
import Panel from "./components/Panel.jsx";
import Button from "./components/Button.jsx";
import PlayerRoster from "./components/PlayerRoster.jsx";
import TicketPicker from "./components/TicketPicker.jsx";
import TambolaTicket from "./components/TambolaTicket.jsx";
import { INVITE_TEXT, INVITE_TITLE } from "./brand.js";

const HostRoom = () => {
  const navigate = useNavigate();
  const [players, setPlayers] = useState([]);
  const [roomCode, setRoomCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [tickets, setTickets] = useState({ count: 1, max: 1 });
  const [previews, setPreviews] = useState([]);

  const pickCount = async (count) => {
    const result = await call("tickets:select", { count });
    if (result.ok) {
      setTickets({ count: result.ticketCount, max: result.maxTickets });
      setPreviews(Array.isArray(result.tickets) ? result.tickets : []);
    } else setError(result.code === "TICKET_LIMIT" ? `This room allows at most ${result.max} tickets.` : result.error || "the server did not accept that");
  };

  useEffect(() => {
    let alive = true;
    let resuming = false;

    const enter = (snapshot) => {
      if (!snapshot) return;
      // The host view is the only snapshot carrying `hostConnected`. If the
      // server answered with a player snapshot, this seat is not the room's
      // host — keep the (valid) player session and move to the player room
      // rather than showing host controls the server would refuse.
      if (snapshot.hostConnected === undefined) {
        navigate("/player/room", { replace: true });
        return;
      }
      setRoomCode(snapshot.roomId);
      setPlayers(snapshot.players || []);
      setTickets({ count: snapshot.ticketCount ?? 1, max: snapshot.maxTickets ?? 1 });
      setPreviews(Array.isArray(snapshot.tickets) ? snapshot.tickets : []);
      if (snapshot.state === "RUNNING") navigate("/host/game");
    };

    // Server-backed restoration: the saved host credential re-claims the room,
    // at mount and again after any transport reconnect (a fresh socket carries
    // no session). Only a definitively-dead seat drops the credential; a
    // transient failure (still connecting, a timeout) keeps it and retries.
    const resume = async () => {
      if (resuming || !alive) return;
      resuming = true;
      try {
        const resumed = await resumeSession();
        if (!alive) return;
        if (resumed.ok) enter(resumed.snapshot);
        else if (isSeatGone(resumed.code)) {
          clearSession();
          navigate("/host");
        }
      } finally {
        resuming = false;
      }
    };

    const stopUpdated = on("room:updated", (data) => setPlayers(data.players || []));
    const stopStarted = on("game:state", (data) => {
      if (data.state === "RUNNING") navigate("/host/game");
    });
    const stopClosed = on("room:closed", () => {
      clearSession();
      navigate("/host");
    });
    const stopConnected = on("connect", () => resume());

    resume();

    return () => {
      alive = false;
      [stopUpdated, stopStarted, stopClosed, stopConnected].forEach((stop) => stop());
    };
  }, [navigate]);

  const shareLink = `${window.location.origin}/player?id=${roomCode}`;

  const handleStartGame = async () => {
    if (!roomCode || busy) return;
    if (!socket.connected) {
      setError("Not connected yet — give it a second.");
      return;
    }
    setBusy(true);
    setError("");
    const started = await call("game:start");
    if (!started.ok) {
      setBusy(false);
      setError(started.error || "the server would not start the game");
      return;
    }
    navigate("/host/game");
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Copy failed — share the code manually.");
    }
  };

  const nativeShare = () => {
    if (navigator.share) {
      navigator.share({ title: INVITE_TITLE, text: INVITE_TEXT, url: shareLink }).catch(() => {});
    } else {
      copyLink();
    }
  };

  return (
    <div className="flex flex-col" style={{ minHeight: "100vh" }}>
      <Header />
      <main
        className="flex-1 w-full"
        style={{ maxWidth: 640, marginInline: "auto", padding: "12px 20px 40px" }}
      >
        <Panel className="p-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="oh-display" style={{ fontSize: 24, margin: 0 }}>
                The Hall is Open
              </h1>
              <p style={{ color: "var(--oh-text-muted)", fontSize: 14, margin: "2px 0 0" }}>
                Waiting for players to take their seats…
              </p>
            </div>
            <div
              className="oh-num text-right"
              style={{
                padding: "8px 14px",
                borderRadius: 14,
                background: "var(--oh-inset)",
                border: "1px solid var(--oh-line-gold)",
              }}
            >
              <div className="oh-eyebrow">Room code</div>
              <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: ".18em", color: "var(--oh-gold-bright)" }}>
                {roomCode || "…"}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mt-4">
            <Button variant="ghost" size="sm" onClick={copyLink}>
              {copied ? "Link Copied" : "Copy Invite Link"}
            </Button>
            <Button variant="ghost" size="sm" onClick={nativeShare}>
              Share Invite
            </Button>
          </div>
        </Panel>

        <div className="mt-4">
          <TicketPicker value={tickets.count} max={tickets.max} disabled={busy} onPick={pickCount} />
        </div>

        {previews.length > 0 ? (
          <div className="mt-5">
            <div className="oh-eyebrow" style={{ marginBottom: 8, color: "var(--oh-text-faint)" }}>
              Preview — these are the exact tickets you will play
            </div>
            <div className="flex flex-col gap-3">
              {previews.map((t) => (
                <TambolaTicket
                  key={`pv-${t.no}`}
                  ticket={t.grid}
                  calledNumbers={[]}
                  ticketNo={t.no}
                  ticketTotal={previews.length}
                />
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-4">
          <PlayerRoster players={players} leaderboard={[]} />
        </div>

        <Button variant="gold" block className="mt-5" onClick={handleStartGame} disabled={busy}>
          {busy ? "Starting…" : "Start Game"}
        </Button>
        {error ? (
          <p role="alert" className="mt-3 text-center" style={{ color: "var(--oh-danger)", fontSize: 13 }}>
            {error}
          </p>
        ) : null}
      </main>
    </div>
  );
};

export default HostRoom;
