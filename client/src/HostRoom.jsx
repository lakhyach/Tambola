import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { call, clearSession, on, resumeSession, socket } from "./net.js";
import Header from "./Header";
import Panel from "./components/Panel.jsx";
import Button from "./components/Button.jsx";
import PlayerRoster from "./components/PlayerRoster.jsx";

const HostRoom = () => {
  const navigate = useNavigate();
  const [players, setPlayers] = useState([]);
  const [roomCode, setRoomCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const enter = (snapshot) => {
      if (!snapshot) return;
      setRoomCode(snapshot.roomId);
      setPlayers(snapshot.players || []);
      if (snapshot.state === "RUNNING") navigate("/host/game");
    };

    const stopUpdated = on("room:updated", (data) => setPlayers(data.players || []));
    const stopStarted = on("game:state", (data) => {
      if (data.state === "RUNNING") navigate("/host/game");
    });
    const stopClosed = on("room:closed", () => {
      clearSession();
      navigate("/host");
    });

    // Server-backed restoration: the saved host credential re-claims the room.
    resumeSession().then((resumed) => {
      if (!resumed.ok) {
        clearSession();
        navigate("/host");
        return;
      }
      enter(resumed.snapshot);
    });

    return () => [stopUpdated, stopStarted, stopClosed].forEach((stop) => stop());
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
      navigator.share({ title: "Tambola", text: "Join my Tambola room", url: shareLink }).catch(() => {});
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
