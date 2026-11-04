/* eslint-disable react/prop-types */
import { useMemo } from "react";
import { bookingCopy, formatBookingNumber } from "../i18n/booking-locale.js";
import { getFestivalThemeArt } from "../festival-themes.js";

function currentThemeArt() {
  if (typeof document === "undefined") return null;
  const themeId = document.documentElement?.dataset?.themeId;
  return getFestivalThemeArt(themeId);
}

/**
 * A winning pattern drawn on the ticket grid — the server's own coordinates,
 * not a guess. The evaluator checks a fixed set of cells (or a fixed count of
 * numbers) on the server's example ticket and sends them here as `cells`, so
 * the picture a player claims from and the verdict that pays them are the same
 * source. This component draws what it is told and adds no rule of its own.
 *
 * `cells` is a list of [row, col] pairs (row 0-2, col 0-8). Patterns defined by
 * a COUNT of numbers rather than fixed positions (Early Five, Early Seven) have
 * no cells and are not drawn here — the caller shows their wording instead.
 *
 * A compact 3×9 of the OBSIDIAN HALL ticket: pattern cells fill gold, the other
 * numbered cells sit dim, empty cells stay hatched. When the seat's own `hit`
 * cells are supplied (the pattern cells it has already completed) they mark the
 * cell so eligibility reads at a glance without implying any local claim.
 */
const PatternDiagram = ({ cells, example = null, note = null, hit = null, label, language = "en" }) => {
  const t = (key, variables) => bookingCopy(language, key, variables);
  const imageLabel = label
    ? t("patternDiagramLabel", { pattern: label, note: note ? t("patternDiagramNotePrefix", { note }) : "" })
    : t("winningPattern");
  const patternSet = useMemo(() => new Set((cells || []).map(([r, c]) => `${r}-${c}`)), [cells]);
  const hitSet = useMemo(() => new Set((hit || []).map(([r, c]) => `${r}-${c}`)), [hit]);
  const rows = example && example.length === 3 ? example : [[], [], []];
  const themeArt = currentThemeArt();

  return (
    <div className="oh-pattern-diagram" data-theme-art={typeof document !== "undefined" ? document.documentElement?.dataset?.themeId : undefined} data-pattern-trim={themeArt?.trim} data-call-marker={themeArt?.marker}>
      <div
        className="oh-pattern-grid"
        role="img"
        aria-label={imageLabel}
      >
        {Array.from({ length: 3 }, (_, r) => (
          <div key={`r-${r}`} className="oh-pattern-row">
            {Array.from({ length: 9 }, (_, c) => {
              const n = rows[r]?.[c] ?? null;
              const isPattern = patternSet.has(`${r}-${c}`);
              const isHit = hitSet.has(`${r}-${c}`);
              const empty = n == null && !isPattern;
              return (
                <span
                  key={`c-${r}-${c}`}
                  className="oh-pattern-cell"
                  data-pattern={String(isPattern)}
                  data-hit={String(isHit)}
                  data-empty={String(empty)}
                  data-call-marker={isPattern && themeArt?.marker ? themeArt.marker : undefined}
                >
                  {n == null ? "" : formatBookingNumber(n, language)}
                </span>
              );
            })}
          </div>
        ))}
      </div>
      {note ? (
        <div className="oh-pattern-diagramnote">{note}</div>
      ) : null}
    </div>
  );
};

export default PatternDiagram;
