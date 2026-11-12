/* eslint-disable react/prop-types */
import { useState } from "react";
import { FaBroadcastTower, FaDoorOpen, FaTicketAlt, FaTrophy, FaUsers } from "react-icons/fa";
import GameHeader from "./GameHeader.jsx";
import CurrentNumberReveal from "./CurrentNumberReveal.jsx";
import GameProgress from "./GameProgress.jsx";
import TicketRail from "./TicketRail.jsx";
import TicketPicker from "./TicketPicker.jsx";
import WinningPatterns from "./WinningPatterns.jsx";
import ClaimFeedback from "./ClaimFeedback.jsx";
import NumberBoard from "./NumberBoard.jsx";
import CallHistory from "./CallHistory.jsx";
import PlayerRoster from "./PlayerRoster.jsx";
import GameChat from "./GameChat.jsx";
import Panel from "./Panel.jsx";
import Toast from "./Toast.jsx";
import CallerConsole from "./caller/CallerConsole.jsx";
import YourResult from "./YourResult.jsx";
import { PlayerControlDock, PlayerCurrentPattern } from "./PlayerGameExtras.jsx";
import { getNumberCallout } from "../lib/number-callouts.js";
import { canClaim, claimNote, ticketPanel } from "../lib/playerview.js";
import { callAnnouncement } from "../lib/ticketview.js";
import { bookingClaimNote, bookingCopy, formatBookingNumber, useBookingLanguage } from "../i18n/booking-locale.js";
import PublicBack from "./PublicBack.jsx";
import TambolaTicket from "./TambolaTicket.jsx";
import GameJourney from "./GameJourney.jsx";

/** Ticket absence has two real meanings; neither should produce a fake grid. */
const TicketNotice = ({ spectator, language }) => (
  <Panel className="p-5">
    <span className="oh-eyebrow">{bookingCopy(language, spectator ? "watchingRound" : "noTicketYet")}</span>
    <h2 className="oh-display">{bookingCopy(language, spectator ? "joinedMidGame" : "chooseTicketsHowMany")}</h2>
    <p>{bookingCopy(language, spectator ? "joinedMidGameHelp" : "ticketDealtExplanation")}</p>
  </Panel>
);

/** Composition only: game values and actions all belong to GameScreen. */
const GameShell = ({ role, view, sessionResumeCount }) => {
  const language = useBookingLanguage();
  const [finderTerm, setFinderTerm] = useState("");
  const [finderResults, setFinderResults] = useState([]);
  const [finderMessage, setFinderMessage] = useState("");
  const [finderBusy, setFinderBusy] = useState(false);
  if (role === "host") return <div className="caller-game-flow"><GameJourney current={view.gameStep || "play"} compact /><CallerConsole view={view} /></div>;

  const tickets = view.tickets || [];
  const panel = ticketPanel({ state: view.state, sheets: tickets });
  const claimable = canClaim({ state: view.state, sheets: tickets });
  const t = (key, variables) => bookingCopy(language, key, variables);
  const hi = language === "hi";
  const eventName = typeof document !== "undefined" ? document.documentElement.dataset.instanceName : "";
  // The voice selector changes spoken output only; visible game copy remains English.
  const callout = getNumberCallout(view.lastCall, { language: "en", festival: view.sound?.festival });
  async function findMyLiveTickets(event) {
    event.preventDefault(); setFinderBusy(true); setFinderMessage(""); setFinderResults([]);
    try {
      const response = await fetch(`/api/public/rooms/${encodeURIComponent(view.roomId)}/tickets/find`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ q: finderTerm.trim() }), cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error("Ticket lookup is unavailable. Check the exact ticket number or display name.");
      setFinderResults(data.tickets || []);
      setFinderMessage(data.tickets?.length ? `${data.tickets.length} confirmed ticket(s) found.` : "No confirmed ticket matched that exact ticket number, display name, or registered phone.");
    } catch (error) { setFinderMessage(error.message); }
    finally { setFinderBusy(false); }
  }

  return (
    <div className="oh-app-shell player-festival" lang={hi ? "hi" : "en"}>
      <a className="public-skip-link" href="#main-content">{t("skipToGame")}</a>
      <GameHeader roomId={view.roomId} state={view.state} playerCount={view.players.length} language={language} sound={view.sound} onToggleSound={view.onToggleSound} onToggleSpeech={view.onToggleSpeech} onToggleSpeechLang={view.onToggleSpeechLang} />
      <main id="main-content" tabIndex="-1" className="player-game-main">
        <PublicBack to="/player/room">← Back to room</PublicBack>
        <GameJourney current={view.gameStep || "play"} language={language} compact />
        {view.scheduledSession ? (() => {
          const session = view.scheduledSession;
          const startsAt = Date.parse(session.startsAt);
          const remaining = startsAt - view.scheduleNow;
          const seconds = Number.isFinite(remaining) ? Math.max(0, Math.floor(remaining / 1000)) : 0;
          const countdown = `${Math.floor(seconds / 86400) ? `${Math.floor(seconds / 86400)}d ` : ""}${String(Math.floor((seconds % 86400) / 3600)).padStart(2, "0")}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
          const scheduledFor = Number.isFinite(startsAt)
            ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: session.timeZone }).format(new Date(startsAt))
            : null;
          let status;
          if (session.status === "cancelled" || session.gameStatus === "cancelled") status = "This scheduled session was cancelled.";
          else if (view.state === "COMPLETED" || session.gameStatus === "completed") status = "This game has completed.";
          else if (view.state === "PAUSED" || session.gameStatus === "paused") status = "The game is paused. Waiting for the host to resume.";
          else if (view.state === "RUNNING" || session.gameStatus === "live") status = "The game is live.";
          else if (session.scheduledStartStatus === "starting") status = "The server is starting the game…";
          else if (session.scheduledStartStatus === "failed") status = "The scheduled start is delayed. The server will retry.";
          else if (remaining > 0) status = `Starts in ${countdown}.`;
          else if (!session.autoStartEnabled) status = "Waiting for the host to start the game.";
          else if (session.scheduledStartStatus === "waiting") status = "Waiting for the server to start the game…";
          else status = "The scheduled time has arrived. Waiting for the server to start the game…";
          return <Panel className="p-4" data-scheduled-game="true" aria-live="polite">
            <span className="oh-eyebrow">{session.title || "Scheduled game"}</span>
            {scheduledFor ? <p style={{ margin: "4px 0", color: "var(--oh-text-muted)" }}>Scheduled for {scheduledFor} ({session.timeZone}).</p> : null}
            <strong role="status">{status}</strong>
          </Panel>;
        })() : null}
        <h1 className="oh-sr-only">{t("liveGameHeading")}</h1>
        <Toast message={view.message} />
        <div className="oh-sr-only" role="status" aria-live="polite" aria-atomic="true" data-call-announcer="true">{callAnnouncement(view.lastCall, view.remaining)}</div>
        <PlayerControlDock view={view} language={language} />
        {view.connected === false ? <p className="player-connection-notice" role="status">{hi ? "कनेक्शन टूट गया। रूम से फिर जुड़ रहे हैं…" : "Connection lost. Reconnecting to your room…"}</p> : null}

        <div className="player-live-layout">
          <aside className="player-live-sidebar" aria-label={t("inTheHall")}>
            <Panel className="player-game-info">
              <span className="player-game-info__eyebrow"><FaBroadcastTower />{hi ? "लाइव गेम" : "THE LIVE EXPERIENCE"}</span>
              <h2>{eventName || (hi ? "तंबोला महफ़िल" : "Tambola Celebration")}</h2>
              <dl>
                <div><dt><FaDoorOpen />{t("room")}</dt><dd>{view.roomId || "—"}</dd></div>
                <div><dt><FaUsers />{hi ? "खिलाड़ी" : "Players"}</dt><dd>{formatBookingNumber(view.players.length, language)}</dd></div>
                <div><dt><FaTicketAlt />{t("myTickets")}</dt><dd>{formatBookingNumber(tickets.length, language)}</dd></div>
                <div><dt><FaTrophy />{t("yourScore")}</dt><dd>{formatBookingNumber(view.points ?? 0, language)}</dd></div>
              </dl>
              <span className="player-game-info__state" data-state={view.state.toLowerCase()}><i aria-hidden="true" />{t(`state${view.state}`)}</span>
            </Panel>
            <div className="player-game-chat"><GameChat sessionResumeCount={sessionResumeCount} /></div>
            <details className="player-hall-details"><summary><FaUsers />{hi ? "खिलाड़ी और स्कोर" : "Players & scores"}<span>{formatBookingNumber(view.players.length, language)}</span></summary><PlayerRoster players={view.players} leaderboard={view.leaderboard} myPlayerId={view.playerId} state={view.state} language={language} /></details>
          </aside>

          <section className="player-live-stage" aria-label={t("liveGameHeading")}>
            <Panel className="player-game-hero" data-hero="true">
              <div className="player-stage-caption"><span><FaBroadcastTower />{t(`state${view.state}`)}</span>{view.gameNumber > 0 ? <span>{t("round")} #{formatBookingNumber(view.gameNumber, language)}</span> : null}</div>
              <div className="player-game-hero__layout">
                <div className="player-caller-speech"><strong>{view.lastCall == null ? (hi ? "महफ़िल तैयार है!" : "Let the celebration begin!") : `${hi ? "नंबर" : "Number"} ${formatBookingNumber(view.lastCall, language)}!`}</strong><span>{callout || (hi ? "पहले आधिकारिक नंबर का इंतज़ार है।" : "Waiting for the first official call.")}</span></div>
                <div className="player-game-hero__ball"><CurrentNumberReveal number={view.lastCall} callIndex={view.calledCount} total={90} language={language} voicePending={view.sound?.speech ? view.sound.pending || 0 : 0} /></div>
              </div>
            </Panel>
            <div className="player-live-history"><CallHistory calledNumbers={view.calledNumbers} language={language} /></div>
            {view.state === "WAITING" && view.onSelectTicketCount ? <div className="player-live-picker"><TicketPicker value={view.ticketCount ?? 1} max={view.maxTickets ?? 1} disabled={view.busy} language={language} onPick={view.onSelectTicketCount} /></div> : null}
            <YourResult state={view.state} leaderboard={view.leaderboard} awards={view.awards} myPlayerId={view.playerId} playerName={view.name} tickets={tickets} calledNumbers={view.calledNumbers} language={language} />
          </section>

          <aside className="player-live-board" aria-label={hi ? "बोर्ड और पैटर्न" : "Board and patterns"}>
            <NumberBoard calledNumbers={view.calledNumbers} currentNumber={view.lastCall} language={language} />
            <Panel className="player-game-progress"><h2>{hi ? "गेम की प्रगति" : "Game Progress"}</h2><GameProgress state={view.state} language={language} calledCount={view.calledCount} remaining={view.remaining} /></Panel>
            <PlayerCurrentPattern patterns={view.patternViews} example={view.patternExample} language={language} />
          </aside>

          <section className="player-live-tickets" aria-label={t("myTickets")}>
            <div className="player-section-heading"><h2><FaTicketAlt />{t("myTickets")} <span>({formatBookingNumber(tickets.length, language)})</span></h2><span>{hi ? "आधिकारिक कॉल से अपने आप चिह्नित" : "Automatically marked from official calls"}</span></div>
            {panel === "spectator" || panel === "choose" ? <TicketNotice spectator={panel === "spectator"} language={language} /> : <TicketRail tickets={tickets} calledNumbers={view.calledNumbers} currentNumber={view.lastCall} playerName={view.name} roomId={view.roomId} state={view.state} language={language} />}
          </section>
          {view.state === "RUNNING" ? <section className="player-live-tickets" aria-labelledby="live-ticket-finder-title">
            <div className="player-section-heading"><h2 id="live-ticket-finder-title">Find a live ticket</h2><span>Exact ticket number, display name{view.scheduledSession?.phoneLookupEnabled ? ", or registered phone" : ""}</span></div>
            <form className="booking-catalog__filters" onSubmit={findMyLiveTickets}>
              <label htmlFor="live-ticket-finder">Ticket number, display name{view.scheduledSession?.phoneLookupEnabled ? ", or registered phone" : ""}<input id="live-ticket-finder" value={finderTerm} minLength={3} maxLength={40} onChange={(event) => setFinderTerm(event.target.value)} required autoComplete="off" /></label>
              <button className="public-link-button" type="submit" disabled={finderBusy}>{finderBusy ? "Searching…" : "Find tickets"}</button>
            </form>
            <p className="booking-hint">Lookup is limited to confirmed tickets in this live room. Phone numbers are only matched when the organizer has enabled privacy-safe phone lookup; no phone or booking details are shown.</p>
            {finderMessage ? <p role="status" className="booking-notice">{finderMessage}</p> : null}
            {finderResults.length ? <div className="adm-issued-ticket-catalog">{finderResults.map((ticket) => <article className="adm-issued-ticket" key={ticket.serial}><strong>{ticket.serial}</strong><TambolaTicket ticket={ticket.grid} ticketNo={ticket.serial} language={language} /></article>)}</div> : null}
          </section> : null}
        </div>

        <section className="player-live-patterns" aria-label={t("winningPatterns")}>
          <WinningPatterns patterns={view.patternViews} example={view.patternExample} claimStates={view.claimStates} pendingPattern={view.claimPending} claimFeedback={view.claimFeedback} awards={view.awards} note={bookingClaimNote(language, claimNote({ state: view.state, sheets: tickets }))} canClaim={claimable} myPlayerId={view.playerId} onSubmit={view.onClaim} language={language} />
          <ClaimFeedback awards={view.awards} leaderboard={view.leaderboard} state={view.state} language={language} />
        </section>
      </main>
    </div>
  );
};

export default GameShell;
