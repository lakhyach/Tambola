/* eslint-disable react/prop-types */
import { useEffect, useMemo, useRef, useState } from "react";
import Panel from "./Panel.jsx";
import { config, resolveLang } from "../config.js";
import { celebrate } from "../i18n/messages.js";

/**
 * Full-screen celebration for a CONFIRMED win. It is only ever mounted with
 * events GameScreen received from verified server pushes (`claim:result` won,
 * `game:completed`) — it never infers a win from local state, and it is not fed
 * from the resume snapshot, so refreshing or reconnecting cannot replay it.
 *
 * Honours reduced motion (OS preference, user-overridable) and the existing
 * opt-in sound switch. Handles a single winner, an explicit tie, or a no-score
 * round, and shows the final standings for the finale.
 */
const MOTION_KEY = "oh.reduceMotion";

function initialReduceMotion() {
  if (typeof window === "undefined") return false;
  const stored = window.localStorage?.getItem(MOTION_KEY);
  if (stored === "1") return true;
  if (stored === "0") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

const CelebrationOverlay = ({ event, onDismiss, soundOn, onToggleSound }) => {
  const lang = resolveLang(config.i18n.default);
  const [reduceMotion, setReduceMotion] = useState(initialReduceMotion);
  const closeRef = useRef(null);

  useEffect(() => {
    if (!event) return;
    const onKey = (e) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [event, onDismiss]);

  const confetti = useMemo(() => {
    if (reduceMotion || !event) return [];
    // A restrained, on-brand scatter of gold/ivory pips — no rainbow.
    return Array.from({ length: 46 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.6,
      dur: 1.6 + Math.random() * 1.4,
      size: 6 + Math.random() * 8,
      tone: i % 3,
    }));
  }, [reduceMotion, event]);

  if (!event) return null;

  const toggleMotion = () => {
    const next = !reduceMotion;
    setReduceMotion(next);
    window.localStorage?.setItem(MOTION_KEY, next ? "1" : "0");
  };

  const isFinal = event.kind === "final";
  const winners = isFinal ? event.outcome?.winners || [] : [];

  return (
    <div className="oh-celebrate" role="dialog" aria-modal="true" aria-labelledby="oh-celebrate-title">
      {!reduceMotion && (
        <div className="oh-confetti" aria-hidden="true">
          {confetti.map((c) => (
            <span
              key={c.id}
              className={"oh-confetti__pip oh-confetti__pip--" + c.tone}
              style={{
                left: c.left + "%",
                width: c.size,
                height: c.size,
                animationDelay: c.delay + "s",
                animationDuration: c.dur + "s",
              }}
            />
          ))}
        </div>
      )}

      <Panel className="oh-celebrate__card" style={{ position: "relative", zIndex: 1 }}>
        <p className="oh-celebrate__eyebrow">
          {isFinal ? celebrate(lang, "resultsTitle", {}) : "🎉"}
        </p>

        <h2 id="oh-celebrate-title" className="oh-celebrate__title">
          {event.message}
        </h2>

        {!isFinal && (
          <p className="oh-celebrate__sub">
            {event.label}
            {event.ticketNo != null ? ` · Ticket #${event.ticketNo}` : ""}
            {event.points != null ? ` · +${event.points}` : ""}
          </p>
        )}

        {isFinal && (
          <>
            {event.reason ? <p className="oh-celebrate__sub">{event.reason}</p> : null}
            {winners.length > 0 && (
              <ul className="oh-celebrate__winners">
                {winners.map((w, i) => (
                  <li key={w.playerId || i}>
                    <span className="oh-celebrate__medal">{winners.length > 1 ? "🤝" : "🏆"}</span>
                    {w.player} <span className="oh-num">· {w.points}</span>
                  </li>
                ))}
              </ul>
            )}
            {event.leaderboard?.length > 0 && (
              <div className="oh-celebrate__standings">
                <p className="oh-celebrate__eyebrow">{celebrate(lang, "standingsTitle", {})}</p>
                <ol>
                  {event.leaderboard.slice(0, 8).map((p, i) => (
                    <li key={p.playerId || i}>
                      <span className="oh-num oh-celebrate__rank">{i + 1}</span>
                      <span className="oh-celebrate__name">{p.player}</span>
                      <span className="oh-num">{p.points}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </>
        )}

        <div className="oh-celebrate__controls">
          <button ref={closeRef} className="oh-btn oh-btn--gold" onClick={onDismiss}>
            {celebrate(lang, "continue", {})}
          </button>
          <div className="oh-celebrate__toggles">
            <button className="oh-chip" onClick={onToggleSound} aria-pressed={soundOn}>
              🔊 {soundOn ? celebrate(lang, "soundOn", {}) : celebrate(lang, "soundOff", {})}
            </button>
            <button className="oh-chip" onClick={toggleMotion} aria-pressed={reduceMotion}>
              {reduceMotion ? celebrate(lang, "motionOff", {}) : celebrate(lang, "motionOn", {})}
            </button>
          </div>
        </div>
      </Panel>
    </div>
  );
};

export default CelebrationOverlay;
