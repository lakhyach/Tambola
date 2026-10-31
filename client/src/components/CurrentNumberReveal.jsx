import { useEffect, useRef, useState } from "react";

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
const CurrentNumberReveal = ({ number, callIndex, total = 90, voicePending = 0 }) => {
  const [animateKey, setAnimateKey] = useState(null);
  const previous = useRef(number);

  useEffect(() => {
    if (number != null && number !== previous.current) {
      setAnimateKey(number);
      previous.current = number;
    }
  }, [number]);

  const label =
    number == null
      ? callIndex > 0
        ? "—"
        : "Awaiting the first call"
      : bandOf(number);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="oh-reveal">
        {number == null ? (
          <span
            className="oh-eyebrow"
            style={{ color: "var(--oh-text-faint)", letterSpacing: ".2em" }}
          >
            No call yet
          </span>
        ) : (
          <span
            key={animateKey ?? number}
            className="oh-reveal__num"
            data-anim={String(animateKey === number)}
            aria-hidden="true"
          >
            {number}
          </span>
        )}
      </div>

      <div className="text-center leading-tight">
        {number == null ? (
          <div className="oh-eyebrow">{label}</div>
        ) : (
          <>
            <div className="oh-eyebrow">Now calling · {label}</div>
            <div className="oh-num" style={{ color: "var(--oh-text-muted)", fontSize: 13, marginTop: 2 }}>
              call {callIndex} of {total}
            </div>
            {voicePending > 0 ? (
              <div
                role="status"
                aria-live="polite"
                className="oh-announce-lag"
                style={{ color: "var(--oh-gold)", fontSize: 12, marginTop: 4 }}
              >
                voice reading {voicePending} behind
              </div>
            ) : null}
          </>
        )}
      </div>
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
function bandOf(n) {
  if (n >= 1 && n <= 9) return "the first nine";
  const low = Math.floor(n / 10) * 10;
  return "the " + low + "s";
}

export default CurrentNumberReveal;
