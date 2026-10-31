# Indian Tambola / Housie — market benchmark

Phase 15 · Phase C deliverable · research performed **2026-10-31** · sources re-verified **2026-10-31 (Phase 16)**

> **Status (later on 31 October):** Phases B and D–G have since completed — voice synchronisation,
> an end-to-end play of this matrix in a real browser, claim edge-case tests, staged load runs and a
> rendered UI review. Their evidence is in `TEST-REPORT.md` and `CHANGELOG.md`; where a line below
> says a later phase "does next", that phase has now run.
>
> **Phase 16 verification pass.** S1–S4 were re-fetched on 31 October 2026 and every competitor claim
> in this document was checked against the live page text again: the party/PID model, 1–3 tickets, the
> six Octro combinations, bogey, "claim before the next number", the seven dividends that say "late
> claim is not allowed" (S3), the 5-character code / QR / 60 players / approval-off-by-default
> changelog entry / one-tap kick / lobby broadcast / Early Seven (S4), and 80+ variations with
> 500K+ downloads and 4.7★ at 11.4K reviews (S2). Nothing cited here was stale. Three dimensions the
> first pass left out — number-calling conventions, mobile gameplay conventions and administrative
> capability — are added as §3a–§3c, and §4a is the decision matrix the client signs off on.

This document compares this product against named, shipped Indian Tambola products. It exists to
answer one question honestly: *if a paying Indian host uses this game, does it behave like the games
they already know?* Every row states where the claim came from, because "I read it on a store page"
and "I played it" are not the same evidence.

---

## 1. Method and evidence classes

Labels used in every table:

| Label | Meaning |
| --- | --- |
| **O** | Directly observed. I opened the running product (or its source code) and saw the behaviour. |
| **D** | Documented by the publisher. The vendor's own store listing, help page, or rules page states it. |
| **D\*** | Documented, but only from a search-result snippet — the page body was not read. |
| **I** | Inferred. My reasoning from other evidence, not stated by the vendor. |

Rules of this document:

- **O is reserved for this product.** I did not install or play the three competitor apps; every
  competitor row is therefore **D** (or **I**), never **O**. Presenting a store listing as observed
  gameplay would be the exact dishonesty this phase is meant to remove.
- A **D** row is not a quality claim. Store copy is marketing; it is evidence of *intent*, not of
  whether the feature works in a bad network.
- No pricing, revenue, or download estimates are inferred beyond what a listing publishes.

### Sources

| # | Source | URL | Used for | Accessed |
| --- | --- | --- | --- | --- |
| S1 | Octro — *Tambola: Play Bingo*, how to play | https://tambola.octro.com/how-to-play.html | Ticket geometry, prize set, claim timing, bogey, multiple claims, party join model | 2026-10-31 |
| S2 | nLife Studios — *Online Tambola Friends Housie*, Google Play | https://play.google.com/store/apps/details?id=com.herokuapp.tambolah | Host/invite model, ticket requests, pace control, prizes, 80+ variations, voice call-out, ratings/downloads | 2026-10-31 |
| S3 | nLife Studios — *Dividends* rules page | https://onlinetambolahousie.com/dividends | The actual definitions of ~70 Indian dividends, and which ones forbid a late claim | 2026-10-31 |
| S4 | *Tambola Board — Host and Play*, App Store (Jasjit Chawla / Privy Central) | https://apps.apple.com/app/id1557433625 | Host-on-phone + players-on-web model, 60 players, audio modes, achievements, moderation | 2026-10-31, re-read Phase 16 |
| S5 | *Tambola Housie Caller 1-90*, Google Play | https://play.google.com/store/apps/details?id=bingo.tambola.housie.number.generator.auto.caller | The caller-only category (no rooms, no players) | 2026-10-31 (snippet only, **D\***) |

All five URLs returned live pages on both passes. S1–S4 were read in full; only S5 remains
snippet-only. S2 and S4 also publish user reviews, which are quoted as **review text** — a user's
words on the vendor's page, not the vendor's claim.

Deliberately not used: affiliate "top 10 tambola apps" listicles, SEO content farms, and AI-written
rules pages. Several rank highly for "tambola rules" and contradict each other on corners and
late claims, which is why S3 (the publisher's own rules page) carries the rules weight here.

---

## 2. The three product shapes on the market

**1. Money-table platform (Octro, S1).** A single large app with public tables, private "parties",
events, and sponsored events. Tickets are bought with virtual chips; the prize pool is the ticket
revenue. Join is *Party ID + password*, optionally through Facebook friends. Calling is automatic.
The host does not run the draw — the platform does.

**2. Social host app (nLife, S2/S3).** A host creates a room, invites people by link or code, players
request tickets, and the host controls the pace (pause / slow / fast) while the app calls numbers
with voice. Prizes are the familiar Indian dividend set, chosen per game, with 80+ variants.

**3. Host-device + web players (Tambola Board, S4).** The host runs the game on an iPhone/iPad;
players join from any browser with a 5-character code, QR, or one of three invite links — no install,
no signup. Up to 60 players, host can play too, auto-call with 5/10/15 s presets, three audio modes
(silent / beep / device voice), male/female voice with pitch and speed, achievements including
Early Seven and custom ones, multiple winners per achievement, player approval (now off by default),
kick/ban, mid-game joins, and rejoin-after-drop.

**4. Caller-only utilities (S5, D\*).** A number board with voice and history; no rooms, no players,
no claims. These are the apps this product replaces.

**Where this product sits.** Shape 3, with shape 2's host pacing and a shape 1-style owner/audit
console on top. That is a defensible position: the host keeps control, players need nothing but a
browser, and the operator gets durable history — which none of the three listings advertise.

---

## 3. Capability comparison

"Ours" rows are **code-verified** in this repository and, where marked ✔b, **browser-verified** in
Phase B / Phase 14 evidence (screenshots and JSON in `.preflight/`).

| Capability | Octro (S1) | nLife (S2, S3) | Tambola Board (S4) | Ours | Notes |
| --- | --- | --- | --- | --- | --- |
| Join mechanism | Party ID + password (D) | Invite link / code (D) | 5-char code, QR, 3 invite links, web (D) | 8-char code + invite link (`/player?id=…`) + native share (O ✔b) | No QR. Ours trades brevity for a larger unguessable space. |
| Account needed | Facebook/chips account (D) | App account (D) | None (D) | None — display name only (O ✔b) | Ours matches the friction-free end of the market. |
| Players per room | Large public tables (I) | Large (D) | 60 (D) | 100 default, configurable (O) | Ours is the highest default; see load results in Phase F. |
| Tickets per player | 1–3 (D) | Multiple, requested from host (D) | Personal tickets (D) | 1–4 default, hard cap 12 (O ✔b) | Octro's UI is built around 3; see §6. |
| Host plays too | n/a (no host role) | Host may buy tickets (D) | Yes (D) | Yes — host selects tickets and sees a rail (O ✔b) | Parity. |
| Auto-call | Yes (D) | Yes (D) | Yes, 5/10/15 s presets (D) | Yes, 500 ms–120 s, default 8 s (O ✔b) | Ours exposes far more range; the floor is where voice breaks — see Phase B. |
| Manual call | n/a | Host can pace (D) | Yes (D) | Yes — "Call next" (O ✔b) | Parity. |
| Pause / resume | No host (I) | Yes, pause control (D) | Yes (D) | Yes (O ✔b) | Phase B proves the board freezes and nothing is announced during pause. |
| Spoken numbers | Yes, per review reply (D) | Voice call-out (D) | Device voice, male/female, pitch, speed (D) | Web Speech, EN + Hindi, per-device on/off, honest RETRY when the browser blocks it (O ✔b) | Ours is weaker on voice *choice*; stronger on honesty when speech fails. |
| Language | English (I) | English + Indian languages (I) | Auto-Language from call phrases (D) | English + Hindi number words, device voice (O ✔b) | Hindi verified in browser: पाँच / पचहत्तर. |
| Chat | Yes (I) | Not advertised | Lobby broadcasts (D) | Room chat, EN + HI content, rate-limited, not persisted (O ✔b) | Ours has chat, not broadcast banners. |
| Reconnect / rejoin | Yes (I) | Yes (I) | Yes, rejoin active games (D) | Yes — session resume, board restored, no history replayed (O ✔b) | Phase B scenario `reload-no-replay`. |
| Mid-game join | Yes (I) | Yes (I) | Yes (D) | Yes, as a **spectator for the round in play**; ticketed from the next round, with an on-screen explanation (O ✔b) | Phase D verified 0 tickets and 0 enabled claim buttons for a 390px joiner at call 12 of 90. |
| Admission control | Paid entry (D) | Ticket approval by host (D) | Approval toggle, default off (D) | None — anyone with the code joins (O) | **Gap.** See §5. |
| Kick / ban | n/a | Not advertised | Yes, one tap (D) | Not implemented (O) | **Gap.** |
| Winner announcement | Auto verification (D) | Auto verification (D) | Real-time notifications + reactions (D) | Server-verified claim, celebration overlay, host + player views (O ✔b) | Parity on correctness; ours has no reactions. |
| Prize configuration | Fixed six combos (D) | Choose dividends per game (D) | Achievements + custom + multiple winners (D) | Six patterns, each on/off per room, fixed points (O) | **Gap.** See §5. |
| Lobby broadcast | Not advertised | Not advertised | Yes — "Game starting in 5 minutes!" to all players (D) | Not implemented (O) | **Gap.** Chat is one-to-many only by volume, not by intent. |
| Bogey recovery | A bogey cancels the ticket; no restore mentioned (D) | "Restore bogey" by host (D) | Not stated | Claim refused, ticket stays alive — nothing to restore (O) | Ours is the softer rule; see §4a and `docs/RULES-DECISIONS.md`. |
| Moderation | Not mentioned | Not mentioned | Profanity filter on names and chat; report flow; kick/ban (D) | Rate-limited chat; no profanity filter, no report flow (O) | **Gap.** Compare S4 before a public room is opened to strangers. |
| Connection status | Not advertised | Not advertised | Player sees host's connectivity, and vice versa (D) | Connection pill per client; host sees roster presence (O ✔b) | Parity. |
| Number phrases / language | Not advertised | Chat recommends responses; insights (D) | Auto-Language from the host's own call phrases (D) | Fixed EN + Hindi word sets; no custom phrases (O) | **Gap**, low urgency for a single-language client. |
| Marking | Player marks (implied by "marked off the numbers", D) | Player strikes the ticket (D) | Tap-to-mark personal tickets (D) | **Marks are derived from the official call history; a tap never changes state (O)** | Deliberate: no mis-mark means no accidental bogey. Some players expect the marking ritual — see §4a. |
| Operator console | No | No | No | Owner login with MFA, room audit, health, backup/restore (O ✔b, Phase 13/14) | Differentiator none of the three advertise. |
| Monetisation | Chips / events (D) | Ads/IAP (I) | Free, no ads (D) | Not implemented — client decision | Out of scope for this phase. |

### 3a. Number-calling conventions

| Convention | Market evidence | Ours | Notes |
| --- | --- | --- | --- |
| Sequence | 1–90, each number once (S1–S4 all describe a 1–90 draw) | 1–90, no repeats, persisted before broadcast (O ✔a) | The call is durable before any client sees it, so a crash cannot re-draw a number. |
| Who draws | Octro: the platform (D). nLife: the host draws but "has no control on what number will actually be called" (D). Tambola Board: the app (D). | The server (O) | In every product the *pace* is a human decision and the *sequence* is not. Ours keeps that split. |
| Pace | Octro: automatic (D). nLife: host pause / fast / slow (D). Tambola Board: auto-call speed presets 5/10/15 s (D). | Auto-call 500 ms–120 s (default 8 s) plus manual "Call next" (O ✔b) | Phase B proved the board freezes and nothing is announced during a pause. |
| Interval change mid-round | nLife: host can change speed at any time (D) | Adjustable mid-round; takes effect on the next tick (O ✔a) | No renumbering, no skipped call. |
| Board / history | nLife: left drawer shows every called number (D). Tambola Board: interactive board of all 90 (D). | Master board with all 90, called ones lit, plus recent-calls strip (O ✔b) | |
| Current number | All three show the last call prominently (D) | Hero reveal; the decade caption names the band, never a second number (O ✔b, fixed in Phase G) | |
| Spoken calls | Octro: spoken (D). nLife: added voice call-out after a review asked for it (D). Tambola Board: silent / beep / device voice, male/female, pitch, speed (D). | Web Speech, EN + Hindi, per device, RETRY chip when the engine is blocked (O ✔b) | See `TEST-REPORT.md` §4 and `.preflight/voice-evidence.json` (7 scenarios, 0 overlaps). |
| Repeat of the last number | None of the three advertises a "repeat" control | Not implemented | Left out on purpose: a repeat button that speaks out of order is the classic voice bug. |
| Winner announcement | Octro: claim tab slides up with claims remaining (D). Tambola Board: notification + reactions (D). | Server-verified award, celebration overlay, host and player views (O ✔b) | |

### 3b. Mobile gameplay conventions

| Convention | Market evidence | Ours | Notes |
| --- | --- | --- | --- |
| Portrait phone first | Every competitor is a phone-first product (D) | 390×844 verified; `scrollWidth 390`, zero horizontal offenders on both game screens (O ✔b, Phase G) | No horizontal scroll is treated as a defect, not a preference. |
| No install for players | Tambola Board: join from any browser, no signup (D); Octro/nLife need the app (D) | Browser-only for both host and players (O ✔b) | |
| Multi-ticket handling on a phone | Tambola Board: scrollable or pageable ticket layouts (D); Octro: 1–3 tickets (D) | Tabbed ticket rail, one ticket at a time, 44px targets (O ✔b) | Phase G measured the rail at 390 px. |
| Marking | All three let the player tap/strike (D) | Marks derive from the official call history; a tap changes nothing (O) | Deliberate difference — see §4a. |
| Audio | Tambola Board: silent / beep / device voice (D) | Voice toggle plus sound cues, per device (O ✔b) | |
| Out-of-app visibility | Tambola Board: live updates on lock screen and Dynamic Island (D) | None | **Gap**, nice-to-have only. |
| Rejoin after a drop | Tambola Board: rejoin active games instantly (D) | Per-tab seat credential; board restored without replaying history (O ✔b, Phase B + D) | |
| Chat vs board overlap | A user review on S2 complains that insights and notifications cover the number display (review text) | Chat sits in its own panel, not floating over the hero number (O ✔b) | Another vendor's bug is free evidence for a layout decision. |
| Late join on a phone | Tambola Board: mid-game joins (D) | Spectator for the round in play, ticketed from the next round, explained on screen (O ✔b) | Verified at 390 px, call 12 of 90. |

### 3c. Administrative capability

| Capability | Octro (S1) | nLife (S2) | Tambola Board (S4) | Ours |
| --- | --- | --- | --- | --- |
| Start / pause / stop | Platform-controlled (D) | Host pause and pace (D) | Host start, pause, end (D) | Host controls with a confirm dialog for end-game (O ✔b) |
| Admission | Paid ticket = admission (D) | Host approves ticket requests (D) | Approval toggle, off by default (D) | Open by code only (O) |
| Remove a player | Not offered | Not advertised | One-tap kick or ban (D) | Not implemented (O) |
| Undo a bogey | Not mentioned | Host can restore a bogey ticket (D) | Not stated | Not applicable — a refused claim does not cancel the ticket (O) |
| Game history | Not advertised | Not advertised | Device-local history; syncs across the host's devices (D) | Durable PostgreSQL history, call log, awards, operator audit (O ✔a) |
| Operator console | None | None | None | Owner sign-in with TOTP MFA, room audit, health snapshot, backup/restore (O ✔b) |
| Backup / recovery | Unknown | Unknown | Game history restored via Game Center (D) | `db:backup` + `db:restore-check` verify ledger, tables, row counts and call sequence (O ✔a, Phase 15) |
| Health / monitoring | Not advertised | Not advertised | Connection indicator (D) | `/livez`, `/readyz`, `/healthz`, draining on SIGTERM (O ✔a) |
| One-instance guarantee | Platform | Platform | Platform | Postgres advisory lease; a second instance fails `/readyz` by design (O ✔a) |

---

## 4. Rules matrix

Legend: ✔ supported, ✘ not supported, ~ supported with a different definition, **✔a** pinned by an
automated test in this repository, **✔b** verified in a real browser (Phase B/14/15 evidence).

| Rule | Standard / common form | Octro (D) | nLife (D) | Tambola Board (D) | Ours (O) | Recommended default |
| --- | --- | --- | --- | --- | --- | --- |
| Ticket geometry | 3 rows × 9 cols, 15 numbers, 5 per row, 1–3 per column | Same (D) | Same (D) | Same (D) | Same, server-generated, CSPRNG, ascending per column (O) | Keep. |
| Number range | 1–90, called once each | 1–90 (D) | 1–90 (D) | 1–90 (D) | 1–90, no repeats, WAL-before-broadcast (O) | Keep. |
| Column ranges | col 1 = 1–9, col 2 = 11–19 … col 9 = 81–90 | Stated as 1–9, 11–19 … (D — the page skips 10/20 when describing) | Not stated | Not stated | 1–9, 10–19, 20–29, … 80–90 (O) | Keep ours; the decade edges are where sloppy rules pages disagree. |
| Tickets per seat | 1–3 typical | 1–3 (D) | Multiple (D) | Personal (D) | 1–4 default, cap 12 (O) | 3 default, 12 cap. |
| Claim timing | Claim before the next number | Must claim before next call, else invalid (D) | "Late claim is not allowed" on Line, Block, Cinko, Ambo, Terno, Quaderna, Cinquina (D) | Not stated | **Enforced, and configurable** — `claimWindowCalls` defaults to 0 (claim before the next call); N gives N calls of grace; a negative value turns the rule off. Enforced at prepare *and* at commit, so a claim in flight when the next number lands is refused (O ✔a) | Ship 0 for paid/competitive tables and 1 for family tables; the operator sets it per room. |
| Wrong claim | Bogey — ticket cancelled | Ticket declared bogey and cancelled (D) | Not stated | Not stated | Rejected with a reason; ticket stays alive (O) | Keep permissive; expose "bogey mode" as an option, off by default. |
| Multiple winners per prize | Platform-dependent | Yes — several players may claim the same condition (D) | Not stated | Configurable, multiple winners per achievement (D) | Exclusive: first valid claim closes the pattern (O); flag `multipleWinnersPerPattern` exists but defaults false | Off for ≤10 seats; recommend enabling for large public rooms. |
| Early Five / Jaldi 5 | Any 5 called on the ticket | Early five (D) | Jaldi 5 (D) | Early Five (D) | `earlyFive`, completion ordinal recorded; optional call window (O) | On. |
| Jaldi 3 | Any 3 called | ✘ | Jaldi 3 (D) | ✘ | ✘ | Optional (fast party opener). |
| Early Seven | Seven called | ✘ | Early 7 (D) | Early Seven (D) | **Deferred by design** — `DEFERRED_PATTERNS.earlySeven` (O) | Add, defined as "seventh ticket number called". |
| Top / Middle / Bottom line | All 5 of a row | Yes (D) | Rows (D) | Yes (D) | All three, exclusive (O) | On. |
| Corners | Four corner numbers | "1st and last numbers of top and bottom rows" (D) | Corners (D) | Four Corners (D) | Leftmost/rightmost numbered cell of top and bottom row (O) | Keep ours — it is the correct reading of a ticket whose outer cells can be blank. |
| Full House | All 15 | Yes (D) | Full House (D) | Full House (D) | Yes, exclusive (O) | On. |
| Indian variants | Star, Pyramid, 143, Temperature, Breakfast/Lunch/Dinner, CID, Lockdown, … | ✘ | 80+ named dividends (D) | Custom achievements (D) | Not implemented; ambiguities documented in `DEFERRED_PATTERNS` (O) | Add 3–5 after a written definition is agreed; never guess. |
| Pause | Host pauses the draw | ✘ | Yes (D) | Yes (D) | Yes (O ✔b) | On. |
| Voice | Spoken numbers | Yes (D) | Yes (D) | Silent / beep / device voice (D) | EN + HI, per device, retry on engine failure (O ✔b) | On by default after first gesture; document the gesture requirement in host onboarding. |

One rule still needs a client decision rather than an engineering default, because it changes who
wins bragging rights: **bogey**. The late-claim window is now engineering-complete and sits in the
operator settings — it needs a *value*, not a design.

### 4a. Rules decision matrix

One row per rule that a client must confirm before a paid or public room is opened. "Ours today" is
what the engine actually does in `2063f0b`; "Recommended" is the default this report argues for.
Nothing in this matrix is a silent engine change — every "add" row is unimplemented on purpose.

| Decision | Market options | Evidence | Ours today | Recommended default | Owner |
| --- | --- | --- | --- | --- | --- |
| Tickets per player | 1–3 (Octro), request-many (nLife), personal (Tambola Board) | D, all three | 4 default, hard cap 12 (`maxTicketsPerPlayer`) | **3** default, cap 12 | Client |
| Claim window | Must claim before the next call (Octro); seven dividends refuse late claims (nLife) | D, S1 + S3 | `claimWindowCalls: 0` (claim on the completing call or before the next), settable 0–10, negative disables | **0** for prize tables, **1** for family | Client |
| Multiple winners per pattern | Octro: yes, with a remaining-claims counter; Tambola Board: configurable; nLife: 2 Full Houses possible | D, S1 + S2 + S4 | `multipleWinnersPerPattern: false` (exclusive) | false ≤10 seats, true above | Client |
| Wrong claim | Bogey cancels the ticket (Octro); host can restore bogey (nLife) | D, S1 + S2 | Refused with a reason; ticket stays alive | Keep — no bogey mode in v1 | Engineering (default), client may opt in later |
| Marking | Player taps/strikes | D, all three | Derived from official calls; taps are display-only | Keep — removes mis-mark disputes | Engineering |
| Late join | Allowed mid-game (S2, S4) | D | Spectator for the round in play; ticketed next round | Keep | Client (confirm wording) |
| Early Five window | No competitor publishes a call window | D | `earlyFiveMaxCalls: 0` (no window) | 0 | Client |
| Early Seven | Present (nLife "Early 7", Tambola Board "Early Seven") | D, S2 + S4 | Deferred — `DEFERRED_PATTERNS.earlySeven` | Add as "seventh ticket number called" | **Client sign-off required** |
| Star / Middle Number | nLife lists Star; S3 defines Laddu as "middle number of second line" | D, S2 + S3 | Deferred — value-vs-cell ambiguity | Add only after a written definition | **Client sign-off required** |
| 143 / Pyramid | nLife lists 143; both appear in "80+ variations" | D, S2 (names only) | Deferred | Add 3–5 named dividends after definitions | **Client sign-off required** |
| Calling interval | 5/10/15 s presets (Tambola Board), host-variable (nLife) | D | 8 s default, 0.5–120 s range | 8 s | Client |
| Pause | Available (nLife, Tambola Board) | D | Available | Keep | Engineering |
| Room size | 60 (Tambola Board), "hundreds" (nLife) | D | 100 default, `maxPlayers` configurable | 100 | Client |
| Admission | Open link (all), approval toggle (S4), ticket approval (S2) | D | Open by code | Open for v1; approval is a launch-tier gap | Client |
| Prize points | Fixed Octro set; per-game dividends (nLife); custom (S4) | D | Fixed points: Early Five 20, lines 10 each, Corners 20, Full House 30 | Client supplies prize list and values | Client |

---

## 5. Gaps that matter commercially

Ranked by how likely a paying host is to notice, not by implementation cost.

**Closed during this phase: the late-claim window.** It used to be possible to complete a line, stay
silent, and claim it ten calls later, because the pattern was still exclusive and unclaimed. Market
products either enforce "before the next number" (S1) or exclude late claims on specific dividends
(S3), and a host running a paid game would call the old behaviour cheating. Every pattern now reports
the call it completed on, and `claimWindowCalls` (0 by default, operator settable 0–10, negative
disables) decides how many calls may pass. `tests/edge-cases.test.js` pins the boundary: on the
completing call it wins, one call later it is `CLAIM_TOO_LATE`, and a claim prepared before the next
number but committed after it is refused too.

Still open, in order:

1. **Admission control (trust).** Anything protected only by an 8-character code is fine for family,
   thin for a public paid game. Tambola Board ships an approval toggle (S4) and nLife has ticket
   approval (S2). Ours has neither kick nor approve.
2. **Prize breadth (expectation).** Six patterns is the Octro set, not the Indian party set. nLife
   documents ~70 dividends and Tambola Board lets hosts invent achievements. A client comparing us
   side by side will ask for Star, 143, Temperature, Breakfast/Lunch/Dinner and Lockdown first. The
   five patterns this build refuses to guess at, with the exact ambiguity in each, are listed in
   `docs/RULES-DECISIONS.md`.
3. **Voice choice (perceived polish).** We cannot offer male/female/pitch with the Web Speech API in
   a portable way, but we already enumerate device voices and never expose the picker. Hindi is
   verified; other Indian languages depend on the device voice pack and must be described as such,
   not promised.
4. **No QR join (friction).** At an actual party, a QR code on the host's screen is faster than
   typing 8 characters. Cheap to add; purely additive.
5. **No broadcast banner (hosting).** "Starting in 5 minutes" to all players is a host tool, not a
   player toy (S4). Our chat is one message per player; a host banner is one-to-many and persists.

Not gaps, despite looking like ones: no chips, no events, no Facebook login, no ads. Those belong to
shape 1, and copying them would drag this product into real-money regulation it is not built for.

---

## 6. Recommended default configuration

These are the values I recommend shipping as the *defaults* for an Indian host, with the reasoning.
None of them require new architecture; the first four are configuration, the rest are scoped work.

| Setting | Current | Recommended | Rationale |
| --- | --- | --- | --- |
| `callIntervalMs` | 8000 | 8000 | Matches the "comfortable family" pace implied by Tambola Board's 5/10/15 s presets and stays above the voice-cost floor proved in Phase B. |
| `autoCall` | true | true | All three competitors default to automatic calling; manual is the exception. |
| `maxTicketsPerPlayer` | 4 | **3** | The market's mental model is 1–3 (S1). Keep the hard cap at 12 for clubs that want it. |
| Patterns enabled | earlyFive, three lines, corners, fullHouse | same | This is the Octro prize set (S1); a host migrating from it recognises every button. |
| `multipleWinnersPerPattern` | false | false for ≤10 seats, **true** above | Private family play wants one winner; a 60-person community game wants several, as both S1 and S4 allow. |
| `earlyFiveMaxCalls` | 0 (off) | 0 | The window exists but no competitor advertises one; leave it off until a client asks. |
| `claimWindowCalls` | 0 (claim before the next number) | 0 for paid/competitive tables, **1** for family tables | Shipped and operator-settable. 0 is Octro's documented rule and the defensible answer in a dispute; 1 buys slow phones tolerance at the cost of a "silent spectator" tactic. |
| Bogey (wrong claim cancels ticket) | none | off, host toggle | Suspending a child's ticket over a mis-tap is a support incident, not a feature. Offer it to serious clubs only. |
| Voice default | on, per device | on, per device | Muting is per device already; a host's phone speaking is expected, a guest's phone is their choice. |
| Join approval | none | off by default, host toggle | Tambola Board moved approval *off* by default after real usage (S4 changelog). Follow the evidence. |
| QR code on host screen | none | add | Removes the highest-friction step at a physical party. |
| Host broadcast banner | none | add | One-to-many announcement, distinct from chat. |

### Decisions that need the client, not engineering

- **Late claims.** The mechanism is built; the client chooses the value. "Claim before the next
  number" (0, market norm, harsher) or a grace window of N calls (kinder on slow networks,
  exploitable)? My recommendation: 0 for anything with a prize at stake, 1 for family games. The
  claim dialog does not yet show a countdown, so a value above 0 should come with that UI work.
- **Prize set.** Which of the Indian dividends does the client actually award, and with what points
  or prize amounts? Each needs a written one-line definition before implementation, because Star,
  143 and Pyramid are all described differently across sources.
- **Money.** If the client intends entry fees or cash prizes, that is a different product with
  licensing obligations; nothing in this build processes payments, and it should stay that way until
  that is decided explicitly.

---

## 7. What this document does not establish

- It does not establish that competitors' features *work* — only that they are advertised.
- It contains no download, revenue, retention, or pricing analysis; the only published figures used
  are the nLife listing's own 500K+ installs and 4.7★/11.4K reviews.
- It makes no claim about visual design similarity. No competitor asset, icon, ticket artwork, or
  copy was reused; the brand and ticket rendering here predate this research.
- It does not replace Phase D. A rules matrix written from documents still has to be played end to
  end on this build; that was what Phase D did next — §3 and §4 of `TEST-REPORT.md` are that play.
