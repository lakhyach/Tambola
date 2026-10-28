import { memo } from "react";

/**
 * A single cell of the player's server-issued ticket. Empty cells are drawn
 * intentionally (hatched, centred dot) so they never read as missing data.
 * Called cells fill gold and animate once, on the call that struck them.
 */
const TicketCell = memo(
  // eslint-disable-next-line react/prop-types
  function TicketCell({ n, called = false, current = false }) {
    const empty = n == null;
    return (
      <div
        className="oh-ticket-cell"
        data-empty={String(empty)}
        data-called={String(!empty && called)}
        data-current={String(!empty && current)}
        aria-label={
          empty ? "empty cell" : `ticket number ${n}${called ? ", called" : ""}`
        }
      >
        {empty ? "" : n}
      </div>
    );
  }
);

export default TicketCell;
