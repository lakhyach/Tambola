import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { clearSession, isSeatGone, on, resumeSession } from "./net.js";
import Header from "./Header";
import Panel from "./components/Panel.jsx";
import PlayerRoster from "./components/PlayerRoster.jsx";

const PlayerRoom = () => {
  const navigate = useNavigate();
  const [players, setPlayers] = useState([]);
  const [roomCode, setRoomCode] = useState("");

  useEffect(() => {
    let alive = true;
    let resuming = false;

    const enter = (snapshot) => {
      if (!snapshot) return;
      setPlayers(snapshot.players || []);
      setRoomCode(snapshot.roomId);
      if (snapshot.state === "RUNNING" || snapshot.state === "PAUSED") {
        navigate("/player/game");
      }
    };

    // Re-claim the seat: at mount, and after every transport reconnect (a new
    // socket carries no session). Only a definitive refusal clears the seat.
    const resume = async () => {
      if (resuming || !alive) return;
      resuming = true;
      try {
        const resumed = await resumeSession();
        if (!alive) return;
        if (resumed.ok) enter(resumed.snapshot);
        else if (isSeatGone(resumed.code)) {
          clearSession();
          navigate("/player");
        }
      } finally {
        resuming = false;
      }
    };

    const stopUpdated = on("room:updated", (data) => setPlayers(data.players || []));
    const stopStarted = on("game:state", (data) => {
      if (data.state === "RUNNING" || data.state === "PAUSED") navigate("/player/game");
    });
    const stopTicket = on("ticket:assigned", () => navigate("/player/game"));
    const stopClosed = on("room:closed", () => {
      clearSession();
      navigate("/player");
    });
    const stopConnected = on("connect", () => resume());

    resume();

    return () => {
      alive = false;
      [stopUpdated, stopStarted, stopTicket, stopClosed, stopConnected].forEach((stop) => stop());
    };
  }, [navigate]);

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
                You’re Seated
              </h1>
              <p style={{ color: "var(--oh-text-muted)", fontSize: 14, margin: "2px 0 0" }}>
                Your ticket is held. The host starts when everyone’s in.
              </p>
            </div>
            {roomCode ? (
              <div
                className="oh-num text-right"
                style={{ padding: "8px 14px", borderRadius: 14, background: "var(--oh-inset)", border: "1px solid var(--oh-line-gold)" }}
              >
                <div className="oh-eyebrow">Room</div>
                <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: ".18em", color: "var(--oh-gold-bright)" }}>
                  {roomCode}
                </div>
              </div>
            ) : null}
          </div>
        </Panel>

        <div className="mt-4">
          <PlayerRoster players={players} leaderboard={[]} />
        </div>

        <p
          className="oh-eyebrow text-center"
          style={{ marginTop: 22, color: "var(--oh-text-faint)" }}
          role="status"
        >
          Waiting for the host to start the game…
        </p>
      </main>
    </div>
  );
};

export default PlayerRoom;
