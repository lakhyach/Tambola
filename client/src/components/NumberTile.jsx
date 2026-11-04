import { memo } from "react";
import { bookingCopy, formatBookingNumber } from "../i18n/booking-locale.js";

/**
 * One cell of the 1–90 master board. States are conveyed by colour AND shape
 * (a corner notch appears on called tiles), so it stays legible for players
 * who can't rely on hue alone. Memoised so a single call only re-renders the
 * two tiles that actually changed.
 */
const NumberTile = memo(
  // eslint-disable-next-line react/prop-types
  function NumberTile({ n, called = false, current = false, recent = false, language = "en" }) {
    const state = bookingCopy(language, called ? "numberCalled" : "numberNotCalled");
    const recentLabel = language === "hi" ? "हाल में बोला गया" : "recently called";
    return (
      <div
        className="oh-tile"
        role="listitem"
        data-called={String(called)}
        data-current={String(current)}
        data-recent={String(Boolean(recent && called && !current))}
        aria-current={current ? "true" : undefined}
        aria-label={`${language === "hi" ? "नंबर" : "Number"} ${formatBookingNumber(n, language)}, ${state}${recent && !current ? `, ${recentLabel}` : ""}${current ? `, ${bookingCopy(language, "numberCurrent")}` : ""}`}
        style={{ fontSize: "clamp(11px, 2.5vw, 15px)" }}
      >
        {formatBookingNumber(n, language)}
      </div>
    );
  }
);

export default NumberTile;
