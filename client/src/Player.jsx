import { useState, useEffect } from "react";
import { useLocation, useNavigate, Outlet, useSearchParams } from "react-router-dom";
import { call, clearSession, loadOwnSession, loadPendingSession, saveSession, socket } from "./net.js";
import { offeredSeatLabel, planJoinEntry } from "./lib/joinSeat.js";
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
  // A seat this browser remembers while this tab holds none. Not taken silently:
  // see lib/joinSeat.js for why a new tab must ask before becoming that player.
  const [offer, setOffer] = useState(null);

  useEffect(() => {
    const plan = planJoinEntry({
      pathname: location.pathname,
      searchTerm,
      own: loadOwnSession(),
      pending: loadPendingSession(),
    });
    if (plan.code) setCode(plan.code);
    // This tab's own seat is the only one that may be resumed without asking.
    // The component is also the layout for /player/room and /player/game, and
    // those screens re-claim their seat themselves — so the plan ignores them,
    // otherwise a seated player would be bounced out of the game they are in.
    if (plan.action === "resume") navigate(`/player/room`);
    else if (plan.action === "offer") setOffer(plan.seat);
  }, [navigate, searchTerm, location.pathname]);

  const reclaimSeat = () => {
    if (!offer) return;
    // Make it this tab's seat, then let the room screen do the resuming it
    // already does on every reconnect — one resume path, not two.
    saveSession(offer);
    setOffer(null);
    navigate(`/player/room`);
  };

  const declineSeat = () => {
    setOffer(null);
    setError("");
  };

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
            Enter the code your host shared. You can choose how many tickets to play.
          </p>
          {offer ? (
            <div
              className="mb-5"
              role="status"
              style={{
                padding: "12px 14px",
                borderRadius: 14,
                background: "var(--oh-inset)",
                border: "1px solid var(--oh-line-gold)",
              }}
            >
              <div className="oh-eyebrow" style={{ color: "var(--oh-gold)", marginBottom: 6 }}>
                Seat this browser remembers
              </div>
              <p style={{ margin: "0 0 10px", fontSize: 14 }}>
                {offeredSeatLabel(offer)} — is that you, in this tab?
              </p>
              <div className="flex gap-2 flex-wrap">
                <Button variant="gold" size="sm" onClick={reclaimSeat}>
                  Take that seat
                </Button>
                <Button variant="ghost" size="sm" onClick={declineSeat}>
                  I’m a new player
                </Button>
              </div>
            </div>
          ) : null}
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
            <span className="oh-eyebrow" style={{ color: "var(--oh-text-faint)" }}>Choose your tickets before the round</span>
          </div>
        </Panel>
      </main>
    </div>
  );
};

export default Player;
