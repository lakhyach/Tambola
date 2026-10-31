/* eslint-disable react/prop-types */
import { useMemo } from "react";
import Panel from "./Panel.jsx";
import { myAwards, ordinal, placeOf, ticketSummaries } from "../lib/ticketview.js";

/**
 * The seat's own result, once the round is over.
 *
 * Everything here is read from the server's final snapshot: the standings, the
 * awards (each carrying the ticket it was won on) and the seat's own tickets.
 * It exists because the end of a round used to be a list of who won what —
 * a player had to scan it to work out how they did.
 */
const YourResult = ({ state, leaderboard = [], awards = [], myPlayerId, playerName, tickets = [], calledNumbers = [] }) => {
  const completed = state === "COMPLETED";
  const place = useMemo(() => placeOf(leaderboard, myPlayerId), [leaderboard, myPlayerId]);
  const mine = useMemo(() => myAwards(awards, myPlayerId), [awards, myPlayerId]);
  const sheets = useMemo(() => ticketSummaries(tickets, calledNumbers), [tickets, calledNumbers]);

  if (!completed) return null;

  const entry = leaderboard.find((row) => row && row.playerId === myPlayerId);
  const points = entry?.points ?? 0;

  return (
    <Panel className="p-4" data-your-result="true">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="leading-tight">
          <h2 className="oh-eyebrow" style={{ color: "var(--oh-gold)" }}>
            Your result
          </h2>
          <div className="oh-display" style={{ fontSize: 22, marginTop: 2 }}>
            {playerName || "This seat"}
          </div>
        </div>
        <div className="flex items-end gap-5">
          <div className="text-right leading-tight">
            <div className="oh-eyebrow">Finished</div>
            <div className="oh-num" style={{ fontSize: 22, fontWeight: 700, color: "var(--oh-gold-bright)" }}>
              {place ? ordinal(place) : "—"}
              {place && leaderboard.length ? (
                <span style={{ fontSize: 12, color: "var(--oh-text-faint)", fontWeight: 600 }}>
                  {" "}
                  of {leaderboard.length}
                </span>
              ) : null}
            </div>
          </div>
          <div className="text-right leading-tight">
            <div className="oh-eyebrow">Points</div>
            <div className="oh-num" style={{ fontSize: 22, fontWeight: 700, color: "var(--oh-gold-bright)" }}>
              {points}
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
                {award.label || award.pattern}
                {Number.isInteger(award.ticketNo) ? (
                  <span className="oh-eyebrow" style={{ marginLeft: 8, color: "var(--oh-text-faint)" }}>
                    Ticket {award.ticketNo}
                  </span>
                ) : null}
              </span>
              <span className="oh-num" style={{ color: "var(--oh-gold-bright)", fontWeight: 700 }}>
                +{award.points}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ margin: 0, fontSize: 13, color: "var(--oh-text-muted)" }}>
          No prizes this round — your tickets and points stay on the board for the host.
        </p>
      )}

      {sheets.length ? (
        <p className="oh-eyebrow" style={{ marginTop: 12, color: "var(--oh-text-faint)" }}>
          {sheets.length} {sheets.length === 1 ? "ticket" : "tickets"} ·{" "}
          {sheets.reduce((sum, sheet) => sum + sheet.marked, 0)} of{" "}
          {sheets.reduce((sum, sheet) => sum + sheet.total, 0)} numbers called
        </p>
      ) : null}
    </Panel>
  );
};

export default YourResult;
