/* eslint-disable react/prop-types */
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
import { canClaim, claimNote, ticketPanel } from "../lib/playerview.js";
import { callAnnouncement } from "../lib/ticketview.js";

/**
 * Shown to a participant who joined while a round was already in progress. The
 * server never issues tickets after a start, so such a seat has none and cannot
 * claim. Rather than a broken-looking empty ticket + dead claim buttons, this
 * states the rule plainly: watch this round, pick tickets when the next starts.
 */
const SpectatorNotice = () => (
  <Panel className="p-5">
    <div className="flex flex-col items-start gap-2">
      <span
        className="oh-eyebrow"
        style={{ color: "var(--oh-gold)", letterSpacing: ".16em" }}
      >
        Watching this round
      </span>
      <h2 className="oh-display" style={{ fontSize: 20, margin: 0 }}>
        You joined mid-game
      </h2>
      <p style={{ color: "var(--oh-text-muted)", fontSize: 14, margin: 0, maxWidth: "46ch" }}>
        Tickets can only be chosen before a round starts, so you’re watching this
        one. Follow the board and chat, and you can pick your tickets as soon as
        the host opens the next round — your seat is already saved for it.
      </p>
    </div>
  </Panel>
);

/**
 * Shown before the first ticket of a round exists. Nothing is wrong and nothing
 * is broken: the picker directly above this panel is the control that produces
 * the ticket, so this says where to look instead of drawing an empty grid.
 */
const TicketChoiceNotice = () => (
  <Panel className="p-5">
    <div className="flex flex-col items-start gap-2">
      <span
        className="oh-eyebrow"
        style={{ color: "var(--oh-gold)", letterSpacing: ".16em" }}
      >
        No ticket yet
      </span>
      <h2 className="oh-display" style={{ fontSize: 20, margin: 0 }}>
        Choose how many you want to play
      </h2>
      <p style={{ color: "var(--oh-text-muted)", fontSize: 14, margin: 0, maxWidth: "46ch" }}>
        Pick a number of tickets above and the server deals them here straight
        away. They are locked in the moment the host starts the round.
      </p>
    </div>
  </Panel>
);

/**
 * The composed game screen — presentation only. It reads every value from the
 * `view` object GameScreen derives from the server snapshot, and calls back out
 * through `view.onClaim` / `view.onHostAction`. No game logic lives here.
 */
const GameShell = ({ role, view }) => {
  // The host operates the room from the caller console (§17) — a dedicated
  // surface built around the draw, the call sheet and the hall. Players keep the
  // shared hall below. Both read the SAME server snapshot, so the two surfaces
  // can never disagree.
  if (role === "host") return <CallerConsole view={view} />;

  const waiting = view.state === "WAITING";
  // The tickets this seat owns, exactly as the server issued them — never a
  // placeholder. `panel` is the honest state of the ticket area (see
  // lib/playerview.js): real tickets, "not chosen yet", or "watching this round".
  const tickets = view.tickets || [];
  const panel = ticketPanel({ state: view.state, sheets: tickets });
  const claimable = canClaim({ state: view.state, sheets: tickets });

  return (
    <div className="oh-app-shell">
      <GameHeader
        roomId={view.roomId}
        sound={view.sound}
        onToggleSound={view.onToggleSound}
        onToggleSpeech={view.onToggleSpeech}
        onToggleSpeechLang={view.onToggleSpeechLang}
      />

      <Toast message={view.message} />

      {/*
        The board is visual; this is its spoken twin. A screen-reader user hears
        each official call once, in the same words the chime announces, instead
        of having to poll a 90 tile grid. It is polite and not atomic per tile,
        so a fast auto-call queue cannot interrupt itself.
      */}
      <div className="oh-sr-only" role="status" aria-live="polite" aria-atomic="true" data-call-announcer="true">
        {callAnnouncement(view.lastCall, view.remaining)}
      </div>

      {/* shared hero: the current call + progress, with host controls beneath */}
      <Panel className="p-4 sm:p-5 mt-4" data-hero="true">
        <div
          className="flex flex-col items-center gap-5"
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}
        >
          <div style={{ flex: "0 0 auto" }}>
            <CurrentNumberReveal
              number={view.lastCall}
              callIndex={view.calledCount}
              total={90}
              voicePending={view.sound && view.sound.speech ? view.sound.pending || 0 : 0}
            />
          </div>
          <div style={{ flex: "1 1 240px", minWidth: 220 }}>
            <GameProgress
              state={view.state}
              calledCount={view.calledCount}
              remaining={view.remaining}
            />
            <div className="flex items-center justify-between mt-4">
              <div className="leading-tight">
                <div className="oh-eyebrow">Your score</div>
                <div className="oh-num" style={{ fontSize: 26, fontWeight: 700, color: "var(--oh-gold-bright)" }}>
                  {view.points ?? 0}
                </div>
              </div>
              {view.name ? (
                <div className="text-right leading-tight">
                  <div className="oh-eyebrow">Playing as</div>
                  <div style={{ fontSize: 15 }}>{view.name}</div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </Panel>

      {waiting && view.onSelectTicketCount ? (
        <div className="mt-4">
          <TicketPicker
            value={view.ticketCount ?? 1}
            max={view.maxTickets ?? 1}
            disabled={view.busy}
            onPick={view.onSelectTicketCount}
          />
        </div>
      ) : null}

      <div
        className="mt-4"
        style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)" }}
        // two balanced columns on wide screens, single stacked column on phones
        data-oh-grid="true"
      >
        <div className="flex flex-col gap-4 oh-col">
          <YourResult
            state={view.state}
            leaderboard={view.leaderboard}
            awards={view.awards}
            myPlayerId={view.playerId}
            playerName={view.name}
            tickets={tickets}
            calledNumbers={view.calledNumbers}
          />
          {panel === "spectator" ? (
            <SpectatorNotice />
          ) : panel === "choose" ? (
            <TicketChoiceNotice />
          ) : (
            <TicketRail
              tickets={tickets}
              calledNumbers={view.calledNumbers}
              currentNumber={view.lastCall}
              playerName={view.name}
              roomId={view.roomId}
              state={view.state}
            />
          )}
          <WinningPatterns
            patterns={view.enabledPatterns}
            awards={view.awards}
            note={claimNote({ state: view.state, sheets: tickets })}
            canClaim={claimable}
            myPlayerId={view.playerId}
            onSubmit={view.onClaim}
          />
          <ClaimFeedback awards={view.awards} leaderboard={view.leaderboard} state={view.state} />
        </div>

        <div className="flex flex-col gap-4 oh-col">
          <NumberBoard calledNumbers={view.calledNumbers} currentNumber={view.lastCall} />
          <CallHistory calledNumbers={view.calledNumbers} />
          <PlayerRoster players={view.players} leaderboard={view.leaderboard} myPlayerId={view.playerId} state={view.state} />
          <GameChat />
        </div>
      </div>

      <style>{`
        @media (min-width: 900px) {
          [data-oh-grid="true"] { grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr) !important; }
        }
      `}</style>
    </div>
  );
};

export default GameShell;
