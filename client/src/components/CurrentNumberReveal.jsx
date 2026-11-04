import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { bookingCopy, formatBookingNumber } from "../i18n/booking-locale.js";

const ThreeBallRenderer = lazy(() => import("./ThreeBallRenderer.jsx"));

/* eslint-disable react/prop-types */
class BallRendererBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false, number: props.number };
  }

  static getDerivedStateFromProps(props, state) {
    return props.number === state.number ? null : { failed: false, number: props.number };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    this.props.onError(this.props.number, error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
/* eslint-enable react/prop-types */

/**
 * The moment-to-moment hero of the game screen. Shows the most recent official
 * call (from server state), with a brief reveal keyed to the number changing.
 * It never predicts or invents a number: with nothing called it says so.
 *
 * `voicePending` is an honest lag readout: when the player's spoken announcements
 * are running behind the board (a slow voice on a fast interval), this says how
 * many numbers the voice still owes, instead of letting the big number imply it
 * has already been read aloud. Zero renders nothing.
 */
// eslint-disable-next-line react/prop-types
const CurrentNumberReveal = ({ number, callIndex, total = 90, voicePending = 0, language = "en" }) => {
  const [animateKey, setAnimateKey] = useState(null);
  const [ballState, setBallState] = useState({ number: null, state: "idle" });
  const previous = useRef(number);
  const validNumber = Number.isInteger(number) && number >= 1 && number <= 90;
  const ballReady = validNumber && ballState.number === number && ballState.state === "ready";
  const ballFailed = validNumber && ballState.number === number && ballState.state === "error";
  const onBallReady = useCallback((loadedNumber) => {
    setBallState({ number: loadedNumber, state: "ready" });
  }, []);
  const onBallError = useCallback((failedNumber, error) => {
    if (import.meta.env.DEV && error) console.error(`3D ball ${failedNumber} could not be rendered`, error);
    setBallState({ number: failedNumber, state: "error" });
  }, []);

  useEffect(() => {
    if (number != null && number !== previous.current) {
      setAnimateKey(number);
      previous.current = number;
      setBallState({ number, state: "loading" });
    } else if (number == null) setBallState({ number: null, state: "idle" });
  }, [number]);

  const label =
    number == null
      ? callIndex > 0
        ? "—"
        : bookingCopy(language, "awaitingFirstCall")
      : bandOf(number, language);

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="oh-reveal"
        data-ball-state={ballReady ? "ready" : ballFailed ? "error" : validNumber ? "loading" : "idle"}
        data-ball-ready={String(Boolean(ballReady))}
        data-call-index={number == null ? undefined : callIndex}
      >
        {number == null ? (
          <span
            className="oh-eyebrow"
            style={{ color: "var(--oh-text-faint)", letterSpacing: ".2em" }}
          >
            {bookingCopy(language, "noCallYet")}
          </span>
        ) : (
          <>
            <span
              key={animateKey ?? number}
              className="oh-reveal__num"
              data-anim={String(animateKey === number)}
              aria-hidden="true"
            >
              {formatBookingNumber(number, language)}
            </span>
            {validNumber ? (
              <>
                <BallRendererBoundary number={number} onError={onBallError}>
                  <Suspense fallback={null}>
                    <ThreeBallRenderer number={number} onReady={onBallReady} onError={onBallError} />
                  </Suspense>
                </BallRendererBoundary>
                {!ballReady ? (
                  <span className="oh-ball-state" role="status" aria-live="polite" aria-atomic="true">
                    {ballFailed
                      ? "3D ball unavailable"
                      : "Loading 3D ball…"}
                  </span>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </div>

      <div className="text-center leading-tight">
        {number == null ? (
          <div className="oh-eyebrow">{label}</div>
        ) : (
          <>
            <div className="oh-eyebrow">{bookingCopy(language, "nowCalling", { band: label })}</div>
            <div className="oh-num" style={{ color: "var(--oh-text-muted)", fontSize: 13, marginTop: 2 }}>
              {bookingCopy(language, "callOrdinal", { count: formatBookingNumber(callIndex, language), total: formatBookingNumber(total, language) })}
            </div>
            {voicePending > 0 ? (
              <div
                role="status"
                aria-live="polite"
                className="oh-announce-lag"
                style={{ color: "var(--oh-gold)", fontSize: 12, marginTop: 4 }}
              >
                {bookingCopy(language, "voiceBehind", { count: formatBookingNumber(voicePending, language) })}
              </div>
            ) : null}
          </>
        )}
      </div>
      {number == null ? null : (
          <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {`Number ${formatBookingNumber(number, language)}, ${bookingCopy(language, "numberCurrent")}`}
        </span>
      )}
    </div>
  );
};

/**
 * The band a called number belongs to, named rather than ranged.
 *
 * It used to read "40 – 49", which sat directly under the big number and read
 * as "40 and 49 were called" — the one thing this screen must never imply.
 * "the 40s" says the same thing and cannot be mistaken for a second call.
 */
function bandOf(n, language = "en") {
  if (n >= 1 && n <= 9) return bookingCopy(language, "bandFirstNine");
  const low = Math.floor(n / 10) * 10;
  return bookingCopy(language, "bandDecade", { decade: formatBookingNumber(low, language) });
}

export default CurrentNumberReveal;
