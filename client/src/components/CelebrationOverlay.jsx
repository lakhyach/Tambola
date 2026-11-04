/* eslint-disable react/prop-types */
import { useEffect, useMemo, useRef, useState } from "react";
import { FaHandshake, FaTrophy, FaVolumeMute, FaVolumeUp } from "react-icons/fa";
import Panel from "./Panel.jsx";
import { config, resolveLang } from "../config.js";
import { celebrate } from "../i18n/messages.js";
import { bookingCopy, bookingPatternName, formatBookingNumber, useBookingLanguage } from "../i18n/booking-locale.js";

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
  const language = useBookingLanguage();
  const lang = language || resolveLang(config.i18n.default);
  const [reduceMotion, setReduceMotion] = useState(initialReduceMotion);
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const returnFocusRef = useRef(null);

  useEffect(() => {
    if (!event) return;
    const active = document.activeElement;
    returnFocusRef.current = active instanceof HTMLElement ? active : null;
    closeRef.current?.focus();
    return () => {
      const previous = returnFocusRef.current;
      if (previous?.isConnected && !previous.closest(".oh-celebrate")) previous.focus();
      else document.getElementById("main-content")?.focus();
      returnFocusRef.current = null;
    };
  }, [event, onDismiss]);

  const handleDialogKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onDismiss();
      return;
    }
    if (e.key !== "Tab") return;
    const focusable = [...(dialogRef.current?.querySelectorAll(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    ) || [])].filter((element) => element.getClientRects().length && element.getAttribute("aria-hidden") !== "true");
    if (!focusable.length) {
      e.preventDefault();
      dialogRef.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) {
      e.preventDefault();
      first.focus();
    }
  };

  const confetti = useMemo(() => {
    if (reduceMotion || !event) return [];
    // Festival colors add variety while keeping each particle lightweight.
    const count = window.matchMedia?.("(max-width: 600px)").matches ? 40 : 72;
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.6,
      dur: 1.6 + Math.random() * 1.4,
      size: 6 + Math.random() * 8,
      tone: i % 5,
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
    <div ref={dialogRef} className="oh-celebrate" lang={lang === "hi" ? "hi" : "en"} role="dialog" aria-modal="true" aria-labelledby="oh-celebrate-title" onKeyDown={handleDialogKeyDown}>
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
          {isFinal ? celebrate(lang, "resultsTitle", {}) : <FaTrophy aria-hidden="true" />}
        </p>

        <h2 id="oh-celebrate-title" className="oh-celebrate__title">
          {event.message}
        </h2>

        {!isFinal && (
          <p className="oh-celebrate__sub">
            {bookingPatternName(lang, event.pattern, event.label)}
            {event.ticketNo != null ? ` · ${bookingCopy(lang, "ticketLabel", { number: typeof event.ticketNo === "string" && !/^\d+$/.test(event.ticketNo) ? event.ticketNo : formatBookingNumber(event.ticketNo, lang) })}` : ""}
            {event.points != null ? ` · +${formatBookingNumber(event.points, lang)}` : ""}
          </p>
        )}

        {isFinal && (
          <>
            {event.reason ? <p className="oh-celebrate__sub">{event.reason}</p> : null}
            {winners.length > 0 && (
              <ul className="oh-celebrate__winners">
                {winners.map((w, i) => (
                  <li key={w.playerId || i}>
                    <span className="oh-celebrate__medal" aria-hidden="true">{winners.length > 1 ? <FaHandshake /> : <FaTrophy />}</span>
                    {w.player} <span className="oh-num">· {formatBookingNumber(w.points, lang)}</span>
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
                      <span className="oh-num oh-celebrate__rank">{formatBookingNumber(i + 1, lang)}</span>
                      <span className="oh-celebrate__name">{p.player}</span>
                      <span className="oh-num">{formatBookingNumber(p.points, lang)}</span>
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
              {soundOn ? <FaVolumeUp aria-hidden="true" /> : <FaVolumeMute aria-hidden="true" />} {soundOn ? celebrate(lang, "soundOn", {}) : celebrate(lang, "soundOff", {})}
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
