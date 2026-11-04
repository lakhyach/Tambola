/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import { FaClock, FaDoorOpen, FaLayerGroup, FaTicketAlt, FaUsers } from "react-icons/fa";
import Panel from "../Panel.jsx";
import { elapsedAt, formatClock } from "../../lib/caller.js";
import { bookingCopy, formatBookingNumber, localizeBookingDigits } from "../../i18n/booking-locale.js";

/** Readouts from the same authoritative room snapshot as the draw controls. */
export default function CallerGameInfo({ view, summary, language = "en" }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (view.state !== "RUNNING") return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [view.state, view.receivedAt]);
  const t = (key) => bookingCopy(language, key);
  const clock = formatClock(elapsedAt({ state: view.state, elapsedMs: view.elapsedMs, receivedAt: view.receivedAt, now }));
  const items = [
    [FaDoorOpen, t("room"), view.roomId || "—"],
    [FaLayerGroup, t("round"), Number(view.gameNumber) > 0 ? formatBookingNumber(view.gameNumber, language) : "—"],
    [FaUsers, language === "hi" ? "कुल खिलाड़ी" : "Total players", formatBookingNumber(summary.seated, language)],
    [FaTicketAlt, language === "hi" ? "जारी टिकट" : "Tickets in play", formatBookingNumber(summary.tickets, language)],
    [FaClock, t("elapsed"), localizeBookingDigits(language, clock)],
  ];
  return (
    <Panel className="caller-game-info festival-caller-card">
      <h2><FaLayerGroup aria-hidden="true" />{language === "hi" ? "गेम की जानकारी" : "Game Info"}</h2>
      <dl>
        {items.map(([Icon, label, value]) => (
          <div key={label}><dt><Icon aria-hidden="true" />{label}</dt><dd>{value}</dd></div>
        ))}
      </dl>
    </Panel>
  );
}
