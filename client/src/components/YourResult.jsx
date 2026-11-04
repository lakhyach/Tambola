/* eslint-disable react/prop-types */
import { useMemo } from "react";
import Panel from "./Panel.jsx";
import { myAwards, ordinal, placeOf, ticketSummaries } from "../lib/ticketview.js";
import { bookingCopy, bookingPatternName, formatBookingNumber } from "../i18n/booking-locale.js";

/**
 * The seat's own result, once the round is over.
 *
 * Everything here is read from the server's final snapshot: the standings, the
 * awards (each carrying the ticket it was won on) and the seat's own tickets.
 * It exists because the end of a round used to be a list of who won what —
 * a player had to scan it to work out how they did.
 */
const YourResult = ({ state, leaderboard = [], awards = [], myPlayerId, playerName, tickets = [], calledNumbers = [], language = "en" }) => {
  const completed = state === "COMPLETED";
  const place = useMemo(() => placeOf(leaderboard, myPlayerId), [leaderboard, myPlayerId]);
  const mine = useMemo(() => myAwards(awards, myPlayerId), [awards, myPlayerId]);
  const sheets = useMemo(() => ticketSummaries(tickets, calledNumbers), [tickets, calledNumbers]);

  if (!completed) return null;

  const entry = leaderboard.find((row) => row && row.playerId === myPlayerId);
  const points = entry?.points ?? 0;
  const t = (key, variables) => bookingCopy(language, key, variables);
  const placeLabel = place ? language === "hi" ? `${formatBookingNumber(place, language)}.` : ordinal(place) : "—";

  return (
    <Panel className="p-4" data-your-result="true">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="leading-tight">
          <h2 className="oh-eyebrow" style={{ color: "var(--oh-gold)" }}>
            {t("yourResult")}
          </h2>
          <div className="oh-display" style={{ fontSize: 22, marginTop: 2 }}>
            {playerName || t("thisSeat")}
          </div>
        </div>
        <div className="flex items-end gap-5">
          <div className="text-right leading-tight">
            <div className="oh-eyebrow">{t("finished")}</div>
            <div className="oh-num" style={{ fontSize: 22, fontWeight: 700, color: "var(--oh-gold-bright)" }}>
              {placeLabel}
              {place && leaderboard.length ? (
                <span style={{ fontSize: 12, color: "var(--oh-text-faint)", fontWeight: 600 }}>
                  {" "}
                  {t("placeOf", { count: formatBookingNumber(leaderboard.length, language) })}
                </span>
              ) : null}
            </div>
          </div>
          <div className="text-right leading-tight">
            <div className="oh-eyebrow">{t("points")}</div>
            <div className="oh-num" style={{ fontSize: 22, fontWeight: 700, color: "var(--oh-gold-bright)" }}>
              {formatBookingNumber(points, language)}
            </div>
          </div>
        </div>
      </div>

      <hr className="oh-rule my-3" />

      {mine.length ? (
        <ul className="flex flex-col gap-2" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {mine.map((award) => (
            <li
              key={award.pattern}
              className="flex items-center justify-between gap-3"
              style={{ fontSize: 14 }}
            >
              <span style={{ color: "var(--oh-text)" }}>
                {bookingPatternName(language, award.pattern, award.label || award.pattern)}
                {award.ticketNo != null ? (
                  <span className="oh-eyebrow" style={{ marginLeft: 8, color: "var(--oh-text-faint)" }}>
                    {t("ticketLabel", { number: typeof award.ticketNo === "string" && !/^\d+$/.test(award.ticketNo) ? award.ticketNo : formatBookingNumber(award.ticketNo, language) })}
                  </span>
                ) : null}
              </span>
              <span className="oh-num" style={{ color: "var(--oh-gold-bright)", fontWeight: 700 }}>
                +{formatBookingNumber(award.points, language)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ margin: 0, fontSize: 13, color: "var(--oh-text-muted)" }}>
          {t("noPrizesThisRound")}
        </p>
      )}

      {sheets.length ? (
        <p className="oh-eyebrow" style={{ marginTop: 12, color: "var(--oh-text-faint)" }}>
          {t("ticketSummary", {
            count: formatBookingNumber(sheets.length, language),
            tickets: t(sheets.length === 1 ? "oneTicket" : "manyTickets"),
            marked: formatBookingNumber(sheets.reduce((sum, sheet) => sum + sheet.marked, 0), language),
            total: formatBookingNumber(sheets.reduce((sum, sheet) => sum + sheet.total, 0), language),
          })}
        </p>
      ) : null}
    </Panel>
  );
};

export default YourResult;
