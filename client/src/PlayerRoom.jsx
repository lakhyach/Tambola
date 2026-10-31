import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { call, clearSession, isSeatGone, on, resumeSession } from "./net.js";
import Header from "./Header";
import Panel from "./components/Panel.jsx";
import PlayerRoster from "./components/PlayerRoster.jsx";
import TicketPicker from "./components/TicketPicker.jsx";
import TicketRail from "./components/TicketRail.jsx";

// nothing has been called before a round starts, and a fresh [] every render
// would defeat the ticket's memoisation
const NO_CALLS = [];

const PlayerRoom = () => {
  const navigate = useNavigate();
  const [players, setPlayers] = useState([]);
  const [roomCode, setRoomCode] = useState("");
  const [tickets, setTickets] = useState({ count: 1, max: 1 });
  const [previews, setPreviews] = useState([]);
  const [note, setNote] = useState("");

  const applyCounts = (snapshot) => {
    if (!snapshot) return;
    setTickets({ count: snapshot.ticketCount ?? 1, max: snapshot.maxTickets ?? 1 });
    setPreviews(Array.isArray(snapshot.tickets) ? snapshot.tickets : []);
  };

  const pickCount = async (count) => {
    const result = await call("tickets:select", { count });
    if (result.ok) {
      setTickets({ count: result.ticketCount, max: result.maxTickets });
      setPreviews(Array.isArray(result.tickets) ? result.tickets : []);
      setNote("");
    } else {
      setNote(
        result.code === "TICKET_LIMIT"
          ? `This room allows at most ${result.max} tickets.`
          : result.error || "the server did not accept that"
      );
    }
  };

  useEffect(() => {
    let alive = true;
    let resuming = false;

    const enter = (snapshot) => {
      if (!snapshot) return;
      setPlayers(snapshot.players || []);
      setRoomCode(snapshot.roomId);
      applyCounts(snapshot);
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
        style={{ maxWidth: 980, marginInline: "auto", padding: "12px 20px 40px" }}
      >
        <div
          data-oh-room-grid="true"
          style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)", alignItems: "start" }}
        >
          <div className="flex flex-col gap-4">
            <Panel className="p-6">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h1 className="oh-display" style={{ fontSize: 24, margin: 0 }}>
                    You’re Seated
                  </h1>
                  <p style={{ color: "var(--oh-text-muted)", fontSize: 14, margin: "2px 0 0" }}>
                    Your seat is held. Choose how many tickets to play — the host starts
                    when everyone’s ready.
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

            <TicketPicker value={tickets.count} max={tickets.max} onPick={pickCount} />
            {note ? (
              <p role="alert" className="text-center" style={{ color: "var(--oh-danger)", fontSize: 13 }}>
                {note}
              </p>
            ) : null}

            <PlayerRoster players={players} leaderboard={[]} />

            <p
              className="oh-eyebrow text-center"
              style={{ color: "var(--oh-text-faint)" }}
              role="status"
            >
              Waiting for the host to start the game…
            </p>
          </div>

          {previews.length > 0 ? (
            <div className="flex flex-col gap-3">
              {/* A caption, not a heading: the tracked eyebrow style turned this
                  sentence into two shouting lines above the tabs on a phone. */}
              <p style={{ color: "var(--oh-text-muted)", fontSize: 13, margin: 0 }}>
                These are the exact tickets you’ll play.
              </p>
              {/* one ticket at a time behind tabs, exactly as it is played: four
                  stacked previews pushed the hall and the status line off-screen */}
              <TicketRail tickets={previews} calledNumbers={NO_CALLS} />
            </div>
          ) : null}
        </div>

        <style>{`
          @media (min-width: 900px) {
            [data-oh-room-grid="true"] { grid-template-columns: minmax(0, 1fr) minmax(0, 400px) !important; }
          }
        `}</style>
      </main>
    </div>
  );
};

export default PlayerRoom;
