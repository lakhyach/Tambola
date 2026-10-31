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
import {
  announce,
  celebrateSound,
  getAnnounceSettings,
  onAnnouncePending,
  resetAnnouncements,
  seedAnnouncements,
  setAnnounceSetting,
  stopAnnouncements,
} from "./lib/announce.js";
import GameShell from "./components/GameShell.jsx";
import CelebrationOverlay from "./components/CelebrationOverlay.jsx";
import { patternEvent, finalEvent } from "./lib/celebration.js";
import { ticketSheets } from "./lib/playerview.js";
import { refusalText } from "./lib/refusals.js";
import { config, resolveLang } from "./config.js";

const CELEBRATE_LANG = resolveLang(config.i18n.default);

// `role` is a literal from HostGame.jsx ("host") or PlayerGame.jsx ("player").
// eslint-disable-next-line react/prop-types
const GameScreen = ({ role }) => {
  const navigate = useNavigate();
  const isHost = role === "host";

  const [snap, setSnap] = useState(null);
  const [serverRole, setServerRole] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [sound, setSound] = useState(getAnnounceSettings());
  const [celebrations, setCelebrations] = useState([]);
  const messageTimer = useRef(null);
  // Session-scoped idempotency: a given verified event is celebrated once, even
  // if the socket delivers it twice. It resets on remount, which is exactly the
  // behaviour we want — after a refresh the past events are not re-sent, so
  // nothing replays.
  const celebrated = useRef(new Set());
  const roomIdRef = useRef("");

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

  // Queue a celebration built from a VERIFIED server event. Deduped by id.
  const enqueueCelebration = useCallback((event) => {
    if (!event || celebrated.current.has(event.id)) return;
    celebrated.current.add(event.id);
    setCelebrations((q) => [...q, event]);
    celebrateSound();
  }, []);

  const dismissCelebration = useCallback(() => setCelebrations((q) => q.slice(1)), []);

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
          } else if (resumed.code === "NOT_PLAYER") {
            // No saved seat on this device at all. Do not render a ghost board
            // with controls the server would refuse — send the visitor back to
            // the entry screen for their role.
            navigate(isHost ? "/host" : "/player", { replace: true });
          } else if (resumed.code !== "DISCONNECTED") {
            flash("Reconnecting to the room…", 2500);
          }
          return;
        }
        if (resumed.snapshot) {
          setSnap(resumed.snapshot);
          // A reconnect must not read the board aloud from call 1: seed the
          // queue's replay guard with everything already called, so only FRESH
          // `number:called` events announce from here on.
          const idx = resumed.snapshot.calledCount;
          if (Number.isInteger(idx)) seedAnnouncements(idx);
        }
        // The resume ack's role is the authoritative statement of what this
        // seat is allowed to be. Trust it over any snapshot shape, because the
        // in-game screen also builds partial synthetic snapshots from pushes
        // (ticket:assigned) that may arrive before the first full one.
        if (resumed.role) setServerRole(resumed.role);
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
      // Announce the number from the authoritative event itself, keyed by its
      // server call index. Feeding the queue here (and not off the snapshot's
      // `lastCall`) means two calls landing before one state fetch completes
      // BOTH get announced, in order — the old snapshot-diff path silently
      // dropped the first of them.
      on("number:called", (data) => {
        if (!alive) return;
        if (data && Number.isInteger(data.number)) announce(data.number, data.index);
        refresh();
      }),
      on("game:state", (data) => {
        if (!alive) return;
        // A brand-new round forgets the previous round's call-index guard so the
        // same indices announce again; a finished/ended round drops any
        // announcement still queued behind the last call.
        if (data && data.state === "WAITING") resetAnnouncements();
        if (data && (data.state === "COMPLETED" || data.state === "PAUSED")) stopAnnouncements();
        refresh();
      }),
      on("room:updated", () => alive && refresh()),
      on("host:changed", () => alive && refresh()),
      on("game:completed", (data) => {
        if (!alive) return;
        flash("Game over — " + (data.leaderboard?.[0]?.player || "nobody") + " leads", 5000);
        enqueueCelebration(finalEvent(data, roomIdRef.current, CELEBRATE_LANG));
        refresh();
      }),
      on("claim:result", (data) => {
        if (!alive) return;
        if (data.won) {
          flash(data.name + " won " + data.label, 3500);
          enqueueCelebration(patternEvent(data, roomIdRef.current, CELEBRATE_LANG));
        }
        refresh();
      }),
      on("ticket:assigned", (data) => {
        if (!alive) return;
        setSnap((prev) => {
          const base = prev || {};
          const tickets = Array.isArray(base.tickets) ? base.tickets.slice() : [];
          const no = data.ticketNo || tickets.length + 1;
          const existing = tickets.findIndex((t) => t.no === no);
          if (existing >= 0) tickets[existing] = { no, grid: data.ticket };
          else tickets.push({ no, grid: data.ticket });
          tickets.sort((a, b) => a.no - b.no);
          const first = tickets.length ? tickets[0].grid : data.ticket;
          return { ...base, ticket: first, tickets, ticketCount: data.ticketCount ?? tickets.length };
        });
      }),
      on("room:closed", (data) => {
        if (!alive) return;
        stopAnnouncements();
        clearSession();
        flash("Room " + (data.roomId || "") + " is closed", 2000);
        setTimeout(() => navigate("/"), 1800);
      }),
      on("app:error", (data) => alive && flash(data.error || "the server refused that", 2500)),
    ];

    // Track how many announcements are waiting behind the current one, so the
    // UI can honestly say the voice is lagging instead of implying it is synced.
    // The same notification also carries the engine's health: when speech dies
    // mid-round the chip has to stop claiming VOICE (see GameHeader).
    const offPending = onAnnouncePending((pending) => {
      if (!alive) return;
      const next = getAnnounceSettings();
      setSound((s) => (s.pending === pending && s.dead === next.dead ? s : { ...s, pending, dead: next.dead }));
    });

    return () => {
      alive = false;
      off.forEach((stop) => stop());
      offPending();
      stopAnnouncements();
      if (messageTimer.current) clearTimeout(messageTimer.current);
    };
  }, [navigate, refresh, flash, isHost, enqueueCelebration]);

  // Keep the celebration id scope current with the room this seat is in.
  useEffect(() => {
    if (snap?.roomId) roomIdRef.current = snap.roomId;
  }, [snap?.roomId]);

  // A host route must be backed by real host authority. The server's resume
  // ack reports this seat's role; if it says "player" while someone is sitting
  // on the host screen, they are an ordinary player who forced the URL — send
  // them to the player room (which forwards on to the game if it is running)
  // rather than showing draw controls the server would only refuse.
  useEffect(() => {
    if (isHost && serverRole === "player") {
      navigate("/player/room", { replace: true });
    }
  }, [isHost, serverRole, navigate]);

  // announce a number only when the server has actually called a new one
  // (handled at the `number:called` listener above, keyed by the server's own
  //  call index — no snapshot diffing, so no number is ever dropped).

  const selectTicketCount = useCallback(
    async (count) => {
      const result = await call("tickets:select", { count });
      if (!result.ok) {
        if (result.code === "TICKET_LIMIT") flash("This room allows at most " + result.max + " tickets", 2500);
        else flash(refusalText(result), 2500);
        await refresh();
        return result;
      }
      setSnap((prev) => ({
        ...(prev || {}),
        tickets: result.tickets,
        ticket: result.tickets.length ? result.tickets[0].grid : null,
        ticketCount: result.ticketCount,
        maxTickets: result.maxTickets,
      }));
      return result;
    },
    [flash, refresh]
  );

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

  // Master switch: turns the whole announcement layer on/off. Speech only
  // actually engages when the browser reports an engine (autoplay gesture too).
  const toggleSound = useCallback(() => {
    const next = !(sound.speech || sound.chime);
    setAnnounceSetting("chime", next);
    setAnnounceSetting("speech", next && sound.available.speech);
    setSound(getAnnounceSettings());
    if (next && !sound.available.speech) {
      flash("Sound on. Spoken numbers need a browser voice engine; the chime plays.", 3500);
    }
  }, [sound, flash]);

  // Mute the SPOKEN numbers alone — the chime and everything visual continue.
  // While the engine is dead the same tap is a RETRY instead: the switch is
  // still "on", so asking for on again is what restarts the queue (see
  // announce-queue.js setEnabled). Muting stays reachable from the master switch.
  const toggleSpeech = useCallback(() => {
    if (!sound.available.speech) {
      flash("This browser has no speech engine, so there is nothing to mute.", 3000);
      return;
    }
    if (sound.dead) {
      setSound(setAnnounceSetting("speech", true));
      flash("Trying the spoken numbers again…", 2000);
      return;
    }
    setSound(setAnnounceSetting("speech", !sound.speech));
  }, [sound, flash]);

  // Say it out loud exactly once when the engine stops: a muted-looking chip
  // with a live board is the one contradiction this screen must never ship.
  const announcedDeath = useRef(false);
  useEffect(() => {
    if (sound.dead && !announcedDeath.current) {
      announcedDeath.current = true;
      flash("Spoken numbers stopped in this browser. The board keeps calling — tap RETRY to hear them again.", 6000);
    } else if (!sound.dead) {
      announcedDeath.current = false;
    }
  }, [sound.dead, flash]);

  // Switch the announcement language (English <-> Hindi). Display text is
  // unaffected; only the voice and the spoken number form change.
  const toggleSpeechLang = useCallback(() => {
    const next = sound.speechLang === "hi" ? "en" : "hi";
    setSound(setAnnounceSetting("speechLang", next));
  }, [sound]);

  // All values below are derived views of the single server snapshot.
  const sheets = ticketSheets(snap);
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
    // Only what the server actually issued. An empty list is a real state (a seat
    // that joined mid-round has no ticket), and GameShell renders it as one — the
    // placeholder grid that used to sit here made that screen look broken.
    tickets: sheets,
    ticket: sheets.length ? sheets[0].grid : null,
    ticketCount: snap?.ticketCount ?? 1,
    maxTickets: snap?.maxTickets ?? 1,
    playerId: snap?.playerId,
    name: snap?.name || "",
    points: snap?.points ?? 0,
    busy,
    sound,
    message,
    onToggleSound: toggleSound,
    onToggleSpeech: toggleSpeech,
    onToggleSpeechLang: toggleSpeechLang,
    onClaim: submitClaim,
    onHostAction: hostAction,
    onSelectTicketCount: selectTicketCount,
  };

  return (
    <>
      <GameShell role={isHost ? "host" : "player"} view={view} />
      <CelebrationOverlay
        event={celebrations[0] || null}
        onDismiss={dismissCelebration}
        soundOn={Boolean(sound.chime || sound.speech)}
        onToggleSound={toggleSound}
      />
    </>
  );
};

export default GameScreen;
