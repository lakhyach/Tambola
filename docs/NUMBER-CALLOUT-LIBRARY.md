# Original English and Hindi caller copy

The source of truth is `client/src/lib/number-callouts.js`. It contains a short, family-friendly line for every official number from 1 to 90 in English and Hindi, alternate original lines for selected calls, and theme alternatives for Diwali, Holi, Navratri, Durga Puja, Ganesh Chaturthi, Onam, Pongal, Eid, Christmas, Halloween, weddings, royal celebrations, neon carnival and textile themes.

The speech adapter may prepend a callout only when the host enables **funny callouts**. It always appends the existing, locale-specific spoken number, so the number remains explicit. Speech stays device-local and optional; no provider, key, subscription or network request is involved. The callout selector accepts only an official 1–90 number, and uses a stable number/call-index selection so a replay or reconnect cannot invent a different call. The game server, number sequence, event queue and claims are unchanged.

The library is hand-authored for this project and does not quote a recording, script, comedian, film, brand or identifiable person. Hindi phrasing has not yet received review by a native-language editor; treat this initial copy as an implementation draft before a public release.

## Verification

`tests/number-callouts.test.js` checks that both locales cover all 90 numbers, variants remain deterministic, each festival line exists in both languages, and invalid calls return no copy. Caller UI and voice controls still need integrated browser verification, including the optional toggle, reconnect behavior, voice preview and absent-voice fallback.
