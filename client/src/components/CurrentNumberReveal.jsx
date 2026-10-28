import { useEffect, useRef, useState } from "react";

/**
 * The moment-to-moment hero of the game screen. Shows the most recent official
 * call (from server state), with a brief reveal keyed to the number changing.
 * It never predicts or invents a number: with nothing called it says so.
 */
// eslint-disable-next-line react/prop-types
const CurrentNumberReveal = ({ number, callIndex, total = 90 }) => {
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
      : decadeOf(number);

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
          </>
        )}
      </div>
    </div>
  );
};

/** Which decade band a called number falls into, purely for the caption. */
function decadeOf(n) {
  if (n <= 9) return "1 – 9";
  if (n === 90) return "80 – 90";
  const low = Math.floor(n / 10) * 10;
  return `${low} – ${low + 9}`;
}

export default CurrentNumberReveal;
