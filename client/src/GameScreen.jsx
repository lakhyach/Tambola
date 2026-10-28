/**
 * In-game screen for both roles. This file is the *data* half of the game
 * experience: it owns the connection to the server, keeps a local mirror of the
 * authoritative snapshot, and hands a plain `view` object to GameShell (which
 * owns presentation only). Nothing here generates a number, a ticket or a score
 * — every value comes from the server.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { call, clearSession, fetchState, isSeatGone, on, resumeSession } from "./net.js";
import { announce, getAnnounceSettings, setAnnounceSetting } from "./lib/announce.js";
import GameShell from "./components/GameShell.jsx";

/** server refusal codes -> something a player can read */
const REFUSAL = {
  ALREADY_AWARDED: "someone else already won that one",
  ALREADY_CLAIMED_BY_YOU: "you already claimed that",
  INVALID_STATE: "the game is not running right now",
  INVALID_TRANSITION: "that is not possible in this state",
  UNKNOWN_PATTERN: "that pattern is not part of this game",
  NOT_HOST: "only the host may do that",
  NOT_PLAYER: "you are not in this room any more",
  BAD_PAYLOAD: "the server did not accept that",
  RATE_LIMITED: "slow down a moment",
  DRAW_EXHAUSTED: "all 90 numbers have been called",
};

const refusalText = (result) =>
  REFUSAL[result.code] || result.error || "the server said no";

// `role` is a literal from HostGame.jsx ("host") or PlayerGame.jsx ("player").
// eslint-disable-next-line react/prop-types
const GameScreen = ({ role }) => {
  const navigate = useNavigate();
  const isHost = role === "host";

  const [snap, setSnap] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [sound, setSound] = useState(getAnnounceSettings());
  const messageTimer = useRef(null);
  const lastAnnounced = useRef(null);

  const refresh = useCallback(async () => {
    const result = await fetchState();
    if (result.ok) {
      setSnap(result.snapshot);
    } else if (result.code === "ROOM_NOT_FOUND") {
      // The room left the process; nothing is left to show.
      clearSession();
      navigate("/");
    }
    // NOT_PLAYER only means this socket lost its seat (a reconnect). The
    // saved token can still claim it again, so the credential is kept.
    return result;
  }, [navigate]);

  const flash = useCallback((text, ms = 3000) => {
    setMessage(text);
    if (messageTimer.current) clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setMessage(""), ms);
  }, []);

  // join / re-join, then keep the mirror in step with the room's pushes
  useEffect(() => {
    let alive = true;
    let resuming = false;

    /**
     * Claim the saved seat on THIS socket. Runs at mount and again after every
     * transport reconnect: Socket.IO gives the client a new socket with no
     * session, so without this a dropped connection would silently eject a
     * player whose ticket is still held by the server.
     */
    const resume = async () => {
      if (resuming || !alive) return;
      resuming = true;
      try {
        const resumed = await resumeSession();
        if (!alive) return;
        if (!resumed.ok) {
          if (isSeatGone(resumed.code)) {
            clearSession();
            flash(resumed.error || "this room is gone", 2000);
            setTimeout(() => navigate("/"), 1800);
          } else if (resumed.code !== "DISCONNECTED") {
            flash("Reconnecting to the room…", 2500);
          }
          return;
        }
        if (resumed.snapshot) setSnap(resumed.snapshot);
        await refresh();
      } finally {
        resuming = false;
      }
    };

    resume();

    const off = [
      on("connect", () => {
        if (alive) resume();
      }),
      on("number:called", () => alive && refresh()),
      on("game:state", () => alive && refresh()),
      on("room:updated", () => alive && refresh()),
      on("host:changed", () => alive && refresh()),
      on("game:completed", (data) => {
        if (!alive) return;
        flash("Game over — " + (data.leaderboard?.[0]?.player || "nobody") + " leads", 5000);
        refresh();
      }),
      on("claim:result", (data) => {
        if (!alive) return;
        if (data.won) flash(data.name + " won " + data.label, 3500);
        refresh();
      }),
      on("ticket:assigned", (data) => {
        if (alive) setSnap((prev) => ({ ...(prev || {}), ticket: data.ticket }));
      }),
      on("room:closed", (data) => {
        if (!alive) return;
        clearSession();
        flash("Room " + (data.roomId || "") + " is closed", 2000);
        setTimeout(() => navigate("/"), 1800);
      }),
      on("app:error", (data) => alive && flash(data.error || "the server refused that", 2500)),
    ];

    return () => {
      alive = false;
      off.forEach((stop) => stop());
      if (messageTimer.current) clearTimeout(messageTimer.current);
    };
  }, [navigate, refresh, flash]);

  // announce a number only when the server has actually called a new one
  useEffect(() => {
    const current = snap?.lastCall;
    if (current != null && current !== lastAnnounced.current) {
      lastAnnounced.current = current;
      announce(current);
    }
  }, [snap?.lastCall]);

  const submitClaim = useCallback(
    async (pattern) => {
      const result = await call("claim:submit", { pattern });
      if (!result.ok) {
        flash(refusalText(result), 2500);
        return;
      }
      if (result.won) {
        flash("You completed " + result.label + " · +" + result.points, 3500);
      }
      await refresh();
    },
    [flash, refresh]
  );

  const hostAction = useCallback(
    async (event, payload) => {
      if (busy) return;
      setBusy(true);
      const result = await call(event, payload);
      if (!result.ok) flash(refusalText(result), 2200);
      await refresh();
      setBusy(false);
    },
    [busy, flash, refresh]
  );

  const toggleSound = useCallback(() => {
    const next = !(sound.speech || sound.chime);
    setAnnounceSetting("chime", next);
    setAnnounceSetting("speech", next && sound.available.speech);
    setSound(getAnnounceSettings());
    if (next && !sound.available.speech) {
      flash("Sound on. Spoken numbers need a browser voice engine; the chime plays.", 3500);
    }
  }, [sound, flash]);

  // All values below are derived views of the single server snapshot.
  const view = {
    roomId: snap?.roomId || "",
    state: snap?.state || "WAITING",
    calledCount: snap?.calledCount ?? 0,
    remaining: snap?.remaining ?? null,
    lastCall: snap?.lastCall ?? null,
    autoCall: Boolean(snap?.autoCall),
    enabledPatterns: snap?.enabledPatterns || [],
    calledNumbers: snap?.calledNumbers || [],
    awards: snap?.awards || [],
    leaderboard: snap?.leaderboard || [],
    players: snap?.players || [],
    ticket: snap?.ticket || [[], [], []],
    playerId: snap?.playerId,
    name: snap?.name || "",
    points: snap?.points ?? 0,
    busy,
    sound,
    message,
    onToggleSound: toggleSound,
    onClaim: submitClaim,
    onHostAction: hostAction,
  };

  return <GameShell role={isHost ? "host" : "player"} view={view} />;
};

export default GameScreen;
