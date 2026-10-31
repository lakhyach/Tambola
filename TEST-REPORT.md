# Test Report

Every number and quotation below is a transcription of what a command printed or
what a browser page displayed. Nothing here is inferred from reading source code;
where a claim rests on a test alone rather than a live run, it says so.

**Run recorded:** 30 October 2026, on this working tree (branch `main`, base
commit `b62bdd9`, plus the changes this report ships with); a second pass on
31 October 2026 added §4.2; a third pass on 31 October 2026 (reliability,
security and interface) replaced §2, §4.3, §5, §8 and added §9, and re-ran every
gate in §1.
**Environment:** Windows 11, Node.js v24.16.0, npm 11.13.0, PostgreSQL 16.14 in a
local Docker container, exactly one application instance, browser automation
against Chromium with the app served from `client/dist` by the server itself.
**This is not a production run.** Nothing here was executed against the deployed
public URL; the deployed instance was deliberately left alone.
**Fifth pass, Phase 16B, 31 October:** the gates in §1 were re-run on the Phase 16B
tree, which adds a production environment gate (`npm run env:check`), a live
deployment smoke test (`npm run smoke`), scheduler and pool signals on `/healthz`,
a database profiler in the load harness, an unregistered Early Seven proposal, four
new test files (25 tests) and the CI workflows. `npm test` printed `tests 408 /
pass 408 / fail 0 / skipped 0`; `security-probe` held 51 of 51; `e2e` and
`e2e:durable` each played a full game to `COMPLETED`; `db:backup` +
`db:restore-check` round-tripped 18 tables / 10 547 rows; the durable load stage at
50 rooms × 250 players was re-measured **after** the dependency patch, so no figure
below is carried over from before it. Details in §2, §4.4, §7 and §8.

**Fourth pass, later on 31 October:** every gate in §1 was re-run on the current
tree after the security probe moved from `.preflight/tools/` (never scanned) to
`scripts/` (scanned). `npm test` again printed `tests 383 / pass 383 / fail 0 /
skipped 0`; `e2e` and `e2e:durable` each completed a full game to `COMPLETED`
with valid and refused claims (fresh draws, so different winning sequences from
§3); `db:backup` + `db:restore-check` round-tripped 18 tables / 10 498 rows;
`secret-scan` first **failed** — F15 below, found by the gate itself — was fixed
at the literal rather than by loosening the scanner, and then passed. The live
`npm run security-probe` then failed four of its 51 checks (F16–F18 below) and,
after the server fixes, held **51 of 51**. `npm run verify` exits 0 on the
current tree.

---

## 1. Reproducing any line of this report

```bash
npm test                 # the whole suite (Node's built-in test runner)
npm run lint             # client ESLint, --max-warnings 0
npm run build            # installs both workspaces, builds client/dist
npm run secret-scan      # no credential in shipped content or in the built bundle
npm run security-probe   # 51 live checks of the HTTP and socket surface, in-process
npm run verify           # test + lint + build + secret-scan, one command
npm run e2e              # a complete game through the real engine, in memory
npm run e2e:durable      # the identical game against real Postgres persistence
npm run db:backup        # pg_dump + manifest
npm run db:restore-check # restores it into a throwaway database and proves it
```

`npm test` needs a reachable PostgreSQL for the durable, persistence and backup
tests. Without a database those tests **skip and say so** rather than passing
quietly. The run recorded below had a live database and reported `skipped 0`, so
all 408 of them actually executed.

---

## 2. Automated suite — 408 of 408

`npm test` on the Phase 16B tree (12.8 s; the same tree measured 10.8 s and 11.6 s
on two earlier runs, so the duration moves with the machine and not with the code):

```
ℹ tests 408
ℹ suites 18
ℹ pass 408
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 12827.0174
```

Suites stayed at 18 because the four new files use top-level tests rather than
`describe` blocks. The previous pass on this tree printed the same pass count with
`duration_ms 10789.2613`.

What each file is responsible for. The counts are each file's own `tests` figure
from running that file alone with the same environment file; they add up to the
408 above.

| File | Tests | What it pins down |
| --- | ---: | --- |
| `hardening.test.js` | 46 | forged payloads, session abuse, limiter, shutdown drain, lease loss, the CORS origin echo, the request-timeout floor and the stalled-body 408 |
| `engine.test.js` | 40 | state machine, draw order, call/claim/pause/resume/end/reset rules |
| `admin.test.js` | 33 | owner accounts, MFA, audit trail, operator actions, CSRF/cookie flags, malformed-body classification |
| `realtime.test.js` | 31 | multi-client behaviour over real Socket.IO connections |
| `seat-credential.test.js` | 25 | the per-tab seat credential and the join-page entry plan |
| `persistence.test.js` | 24 | hydration, sessions, rotation, backup/restore, schema-scoped instance lease |
| `patterns.test.js` | 24 | every pattern predicate against hand-built tickets |
| `multiticket.test.js` | 19 | 1–4 tickets per seat, selection lock, late joiners, claim per ticket, the roster's ticket counts |
| `ticket.test.js` | 17 | ticket legality: 15 numbers, 5 per row, column bands, no duplicates |
| `validate.test.js` | 16 | payload schema guards: names, codes, credentials, booleans, integers |
| `chat-messages.test.js` | 16 | chat validation, rate limit, room isolation, the history tail |
| `player-experience.test.js` | 15 | what the game screen may show, derived from real snapshots; the roster's right edge |
| `announce.test.js` | 15 | spoken-number queueing, language, lag reporting |
| `edge-cases.test.js` | 15 | deterministic engine edge cases and the durable claim-window rules |
| `chat-feed.test.js` | 12 | the client's chat list: dedupe, ordering, windowing |
| `env-check.test.js` | 11 | the production environment gate: TLS-verified remote database, no default credentials, refused transaction pooler, required origin/proxy/MFA shape, and that its own report never echoes a credential |
| `secret-scan.test.js` | 9 | the scanner itself: planted secrets must be caught |
| `host-confirm.test.js` | 9 | the second-click guard on End game / Reset |
| `celebration.test.js` | 8 | celebration events built only from verified server events |
| `refusals.test.js` | 7 | server refusal codes → honest player-facing sentences |
| `proposed-patterns.test.js` | 6 | Early Seven as a proposal: the live registry cannot award it, exactly seven of the ticket's own numbers, an eighth call never moves the completion ordinal, call order is irrelevant |
| `health-signals.test.js` | 4 | the new `/healthz` blocks: scheduler overdue verdict, pool occupancy and connection errors, memory mode reporting neither unless wired, and no connection string in the payload |
| `smoke-deploy.test.js` | 4 | the deployment smoke test itself: probes pass against an in-process server, a full multiplayer round over real sockets, an unreachable URL fails every probe, a malformed URL is refused before any request |
| `bootstrap.test.js` | 2 | boot without a database refuses; opt-in memory mode works |

`npm run lint` exited 0. `npm run build` exited 0 on the Phase 16B tree — 123
modules, `dist/assets/index-Bixp5xmq.js` 353.97 kB (107.57 kB gzipped), CSS
33.40 kB, `index.html` 1.78 kB, built in 1.51 s. The fourth-pass build printed 124
modules and `index-DB4GhiSQ.js` 352.38 kB; no client source changed in this phase,
but `client/package-lock.json` did (the dependency audit), and the content hash
moves with it.

Earlier in the day, the same suite was **341 / 341**; the 42 added since are the
security, durability and interface checks in §4.3 and §5, plus the three
HTTP-surface checks (F16–F18) added on the fourth pass. Phase 16B then added 25
more (383 → 408), all of them gating something that ships: the two new scripts, the
two new health blocks and the Early Seven proposal. One failure was produced and
explained along the way: `persistence.test.js` "the single-instance lease refuses
a second scheduler" failed with `INSTANCE_LOCKED` while a verification instance
was still running. That failure was real and it was fixed at the root rather than
by stopping the server — see F11 in §5. Phase 16B produced a second one, F19, and
it too was fixed at the literal rather than by weakening the gate.


---

## 3. A complete game, twice — the exact winning sequences

`scripts/e2e-game.mjs` seats real players, lets them choose ticket counts, starts
the round, drives every call, fires **valid and invalid** claims, plays to
COMPLETED and then asks the engine to audit itself
(`room.assertIntegrity()`): every call must match the stored draw plan, no
exclusive pattern may have two winners, every award must name a real participant
and appear on that player's claim list, and every player's points must equal the
sum of the patterns they hold.

### 3.1 In memory — `npm run e2e`

```
room E99YSN4A created by GameHost (state WAITING)
  Asha chose 3 ticket(s): #1, #2, #3
  Ravi chose 2 ticket(s): #1, #2
  Meena chose 4 ticket(s): #1, #2, #3, #4
  John chose 1 ticket(s): #1
game started: 11 tickets issued across 4 seats (selection locked)

== winning sequence (server-verified) ======================
 1  Early Five     Asha     #3      20   idx 22 = #53
 2  Middle Line    Meena    #3      10   idx 49 = #10
 3  Top Line       Meena    #3      10   idx 52 = #65
 4  Bottom Line    Asha     #1      10   idx 64 = #61
 5  Corners        Asha     #1      20   idx 64 = #61
 6  Full House     Ravi     #2      30   idx 78 = #19

== rejected claims (must never score) ======================
  premature line         @ call 1   -> line incomplete
  invented ticket        @ call 22  -> fewer than five ticket numbers called
  duplicate full house   @ call 78  -> Full House was already won by Ravi

state: COMPLETED | called 78 | remaining 12
awards: 6 (one per enabled pattern: 6)

  Asha      50 pts  [earlyFive, bottomLine, corners]
  Ravi      30 pts  [fullHouse]
  Meena     20 pts  [middleLine, topLine]
  GameHost   0 pts  []
  John       0 pts  []

PASS — a full game ran through the real engine to a COMPLETED state.
Winner of the deciding Full House: Ravi (ticket #2) on call 78 (#19).
Top of leaderboard: Asha with 50 points.
```

The winning sequence, read as a story: Early Five went to Asha's third ticket on
call 22 (number 53); Meena took Middle Line on her third ticket at call 49 and
Top Line at call 52; Asha completed Bottom Line and Corners on the same call
(64, number 61); the round closed when Ravi's second ticket made Full House on
call 78 (number 19) — 12 numbers still un-called. Three deliberate illegal
claims were attempted along the way and all three were refused by the server with
a reason, scoring nothing.

### 3.2 Against real Postgres — `npm run e2e:durable`

Same script, same seats, same asserts, persistence on:

```
persistence: durable (throwaway schema tambola_e2e_78c011)
room YR9E3DPE created by GameHost (state WAITING)
  Asha chose 3 ticket(s): #1, #2, #3
  Ravi chose 2 ticket(s): #1, #2
  Meena chose 4 ticket(s): #1, #2, #3, #4
  John chose 1 ticket(s): #1
game started: 11 tickets issued across 4 seats (selection locked)

 1  Early Five     Ravi     #2      20   idx 13 = #51
 2  Corners        Meena    #4      20   idx 16 = #26
 3  Bottom Line    Ravi     #2      10   idx 39 = #59
 4  Top Line       Meena    #4      10   idx 51 = #14
 5  Middle Line    Asha     #1      10   idx 53 = #6
 6  Full House     Ravi     #1      30   idx 72 = #89

  premature line         @ call 1   -> line incomplete
  invented ticket        @ call 13  -> fewer than five ticket numbers called
  duplicate full house   @ call 72  -> Full House was already won by Ravi

state: COMPLETED | called 72 | remaining 18

  Ravi      60 pts  [earlyFive, bottomLine, fullHouse]
  Meena     30 pts  [corners, topLine]
  Asha      10 pts  [middleLine]
  GameHost   0 pts  []
  John       0 pts  []

engine integrity assertion passed on the completed room.
recoverable open rooms after this game closed cleanly: 1
dropped throwaway schema tambola_e2e_78c011

PASS — a full game ran through the real engine to a COMPLETED state.
```

A different draw order, a different winner (Ravi, ticket #1, Full House on call 72
— number 89), the same six patterns awarded exactly once, the same three
illegal claims refused. The sequence differs between the two runs because the
draw is shuffled from a fresh random source each game; the invariants do not
change, which is the point of running it twice.

`recoverable open rooms … : 1` is the other room this script keeps alive to
prove recovery has something to rebuild; the throwaway schema is dropped
afterwards, so nothing is left behind.

---

## 4. Browser evidence

Two kinds of evidence are kept separate below on purpose: what a person's browser
actually displayed, and what an automated test proves about code.

### 4.1 Observed in a live browser

**Complete game, winner, celebration, no replay after refresh.** In a verification
session on a room hosted at `http://127.0.0.1:4000` (room codes recorded in the
local evidence folder, e.g. `realplay_*` and `r7_*` passes), the following were
read off the rendered pages: two players with 2 and 3 real tickets taking their
seats in the waiting room; the host's board advancing call by call; a claim
attempted too early producing the refusal `line incomplete` as a visible toast
with the ticket unchanged; the winning claim producing the celebration overlay
naming the pattern and the player, seen identically on the winner's tab and on
the host's tab; the final results panel showing the standings; chat carrying an
English and a Hindi quick message from different seats. Reloading the winner's
tab after the round completed showed the completed results **without** replaying
the celebration — the overlay is driven only by server events that arrive while
the page is open, and the client's idempotency set is per-session.

**A seat that joins mid-round (room `U49KCQBN`, 30 Oct).** Read from the DOM:

- eyebrow `Watching this round`, heading `You joined mid-game`;
- elements with `role="table"` on that screen: **0** — no empty ticket grid is
  drawn any more;
- the string `NN/15` (a marked-count header) appears nowhere on it;
- the note beside the claim heading read `no ticket this round`;
- all **6** Claim buttons reported `disabled === true`;
- the board kept advancing while she watched (`19 called` → `90 called`);
- she could chat: `Ravi: Hi from Ravi 👋` appeared in the room's list;
- console: zero messages.

**Seat claiming (same session).** A brand-new tab opened at `/player` stayed on
the join form and offered the remembered seat instead of taking it: card
`SEAT THIS BROWSER REMEMBERS`, line `Ravi · room U49KCQBN — is that you, in this
tab?`, buttons `Take that seat` and `I'm a new player`. Choosing "I'm a new
player" made the card disappear and gave the new tab its own seat — header
`Playing as Meena`, roster line `4 playing … Meena (you)` — so N tabs really do
mean N players. Choosing "Take that seat" re-entered the existing seat instead.

**Host flow (room `KQUV452G`, 30 Oct, the rebuilt bundle).** `/host` → name
`Vikram` → `Create Room` → waiting room printed `The Hall is Open`, room code
`KQUV452G`, `Copy Invite Link`, `Share Invite`, ticket picker
`PICK 1–4. EACH IS A FRESH SET OF 15 NUMBERS.`, roster `IN THE HALL`. `Start
Game` routed to `/host/game`, which showed `RUNNING`, `NOW CALLING · 70 – 79`,
badge `77`, `call 3 of 90`, `3/90 · 87 left`. `Host Controls` contained exactly
`Call next` (disabled, because auto-call was on), `Pause`, `Auto: On`,
`End game`, `Reset` (disabled) — and no `Start game`, which was the defect fixed
after this observation (see §5, F4); the control that replaced it is read live in
§4.2.

### 4.2 The five interface changes — observed in a browser (31 October)

A second verification run on **31 October 2026** (Node v24.18.0, the same local
PostgreSQL, one application instance started with a shell-level
`CALL_INTERVAL_MS=500` so a round closes in about a minute — `.env` untouched, and
the built bundle re-verified byte-identical: `index-BgQrlBFv.js`, 344.03 kB) read
each of the five off a rendered page. Room `96DUNEYN`: host `Vikram`, `Asha` with 2
tickets, `Meena` seated mid-round.

| Change | What the page actually showed |
| --- | --- |
| `Start game` on the host's game screen after a reset | With the room in `COMPLETED`, two clicks on `Reset` returned it to `WAITING` **without leaving `/host/game`**. That screen then showed `Start game` (enabled) and **no** `Call next`; `Pause`, `Auto` and `Reset` were disabled and `End game` enabled. Clicking `Start game` began a fresh round — `RUNNING`, `call 13 of 90`, `NOW CALLING · 50 – 59` — on the host tab and on both player tabs at once. |
| End game / Reset second-click confirmation | First click on `End game` (`RUNNING`): the button became `Confirm: end game` with `aria-pressed="true"`, a `role="alert"` line appeared — *End this round now? Every seat loses the rest of it, and only Reset follows. Click again to confirm.* — in `rgb(216, 162, 74)`, plus a `Cancel` button. Nothing fired: the state stayed `RUNNING` and the board kept drawing. Same shape for `Reset` → `Confirm: reset room`. A `MutationObserver` on the panel logged `armed: true` at +1 ms and `armed: false` at **+8646 ms** with no click in between: the 8-second expiry clears the arm by itself. A second click fired exactly once (coordinates shifted 664 → 714 as the label widened). `Cancel` clicked 80 ms after arming removed the warning, restored the label to `Reset`, and left the room `COMPLETED` at `90/90 · 0 left` — nothing destroyed. The armed control, the alert and `Cancel` all appear in the accessibility tree (`button "Confirm: reset room"`, `alert "Reset the room? …"`, `button "Cancel"`), which the old native dialog never did. |
| …at phone width | In a 434 px window with the layout container pinned to 390 px: label `Confirm: reset room` (176 px wide, `scrollWidth ≤ clientWidth`, not clipped), warning line wrapped to **2** lines at 330 px, `Cancel` flowed onto its own line below it, and **0** text nodes in that row extended past 390 px. |
| `this round is finished` / `no ticket this round` / `claims open when the round starts` | All five states were read live. `RUNNING` with tickets: **no** note at all beside `WINNING PATTERNS` and all 6 `Claim` buttons enabled. `RUNNING` without tickets (Meena): `NO TICKET THIS ROUND`, 6/6 disabled. `PAUSED` with tickets: `CLAIMS REOPEN WHEN THE HOST RESUMES`. `COMPLETED`: `THIS ROUND IS FINISHED` on all three tabs, claims disabled. `WAITING` after the reset: `CLAIMS OPEN WHEN THE ROUND STARTS`. |
| `1 seated` instead of `1 playing` in the waiting room | `IN THE HALL · 1 seated` with only the host (also at 390 px), `2 seated` after Asha joined, `3 seated` after the reset. `3 playing` through `RUNNING` **and** `PAUSED`, `3 played` at `COMPLETED` (`2 played` once a seat had left). |
| Chat history for a seat that joins mid-round | Asha sent `Missed me? line from Asha` while the round was at call ~30. Meena opened a brand-new tab from the invite link and was seated at **call 58** — her `Room Chat` panel showed Asha's line, which she had never been pushed and which nobody re-sent. Her screen also read `WATCHING THIS ROUND / You joined mid-game`, had **0** `role="table"` elements, no `NN/15` string anywhere, and all 6 claim buttons disabled. |

Two things observed on the same pass, recorded so they are not mistaken for defects
later: a round that ends with no claims raises the overlay
`dialog "Game over — no winner this round."` with `Continue` and sound/motion
toggles; and after a `Reset`, a seat that never touched the picker is dealt the
default **1** ticket at the next start (Meena went from spectator to one ticket), so
`NO TICKET THIS ROUND` is a per-round statement, not a permanent one.

**Harness notes, kept separate from product findings.** The 30 October pass was
stranded by a native dialog raised by an older bundle; `window.confirm` now appears
only in two source comments and **zero** times in the built JS, and no dialog froze
the driver on this pass — the console recorded no messages at all. Two emulation
routes are closed by design or by the browser: `X-Frame-Options: DENY` and CSP
`frame-ancestors 'none'` (both deliberate anti-clickjacking headers,
`server/index.js:229`) make an iframe-based 390 px viewport impossible, and Chrome
will not shrink a window below ~434 px — hence the constrained-container method
above, which is sound here only because the emitted stylesheet has exactly **one**
breakpoint, `@media (min-width: 640px)`, so 390 px and 434 px render the same
(mobile-first) branch. The row utilities themselves were grepped in the built CSS,
not assumed: `.flex-wrap{flex-wrap:wrap}`, `.mt-3{margin-top:.75rem}`,
`.items-center{align-items:center}`, `.gap-3{gap:.75rem}`. Finally: an 8-second
arm is shorter than this driver's round trip, so any check that arms a control must
arm and act inside one script — three early "the arm vanished" readings were the
expiry, not a bug, and the corrected measurement is the +1 ms / +8646 ms log above.

**Still without browser evidence:** Safari and Firefox, a screen reader, a physical
handset, and the deployed URL — see §10. None of the five rows above is among them.

### 4.3 The 31 October interface pass — real 1440×900 and 390×844 pages

The narrow-layout evidence above had to work around a Chrome window that would not
shrink below ~434 px. That limitation is gone: `.preflight/tools/ui-capture.mjs`
drives Chrome directly over the DevTools Protocol and calls
`Emulation.setDeviceMetricsOverride` with `width: 390, height: 844,
deviceScaleFactor: 2, mobile: true`, so the page lays itself out at a true phone
viewport and the screenshot is taken at 780×1688 device pixels.

It is still a browser, not a workflow: the script creates a real room over the
live socket transport, seats two real players with `room:join` and
`tickets:select`, writes each seat's real session record where the client keeps it
(`tambola.session.v2`), opens one tab per seat, and clicks the real host controls
("Start game", "End game", "Confirm: end game"). Every image is the product's own
rendering against the durable stack.

| Screenshot | What it proves |
| --- | --- |
| `phaseG_02_host_waiting_room.png` | the hall lists three seats, each with a labelled ticket count — **including the host's own** — and the room code |
| `phaseG_03_player_join.png` / `_04_` | the two-column waiting room with a tabbed ticket preview; hall and status stay above the fold |
| `phaseG_05_host_seats_after_reload.png` | a full reload returns the same seat, same code, same three seats |
| `phaseG_06_host_game.png` / `_06b_` (full page) | host round at call 6: hero number, `RUNNING`, controls, ticket, master board, patterns, recent calls, hall, chat |
| `phaseG_07_player_game.png` | player round: tabs for three tickets, marked cells, the same board |
| `phaseG_08` / `_09_` / `_10_` (390×844) | the phone game screen, waiting room, and the scrolled ticket/patterns/board |
| `phaseG_11_results_host.png` / `_12_` | `Game over — no winner this round.` with standings, `Continue`, sound and motion controls |

Measured rather than judged, from `ui-capture.json`:

```
viewports.desktop 1440x900        viewports.mobile 390x844
overflow.waiting { viewport: 390, scrollWidth: 390, offenders: [] }
overflow.game    { viewport: 390, scrollWidth: 390, offenders: [] }
autoCall: true    callsBeforeShot: 6    state: "final shown"
```

`scrollWidth` equal to the viewport on both phone screens, with an element scan
that reports nothing wider than 390 px, is the objective form of "the phone layout
does not scroll sideways". Before the header fix in F12 it was not true.

The full review — what looked wrong, what was fixed, what is left to a designer —
is `.preflight/phaseG-ui-review.md`.

### 4.4 The Phase 16B readiness pass — both roles, two real viewports, through the forms

`.preflight/tools/p16b-readiness.mjs` drives headless Chrome over the DevTools
Protocol against a running server on `http://127.0.0.1:4000` — the production
build served by the server itself, durable PostgreSQL, one instance. It types into
the real inputs and clicks the real buttons; nothing is written into the
application's state by the harness.

```
landing   1440×900   h1 "Tambola" · "No sign-up · No cost · Your ticket lives through a refresh"
                     scrollWidth 1440 = innerWidth 1440
host      typed "BrowserHost" → clicked "Create Room" → room 7BXX8KDA
                     path /host/room · "IN THE HALL 1 seated BrowserHost HOST"
mobile    390×844   scrollWidth 390 = innerWidth 390 on /host/room
guest     typed "BrowserGuest" + "7BXX8KDA" → clicked "Join Room"
                     path /player/room · scrollWidth 390 = innerWidth 390
host sees guest      seated 2 · names ["BrowserHost","BrowserGuest"]
consoleErrors        []   (both tabs, the whole pass)
```

Screenshots `p16b_01_landing.png` … `p16b_05_host_sees_guest.png`, and the
machine-readable form of the block above, are in `.preflight/`. What this pass
does **not** do: play a round, resize mid-session, or run on a handset. The
round itself is proven by `npm run smoke -- --full` (§6) and by §3.


---

## 5. Defects found by testing, and what closed them

| # | Defect (how it was found) | Fix | Test that pins it |
| --- | --- | --- | --- |
| F1 | A seat that joined mid-round was shown a fabricated empty ticket grid headed `…'S TICKET 0/15 MARKED` with live claim buttons (browser). The server had done the right thing — selection locks at start, so the seat holds nothing — and `GameScreen` had papered over that true state with `snap?.ticket || [[], [], []]`. | Tickets come from `ticketSheets(snap)`; a grid counts as a ticket only if it contains numbers. Three honest panel states (`tickets` / `choose` / `spectator`). | `player-experience.test.js`: the exact snapshot (`RUNNING`, `tickets: []`, `ticket: null`) yields `[]`, `"spectator"`, `canClaim false`; `[[ ],[ ],[ ]]` is rejected |
| F2 | A brand-new tab silently claimed the last seat written to the device, so several tabs in one browser became one player (browser). | `loadOwn()` (this tab) and `loadPending()` (device copy, only while the tab is empty) plus `planJoinEntry()`: the tab's own seat resumes, a device seat is **offered**, nothing is taken silently. | `seat-credential.test.js` (25 tests incl. half-seat and junk immunity, host never offered, invite links never auto-resume) |
| F2a | Fixing F2 introduced a regression: a **host** tab visiting `/player` was bounced into the player lobby (browser). | `planJoinEntry` refuses to resume a seat whose role is `host`. | `seat-credential.test.js` — "the host's own tab is not bounced into a player lobby by the join page" |
| F3 | A seat that joined while the room was already chatting saw `Room Chat / No messages yet.` next to a live conversation (browser). | The room keeps a bounded in-memory tail (`CHAT_HISTORY = 24`), every message carries an id, and the panel asks `chat:history` when it mounts and on each reconnect. | `chat-messages.test.js`, `chat-feed.test.js`, `realtime.test.js` (wire level) |
| F4 | A host whose round ended and who pressed Reset was back in `WAITING` **on the game screen with no way to start again** — the only Start control lived on the waiting-room screen they had left (found by reading the button inventory in §4.1). | The primary host button follows the server state: `Start game` while `WAITING`, `Call next` while `RUNNING`. | `host-confirm.test.js` + the state rules in `engine.test.js` (`start()` only from `WAITING`) |
| F5 | `Winning Patterns` showed `claims open while running` in every state, so a finished round kept promising a claim it would never accept (browser note). | `claimNote()` returns the reason for the current state, and returns nothing exactly when the buttons are live. | `player-experience.test.js`: `claimNote(...) === null` ⟺ `canClaim(...)` for all five states, and COMPLETED reads `this round is finished` |
| F6 | `In the Hall` said `1 playing` before the round had started. | `rosterTally()`: seated / playing / played. | same derivation module |
| F7 | Destructive host actions relied on `window.confirm()`: unreadable to assistive tech, invisible to automated checks, and able to freeze a browser driver mid-verification. | An explicit second click with a per-action warning and a Cancel, extracted as `lib/confirmAction.js`. | `host-confirm.test.js` (9 sequence tests: first click arms, second fires once, arming one never fires the other, state change clears the arm) |

| F8 | Every seat row in the hall ended in a bare `0` before a round — `player.points` printed with no label, which reads as a fault rather than a score (browser, §4.3). | `rosterStatistic()` gives the right edge a meaning per state — ticket count before a round, points during one — and renders nothing when neither applies. | `player-experience.test.js`: WAITING on a seat holding 2 tickets is `{2, "tickets"}`, a running round is `{20, "pts"}`, and an empty seat is `null` |
| F9 | A seat that never touched the picker showed **no** ticket count, including the host whose own picker said 1: the roster reported the grids already minted (`0` until Start), not the count the seat would play (browser, §4.3). | `playersList().tickets` reports `player.ticketCount`; `start()` issues exactly that count. | `multiticket.test.js`: an untouched seat reads 1, and after `start()` every row's count equals the tickets that seat actually holds |
| F10 | The player waiting room stacked up to four full-size ticket previews, pushing the hall list and the "waiting for the host" line below the fold — the information a waiting player needs was the information off screen (browser, §4.3). | A two-column desktop layout with a single tabbed preview (`TicketRail`); the phone layout stays one column. | Layout only — evidenced by `phaseG_03` / `phaseG_09` and the overflow measurement, not by a unit test |
| F11 | Running `npm test` while a dev server was up failed with `INSTANCE_LOCKED`. The single-instance lease used one fixed advisory key, so it protected the *database* rather than the *schema*, and the test suite's throwaway schema collided with the running app. | `instanceLeaseKey(schema)` derives two int4 halves from a SHA-256 of the schema name, and every call site uses `pg_try_advisory_lock($1,$2)`. Two schemas of one database are genuinely independent; one instance per schema still fails closed. | `persistence.test.js`: "the lease belongs to a schema, so another schema on the same database is not blocked" |
| F12 | The game header overflowed a 390 px phone: room chip, voice chip, sound button and connection pill were one non-wrapping group ~40 px wider than the viewport, clipping `CONNECTED` at the right edge (browser, measured). | The chip group wraps as a unit and stays right-aligned. | No unit test; measured instead — `scrollWidth 390`, zero elements wider than the viewport, on both phone screens |
| F13 | Under the hero number, `Now calling · 40 – 49` printed the decade as a range, which reads as two numbers being called in the same breath — the one thing a calling screen must never imply (browser, §4.3). | The band is named: `the 40s`, `the first nine`. | Copy only; verified on the rendered page |
| F14 | The admin router's own error boundary ran ahead of the app-level one and reported body-parser failures as `500 ADMIN_ERROR`, so an oversized or truncated request looked like a server fault (security probe). | 4xx classification in `server/admin/routes.js`: 413 `PAYLOAD_TOO_LARGE`, 400 `MALFORMED_BODY`, otherwise `BAD_REQUEST`. | `admin.test.js`: a 32 kB body and a truncated body are refused as the client's error, with nothing echoed back and the session endpoint still working |
| F15 | Moving the security probe from `.preflight/tools/` (outside the scan) into `scripts/` (inside it) made `secret-scan` flag its fake CSRF-probe body as a generic assigned secret — `password: "whatever-it-is"`. The value never reaches authentication (the request is refused at the CSRF gate), but a credential-shaped literal in shipped content is precisely what the scanner exists to catch (found by `npm run verify` itself, fourth pass). | The fake password is phrased `placeholder-not-a-secret`, which matches the scanner's existing placeholder allowance. The scanner was not weakened. | `secret-scan.test.js` (9 tests) still proves planted secrets are caught; `npm run secret-scan` and `npm run verify` exit 0 on the current tree |
| F16 | The live security probe sent an `Origin` on its allow-list and got `Access-Control-Allow-Origin: true` back, not the origin. The HTTP middleware set the header from the boolean verdict instead of the matched string, so a cross-origin browser would have rejected a socket the server had *just* accepted — the allow-list silently did nothing over plain HTTP (found by `npm run security-probe`). | The middleware echoes `req.headers.origin`; Socket.IO already used the same `corsOrigin` verdict correctly. | `hardening.test.js`: "an allow-listed origin comes back as itself, not as the word true", and an unlisted origin is granted nothing |
| F17 | Two small public-surface leaks the probe caught: every response carried `X-Powered-By: Express`, advertising the stack, and `/livez` returned `uptimeSeconds` — telemetry no anonymous liveness probe should hand out. | `app.disable("x-powered-by")`; `liveness()` now answers `{ok, live, draining}` and nothing else, with uptime kept on `/readyz` and `/healthz`. | `hardening.test.js`: the `/livez` test asserts no `uptime` substring and no `x-powered-by` header |
| F18 | A request that declares a body and then stalls (`content-length: 80`, sends 12 bytes, holds the socket) was held open by `express.json` — the probe's own client timed out at 8 s before any answer. Node's `server.requestTimeout` does not fire once a body has started, and body-parser has no timeout of its own, so a slow-loris-shaped client could park a connection. | Two bounds on one knob, `HTTP_REQUEST_TIMEOUT_MS` (default 30 s): `server.requestTimeout` for headers, and a new admin-router guard that answers a stalled body with `408 REQUEST_TIMEOUT` and `Connection: close`. | `hardening.test.js`: the request-timeout floor is asserted, and "a stalled request body is answered 408, not held open forever" proves the guard fires, refuses with a code, and leaves `/livez` working |
| F19 | Phase 16B's own new `tests/env-check.test.js` embedded a fully formed, password-bearing connection string as a fixture, and `npm run secret-scan` — run by `npm run verify` — flagged it at `tests/env-check.test.js:12`. The gate was right: a credential shape in shipped content is what it exists to catch, and an inline ignore is how a scanner becomes decorative. | The fake password became a `FAKE_DB_PASSWORD` constant interpolated into the string, which the scanner's existing interpolation allowance covers. No shape rule, no path exclusion and no ignore entry was added. | `secret-scan.test.js` (9 tests) still proves planted secrets are caught; `npm run secret-scan` passes over the whole tree, this file included |

Earlier phases are documented in `CHANGELOG.md`; this table is limited to what
testing on 29–31 October produced.

---

## 6. Contract, isolation and secret checks

- `npm run secret-scan` — `178 file(s) inspected (4 from client/dist, the rest
  version-controlled); 2 .env value(s) checked for leakage; 7 credential shape(s)
  checked` → **PASSED**: no credential values and no credential-shaped text in
  shipped content or in the built bundle. The scanner's own ability to catch a
  planted secret is tested (`secret-scan.test.js`, 9 tests). Fourth-pass re-run
  after F15: `186 file(s) inspected` → **PASSED**. The count grew by eight as
  work-in-progress entered the scan scope between the two runs — one of them the
  moved probe itself, which is exactly how F15 surfaced. Phase 16B re-run on the
  final tree: `204 file(s) inspected (4 from client/dist, the rest
  version-controlled); 2 .env value(s) checked for leakage; 7 credential shape(s)
  checked` → **PASSED**, this time after the gate had caught F19 in the new tests.
- `npm run security-probe` boots two in-memory instances on ephemeral ports and
  asserts 51 live checks across the HTTP response surface, CORS, admin auth,
  CSRF, body limits, the socket contract refusals, room isolation and the shipped
  rate budget: `RESULT: PASS — 51 of 51 checks held` (fourth pass, and again on the
  Phase 16B tree). The first run of the fourth pass held 47; the four failures were
  real and are fixed at the server in F16–F18, each now pinned by a
  `hardening.test.js` case as well.
- `npm run smoke -- --url http://127.0.0.1:4000 --full` — the deployment smoke test
  against a live server, in this phase. Eleven checks, one of them a real round over
  two real sockets:

  ```
  PASS  livez                    process alive (30ms)
  PASS  readyz                   durable, lease held (14ms)
  PASS  healthz                  schema current (2ms)
  PASS  spa                      client bundle served (4ms)
  PASS  socket-handshake         Socket.IO answers EIO=4 (2ms)
  PASS  multiplayer.host-socket  websocket connected
  PASS  multiplayer.room-create  room created
  PASS  multiplayer.room-join    second seat seated
  PASS  multiplayer.game-start   tickets issued
  PASS  multiplayer.call-fanout  both seats saw number 86
  PASS  multiplayer.game-end     room completed
  RESULT: PASS
  ```

  The last four lines are the ones a health check cannot give you: two clients actually
  seated, a round actually started, the same number actually delivered to both, and the
  room actually closed. `tests/smoke-deploy.test.js` (4 tests) pins the harness itself,
  including that it fails every probe against an unreachable URL.
- `realtime.test.js` proves over real sockets: a room code is 8 characters from
  the server alphabet; no raw engine credential (`hostToken`/`playerToken`) ever
  crosses the wire; a forged 48-hex session token cannot take another seat
  (`SESSION_UNKNOWN`); a payload claiming a different `roomId` is ignored, so chat
  and actions stay inside their own room; malformed frames are refused without
  touching the game; every event the old client used is on the deny list; a burst
  of events is rate limited and then refills.
- `server/net/CONTRACT.md` is the documented event surface, and the contract tests
  are the reason a client cannot assert a win.

---

## 7. Backup and restore

Run against the local PostgreSQL 16.14 during this verification. `db:backup`
writes a `pg_dump -Fc` archive plus a manifest outside the data directory;
`db:restore-check` restores that archive into a throwaway database and compares
the migration ledger, the table inventory, the row counts and the
call-log-versus-draw sequence before dropping it.

```
[backup] dumping database "tambola" (schema "public") with pg_dump in container tambola-pg
[backup] writing to E:\Projects\tambolagame\backups\tambola-tambola-20261030T183409Z.dump
[backup] wrote tambola-tambola-20261030T183409Z.dump (112577 bytes, sha256 71b1c7af515a2c36…)
[backup] 18 table(s), 6644 row(s) recorded in tambola-tambola-20261030T183409Z.manifest.json

[restore-check] archive: tambola-tambola-20261030T183409Z.dump
[restore-check] manifest: tambola-tambola-20261030T183409Z.manifest.json
[restore-check] created throwaway database "tambola_rc_34852c7f47" (source "tambola" untouched)
[restore-check] archive creates schema "public" itself — removed the pre-existing one from the scratch database
[restore-check] pg_restore into "tambola_rc_34852c7f47" completed
[restore-check] restored 18 table(s), 6644 row(s); ledger 4 entry(ies)
[restore-check] dropped throwaway database "tambola_rc_34852c7f47"

RESTORE CHECK PASSED
  archive restores faithfully into an isolated database; ledger, table inventory,
  row counts and game-history invariants all match.
```

Both commands exited 0. The `backups/` directory is gitignored on purpose: a dump
is game data and never belongs in the repository.

**Phase 16B re-ran both on 31 October** against the same container, after the
dependency patch: `[backup] wrote … (179004 bytes, sha256 3b0afb57057dfe23…)`,
`18 table(s), 10547 row(s)`, and `db:restore-check` created the throwaway
database `tambola_rc_be2b409117`, restored into it, matched the migration ledger,
the table inventory, the row counts and the call-log-versus-draw sequence, and
dropped it — `RESTORE CHECK PASSED`. The row count is 59% higher than the run
quoted above because the local database has kept playing since; the procedure, not
the size, is what is being proved.

---

## 8. Load, measured

`scripts/loadtest.mjs staged`, local PostgreSQL 16, one app instance, throwaway
schema, calls fired back-to-back (a far harsher write rate than real play, where
`CALL_INTERVAL_MS` spaces them by seconds). p50 / p99 call-ack latency:

| Active rooms | `DB_POOL_MAX` | p50 | p99 | peak pool | peak waiters | dup calls / leaks / conn errors |
| --- | --- | --- | --- | --- | --- | --- |
| 20 | 8 (default) | 25 ms | 58 ms | 8/8 | 12 | 0 / 0 / 0 |
| 50 | 8 | 61 ms | 101 ms | 8/8 | 42 | 0 / 0 / 0 |
| 50 | 24 | 49 ms | 90 ms | 24/24 | 26 | 0 / 0 / 0 |
| 50 | 40 | 49 ms | 86 ms | 40/40 | 10 | 0 / 0 / 0 |
| 100 | 40 | 108 ms | 170 ms | 40/40 | 60 | 0 / 0 / 0 |

Correctness held at every size: zero duplicate calls, zero cross-room fan-out
leakage, zero connection errors, every reconnect sample recovered. The full
assessment, including why the production ceiling is the pooler plan rather than
these numbers, is `server/RUNBOOK.md` §5.

### 8.1 Phase 16B — 50 rooms × 250 players, with the database profiled

`scripts/loadtest.mjs staged 10:50,50:250`, local PostgreSQL 16.14
(`max_connections = 100`), one instance, throwaway schema. The harness now wraps
every game transaction and samples `pg_stat_activity`, `pg_stat_database` and
`pg_stat_wal`, so the queue is attributed instead of inferred:

| `DB_POOL_MAX` | ack p50 | p95 | p99 | peak waiters | tx p95 | tx p99 | lock waits |
| --- | --- | --- | --- | ---: | --- | --- | ---: |
| 8 (default) | 44.6 ms | 84.8 ms | 101.2 ms | 42 | 102.3 ms | 158.2 ms | 1 |
| 16 | 37.1 ms | 65.0 ms | 89.8 ms | 34 | 151.5 ms | 236.7 ms | 1 |
| 32 | 42.9 ms | 56.4 ms | 62.9 ms | 18 | 141.1 ms | 320.8 ms | 16 |

At 42 waiters the database was idle: peak **7** active backends of 8, longest
query **23 ms**, cache hit **100%**, 0 deadlocks, 0 rollbacks, WAL 2.2 MB over
25 750 records. The queue is **pool checkout plus per-room serialisation**, not
Postgres capacity — which is why enlarging the pool stops paying once the per-call
transaction round-trips are the floor. 16 is the right setting for a known ~50-room
peak; 32 buys ~8 ms of p95 and costs 16 lock waits and a 321 ms transaction p99.

Re-run **after** the dependency patch, so no figure above is carried into this
release unchecked:

```
joins 250 · failures 0 · acks 750 · duplicate calls 0
ack p50 48.8 ms · p95 87.0 ms · p99 121.0 ms
room syncs 150/150 · reconnects 50/50 · event-loop p99 29.3 ms
rss 137.6 MB · cpu 50 % · pool 8/8 · waiting 42
db: 1400 transactions · tx p50 47.3 / p95 161.1 / p99 213.1 ms
    peak active 7 · longest query 48 ms · lock waits 0 · cache hit 100 %
    wal 1.8 MB / 19869 records
```

That is **250 concurrent players across 50 active rooms**, on durable PostgreSQL,
and the two numbers that matter are zero duplicate calls and zero failures of any
kind. Nothing here was measured above 250 concurrent players, and the 100-room row
in the table above is an artificial burst, not an operating target.

---

## 9. What this report does not prove

- **No production verification.** The deployed instance was not touched, per
  instruction. Nothing here says the hosting provider's TLS, proxy headers or
  cookie flags are correctly configured — `DEPLOYMENT.md` lists them as
  post-deploy checks precisely because only a live check can confirm them.
- **One browser engine.** Everything observed was Chromium. Safari and Firefox
  have not been run against this build; the client uses standard APIs (Web Speech
  with a graceful fallback, clipboard with a manual fallback, `navigator.share`
  with a copy fallback) but "has a fallback" is not "verified on that engine".
- **Screen readers were not used.** The interface carries roles, `aria-live`,
  `aria-pressed` and labelled controls, and the ticket grid is a `role="table"`,
  but no assistive technology has been run over it.
- **Phone evidence is emulation, not a device.** The 30 October narrow-layout
  checks ran in a real Chrome window that would not shrink below ~434 px with the
  layout container pinned to 390 px. Phase 16B added a second pass that does it
  properly — `Emulation.setDeviceMetricsOverride` at 390×844, scale 2, mobile,
  against the built bundle (§4.4) — and both reported `scrollWidth 390` with zero
  offending elements. It is still not a handset: no iOS Safari, no touch gestures,
  no cellular network, no keyboard obscuring the viewport.
- **No soak, no chaos.** Nothing ran for hours; no database failover, no
  network-partition simulation, no killed-process recovery beyond the boot
  recovery tests in `persistence.test.js`.
- **Capacity is a measured worst case, not a recommendation.** ~100 concurrently
  active rooms under artificial load is not a target to run at. The Phase 16B
  durable run stops at 250 concurrent players; no evidence exists above that, and
  none is claimed.
- **The deployment gates were run against `127.0.0.1`, not a public URL.**
  `npm run smoke -- --full` proves the live surface, the sockets and a round; it
  cannot prove the provider's TLS, proxy headers or cookie flags, which
  `DEPLOYMENT.md` lists as post-deploy checks for exactly that reason.
- Chat is unmoderated beyond length and rate limits, and there are no player
  accounts; both are product boundaries, not test gaps.
