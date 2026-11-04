import { runtimeThemeValues } from "../theme-runtime.js";
import { getFestivalThemeArt } from "../festival-themes.js";
import { ThemeArtwork } from "./theme-art.js";
import "./themes.css";
import "../themes-public.css";

/* eslint-disable react/prop-types -- the theme shape is validated at the API boundary. */

const numbers = [2, 12, 0, 0, 42, 0, 0, 71, 88, 0, 0, 21, 34, 0, 0, 63, 0, 89, 5, 0, 0, 0, 48, 56, 0, 77, 0];
const calls = [2, 5, 12, 21, 34, 42, 48, 56, 63, 71, 77, 88, 89];

export default function ThemePreview({ theme }) {
  const style = runtimeThemeValues(theme?.package);
  if (!style) return <div className="theme-preview theme-preview--invalid">Preview unavailable: unsupported theme package.</div>;
  const art = getFestivalThemeArt(theme.themeId);
  return <div className="theme-preview" style={style} role="group" aria-label={`${theme.name} game preview`} data-theme-art={theme.themeId} data-theme-family={art?.family || "unmapped"}>
    <header className="theme-preview__header"><span>{theme.name}</span><span className="theme-preview__live">LIVE · 90</span></header>
    <ThemeArtwork themeId={theme.themeId} />
    <div className="theme-preview__content">
      <div className="theme-preview__ticket" role="group" aria-label="Sample ticket" data-ticket-trim={art?.trim || "plain"} data-call-marker={art?.marker || "round"}>
        <ThemeArtwork themeId={theme.themeId} variant="ticket" />
        <div className="theme-preview__ticket-head"><strong>PLAYER TICKET</strong><span>#04</span></div>
        <div className="theme-preview__grid">{numbers.map((number, index) => <span key={index} className={number && calls.includes(number) ? "is-called" : ""}>{number || ""}</span>)}</div>
        <div className="theme-preview__pattern" role="group" aria-label="Winning pattern preview: top line">
          <ThemeArtwork themeId={theme.themeId} variant="pattern" />
          <span>TOP LINE · MATCHED MARKS</span>
        </div>
      </div>
      <div className="theme-preview__board" role="group" aria-label="Sample number board">
        <div className="theme-preview__board-head"><strong>1–90 board</strong><span>{calls.length} / 90</span></div>
        <div className="theme-preview__call-showcase" data-ball-style={art?.ball || "classic"}>
          <div className="theme-preview__number-ball">
            <ThemeArtwork themeId={theme.themeId} variant="ball" />
            <strong>42</strong>
          </div>
          <span>CALLED NUMBER</span>
        </div>
        <div className="theme-preview__balls">{Array.from({ length: 90 }, (_, index) => index + 1).map((number) => <span key={number} className={calls.includes(number) ? "is-called" : ""}>{number}</span>)}</div>
      </div>
    </div>
  </div>;
}
