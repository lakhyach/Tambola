/* eslint-disable react/prop-types */
import { useState } from "react";
import { FaChevronLeft, FaChevronRight, FaThLarge } from "react-icons/fa";
import Panel from "../Panel.jsx";
import PatternDiagram from "../PatternDiagram.jsx";
import { bookingCopy, bookingPatternHint, bookingPatternName, formatBookingNumber } from "../../i18n/booking-locale.js";

/** Browses configured patterns only; diagram coordinates remain server-owned. */
export default function CallerPattern({ patterns = [], example = null, awards = [], language = "en" }) {
  const [selectedId, setSelectedId] = useState(null);
  const firstOpen = patterns.find((pattern) => !awards.some((award) => award.pattern === pattern.id));
  const selected = patterns.find((pattern) => pattern.id === selectedId) || firstOpen || patterns[0];
  const index = selected ? patterns.indexOf(selected) : -1;
  const t = (key, variables) => bookingCopy(language, key, variables);
  const move = (direction) => setSelectedId(patterns[(index + direction + patterns.length) % patterns.length].id);
  return (
    <Panel className="caller-current-pattern festival-caller-card">
      <h2><FaThLarge aria-hidden="true" />{language === "hi" ? "वर्तमान पैटर्न" : "Current Pattern"}</h2>
      {selected ? (
        <div className="caller-current-pattern__body">
          {selected.cells ? <PatternDiagram cells={selected.cells} example={example} label={selected.label} language={language} /> : selected.kind === "count" ? <span className="caller-pattern-count">{formatBookingNumber(selected.need, language)}</span> : <FaThLarge className="caller-pattern-symbol" aria-hidden="true" />}
          <div className="caller-current-pattern__copy"><h3>{bookingPatternName(language, selected.id, selected.label)}</h3><p>{bookingPatternHint(language, selected.id, selected.hint)}</p></div>
        </div>
      ) : <p className="oh-caller-note">{language === "hi" ? "इस राउंड के पैटर्न अभी उपलब्ध नहीं हैं।" : "Round patterns are not available yet."}</p>}
      {patterns.length > 1 ? <div className="caller-pattern-navigation"><button type="button" onClick={() => move(-1)} aria-label={language === "hi" ? "पिछला पैटर्न" : "Previous pattern"}><FaChevronLeft aria-hidden="true" /></button><span>{formatBookingNumber(index + 1, language)} / {formatBookingNumber(patterns.length, language)} · {t("winningPatterns")}</span><button type="button" onClick={() => move(1)} aria-label={language === "hi" ? "अगला पैटर्न" : "Next pattern"}><FaChevronRight aria-hidden="true" /></button></div> : null}
    </Panel>
  );
}
