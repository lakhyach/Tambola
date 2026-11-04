/**
 * Code-native artwork directions for the reviewed theme catalogue.
 *
 * The server remains the source of reviewed theme IDs, tokens, versions and
 * publication state. This registry only selects original, decorative artwork
 * that can be previewed alongside the real ticket and board.
 */
const PACKAGES = Object.freeze({
  "obsidian-hall": Object.freeze({ family: "heritage", trim: "keyline", ball: "lacquer", marker: "seal", symbol: "arch" }),
  "midnight-indigo": Object.freeze({ family: "night-sky", trim: "crescent", ball: "moon-glass", marker: "star", symbol: "moon" }),
  "marigold-festival": Object.freeze({ family: "flower-market", trim: "garland", ball: "petal", marker: "petal", symbol: "marigold" }),
  "cobalt-arcade": Object.freeze({ family: "game-show", trim: "electric", ball: "neon", marker: "pixel", symbol: "arcade" }),
  "terracotta-house": Object.freeze({ family: "courtyard", trim: "arch", ball: "clay", marker: "arch", symbol: "lotus" }),
  "monsoon-garden": Object.freeze({ family: "monsoon", trim: "rain", ball: "rain-glass", marker: "drop", symbol: "rain" }),
  "paper-lantern": Object.freeze({ family: "lantern-night", trim: "lantern", ball: "lantern-glow", marker: "lantern", symbol: "lantern" }),
  "snowlight-minimal": Object.freeze({ family: "winter", trim: "frost", ball: "frosted", marker: "snow", symbol: "snow" }),
  "kesar-royale": Object.freeze({ family: "royal", trim: "crest", ball: "enamel", marker: "crest", symbol: "crest" }),
  "diwali-celebration": Object.freeze({ family: "diwali", trim: "diya", ball: "flame-glass", marker: "flame", symbol: "diya" }),
  "holi-colours": Object.freeze({ family: "holi", trim: "gulal", ball: "colour-pop", marker: "splash", symbol: "gulal" }),
  "durga-puja": Object.freeze({ family: "durga-puja", trim: "dhak", ball: "vermilion", marker: "trident", symbol: "dhak" }),
  "navratri-garba": Object.freeze({ family: "navratri", trim: "mirrorwork", ball: "dandiya", marker: "diamond", symbol: "dandiya" }),
  "ganesh-chaturthi": Object.freeze({ family: "ganesh-chaturthi", trim: "modak", ball: "saffron-clay", marker: "modak", symbol: "modak" }),
  "onam-pookalam": Object.freeze({ family: "onam", trim: "pookalam", ball: "flower-enamel", marker: "petal-ring", symbol: "pookalam" }),
  "pongal-harvest": Object.freeze({ family: "pongal", trim: "kolam", ball: "harvest-gold", marker: "sunrise", symbol: "sugarcane" }),
  "eid-moonlight": Object.freeze({ family: "eid", trim: "crescent-arch", ball: "moonlit-jade", marker: "crescent-star", symbol: "eid-moon" }),
  "christmas-winter": Object.freeze({ family: "christmas", trim: "holly", ball: "evergreen", marker: "holly-berry", symbol: "holly" }),
  "halloween-night": Object.freeze({ family: "halloween", trim: "cobweb", ball: "pumpkin-glow", marker: "bat-wing", symbol: "pumpkin" }),
  "new-year-celebration": Object.freeze({ family: "new-year", trim: "fireworks", ball: "midnight-gold", marker: "confetti", symbol: "fireworks" }),
  "wedding-celebration": Object.freeze({ family: "wedding", trim: "jaali", ball: "rose-gold", marker: "petal-heart", symbol: "wedding-mandap" }),
  "indian-textile-heritage": Object.freeze({ family: "indian-textile", trim: "woven-border", ball: "indigo-weave", marker: "woven-diamond", symbol: "textile" }),
});

export const FESTIVAL_THEME_ART_IDS = Object.freeze(Object.keys(PACKAGES));

export function getFestivalThemeArt(themeId) {
  return typeof themeId === "string" ? PACKAGES[themeId] || null : null;
}
