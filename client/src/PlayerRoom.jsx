import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { call, clearSession, isSeatGone, on, resumeSession } from "./net.js";
import Header from "./Header";
import PublicBack from "./components/PublicBack.jsx";
import Panel from "./components/Panel.jsx";
import ConnectionIndicator from "./components/ConnectionIndicator.jsx";
import PlayerRoster from "./components/PlayerRoster.jsx";
import TicketPicker from "./components/TicketPicker.jsx";
import TicketRail from "./components/TicketRail.jsx";
import BookingLanguageSelect from "./i18n/BookingLanguageSelect.jsx";
import { bookingCopy, bookingRefusalText, setBookingLanguage, useBookingLanguage } from "./i18n/booking-locale.js";

// nothing has been called before a round starts, and a fresh [] every render
// would defeat the ticket's memoisation
const NO_CALLS = [];

const PlayerRoom = () => {
  const navigate = useNavigate();
  const language = useBookingLanguage();
  const t = useCallback((key, variables) => bookingCopy(language, key, variables), [language]);
  const [players, setPlayers] = useState([]);
  const [roomCode, setRoomCode] = useState("");
  const [scheduledSession, setScheduledSession] = useState(null);
  const [clockNow, setClockNow] = useState(Date.now());
  const serverClockOffset = useRef(0);
  const [tickets, setTickets] = useState({ count: 1, max: 1, locked: false });
  const [previews, setPreviews] = useState([]);
  const [note, setNote] = useState("");
  // A seat joins with a ticket count but no minted grids (the server stores the
  // count, not the tickets, until play starts). Asking once for the count the
  // seat already holds materialises its real tickets, so the waiting room shows
  // what will actually be played instead of an empty preview area. The call is
  // idempotent — the engine only mints while the seat is short of its count.
  const previewed = useRef(false);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now() + serverClockOffset.current), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!roomCode) return undefined;
    const abort = new AbortController();
    let active = true;
    const refreshSchedule = async () => {
      try {
        const response = await fetch(`/api/public/rooms/${encodeURIComponent(roomCode)}/session`, { cache: "no-store", signal: abort.signal, headers: { Accept: "application/json" } });
        const data = await response.json().catch(() => ({}));
        if (!active) return;
        if (!response.ok || !data.ok || !data.session) { setScheduledSession(null); return; }
        const serverTime = Date.parse(data.session.serverTime);
        if (Number.isFinite(serverTime)) serverClockOffset.current = serverTime - Date.now();
        setScheduledSession(data.session);
      } catch (error) {
        if (active && error.name !== "AbortError") setScheduledSession(null);
      }
    };
    refreshSchedule();
    const stopReconnect = on("connect", refreshSchedule);
    const timer = window.setInterval(refreshSchedule, 15_000);
    const onVisible = () => { if (document.visibilityState === "visible") refreshSchedule(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { active = false; abort.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); stopReconnect(); };
  }, [roomCode]);

  const applyCounts = (snapshot) => {
    if (!snapshot) return;
    setTickets({ count: snapshot.ticketCount ?? 1, max: snapshot.maxTickets ?? 1, locked: Boolean(snapshot.ticketSelectionLocked) });
    setPreviews(Array.isArray(snapshot.tickets) ? snapshot.tickets : []);
  };

  const pickCount = useCallback(async (count) => {
    const result = await call("tickets:select", { count });
    if (result.ok) {
      setTickets((current) => ({ ...current, count: result.ticketCount, max: result.maxTickets }));
      setPreviews(Array.isArray(result.tickets) ? result.tickets : []);
      setNote("");
    } else {
      setNote(bookingRefusalText(language, { ...result, error: result.error || t("ticketPickFailed") }));
    }
  }, [language, t]);

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
        return;
      }
      if (!previewed.current && !(snapshot.tickets || []).length) {
        previewed.current = true;
        pickCount(Math.max(1, snapshot.ticketCount || 1));
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
    const stopRemoved = on("room:removed", () => {
      clearSession();
      navigate("/player");
    });
    const stopConnected = on("connect", () => resume());

    resume();

    return () => {
      alive = false;
      [stopUpdated, stopStarted, stopTicket, stopClosed, stopRemoved, stopConnected].forEach((stop) => stop());
    };
  }, [navigate, pickCount]);

  return (
    <div className="flex flex-col" style={{ minHeight: "100vh" }}>
      <Header />
      <main id="main-content" lang={language === "hi" ? "hi" : "en"} tabIndex="-1"
        className="player-room-page flex-1 w-full"
        style={{ maxWidth: 980, marginInline: "auto", padding: "12px 20px 40px" }}
      >
        <PublicBack to="/games">← Back to games</PublicBack>
        <div
          data-oh-room-grid="true"
          style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)", alignItems: "start" }}
        >
          <div className="flex flex-col gap-4">
            <Panel className="p-4 sm:p-6">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h1 className="oh-display" style={{ fontSize: 24, margin: 0 }}>
                    {t("seatedTitle")}
                  </h1>
                  <p style={{ color: "var(--oh-text-muted)", fontSize: 14, margin: "2px 0 0" }}>
                    {t("seatedIntro")}
                  </p>
                </div>
                <ConnectionIndicator />
                <BookingLanguageSelect language={language} onChange={setBookingLanguage} />
                {roomCode ? (
                  <div
                    className="oh-num text-right"
                    style={{ padding: "8px 14px", borderRadius: 14, background: "var(--oh-inset)", border: "1px solid var(--oh-line-gold)" }}
                  >
                    <div className="oh-eyebrow">{t("room")}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: ".18em", color: "var(--oh-gold-bright)" }}>
                      {roomCode}
                    </div>
                  </div>
                ) : null}
              </div>
            </Panel>

            {scheduledSession ? <Panel className="p-4" aria-live="off">
              <p className="oh-eyebrow" style={{ margin: 0 }}>SCHEDULED GAME</p>
              <strong>{scheduledSession.title}</strong>
              <p style={{ color: "var(--oh-text-muted)", margin: "6px 0 0" }}>
                {scheduledSession.gameStatus === "live" ? "The game is live. Joining the current game…"
                  : scheduledSession.gameStatus === "completed" ? "This game has completed."
                    : scheduledSession.status === "cancelled" ? "This scheduled game was cancelled."
                      : scheduledSession.gameStatus === "paused" ? "The game is paused. Waiting for the host to resume."
                      : scheduledSession.scheduledStartStatus === "starting" ? "The server is starting the game…"
                        : scheduledSession.scheduledStartStatus === "failed" ? "The scheduled start is delayed. The server will retry."
                        : (() => {
                          const remaining = Math.max(0, Date.parse(scheduledSession.startsAt) - clockNow);
                          const seconds = Math.floor(remaining / 1000);
                          const days = Math.floor(seconds / 86400);
                          const hours = Math.floor((seconds % 86400) / 3600);
                          const minutes = Math.floor((seconds % 3600) / 60);
                          const rest = seconds % 60;
                          return remaining > 0 ? `Scheduled for ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: scheduledSession.timeZone }).format(new Date(scheduledSession.startsAt))} (${scheduledSession.timeZone}) · starts in ${days ? `${days}d ` : ""}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}` : !scheduledSession.autoStartEnabled ? "Waiting for the host to start the game…" : scheduledSession.scheduledStartStatus === "waiting" ? "Waiting for the server to start the game…" : "The scheduled time has arrived. Waiting for the server to start the game…";
                        })()}
              </p>
            </Panel> : null}

            {tickets.locked ? (
              <Panel className="p-4" aria-label={t("yourTickets")}>
                <h2 className="oh-display" style={{ fontSize: 15, margin: 0 }}>{t("yourTickets")}</h2>
                <p className="oh-eyebrow" style={{ margin: "5px 0 0", color: "var(--oh-text-muted)" }}>{t("lockedReservation")}</p>
                {previews.some((ticket) => ticket?.serial) ? (
                  <ul className="oh-ticket-serial-list" aria-label={t("assignedTicketSerials")}>
                    {previews.filter((ticket) => ticket?.serial).map((ticket) => <li key={ticket.serial}>{ticket.serial}</li>)}
                  </ul>
                ) : null}
              </Panel>
            ) : <TicketPicker value={tickets.count} max={tickets.max} language={language} onPick={pickCount} />}
            {note ? (
              <p role="alert" className="text-center" style={{ color: "var(--oh-danger)", fontSize: 13 }}>
                {note}
              </p>
            ) : null}

            {previews.length > 0 ? (
              <div className="flex flex-col gap-3">
                {/* A caption, not a heading: the tracked eyebrow style turned this
                    sentence into two shouting lines above the tabs on a phone. It sits
                    right above the tickets because on a phone those have to reach the
                    first screen — above the roster, not below it. */}
                <p style={{ color: "var(--oh-text-muted)", fontSize: 13, margin: 0 }}>
                  {t("ticketPreviewCaption")}
                </p>
                {/* one ticket at a time behind tabs, exactly as it is played: four
                    stacked previews pushed the hall and the status line off-screen */}
                <TicketRail tickets={previews} calledNumbers={NO_CALLS} roomId={roomCode} state="WAITING" language={language} />
              </div>
            ) : null}

            <p
              className="oh-eyebrow text-center"
              style={{ color: "var(--oh-text-faint)" }}
              role="status"
            >
              {t("waitingForHost")}
            </p>

          </div>

          {/* The hall is the second column on a wide screen and the last thing on
              a phone: the seat's own tickets come first. */}
          <PlayerRoster players={players} leaderboard={[]} language={language} />
        </div>

        <style>{`
          @media (min-width: 900px) {
            [data-oh-room-grid="true"] { grid-template-columns: minmax(0, 1fr) minmax(0, 340px) !important; }
          }
        `}</style>
      </main>
    </div>
  );
};

export default PlayerRoom;
