/* eslint-disable react/prop-types */
import { useMemo } from "react";
import TicketCell from "./TicketCell.jsx";
import Panel from "./Panel.jsx";
import { APP_NAME } from "../brand.js";
import { ticketProgress } from "../lib/ticketview.js";
import { bookingCopy, formatBookingNumber } from "../i18n/booking-locale.js";
import { getFestivalThemeArt } from "../festival-themes.js";
import "./ticket-theme-identity.css";

function currentThemeArt() {
  if (typeof document === "undefined") return null;
  const themeId = document.documentElement?.dataset?.themeId;
  return getFestivalThemeArt(themeId);
}

/**
 * The player's actual 3×9, 15-number ticket — exactly as the server issued it.
 *
 * Marking is derived from the official called history (see lib/ticketview.js):
 * a cell is called because the server said so, never because it was tapped.
 * There is deliberately no tap-to-mark, so no local gesture can disagree with
 * the draw or be mistaken for a winning claim.
 *
 * The header carries the two numbers a player actually needs while the board
 * is running: how many of the fifteen are marked, and how many are still to
 * come. The three row chips add the same read-out per line, which is what a
 * line claim depends on. The grid is a real ARIA grid (rows + gridcells), so a
 * screen reader can move cell by cell and hear the row and column.
 */
const TambolaTicket = ({ ticket, calledNumbers = [], currentNumber = null, playerName, ticketNo = null, ticketTotal = null, language = "en" }) => {
  const calledSet = useMemo(() => new Set(calledNumbers), [calledNumbers]);
  const rows = useMemo(() => (ticket && ticket.length === 3 ? ticket : [[], [], []]), [ticket]);
  const progress = useMemo(() => ticketProgress(ticket, calledSet), [ticket, calledSet]);
  const themeArt = currentThemeArt();

  const t = (key, variables) => bookingCopy(language, key, variables);
  const number = (value) => formatBookingNumber(value, language);
  const serialLabel = typeof ticketNo === "string" && !/^\d+$/.test(ticketNo) ? ticketNo : null;
  const title = serialLabel
    ? serialLabel
    : ticketNo != null
      ? ticketTotal ? t("ticketNumberOfTotal", { number: number(ticketNo), total: number(ticketTotal) }) : t("ticketNumberCount", { number: number(ticketNo), total: "" })
      : playerName ? t("ticketNamedTitle", { name: playerName }) : t("ticketYourTicket");
  const gridLabel = `${title}: ${t("ticketCallProgress", { marked: number(progress.marked), total: number(progress.total) })}`;

  return (
    <Panel className="oh-ticket-paper p-4" data-ticket-no={ticketNo ?? 1} data-theme-art={typeof document !== "undefined" ? document.documentElement?.dataset?.themeId : undefined} data-ticket-trim={themeArt?.trim} data-call-marker={themeArt?.marker}>
      <div
        className="oh-ticket-paper__header"
      >
        <div className="oh-ticket-paper__identity">
          <div className="oh-ticket-paper__brand">{APP_NAME}</div>
          <div className="oh-ticket-paper__title">{title}</div>
        </div>
        <div className="oh-ticket-paper__progress">
          <div className="oh-num oh-ticket-paper__progress-value">
            {number(progress.marked)}
            <span>/{number(progress.total)}</span>
          </div>
          <div className="oh-ticket-paper__progress-label" data-complete={String(progress.complete)}>
            {progress.complete ? t("ticketComplete") : t("ticketToGo", { count: number(progress.toGo) })}
          </div>
        </div>
      </div>

      <div className="oh-ticket-rowstats" role="group" aria-label={t("ticketRowsGroup")}>
        {progress.rows.map((row) => (
          <span key={row.index} className="oh-ticket-rowstat" data-complete={String(row.complete)}>
            <span aria-hidden="true" className="oh-ticket-rowstat__label">{t("ticketRowShort", { row: number(row.index + 1) })}</span>
            <span aria-hidden="true" className="oh-num">
              {number(row.marked)}/{number(row.filled)}
            </span>
            <span className="oh-sr-only">{t("ticketRowProgress", { row: number(row.index + 1), marked: number(row.marked), total: number(row.filled) })}</span>
          </span>
        ))}
      </div>

      <div className="oh-ticket-grid" role="grid" aria-label={gridLabel} aria-rowcount={3} aria-colcount={9}>
        {rows.map((row, r) => (
          <div key={`r-${r}`} role="row" aria-rowindex={r + 1} className="oh-ticket-row">
            {Array.from({ length: 9 }, (_, c) => {
              const n = row[c] ?? null;
              return (
                <TicketCell
                  key={`c-${r}-${c}`}
                  n={n}
                  row={r}
                  col={c}
                  called={n != null && calledSet.has(n)}
                  current={n != null && n === currentNumber}
                  callMarker={themeArt?.marker}
                  language={language}
                />
              );
            })}
          </div>
        ))}
      </div>
    </Panel>
  );
};

export default TambolaTicket;
