import { useState, useEffect } from "react";
import { useLocation, useNavigate, Outlet, useSearchParams } from "react-router-dom";
import { call, clearSession, loadSession, saveSession, socket } from "./net.js";
import Header from "./Header";
import Panel from "./components/Panel.jsx";
import Button from "./components/Button.jsx";
import ConnectionIndicator from "./components/ConnectionIndicator.jsx";

const Player = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const searchTerm = searchParams.get("id");

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (searchTerm) setCode(searchTerm.toUpperCase());
    // A saved seat auto-resumes from the join page only. This component is the
    // layout for /player/room and /player/game too, and those screens re-claim
    // their own seat - redirecting from here would bounce a seated player out
    // of the game they are already in.
    const saved = loadSession();
    if (location.pathname === "/player" && !searchTerm && saved.roomId && saved.role === "player") {
      navigate(`/player/room`);
    }
  }, [navigate, searchTerm, location.pathname]);

  const handleJoinClick = async (e) => {
    e?.preventDefault?.();
    setError("");
    if (name.trim().length < 3) {
      setError("Your name needs at least 3 characters.");
      return;
    }
    if (!code.trim()) {
      setError("Enter the room code your host shared.");
      return;
    }
    if (!socket.connected) {
      setError("Not connected yet — give it a second.");
      return;
    }
    setBusy(true);
    // one ack, one truth: the server hands back the identity this session uses
    const joined = await call("room:join", { roomId: code.trim(), name: name.trim() });
    setBusy(false);
    if (!joined.ok) {
      setError(joined.error || "could not join that room");
      return;
    }
    clearSession();
    saveSession({
      roomId: joined.snapshot.roomId,
      role: "player",
      name: joined.name,
      playerId: joined.playerId,
      sessionToken: joined.sessionToken,
    });
    navigate(`/player/room`);
  };

  if (location.pathname !== "/player") return <Outlet />;

  return (
    <div className="flex flex-col" style={{ minHeight: "100vh" }}>
      <Header />
      <main className="flex-1 flex items-center justify-center" style={{ padding: 20 }}>
        <Panel className="p-6 sm:p-8" style={{ width: "100%", maxWidth: 420 }}>
          <h1 className="oh-display" style={{ fontSize: 30, margin: "0 0 4px" }}>
            Take Your Seat
          </h1>
          <p style={{ color: "var(--oh-text-muted)", margin: "0 0 20px", fontSize: 14 }}>
            Enter the code your host shared. The server gives you one ticket.
          </p>
          <form onSubmit={handleJoinClick}>
            <label className="oh-eyebrow" htmlFor="player-name" style={{ display: "block", marginBottom: 6 }}>
              Your name
            </label>
            <input
              id="player-name"
              className="oh-field"
              value={name}
              maxLength={20}
              autoComplete="off"
              placeholder="e.g. Arjun"
              onChange={(e) => setName(e.target.value)}
            />
            <label className="oh-eyebrow" htmlFor="player-code" style={{ display: "block", margin: "16px 0 6px" }}>
              Room code
            </label>
            <input
              id="player-code"
              className="oh-field oh-num"
              value={code}
              maxLength={12}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="ABC123"
              style={{ letterSpacing: ".2em", textTransform: "uppercase" }}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <Button type="submit" variant="gold" block className="mt-4" disabled={busy}>
              {busy ? "Joining…" : "Join Room"}
            </Button>
          </form>
          {error ? (
            <p role="alert" className="mt-3" style={{ color: "var(--oh-danger)", fontSize: 13 }}>
              {error}
            </p>
          ) : null}
          <div className="mt-5 flex justify-between items-center">
            <ConnectionIndicator />
            <span className="oh-eyebrow" style={{ color: "var(--oh-text-faint)" }}>One ticket per seat</span>
          </div>
        </Panel>
      </main>
    </div>
  );
};

export default Player;
