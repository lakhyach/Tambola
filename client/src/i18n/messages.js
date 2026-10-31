/**
 * QUICK-MESSAGE + CELEBRATION CATALOGUE (English / हिन्दी)
 * -------------------------------------------------------
 * One data-driven source for the one-tap chat messages and the celebratory
 * announcement strings, so no component hard-codes its own duplicated list.
 * Add a language by adding a key here; add a phrase by pushing to a category.
 *
 * The chat picker sends these through the existing `chat:send` contract, so
 * they inherit the server's rate-limit, room isolation and payload validation.
 * They are ordinary player chatter — never authoritative game events. Winning
 * announcements (§4) are driven only by verified server events and merely use
 * the localized strings below for display.
 *
 * Keep every message short: the server trims chat to `maxChatLength` (120).
 */

import { config, resolveLang } from "../config.js";

/** Picker categories, in display order, with localized tab labels. */
export const CATEGORIES = [
  { id: "greetings", label: { en: "Greetings", hi: "नमस्ते" } },
  { id: "goodLuck", label: { en: "Good luck", hi: "शुभकामनाएँ" } },
  { id: "reactions", label: { en: "Reactions", hi: "प्रतिक्रिया" } },
  { id: "numberMatch", label: { en: "My number", hi: "मेरा नंबर" } },
  { id: "celebration", label: { en: "Hooray", hi: "जीत" } },
  { id: "thanks", label: { en: "Thanks", hi: "धन्यवाद" } },
];

/** Categorized quick messages, keyed by language then category id. */
export const QUICK_MESSAGES = {
  en: {
    greetings: ["Hi everyone 👋", "Hello! 🙏", "Good evening all ✨"],
    goodLuck: ["Good luck! 🍀", "All the best 🤞", "May the best ticket win 🎟️"],
    reactions: ["Nice! 👏", "Ohhh so close 😅", "Wow 😮", "Haha 😄", "😮‍💨 just missed"],
    numberMatch: ["That's mine! 🙋", "Got it ✅", "One more! 😃", "Coming along 🎯"],
    celebration: ["Yesss! 🎉", "Let's gooo 🔥", "Claiming it! 🏆", "So happy 😄"],
    thanks: ["Thank you 🙏", "Nice game! 👍", "Well played 🤝", "GG 🎉"],
  },
  hi: {
    greetings: ["नमस्ते सबको 👋", "हैलो! 🙏", "शुभ संध्या ✨"],
    goodLuck: ["शुभकामनाएँ! 🍀", "गुड लक 🤞", "जिसका टिकट अच्छा, वो जीते 🎟️"],
    reactions: ["शाबाश! 👏", "अरे बिल्कुल पास 😅", "वाह 😮", "हाहा 😄", "😮‍💨 रह गया"],
    numberMatch: ["ये मेरा नंबर है! 🙋", "मिल गया ✅", "एक और! 😃", "बन रहा है 🎯"],
    celebration: ["वाहहह! 🎉", "बढ़िया! 🔥", "क्लेम कर रहा हूँ! 🏆", "बहुत खुशी 😄"],
    thanks: ["धन्यवाद 🙏", "अच्छा खेल! 👍", "शाबाश, बढ़िया खेल 🤝", "अच्छा गेम 🎉"],
  },
};

/**
 * Localized strings for verified-server-event celebrations (§4). `{...}` are
 * filled from the authoritative event payload client-side; nothing here marks a
 * win — the caller only renders these after a real `claim:result`/`game:completed`.
 */
export const CELEBRATION = {
  en: {
    patternWin: "{name} wins {label}! 🎉",
    finalWinner: "{name} wins the game! 🏆",
    tiedWinner: "It's a tie between {names}! 🤝",
    noWinner: "Game over — no winner this round.",
    resultsTitle: "Final Results",
    standingsTitle: "Standings",
    viewResults: "View final results",
    continue: "Continue",
    soundOn: "Sound on",
    soundOff: "Sound off",
    motionOn: "Motion on",
    motionOff: "Motion off",
  },
  hi: {
    patternWin: "{name} ने {label} जीता! 🎉",
    finalWinner: "{name} ने गेम जीता! 🏆",
    tiedWinner: "{names} के बीच बराबरी! 🤝",
    noWinner: "खेल खत्म — इस बार कोई विजेता नहीं।",
    resultsTitle: "अंतिम परिणाम",
    standingsTitle: "स्थान",
    viewResults: "अंतिम परिणाम देखें",
    continue: "जारी रखें",
    soundOn: "आवाज़ चालू",
    soundOff: "आवाज़ बंद",
    motionOn: "एनिमेशन चालू",
    motionOff: "एनिमेशन बंद",
  },
};

/** Which languages the picker should offer, honouring the bilingual config. */
export function pickerLanguages() {
  return config.i18n.bilingualPicker ? config.i18n.supported : [resolveLang(config.i18n.default)];
}

/** Quick messages for one language as a flat [{ category, text }] list. */
export function quickMessagesFor(lang) {
  const table = QUICK_MESSAGES[resolveLang(lang)] || {};
  const out = [];
  for (const cat of CATEGORIES) {
    const list = table[cat.id] || [];
    for (const text of list) out.push({ category: cat.id, text });
  }
  return out;
}

/** A localized celebration string with `{token}` placeholders filled in. */
export function celebrate(lang, key, vars = {}) {
  const template = (CELEBRATION[resolveLang(lang)] || CELEBRATION.en)[key] || CELEBRATION.en[key] || key;
  return template.replace(/\{(\w+)\}/g, (_, name) => (vars[name] !== undefined ? String(vars[name]) : ""));
}
