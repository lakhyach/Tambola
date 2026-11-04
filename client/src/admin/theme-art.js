import { createElement } from "react";
import { getFestivalThemeArt } from "../festival-themes.js";

/* eslint-disable react/prop-types -- IDs come from the validated theme catalog. */

// Small, original line-art motifs give each reviewed palette a visual identity
// while keeping the ticket and live number board as the focus of every preview.
const motifs = {
  "obsidian-hall": [
    ["path", { d: "M22 78V40C22 15 45 5 68 5s46 10 46 35v38", className: "stroke" }],
    ["path", { d: "M38 78V43c0-17 12-26 30-26s30 9 30 26v35M52 78V48c0-9 5-14 16-14s16 5 16 14v30", className: "stroke thin" }],
    ["circle", { cx: 68, cy: 49, r: 4, className: "fill" }],
    ["path", { d: "M160 78V35m-15 43V48m30 30V48M320 78V35m-15 43V48m30 30V48", className: "stroke faint" }],
  ],
  "midnight-indigo": [
    ["path", { d: "M76 10C48 16 39 52 58 70c15 14 37 13 50 1-27 4-47-22-38-47 2-6 4-10 6-14Z", className: "fill" }],
    ["path", { d: "m147 22 4 10 10 4-10 4-4 10-4-10-10-4 10-4 4-10Zm58 31 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Zm133-30 4 10 10 4-10 4-4 10-4-10-10-4 10-4 4-10Z", className: "fill" }],
    ["circle", { cx: 273, cy: 31, r: 2, className: "fill faint" }], ["circle", { cx: 247, cy: 67, r: 2, className: "fill faint" }],
  ],
  "marigold-festival": [
    ["path", { d: "M66 76c-1-18-1-34 2-52m0 30C49 49 39 39 39 25c15 1 25 10 29 29m2-13c5-17 15-26 31-27 0 16-10 28-32 33", className: "stroke" }],
    ["path", { d: "M221 15c9 14 15 25 15 34a15 15 0 1 1-30 0c0-9 6-20 15-34Zm78 20c7 10 11 18 11 24a11 11 0 1 1-22 0c0-6 4-14 11-24Z", className: "fill soft" }],
    ["circle", { cx: 236, cy: 49, r: 4, className: "fill" }], ["path", { d: "M350 75c20-25 39-37 61-39m-41 40c10-19 22-29 42-32", className: "stroke faint" }],
  ],
  "cobalt-arcade": [
    ["path", { d: "M31 70V25h58v45m-48 0V38h38v32M43 49h10m14 0h10m-34 12h10m14 0h10", className: "stroke" }],
    ["path", { d: "M167 70V18h38v52m-28 0V31h18v39M267 70V31h38v39m-28 0V43h18v27", className: "stroke thin" }],
    ["circle", { cx: 367, cy: 44, r: 24, className: "stroke" }], ["path", { d: "M367 28v16l12 8", className: "stroke" }],
  ],
  "terracotta-house": [
    ["path", { d: "M35 78V42a36 36 0 0 1 72 0v36m-55 0V45a19 19 0 0 1 38 0v33", className: "stroke" }],
    ["path", { d: "M169 78V27m0 25c-20-2-30-13-30-30 19 1 29 11 30 30Zm0-8c2-19 12-29 31-31 0 18-10 29-31 31Z", className: "stroke thin" }],
    ["path", { d: "M263 78V38h59v40M276 78V51h33v27m-79 0h130", className: "stroke faint" }],
  ],
  "monsoon-garden": [
    ["path", { d: "M45 34a24 24 0 0 1 46 0 17 17 0 0 1 2 34H46a17 17 0 0 1-1-34Z", className: "stroke" }],
    ["path", { d: "m53 76 6-11m14 11 6-11m14 11 6-11", className: "stroke thin" }],
    ["path", { d: "M171 78c3-26 14-42 37-53m-33 39c-16-2-24-12-24-29 17 1 25 10 24 29Zm12-20c3-17 12-26 29-28 0 17-10 26-29 28Zm128 34c3-26 14-42 37-53m-33 39c-16-2-24-12-24-29 17 1 25 10 24 29Z", className: "stroke" }],
  ],
  "paper-lantern": [
    ["path", { d: "M63 8v14m-14 0h28l6 9v34l-6 9H49l-6-9V31l6-9Zm-6 9h20m-20 48v8m14-8v8", className: "stroke" }],
    ["path", { d: "M180 17v9m-11 0h22l5 7v28l-5 7h-22l-5-7V33l5-7Zm0 9h12m-12 33v7", className: "stroke thin" }],
    ["path", { d: "M292 8v16m-13 0h26l6 8v33l-6 8h-26l-6-8V32l6-8Zm7 9v48", className: "stroke" }],
    ["path", { d: "M75 8c48 13 94-7 130 9m99-1c27 13 52 11 80 1", className: "stroke faint" }],
  ],
  "snowlight-minimal": [
    ["path", { d: "M24 75 70 27l29 29 19-19 39 38H24Zm128 0 51-54 49 54h-100Zm119 0 43-39 42 39h-85Z", className: "stroke" }],
    ["path", { d: "m214 12 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Zm91 11 2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5Z", className: "fill faint" }],
    ["path", { d: "M51 75h325", className: "stroke faint" }],
  ],
  "kesar-royale": [
    ["path", { d: "M34 78V39a36 36 0 0 1 72 0v39m-56 0V43a20 20 0 0 1 40 0v35", className: "stroke" }],
    ["path", { d: "M68 13v12m-10-6h20M68 25c-11 12-13 25 0 36 13-11 11-24 0-36Zm0 36v17", className: "stroke thin" }],
    ["path", { d: "M184 77c-19-6-27-20-23-41 19 4 27 17 23 41Zm0 0c2-21 13-33 34-36 0 21-11 33-34 36Zm104 0V39a36 36 0 0 1 72 0v38m-56 0V43a20 20 0 0 1 40 0v34", className: "stroke faint" }],
  ],
  "diwali-celebration": [
    ["path", { d: "M44 58h50c-3 15-11 21-25 21S47 73 44 58Zm8-7c10-11 23-11 34 0m-25-3c0-9 8-14 8-24 10 11 14 19 7 27", className: "stroke" }],
    ["path", { d: "m165 20 4 10 10 4-10 4-4 10-4-10-10-4 10-4 4-10Zm75 28 3 8 8 3-8 3-3 8-3-8-8-3 8-3 3-8Z", className: "fill" }],
    ["path", { d: "M310 76V40m-15 36V53m30 23V53m-45-1h60", className: "stroke faint" }],
  ],
  "holi-colours": [
    ["circle", { cx: 58, cy: 43, r: 26, className: "stroke" }], ["circle", { cx: 58, cy: 43, r: 15, className: "stroke thin" }],
    ["path", { d: "M51 77c3-14 9-23 19-31m-9 31c11-14 21-21 35-24m-12 25c9-10 18-14 30-16", className: "stroke" }],
    ["circle", { cx: 197, cy: 27, r: 7, className: "fill" }], ["circle", { cx: 222, cy: 54, r: 10, className: "fill soft" }], ["circle", { cx: 260, cy: 30, r: 5, className: "fill" }], ["path", { d: "M320 26c14 6 25 17 31 31m-12-41c13 11 22 25 26 42m-53 17h59", className: "stroke faint" }],
  ],
  "durga-puja": [
    ["path", { d: "M49 77V40a24 24 0 0 1 48 0v37M57 45h32m-16-7v31m-15-5 15-9 15 9", className: "stroke" }],
    ["path", { d: "M184 26v46m-14-31 14 8 14-8m-30 33 16-9 16 9m74-42v43m-14-31 14 8 14-8", className: "stroke thin" }],
    ["circle", { cx: 184, cy: 19, r: 5, className: "fill" }], ["path", { d: "M326 73c11-18 23-28 43-32m-29 37c9-14 19-21 33-25", className: "stroke faint" }],
  ],
  "navratri-garba": [
    ["path", { d: "M58 13 86 41 58 69 30 41 58 13Zm0 12 16 16-16 16-16-16 16-16Z", className: "stroke" }],
    ["path", { d: "M167 15v55m-11-44 22 33m0-33-22 33m100-44v55m-11-44 22 33m0-33-22 33", className: "stroke thin" }],
    ["circle", { cx: 166, cy: 14, r: 4, className: "fill" }], ["circle", { cx: 267, cy: 14, r: 4, className: "fill" }], ["path", { d: "M326 74a34 34 0 0 1 68 0m-55 0a21 21 0 0 1 42 0", className: "stroke faint" }],
  ],
  "ganesh-chaturthi": [
    ["path", { d: "M53 35c-14-18-31-8-22 5 6 8 17 8 25 3m12-8c14-18 31-8 22 5-6 8-17 8-25 3m-6-19c-6 5-7 14-4 20l-3 21c-1 8 5 14 12 14s13-6 12-14l-3-21c3-6 2-15-4-20Zm-9 22h9m-13 21h18", className: "stroke" }],
    ["path", { d: "M190 20c-9 10-9 18 0 24 9-6 9-14 0-24Zm48 27c-9 10-9 18 0 24 9-6 9-14 0-24Zm93-31 4 9 9 4-9 4-4 9-4-9-9-4 9-4 4-9Z", className: "fill soft" }],
    ["path", { d: "M328 74c14-17 28-25 48-26m-36 29c9-10 19-16 32-18", className: "stroke faint" }],
  ],
  "onam-pookalam": [
    ["circle", { cx: 65, cy: 43, r: 31, className: "stroke" }], ["circle", { cx: 65, cy: 43, r: 21, className: "stroke thin" }], ["circle", { cx: 65, cy: 43, r: 9, className: "fill" }],
    ["path", { d: "M65 12c8 10 8 17 0 23-8-6-8-13 0-23Zm0 62c-8-10-8-17 0-23 8 6 8 13 0 23ZM34 43c10-8 17-8 23 0-6 8-13 8-23 0Zm62 0c-10 8-17 8-23 0 6-8 13-8 23 0Z", className: "stroke" }],
    ["path", { d: "M174 77c8-22 20-34 39-39m-30 40c8-14 18-22 32-26m81 25c8-22 20-34 39-39m-30 40c8-14 18-22 32-26", className: "stroke faint" }],
  ],
  "pongal-harvest": [
    ["path", { d: "M45 60h48l-5 17H50l-5-17Zm8-6c0-10 7-16 16-16s16 6 16 16m-16-15V28m0 0c-12 0-18-7-18-16 12 0 18 6 18 16Zm0 0c0-12 7-18 18-18 0 12-6 18-18 18Z", className: "stroke" }],
    ["path", { d: "M154 76V21m-8 23 8-9 8 9m-8-1c-9-13-15-19-24-22 0 14 8 21 24 22Zm0 7c9-13 15-19 24-22 0 14-8 21-24 22Zm100-49v49m-8-25 8-9 8 9", className: "stroke thin" }],
    ["circle", { cx: 332, cy: 41, r: 26, className: "stroke" }], ["path", { d: "M332 6v12m0 46v12m-35-35h12m46 0h12", className: "stroke faint" }],
  ],
  "eid-moonlight": [
    ["path", { d: "M58 16c-19 6-25 31-12 45 11 11 29 10 39-1-23 3-39-20-31-40 1-2 2-3 4-4Z", className: "fill" }],
    ["path", { d: "M169 22v55m-17-37h34m-28 0 28 37m-28 0 28-37m92-20v55m-17-37h34m-28 0 28 37m-28 0 28-37", className: "stroke thin" }],
    ["path", { d: "M338 18v10m-5-5h10m30 31v8m-4-4h8m-41 18h38", className: "stroke faint" }],
  ],
  "christmas-winter": [
    ["path", { d: "M58 16 31 59h18L39 76l19-8 19 8-10-17h18L58 16Zm0 60v7", className: "stroke" }],
    ["path", { d: "M169 30c-20-17-32 4-12 17-20 13-8 34 12 17 20 17 32-4 12-17 20-13 8-34-12-17Zm0 0v34m-15-17h30", className: "stroke thin" }],
    ["circle", { cx: 268, cy: 33, r: 3, className: "fill" }], ["circle", { cx: 286, cy: 53, r: 3, className: "fill" }], ["path", { d: "M340 23v52m-13-41h26m-22 0 22 29m-22 0 22-29", className: "stroke faint" }],
  ],
  "halloween-night": [
    ["path", { d: "M34 57c0-22 12-35 30-35s30 13 30 35l-10-6-10 7-10-7-10 7-10-7-10 6Zm18-9v9m25-9v9m-22 13c6 5 13 5 19 0", className: "stroke" }],
    ["path", { d: "M181 14c0 17-14 17-14 34 0 10 7 17 16 17 10 0 17-8 16-18-1-8-8-12-9-21-5 5-6 10-6 15-6-6-7-16-3-27Z", className: "stroke thin" }],
    ["path", { d: "M282 35c12-11 24-11 36 0l-10 1 2 12-10-5-10 5 2-12-10-1Zm-5 5-14-5m60 5 14-5", className: "stroke faint" }],
  ],
  "new-year-celebration": [
    ["path", { d: "M54 44V10m0 68V44M20 44h34m0 0h34M30 20l24 24m0 0 24 24M78 20 54 44m0 0L30 68m130-21V16m0 64V47m-31 0h31m0 0h31m-53-21 22 21m0 0 22 22m0-43-22 21m0 0-22 22", className: "stroke" }],
    ["path", { d: "M282 23v13m-6-6h12m52 28v13m-6-6h12m-78 8v9m-4-4h8m86-59v9m-4-4h8", className: "stroke thin" }],
    ["circle", { cx: 246, cy: 28, r: 2.5, className: "fill" }], ["circle", { cx: 372, cy: 42, r: 3, className: "fill faint" }],
  ],
  "wedding-celebration": [
    ["path", { d: "M32 77V39a26 26 0 0 1 52 0v38M43 77V42a15 15 0 0 1 30 0v35m-53 0h64", className: "stroke" }],
    ["path", { d: "M181 30c-13-17-35 1 0 30 35-29 13-47 0-30Zm85 0c-13-17-35 1 0 30 35-29 13-47 0-30Z", className: "stroke thin" }],
    ["path", { d: "M333 19c0 14-17 14-17 29s17 15 17 29m18-58c0 14-17 14-17 29s17 15 17 29", className: "stroke faint" }],
  ],
  "indian-textile-heritage": [
    ["path", { d: "M26 20h68v54H26zM34 28l52 38m0-38L34 66m-8-19h68M60 20v54", className: "stroke" }],
    ["path", { d: "M157 46 180 23l23 23-23 23-23-23Zm10 0 13-13 13 13-13 13-13-13Zm89-23 23 23-23 23-23-23 23-23Zm-12 23h24m-12-12v24", className: "stroke thin" }],
    ["path", { d: "M326 20h67v54h-67zm0 18h67m-67 18h67m-48-36v54m29-54v54", className: "stroke faint" }],
  ],
};

export const THEME_ART_IDS = Object.freeze(Object.keys(motifs));

const symbols = Object.freeze({
  arch: "M20 45V28a30 30 0 0 1 60 0v17M31 45V30a19 19 0 0 1 38 0v15M50 8v8",
  moon: "M57 14c-18 5-24 30-12 43 10 11 28 11 38 1-22 2-37-19-30-38 1-2 2-4 4-6Zm19 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z",
  marigold: "M50 13c7 10 7 15 0 20-7-5-7-10 0-20Zm0 54c-7-10-7-15 0-20 7 5 7 10 0 20ZM23 41c12-2 16 0 17 9-9 4-14 1-17-9Zm54 0c-12-2-16 0-17 9 9 4 14 1 17-9ZM31 22c11 5 13 9 8 16-9-2-11-7-8-16Zm38 0c-11 5-13 9-8 16 9-2 11-7 8-16Z",
  arcade: "M25 22h50v46H25zM34 31h32v28H34zM42 41h6m8 0h6M42 50h6m8 0h6M18 14h6m52 0h6M18 76h6m52 0h6",
  lotus: "M50 14c-13 13-13 25 0 33 13-8 13-20 0-33Zm-5 36C33 39 23 43 20 57c10 8 19 6 25-7Zm10 0c12-11 22-7 25 7-10 8-19 6-25-7ZM50 48v24m-20-1h40",
  rain: "M25 40a18 18 0 0 1 35-4 14 14 0 0 1 2 28H27a14 14 0 0 1-2-24Zm10 31-4 8m20-8-4 8m20-8-4 8",
  lantern: "M37 12h26v8l7 8v30l-7 8H37l-7-8V28l7-8v-8Zm-2 17h30m-30 31h30M50 66v11m-7 0h14",
  snow: "M50 12v76M17 31l66 38M17 69l66-38m-33-9-7 8m7-8 7 8m-7 42-7-8m7 8 7-8m-37-9 10-2m-10 2 4 9m46-9-10-2m10 2-4 9",
  crest: "M50 11 76 22v19c0 17-10 29-26 39-16-10-26-22-26-39V22l26-11Zm0 15v44m-13-22 13 10 13-10m-13-9v-8",
  diya: "M18 55h64c-5 18-14 25-32 25S23 73 18 55Zm13-9c13-14 25-14 38 0M49 42c-8-9-5-19 2-31 9 12 12 22 2 31",
  gulal: "M50 16a32 32 0 1 0 0 64 32 32 0 0 0 0-64Zm0 13a19 19 0 1 1 0 38 19 19 0 0 1 0-38Z",
  dhak: "M24 26v51m-12-34 12 7 12-7m-24 34 12-7 12 7m26-51v51m-12-34 12 7 12-7m-24 34 12-7 12 7",
  dandiya: "M18 21 82 79M82 21 18 79M18 21l12 2-2 12m54 44L70 77l2-12m10-44L70 23l2 12m-54 44 12-2-2-12",
  modak: "M50 13c-4 13-25 24-25 43a25 25 0 0 0 50 0c0-19-21-30-25-43Zm-15 36 15 9 15-9m-25 19 10-10 10 10",
  pookalam: "M50 12c11 14 11 22 0 30-11-8-11-16 0-30Zm0 76c-11-14-11-22 0-30 11 8 11 16 0 30ZM12 50c14-11 22-11 30 0-8 11-16 11-30 0Zm76 0C74 61 66 61 58 50c8-11 16-11 30 0Z",
  sugarcane: "M50 86V16m-7 53 7-8 7 8m-7-14c-15-20-23-29-38-34 0 23 12 34 38 34Zm0 0c15-20 23-29 38-34 0 23-12 34-38 34Z",
  "eid-moon": "M49 13C25 20 20 51 37 68c14 13 36 12 49-2-29 4-49-24-39-49l2-4Zm31 5 3 10 10 4-10 4-3 10-4-10-10-4 10-4 4-10Z",
  holly: "M50 48c-5-18-24-24-35-16 3 8 10 13 21 14-12 1-18 11-16 20 15 2 25-5 30-18 5 13 15 20 30 18 2-9-4-19-16-20 11-1 18-6 21-14-11-8-30-2-35 16Zm-3 4 6-8m-3 11 18 19m-28-20L22 74",
  pumpkin: "M50 20c-22 0-33 14-33 34 0 19 12 29 33 29s33-10 33-29C83 34 72 20 50 20Zm-9 28-7 7 9 2m25-9 7 7-9 2m-28 12c12 10 24 10 36 0m-29-40c-2-7 0-13 6-18 6 5 8 11 6 18",
  "wedding-mandap": "M50 23C36 5 12 25 50 60 88 25 64 5 50 23ZM21 80V43a29 29 0 0 1 58 0v37M32 80V45a18 18 0 0 1 36 0v35",
  textile: "M50 10 90 50 50 90 10 50 50 10Zm0 15L25 50l25 25 25-25-25-25Zm0 10 15 15-15 15-15-15 15-15Z",
  fireworks: "M50 50V9m0 41 21-35M50 50l36-21M50 50h41M50 50l35 21M50 50 71 85M50 50v41M50 50 29 85M50 50 15 71M50 50H9m41 0L15 29m35 21L29 15",
});

function artworkSvg(themeId, variant, children, viewBox, className) {
  return createElement("svg", {
    className,
    viewBox,
    preserveAspectRatio: variant === "banner" ? "xMidYMid slice" : "xMidYMid meet",
    "aria-hidden": true,
    focusable: false,
    "data-art-theme": themeId,
    "data-art-variant": variant,
  }, createElement("g", { className: `theme-art__${variant}` }, children));
}

function ticketArtwork(themeId, style) {
  return artworkSvg(themeId, "ticket", [
    createElement("rect", { key: "frame", x: 8, y: 8, width: 84, height: 54, rx: 8, className: `theme-art__ticket-frame theme-art__ticket-frame--${style}` }),
    createElement("path", { key: "signature", d: symbols[getFestivalThemeArt(themeId).symbol], transform: "translate(33 15) scale(.34)", className: "theme-art__signature" }),
    createElement("circle", { key: "seal", cx: 50, cy: 35, r: 2.5, className: "theme-art__seal" }),
  ], "0 0 100 70", `theme-preview__ticket-art theme-preview__ticket-art--${style}`);
}

function ballArtwork(themeId, packageArt) {
  return artworkSvg(themeId, "ball", [
    createElement("circle", { key: "outer", cx: 50, cy: 50, r: 45, className: `theme-art__ball theme-art__ball--${packageArt.ball}` }),
    createElement("circle", { key: "highlight", cx: 35, cy: 29, r: 8, className: "theme-art__ball-highlight" }),
    createElement("path", { key: "mark", d: symbols[packageArt.symbol], transform: "translate(30 25) scale(.4)", className: "theme-art__ball-signature" }),
  ], "0 0 100 100", `theme-preview__ball-art theme-preview__ball-art--${packageArt.ball}`);
}

function patternArtwork(themeId, packageArt) {
  const cells = Array.from({ length: 9 }, (_, index) => createElement("rect", {
    key: `cell-${index}`,
    x: 8 + (index % 3) * 27,
    y: 8 + Math.floor(index / 3) * 18,
    width: 21,
    height: 13,
    rx: 2,
    className: index < 3 ? "theme-art__pattern-cell is-won" : "theme-art__pattern-cell",
  }));
  return artworkSvg(themeId, "pattern", [
    ...cells,
  ], "0 0 100 72", `theme-preview__pattern-art theme-preview__pattern-art--${packageArt.marker}`);
}

export function ThemeArtwork({ themeId, variant = "banner" }) {
  const packageArt = getFestivalThemeArt(themeId);
  if (!packageArt || !motifs[themeId]) return null;
  if (variant === "ticket") return ticketArtwork(themeId, packageArt.trim);
  if (variant === "ball") return ballArtwork(themeId, packageArt);
  if (variant === "pattern") return patternArtwork(themeId, packageArt);
  // Festival theme cards use the original environment artwork directly.
  // Generated line motifs layered on top read as diagram overlays and obscure it.
  return null;
}
