import { useEffect, useState } from "react";
import { socket } from "../net.js";

/**
 * Live Socket.IO status. Reads the transport the same way the rest of the app
 * does, so it reflects the truth about reconnection rather than a guess.
 */
// eslint-disable-next-line react/prop-types
const ConnectionIndicator = ({ className = "" }) => {
  const [status, setStatus] = useState(socket.connected ? "online" : "connecting");

  useEffect(() => {
    const online = () => setStatus("online");
    const offline = () => setStatus("offline");
    socket.on("connect", online);
    socket.on("disconnect", offline);
    socket.io.on("reconnect_attempt", () => setStatus("connecting"));
    // settle the initial value in case it changed between render and effect
    if (socket.connected) setStatus("online");
    return () => {
      socket.off("connect", online);
      socket.off("disconnect", offline);
    };
  }, []);

  const tone =
    status === "online" ? "var(--oh-ok)" : status === "connecting" ? "var(--oh-warn)" : "var(--oh-danger)";
  const word =
    status === "online" ? "Connected" : status === "connecting" ? "Reconnecting…" : "Offline";

  return (
    <span
      className={`inline-flex items-center gap-2 text-xs uppercase tracking-wider ${className}`}
      style={{ color: "var(--oh-text-muted)" }}
      role="status"
      aria-live="polite"
    >
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: tone,
          boxShadow: `0 0 0 3px ${tone}22`,
        }}
      />
      {word}
    </span>
  );
};

export default ConnectionIndicator;
