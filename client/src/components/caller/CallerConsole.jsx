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
import TicketRail from "../TicketRail.jsx";
import TicketPicker from "../TicketPicker.jsx";
import ClaimFeedback from "../ClaimFeedback.jsx";
import YourResult from "../YourResult.jsx";
import CallerGameInfo from "./CallerGameInfo.jsx";
import CallerPattern from "./CallerPattern.jsx";
import CallerClaims from "./CallerClaims.jsx";
import { FaComments, FaMicrophoneAlt, FaKeyboard } from "react-icons/fa";
import "./caller-console.css";
import { listSpeechVoices } from "../../lib/announce.js";
import { bookingCallerText, bookingCopy, formatBookingNumber, useBookingLanguage } from "../../i18n/booking-locale.js";
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
  const language = useBookingLanguage();
  const t = (key, variables) => bookingCopy(language, key, variables);
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
    pendingCall,
    message,
  } = view;

  const lang = ["hi", "hinglish"].includes(sound?.speechLang) ? sound.speechLang : "en";
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
        providerAvailable: Boolean(sound?.voiceSupport?.provider),
        state,
      }),
    [sound, lang, voices, state]
  );
  const localizedVoice = useMemo(() => ({
    ...voice,
    label: bookingCallerText(language, voice.label),
    detail: bookingCallerText(language, voice.detail),
  }), [voice, language]);

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
    <div className="oh-console-shell festival-caller-console" lang={language === "hi" ? "hi" : "en"}>
      <div className="oh-console festival-caller-console__inner">
        <a className="public-skip-link" href="#main-content">{t("skipToGame")}</a>
        <GameHeader
          roomId={view.roomId}
          state={state}
          playerCount={players.length}
          language={language}
          sound={sound}
          onToggleSound={view.onToggleSound}
          onToggleSpeech={view.onToggleSpeech}
          onToggleSpeechLang={view.onToggleSpeechLang}
        />
        <main id="main-content" tabIndex="-1">
        <h1 className="oh-sr-only">{t("callerConsoleHeading")}</h1>
        <Toast message={message} />

        <div className="caller-desk" data-oh-console="true">
          <div className="caller-desk__draw">
            <CallerHero
              state={state}
              gameNumber={view.gameNumber}
              lastCall={last}
              language={language}
              previous={previous}
              calledCount={calledCount}
              remaining={remaining}
              elapsedMs={elapsedMs}
              receivedAt={receivedAt}
              voice={localizedVoice}
              speaking={sound?.speaking}
              onRepeat={view.onRepeatNumber}
              repeatEnabled={repeatEnabled}
              callouts={Boolean(sound?.callouts)}
              calloutLanguage={lang}
              calloutPersonality={sound?.personality}
              calloutFestival={sound?.festival}
            />
            <CallerControls
              language={language}
              state={state}
              autoCall={autoCall}
              callIntervalMs={callIntervalMs}
              actions={actions}
              busy={busy}
              pendingCall={pendingCall}
              onAction={view.onHostAction}
              onSetInterval={setInterval}
            />
          </div>

          <div className="caller-desk__center">
            <div className="caller-desk__board">
              <NumberBoard calledNumbers={calledNumbers} currentNumber={lastCall} language={language} />
            </div>
            <section className="oh-console-bottom__tickets" aria-label={t("myTickets")}>
              {state === "WAITING" && view.onSelectTicketCount ? <TicketPicker value={view.ticketCount ?? 1} max={view.maxTickets ?? 1} disabled={busy} language={language} onPick={view.onSelectTicketCount} /> : null}
              <TicketRail tickets={view.tickets || []} calledNumbers={calledNumbers} currentNumber={lastCall} playerName={view.name} roomId={view.roomId} state={state} language={language} />
              <YourResult state={state} leaderboard={leaderboard} awards={view.awards || []} myPlayerId={view.playerId} playerName={view.name} tickets={view.tickets || []} calledNumbers={calledNumbers} language={language} />
            </section>
          </div>
          <div className="caller-desk__information">
            <CallerLog calledNumbers={calledNumbers} language={language} />
            <CallerGameInfo view={view} summary={seats} language={language} />
          </div>

          <div className="caller-desk__players">
            <RoomOverview
              players={players}
              leaderboard={leaderboard}
              state={state}
              maxPlayers={maxPlayers}
              language={language}
            />
            <CallerPattern patterns={view.patternViews || []} example={view.patternExample} awards={view.awards || []} language={language} />
          </div>

          <section className="oh-console-bottom__claims" aria-label={t("winningPatterns")}>
            <CallerClaims view={view} language={language} />
            <ClaimFeedback awards={view.awards || []} leaderboard={leaderboard} state={state} language={language} />
          </section>
        </div>

        <div className="caller-utility-dock">
          <details className="caller-utility caller-utility--voice">
            <summary><FaMicrophoneAlt aria-hidden="true" />{t("voicePanel")}</summary>
            <VoicePanel language={language} sound={sound || {}} voice={localizedVoice} onChange={view.onVoiceSetting} onRetry={view.onToggleSpeech} />
          </details>
          <details className="caller-utility caller-utility--chat">
            <summary><FaComments aria-hidden="true" />{language === "hi" ? "लाइव चैट" : "Live chat"}</summary>
            <GameChat />
          </details>
          <div className="caller-keyboard-help">
            <FaKeyboard aria-hidden="true" />
            <span><kbd>C</kbd> {t("callNextNumber")} · <kbd>P</kbd> {t("pauseRound")} · <kbd>R</kbd> {t("repeatNumber")}</span>
          </div>
        </div>

        <div className="oh-console-bar" role="region" aria-label={t("drawControlBar")}>
          <div className="oh-console-bar__meta">
            <span className="oh-statechip" data-tone={state.toLowerCase()}>
              {t(`state${state}`)}
            </span>
            <span className="oh-num" style={{ fontSize: 12, color: "var(--oh-text-muted)" }}>
              {formatBookingNumber(calledCount, language)}/{formatBookingNumber(90, language)} · {t("numbersLeft", { count: formatBookingNumber(remaining == null ? 90 - calledCount : remaining, language) })}
            </span>
          </div>
          <div className="oh-console-bar__actions">
            {state === "RUNNING" ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={!actions.pause.enabled}
                onClick={() => view.onHostAction("game:pause")}
                title={bookingCallerText(language, actions.pause.reason || "Pause the round")}
              >
                {t("pauseRound")}
              </Button>
            ) : null}
            <Button
              variant="gold"
              size="sm"
              disabled={!bar.enabled}
              onClick={() => bar.action && view.onHostAction(bar.action)}
              title={bookingCallerText(language, bar.reason || nextCallHint({ state, autoCall, callIntervalMs, remaining }))}
            >
              {t(bar.label === "Start" ? "startRound" : bar.label === "Resume" ? "resumeRound" : "callNextNumber")}
            </Button>
          </div>
        </div>
        </main>
      </div>
    </div>
  );
};

export default CallerConsole;
