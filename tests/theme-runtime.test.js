import test from "node:test";
import assert from "node:assert/strict";
import { applyRuntimeTheme, instanceBrandingStyles } from "../client/src/theme-runtime.js";

const legacyTokens = {
  void: "#07110f", obsidian: "#0b1814", graphite: "#10231c", panel: "#153027",
  panelRaised: "#1b3a2f", inset: "#0c1d17", line: "#25483a", gold: "#42c98a",
  goldBright: "#9cf0c5", goldDeep: "#178354", coral: "#ff7165", silver: "#c6d8ce",
  silverDim: "#92aa9d", ivory: "#f3f6ef", text: "#e8f1eb", textMuted: "#b1c4b9",
  textFaint: "#9ab1a3", ok: "#6ee0a4", warn: "#f2c36b", danger: "#ff8177",
  info: "#86c6df", ticket: "#f4f0e4", ticketInk: "#19261f", board: "#153027",
  boardCalled: "#d7a94a", radius: "soft", displayFont: "serif", uiFont: "system", shadow: "deep",
};

test("the exact legacy Obsidian palette renders with the new festival UI tokens", () => {
  const style = new Map();
  const root = { style: { setProperty: (key, value) => style.set(key, value) }, dataset: {} };
  const previous = globalThis.document;
  globalThis.document = { documentElement: root };
  try {
    assert.equal(applyRuntimeTheme({ themeId: "obsidian-hall", version: 1, package: { schemaVersion: 1, tokens: legacyTokens } }), true);
    assert.equal(style.get("--oh-gold"), "#ffbe4d");
    assert.equal(style.get("--oh-panel"), "#2b1a39");
    assert.equal(style.get("--oh-ticket"), "#fff4dd");
    assert.equal(style.get("--oh-ok"), "#6ee0a4", "semantic success color remains distinct");
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});

test("other approved theme palettes and customized instance accents remain unchanged", () => {
  assert.deepEqual(instanceBrandingStyles({ accent: "#42c98a", accentBright: "#9cf0c5", accentDeep: "#178354" }), {}, "legacy defaults do not overwrite a selected theme");
  assert.equal(instanceBrandingStyles({ accent: "#2a8c70", accentBright: "#9cf0c5", accentDeep: "#178354" })["--oh-gold"], "#2a8c70");

  const style = new Map();
  const root = { style: { setProperty: (key, value) => style.set(key, value) }, dataset: {} };
  const previous = globalThis.document;
  globalThis.document = { documentElement: root };
  try {
    const midnightTokens = { ...legacyTokens, void: "#090b18", gold: "#a99bff", goldBright: "#d2caff", goldDeep: "#7566d4" };
    assert.equal(applyRuntimeTheme({ themeId: "midnight-indigo", version: 1, package: { schemaVersion: 1, tokens: midnightTokens } }), true);
    assert.equal(style.get("--oh-gold"), "#a99bff");
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});
