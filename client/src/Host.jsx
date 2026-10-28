import { useState } from "react";
import { useNavigate, useLocation, Outlet } from "react-router-dom";
import { call, clearSession, saveSession, socket } from "./net.js";
import Header from "./Header";
import Panel from "./components/Panel.jsx";
import Button from "./components/Button.jsx";
import ConnectionIndicator from "./components/ConnectionIndicator.jsx";

const MIN_NAME_LENGTH = 3;

const Host = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleCreateRoom = async (e) => {
    e?.preventDefault?.();
    setError("");
    if (name.trim().length < MIN_NAME_LENGTH) {
      setError(`Your name needs at least ${MIN_NAME_LENGTH} characters.`);
      return;
    }
    if (!socket.connected) {
      setError("Not connected yet — give it a second.");
      return;
    }
    setBusy(true);
    // the room code is the server's to hand out, never the player's
    const created = await call("room:create", { name: name.trim() });
    setBusy(false);
    if (!created.ok) {
      setError(created.error || "the server could not open a room");
      return;
    }
    clearSession();
    saveSession({
      roomId: created.roomId,
      role: "host",
      name: name.trim(),
      playerId: created.playerId,
      sessionToken: created.sessionToken,
    });
    navigate(`/host/room`);
  };

  if (location.pathname !== "/host") return <Outlet />;

  return (
    <div className="flex flex-col" style={{ minHeight: "100vh" }}>
      <Header />
      <main className="flex-1 flex items-center justify-center" style={{ padding: 20 }}>
        <Panel className="p-6 sm:p-8" style={{ width: "100%", maxWidth: 420 }}>
          <h1 className="oh-display" style={{ fontSize: 30, margin: "0 0 4px" }}>
            Open a Hall
          </h1>
          <p style={{ color: "var(--oh-text-muted)", margin: "0 0 20px", fontSize: 14 }}>
            You’ll be handed a room code to share. The server creates the game.
          </p>
          <form onSubmit={handleCreateRoom}>
            <label className="oh-eyebrow" htmlFor="host-name" style={{ display: "block", marginBottom: 6 }}>
              Your name
            </label>
            <input
              id="host-name"
              className="oh-field"
              value={name}
              maxLength={20}
              autoComplete="off"
              placeholder="e.g. Priya"
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit" variant="gold" block className="mt-4" disabled={busy}>
              {busy ? "Opening…" : "Create Room"}
            </Button>
          </form>
          {error ? (
            <p role="alert" className="mt-3" style={{ color: "var(--oh-danger)", fontSize: 13 }}>
              {error}
            </p>
          ) : null}
          <div className="mt-5 flex justify-between items-center">
            <ConnectionIndicator />
            <span className="oh-eyebrow" style={{ color: "var(--oh-text-faint)" }}>Free to play</span>
          </div>
        </Panel>
      </main>
    </div>
  );
};

export default Host;
