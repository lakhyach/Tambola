import { memo } from "react";

/**
 * One cell of the 1–90 master board. States are conveyed by colour AND shape
 * (a corner notch appears on called tiles), so it stays legible for players
 * who can't rely on hue alone. Memoised so a single call only re-renders the
 * two tiles that actually changed.
 */
const NumberTile = memo(
  // eslint-disable-next-line react/prop-types
  function NumberTile({ n, called = false, current = false }) {
    return (
      <div
        className="oh-tile"
        data-called={String(called)}
        data-current={String(current)}
        aria-label={`Number ${n}${called ? ", called" : ", not called"}`}
        style={{ fontSize: "clamp(11px, 2.5vw, 15px)" }}
      >
        {n}
      </div>
    );
  }
);

export default NumberTile;
