/* eslint-disable react/prop-types */
import GameHeader from "./GameHeader.jsx";
import CurrentNumberReveal from "./CurrentNumberReveal.jsx";
import GameProgress from "./GameProgress.jsx";
import TambolaTicket from "./TambolaTicket.jsx";
import WinningPatterns from "./WinningPatterns.jsx";
import ClaimFeedback from "./ClaimFeedback.jsx";
import NumberBoard from "./NumberBoard.jsx";
import CallHistory from "./CallHistory.jsx";
import PlayerRoster from "./PlayerRoster.jsx";
import GameChat from "./GameChat.jsx";
import HostControls from "./HostControls.jsx";
import Panel from "./Panel.jsx";

/**
 * The composed game screen — presentation only. It reads every value from the
 * `view` object GameScreen derives from the server snapshot, and calls back out
 * through `view.onClaim` / `view.onHostAction`. No game logic lives here.
 */
const GameShell = ({ role, view }) => {
  const isHost = role === "host";
  const running = view.state === "RUNNING";

  return (
    <div className="oh-app-shell">
      <GameHeader roomId={view.roomId} sound={view.sound} onToggleSound={view.onToggleSound} />

      {view.message ? (
        <div
          className="oh-toast"
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            top: 68,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 40,
            padding: "10px 18px",
            maxWidth: "90vw",
            fontSize: 14,
            textAlign: "center",
          }}
        >
          {view.message}
        </div>
      ) : null}

      {/* shared hero: the current call + progress, with host controls beneath */}
      <Panel className="p-4 sm:p-5 mt-4">
        <div
          className="flex flex-col items-center gap-5"
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}
        >
          <div style={{ flex: "0 0 auto" }}>
            <CurrentNumberReveal
              number={view.lastCall}
              callIndex={view.calledCount}
              total={90}
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

      {isHost ? (
        <div className="mt-4">
          <HostControls
            state={view.state}
            autoCall={view.autoCall}
            busy={view.busy}
            onAction={view.onHostAction}
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
          <TambolaTicket
            ticket={view.ticket}
            calledNumbers={view.calledNumbers}
            currentNumber={view.lastCall}
            playerName={view.name}
          />
          <WinningPatterns
            patterns={view.enabledPatterns}
            awards={view.awards}
            running={running}
            myPlayerId={view.playerId}
            onSubmit={view.onClaim}
          />
          <ClaimFeedback awards={view.awards} leaderboard={view.leaderboard} state={view.state} />
        </div>

        <div className="flex flex-col gap-4 oh-col">
          <NumberBoard calledNumbers={view.calledNumbers} currentNumber={view.lastCall} />
          <CallHistory calledNumbers={view.calledNumbers} />
          <PlayerRoster players={view.players} leaderboard={view.leaderboard} myPlayerId={view.playerId} />
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
