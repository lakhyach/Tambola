/* eslint-disable react/prop-types */
import { useCallback, useEffect, useMemo, useRef } from "react";
import GameHeader from "../GameHeader.jsx";
import Toast from "../Toast.jsx";
import NumberBoard from "../NumberBoard.jsx";
import GameChat from "../GameChat.jsx";
import Button from "../Button.jsx";
import CallerHero from "./CallerHero.jsx";
import CallerControls from "./CallerControls.jsx";
import CallerLog from "./CallerLog.jsx";
import RoomOverview from "./RoomOverview.jsx";
import VoicePanel from "./VoicePanel.jsx";
import { listSpeechVoices } from "../../lib/announce.js";
import {
  callerActions,
  hotkeyCommand,
  intervalPayload,
  nextCallHint,
  recentCalls,
  roomSummary,
  voiceStatus,
} from "../../lib/caller.js";

/**
 * THE CALLER CONSOLE — the host's whole operating surface for one room.
 *
 * Composition only: it lays out the pieces and routes their intents to
 * GameScreen (which owns the socket). Every value shown was derived in
 * lib/caller.js from the server snapshot; nothing is kept in local game state
 * that could drift from the server.
 *
 * Layout: a compact three-column desk on wide screens (console · board · hall),
 * two columns on tablets, and a single scrolling column on phones with the draw
 * control pinned to the bottom edge — the one control a caller needs without
 * hunting while the room is live.
 */
const CallerConsole = ({ view }) => {
  const {
    state,
    remaining,
    calledCount,
    calledNumbers,
    players,
    leaderboard,
    maxPlayers,
    lastCall,
    autoCall,
    callIntervalMs,
    elapsedMs,
    receivedAt,
    sound,
    busy,
    message,
  } = view;

  const lang = sound?.speechLang === "hi" ? "hi" : "en";
  const seats = useMemo(() => roomSummary({ players, maxPlayers }), [players, maxPlayers]);
  const actions = useMemo(
    () => callerActions({ state, connected: view.connected !== false, busy, seated: seats.seated, remaining }),
    [state, view.connected, busy, seats.seated, remaining]
  );
  const { last, previous } = useMemo(() => recentCalls(calledNumbers), [calledNumbers]);

  // Voice list, for the "no Hindi voice on this machine" sentence. Read on each
  // render rather than memoised: Chrome fills the list asynchronously, and a
  // stale count would make the console claim a voice exists that does not.
  const voices = listSpeechVoices(lang).length;
  const voice = useMemo(
    () =>
      voiceStatus({
        speech: Boolean(sound?.speech),
        dead: Boolean(sound?.dead),
        engine: Boolean(sound?.available?.speech),
        pending: sound?.pending || 0,
        speaking: Number.isInteger(sound?.speaking) ? sound.speaking : null,
        lang,
        voices,
        state,
      }),
    [sound, lang, voices, state]
  );

  // A repeat needs a number to say, a live voice, and no engine failure. The
  // queue itself refuses an overlap, so pressing this twice quickly is safe.
  const repeatEnabled = Boolean(sound?.speech) && !sound?.dead && Number.isInteger(last);

  // Hotkeys are a convenience for a caller with one hand on the desk. The
  // console refuses them while the host is typing, and each one runs the same
  // guarded intent a click would.
  const latest = useRef({ actions, view, repeatEnabled });
  useEffect(() => {
    latest.current = { actions, view, repeatEnabled };
  }, [actions, view, repeatEnabled]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.repeat) return;
      const command = hotkeyCommand(event);
      if (!command) return;
      const { actions: next, view: screen } = latest.current;
      if (command === "call" && next.call.enabled) {
        event.preventDefault();
        screen.onHostAction("game:call-next");
      } else if (command === "pause") {
        if (next.pause.enabled) {
          event.preventDefault();
          screen.onHostAction("game:pause");
        } else if (next.resume.enabled) {
          event.preventDefault();
          screen.onHostAction("game:resume");
        }
      } else if (command === "repeat" && latest.current.repeatEnabled) {
        event.preventDefault();
        screen.onRepeatNumber();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const setInterval = useCallback(
    (ms) => {
      const payload = intervalPayload(ms);
      if (payload) view.onSetInterval(payload.intervalMs);
    },
    [view]
  );

  const bar = actions.call.enabled
    ? { label: "Call next", action: "game:call-next", enabled: true, reason: "" }
    : actions.resume.enabled
      ? { label: "Resume", action: "game:resume", enabled: true, reason: "" }
      : actions.start.enabled
        ? { label: "Start", action: "game:start", enabled: true, reason: "" }
        : { label: "Call next", action: null, enabled: false, reason: actions.call.reason };

  return (
    <div className="oh-console-shell">
      <div className="oh-console">
        <GameHeader
          roomId={view.roomId}
          sound={sound}
          onToggleSound={view.onToggleSound}
          onToggleSpeech={view.onToggleSpeech}
          onToggleSpeechLang={view.onToggleSpeechLang}
        />
        <Toast message={message} />

        <div className="oh-console-grid" data-oh-console="true">
          <div className="oh-console-col">
            <CallerHero
              state={state}
              gameNumber={view.gameNumber}
              lastCall={last}
              previous={previous}
              calledCount={calledCount}
              remaining={remaining}
              elapsedMs={elapsedMs}
              receivedAt={receivedAt}
              voice={voice}
              speaking={sound?.speaking}
              onRepeat={view.onRepeatNumber}
              repeatEnabled={repeatEnabled}
            />
            <CallerControls
              state={state}
              autoCall={autoCall}
              callIntervalMs={callIntervalMs}
              actions={actions}
              busy={busy}
              onAction={view.onHostAction}
              onSetInterval={setInterval}
            />
            <VoicePanel
              sound={sound || {}}
              voice={voice}
              onChange={view.onVoiceSetting}
              onRetry={view.onToggleSpeech}
            />
          </div>

          <div className="oh-console-col">
            <NumberBoard calledNumbers={calledNumbers} currentNumber={lastCall} />
            <CallerLog calledNumbers={calledNumbers} />
          </div>

          <div className="oh-console-col">
            <RoomOverview
              players={players}
              leaderboard={leaderboard}
              state={state}
              maxPlayers={maxPlayers}
            />
            <GameChat />
            <div className="oh-console-footnote">
              <p className="oh-caller-note" style={{ marginBottom: 6 }}>
                Every number is drawn, stored and broadcast by the server. This console only asks.
              </p>
              <p className="oh-caller-note">
                <span className="oh-kbd">C</span> call · <span className="oh-kbd">P</span> pause/resume ·{" "}
                <span className="oh-kbd">R</span> repeat
              </p>
            </div>
          </div>
        </div>

        <div className="oh-console-bar" role="region" aria-label="Draw control bar">
          <div className="oh-console-bar__meta">
            <span className="oh-statechip" data-tone={state.toLowerCase()}>
              {state}
            </span>
            <span className="oh-num" style={{ fontSize: 12, color: "var(--oh-text-muted)" }}>
              {calledCount}/90 · {remaining == null ? 90 - calledCount : remaining} left
            </span>
          </div>
          <div className="oh-console-bar__actions">
            {state === "RUNNING" ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={!actions.pause.enabled}
                onClick={() => view.onHostAction("game:pause")}
                title={actions.pause.reason || "Pause the round"}
              >
                Pause
              </Button>
            ) : null}
            <Button
              variant="gold"
              size="sm"
              disabled={!bar.enabled}
              onClick={() => bar.action && view.onHostAction(bar.action)}
              title={bar.reason || nextCallHint({ state, autoCall, callIntervalMs, remaining })}
            >
              {bar.label}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CallerConsole;
