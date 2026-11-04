import { memo } from "react";
import { bookingCopy, formatBookingNumber } from "../i18n/booking-locale.js";

/**
 * A single cell of the player's server-issued ticket. Empty cells are drawn
 * intentionally (hatched, centred dot) so they never read as missing data.
 * Called cells fill gold and animate once, on the call that struck them.
 *
 * The cell is inert on purpose. Marks come from the server's called history
 * (see lib/ticketview.js), so there is no tap handler to disagree with it —
 * a local mark could never become a winning claim anyway. Position is exposed
 * to assistive technology because a 27-cell grid is hard to navigate otherwise.
 */
const TicketCell = memo(
  // eslint-disable-next-line react/prop-types
  function TicketCell({ n, called = false, current = false, row, col, language = "en", callMarker = null }) {
    const empty = n == null;
    const number = (value) => formatBookingNumber(value, language);
    const position = Number.isInteger(row) && Number.isInteger(col) ? bookingCopy(language, "ticketGridPosition", { row: number(row + 1), column: number(col + 1) }) : "";
    const label = empty
      ? `${bookingCopy(language, "ticketGridEmpty")}${position}`
      : `${bookingCopy(language, "ticketGridNumber", { number: number(n) })}${position}, ${bookingCopy(language, called ? "ticketGridCalled" : "ticketGridNotCalled")}`;

    return (
      <div
        className="oh-ticket-cell"
        role="gridcell"
        aria-label={label}
        aria-colindex={Number.isInteger(col) ? col + 1 : undefined}
        data-empty={String(empty)}
        data-called={String(!empty && called)}
        data-current={String(!empty && current)}
        data-call-marker={called && typeof callMarker === "string" ? callMarker : undefined}
      >
        {empty ? "" : number(n)}
      </div>
    );
  }
);

export default TicketCell;
