import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { THEME_ART_IDS, ThemeArtwork } from "../client/src/admin/theme-art.js";
import { FESTIVAL_THEME_ART_IDS } from "../client/src/festival-themes.js";

test("every reviewed catalog theme uses its original clean environment artwork without generated banner motifs", () => {
  assert.deepEqual(THEME_ART_IDS, [
    "obsidian-hall", "midnight-indigo", "marigold-festival", "cobalt-arcade",
    "terracotta-house", "monsoon-garden", "paper-lantern", "snowlight-minimal", "kesar-royale",
    "diwali-celebration", "holi-colours", "durga-puja", "navratri-garba",
    "ganesh-chaturthi", "onam-pookalam", "pongal-harvest", "eid-moonlight",
    "christmas-winter", "halloween-night", "new-year-celebration", "wedding-celebration", "indian-textile-heritage",
  ]);
  assert.deepEqual(FESTIVAL_THEME_ART_IDS, THEME_ART_IDS);
  for (const themeId of THEME_ART_IDS) {
    assert.equal(ThemeArtwork({ themeId }), null, `${themeId} has no artificial banner overlay`);
  }
});

test("each named festival and textile package has distinct theme-bound art variants", () => {
  const namedPackages = [
    "diwali-celebration", "holi-colours", "durga-puja", "navratri-garba",
    "ganesh-chaturthi", "onam-pookalam", "pongal-harvest", "eid-moonlight",
    "christmas-winter", "halloween-night", "new-year-celebration", "wedding-celebration", "indian-textile-heritage",
  ];
  for (const themeId of namedPackages) {
    assert.equal(ThemeArtwork({ themeId, variant: "banner" }), null, `${themeId} uses clean background art`);
    for (const variant of ["ticket", "ball", "pattern"]) {
      const artwork = ThemeArtwork({ themeId, variant });
      assert.equal(artwork.type, "svg", `${themeId} ${variant} artwork exists`);
      assert.equal(artwork.props["data-art-theme"], themeId);
      assert.equal(artwork.props["data-art-variant"], variant);
      assert.equal(artwork.props["aria-hidden"], true);
    }
  }
});

test("unrecognized and draft theme IDs do not render unrelated catalog artwork", () => {
  assert.equal(ThemeArtwork({ themeId: "unreviewed-user-theme" }), null);
  assert.equal(ThemeArtwork({}), null);
});

test("all 22 reviewed themes bind to ticket stock, trims and called-number marker art", async () => {
  const css = await readFile(new URL("../client/src/components/ticket-theme-identity.css", import.meta.url), "utf8");
  for (const themeId of THEME_ART_IDS) {
    assert.ok(css.includes(`[data-theme-art=\"${themeId}\"]`), `${themeId} has a distinct ticket paper treatment`);
  }
  const trims = ["keyline", "crescent", "garland", "electric", "arch", "rain", "lantern", "frost", "crest", "diya", "gulal", "dhak", "mirrorwork", "modak", "pookalam", "kolam", "crescent-arch", "holly", "cobweb", "fireworks", "jaali", "woven-border"];
  for (const trim of trims) assert.ok(css.includes(`[data-ticket-trim=\"${trim}\"]`), `${trim} has ticket border styling`);
  for (const marker of [
    "seal", "star", "petal", "pixel", "arch", "drop", "lantern", "snow", "crest",
    "flame", "splash", "trident", "diamond", "modak", "petal-ring", "sunrise",
    "crescent-star", "holly-berry", "bat-wing", "confetti", "petal-heart", "woven-diamond",
  ]) {
    assert.ok(css.includes(`.oh-ticket-cell[data-called=\"true\"][data-call-marker=\"${marker}\"]`), `${marker} has a ticket marking`);
    assert.ok(css.includes(`.oh-pattern-cell[data-pattern=\"true\"][data-call-marker=\"${marker}\"]`), `${marker} has a pattern marking`);
  }
  assert.ok(css.includes(".oh-pattern-diagram[data-theme-art] .oh-pattern-grid"), "pattern diagrams use the active theme palette");
});
