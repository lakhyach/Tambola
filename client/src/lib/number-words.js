/**
 * SPOKEN NUMBER FORMS (1–90) for English and Hindi (हिन्दी).
 *
 * Why words instead of the digit string: some TTS voices rush digit strings at
 * speed and Indian players report confusing pairs like 15/50 (पंद्रह/पचास) and
 * 16/60 (सोलह/साठ). Spelling the word makes the utterance unambiguous, matches
 * the way a live housie caller announces ("बोलो पंद्रह…"), and lets us pick the
 * exact Devanagari the voice should say.
 *
 * `speakWord` returns a best-effort string for ANY integer so an out-of-range
 * number from a stale event can never throw inside a speech callback.
 */

const EN_ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];
const EN_TENS = { 2: "twenty", 3: "thirty", 4: "forty", 5: "fifty", 6: "sixty", 7: "seventy", 8: "eighty", 9: "ninety" };

const HI_ONES = [
  "शून्य", "एक", "दो", "तीन", "चार", "पाँच", "छह", "सात", "आठ", "नौ",
  "दस", "ग्यारह", "बारह", "तेरह", "चौदह", "पंद्रह", "सोलह", "सत्रह", "अठारह", "उन्नीस",
];
const HI_TENS = {
  2: "बीस", 3: "तीस", 4: "चालीस", 5: "पचास", 6: "साठ", 7: "सत्तर", 8: "अस्सी", 9: "नब्बे",
};
// 21–29, 31–39… in Hindi are "एक-की-बीस", "छह-का-चालीस"… The compound form the
// caller tradition uses is simply "<unit>-<tens>"; voices say the hyphenated
// pair clearly, so we generate it rather than hand-listing 70 entries.
const HI_TENS_CONNECTOR = { 2: "बीस", 3: "तीस", 4: "चालीस", 5: "पचास", 6: "साठ", 7: "सत्तर", 8: "अस्सी" };

/** English words for 0–99, null outside that range. */
export function englishWords(n) {
  if (!Number.isInteger(n) || n < 0 || n > 99) return null;
  if (n < 20) return EN_ONES[n];
  const tens = Math.floor(n / 10);
  const unit = n % 10;
  const base = EN_TENS[tens];
  return unit === 0 ? base : `${base}-${EN_ONES[unit]}`;
}

/** Devanagari words for 0–90 (the Tambola range), null outside it. */
export function hindiWords(n) {
  if (!Number.isInteger(n) || n < 0 || n > 90) return null;
  if (n < 20) return HI_ONES[n];
  if (n === 90) return "नब्बे";
  const tens = Math.floor(n / 10);
  const unit = n % 10;
  if (unit === 0) return HI_TENS[tens];
  return `${HI_ONES[unit]}-${HI_TENS_CONNECTOR[tens]}`;
}

/**
 * The phrase a voice should say for `n` in `lang` ("en" | "hi").
 * Falls back to the plain digits for anything outside 1–90 or an unknown
 * language — a wrong-but-spoken call still beats a thrown exception inside
 * the speech engine's callback.
 */
export function speakWord(n, lang) {
  const words = lang === "hi" ? hindiWords(n) : englishWords(n);
  return words || String(n);
}
