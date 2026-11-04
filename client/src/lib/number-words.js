/**
 * SPOKEN NUMBER FORMS (1–90) for English and Hindi voice.
 *
 * Why words instead of the digit string: some TTS voices rush digit strings at
 * speed and Indian players report confusing pairs like 15/50 (पंद्रह/पचास) and
 * 16/60 (सोलह/साठ). Spelling the word makes the utterance unambiguous, matches
 * the way a live housie caller announces. Romanized Hindi keeps voice copy in
 * the same readable script as the Hinglish callouts.
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

const HI_ROMAN = [
  "shoonya", "ek", "do", "teen", "chaar", "paanch", "chhe", "saat", "aath", "nau",
  "das", "gyaarah", "baarah", "terah", "chaudah", "pandrah", "solah", "satrah", "atharah", "unnees",
  "bees", "ikkis", "bais", "teis", "chaubis", "pachis", "chhabis", "sattais", "atthais", "untis",
  "tees", "ikattis", "battis", "taintees", "chauntees", "paintees", "chhattis", "saintis", "adtees", "untalis",
  "chalis", "iktalis", "bayalis", "tain-taalis", "chawalis", "paintalis", "chhiyalis", "saintalis", "adtalis", "unchaas",
  "pachaas", "ikyavan", "bavan", "tirpan", "chauvan", "pachpan", "chhappan", "sattavan", "athavan", "unsath",
  "saath", "iksath", "basath", "tirsath", "chaunsath", "painsath", "chhiyasath", "sadsath", "adsath", "unhattar",
  "sattar", "ikhattar", "bahattar", "tihattar", "chauhattar", "pachhattar", "chhihattar", "satattar", "athhattar", "unasi",
  "assi", "ikyasi", "bayasi", "tirasi", "chaurasi", "pachasi", "chhiyasi", "satasi", "athasi", "navasi", "nabbe",
];

/** English words for 0–99, null outside that range. */
export function englishWords(n) {
  if (!Number.isInteger(n) || n < 0 || n > 99) return null;
  if (n < 20) return EN_ONES[n];
  const tens = Math.floor(n / 10);
  const unit = n % 10;
  const base = EN_TENS[tens];
  return unit === 0 ? base : `${base}-${EN_ONES[unit]}`;
}

/** Romanized Hindi words for 0–90, null outside the Tambola range. */
export function hindiWords(n) {
  if (!Number.isInteger(n) || n < 0 || n > 90) return null;
  return HI_ROMAN[n];
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
