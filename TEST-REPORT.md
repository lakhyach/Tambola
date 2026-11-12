# Test Report

## Waiting-room host moderation and multi-instance regression (1 November 2026)

- `node --test tests/host-moderation.test.js` passed **1/1**. A non-host socket was refused; the room host removed a waiting seat; the target received `room:removed` and could not resume with the revoked credential; a removal after game start was refused without dropping the seat.
- Live Chromium in disposable schema `codex_halls_dc49f772f8` removed a synthetic Bumper guest from the 390px host waiting room. Database readback confirmed the member row remains with `left_at`, its session is revoked, and the immutable room audit includes `removed-by-host`, the acting host player ID and `actorRole: host`. The removed socket left the room and the browser returned to `/player` with session storage cleared. The host roster had no horizontal overflow and browser errors were **0**.
- In the same run, Regular and Bumper games remained concurrent with independent durable call histories (2 and 1). The harness dropped and verified removal of its disposable schema. Repeatable browser command: `node .preflight/tools/multi-instance-host-game-browser-check.mjs`.

## Public hall host routing and concurrent multi-instance gameplay (1 November 2026)

- Server integration `tests/instances.test.js` passed **1/1** against isolated local PostgreSQL, including durable creation through the public Bumper slug and refusal to create rooms for hidden Legacy or a private Bumper hall.
- Live Chromium in disposable schema `codex_halls_cda828bd04` opened both public hall pages and used their “Host in this hall” controls. It created one Regular and one Bumper room, joined a player to each, started both games, and verified independent durable call histories: Regular **2**, Bumper **1**. Browser errors: **0**.
- The harness dropped and verified removal of its schema; no reservation data, retained booking schemas or production port 4000 were used. Repeatable browser command: `node .preflight/tools/multi-instance-host-game-browser-check.mjs`.

## Durable game process-restart browser verification (1 November 2026)

- Live PostgreSQL + Chromium flow passed in disposable schema `codex_restart_a8edab1930`: one room recovered, remained `RUNNING`, and retained its exact single-number call history, player ID and ticket grids after app recreation. Both host and player browser sessions resumed after reload; browser errors: **0**.
- The harness dropped only its disposable schema and verified it was absent. No reservation rows were created; existing retained booking schemas and port 4000 were not used.
- Reproducible command: `node .preflight/tools/durable-game-process-restart-browser-check.mjs`.

## Host setup and waiting-room localization (1 November 2026)

Chromium created a synthetic in-memory host room, switched from English to
Hindi, exercised ticket allocation to render the issued ticket grids, and
checked the host waiting-room controls, optional prize labels, ticket-limit
digits, prize-point digits, ticket-row labels and grid accessible names. The flow then
switched back to English. Both languages had no page/main overflow at 390×844
and 1440×900, and browser errors were 0. The room remained in `WAITING` and was
destroyed with the memory-only app.

| Gate | Result |
|---|---|
| `.preflight/tools/host-localization-browser-check.mjs` | PASS — English/Hindi host setup and waiting room, five optional prizes, accessible ticket labels, 4 viewport/language samples |
| `.preflight/tools/number-board-accessibility-browser-check.mjs` | PASS — live host/player call, 90 board items, 6 viewport sizes, 12.97:1 language-control contrast, 0 browser errors |
| `node --test tests/booking-locale.test.js` | PASS — 7/7 |
| `npm run lint --prefix client` | PASS |
| `npm run build --prefix client` | PASS — 209.23 KB minified entry bundle (69.38 KB gzip) |

Screenshots: `.preflight/host-room-hi-390.png` and
`.preflight/host-room-hi-1440.png`. This does not close whole-app translation,
screen-reader, or physical-device review.

## Expired reservation lookup recovery (1 November 2026)

The real public booking flow created a synthetic two-ticket hold in isolated
schema `codex_booking_expired_hold_1793554705955`. The hold was expired in
PostgreSQL and looked up in Chromium. Lookup transitioned it to `expired`,
appended `hold.expire`, cleared the stale held panel, and exposed no confirm,
join, or cancel action. The private token was absent from browser storage.

| Gate | Result |
|---|---|
| Durable Chromium check | PASS — 1 hold; persisted status `expired`; ordered audit `hold.create`, `hold.expire`; 0 browser errors |
| Post-shutdown database read | PASS — the reservation and both audit rows remained in the retained schema |

Reservation `84497534-69f5-4d74-a3e9-be5ffdee3f45` remains retained per the
keep-until-policy instruction. Screenshot:
`.preflight/booking-expired-hold-recovered-390.png`.

## Durable booking expiry and unavailability browser check (1 November 2026)

Chromium visited an expired booking window and a cancelled session against the
live app backed by a fresh isolated PostgreSQL schema. Both pages showed the
generic unavailable state, had no ticket-hold action, and made no booking API
writes. The underlying API returned the same generic `SESSION_NOT_FOUND` response
for both states. The run created no reservation/audit rows and removed the
temporary schema afterward.

| Gate | Result |
|---|---|
| `.preflight/tools/booking-window-unavailability-durable-browser-check.mjs` | PASS — 2 database-backed browser journeys; 0 browser errors; 0 reservation records |

Screenshots: `.preflight/booking-window-expired-390.png` and
`.preflight/booking-window-unavailable-390.png`. Durable expired-reservation
lookup/recovery remains open.

## Player and booking error localization (1 November 2026)

Shared refusal handling now localizes known game, host and public booking API
errors for English and Hindi. Unknown Hindi codes show a translated generic
failure; English preserves server-provided detail.

| Gate | Result |
|---|---|
| `node --test tests/booking-locale.test.js` | PASS — 7/7 |
| `npm run lint --prefix client` | PASS |
| `npm run build --prefix client` | PASS — Vite production bundle built |

This change does not claim complete translation of all public screen copy or a
full accessibility audit.

## Multi-instance foundation follow-up (31 October 2026)

On the current `6341f62` base plus this working change, migration 006 was applied
to the local database, then 007 and 008 were applied as forward-only migrations.
The 006 file was restored to its applied checksum; later schema corrections are
in 007/008. The isolated PostgreSQL test verifies Regular/Bumper/Legacy seeds,
room association, paused-instance join refusal, finishing an already-created
room after pause, and preventing ownership movement after game start.

| Gate | Result |
|---|---|
| `npm run migrate` | PASS — applied `006_game_instances.sql`, then `007_room_instance_lock.sql`, then `008_legacy_room_default.sql`; subsequent run is expected to be a no-op |
| `node --env-file-if-exists=.env --test tests/instances.test.js` | PASS — 1/1 PostgreSQL integration test |
| Serial full suite (PowerShell command below) | PASS — 627 pass, 0 fail, 0 cancelled, 0 skipped; 43.9 seconds |
| `npm run lint --prefix client` | PASS — 0 warnings |
| `npm run build --prefix client` | PASS — Vite production bundle built |
| `npm run secret-scan` | PASS — 240 files inspected; no credential leakage |
| `npm run e2e` | PASS — in-memory 90-ball round completed, 6 awards |
| `npm run e2e:durable` | PASS — PostgreSQL round completed, 6 awards; throwaway schema removed |
| `npm run security-probe` | PASS — 51/51 checks |
| `npm test` default parallel run | **FAIL** — migration contention hit PostgreSQL statement timeout; the serial full suite above passed |

The serial suite command was:

```powershell
$files = Get-ChildItem tests -Filter '*.test.js' | ForEach-Object { $_.FullName }
& node --env-file-if-exists=.env --test --test-concurrency=1 @files
```

This only verifies the platform foundation. It does not verify moderator
authorization, full instance-filtering of all queries, runtime branding editing,
instance-specific player joining, browser or mobile journeys, backup of new
moderator records, or a deep security review. Do not treat it as acceptance of
the requested platform.

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

**Sixth pass, Phase 17, 31 October:** every gate in §1 was re-run on the Phase 17
tree, which replaces the host strip with the caller console, adds a server round
clock and three new test files (39 tests), and adds a browser harness
(`.preflight/tools/p17-caller.mjs`). `npm test` printed `tests 447 / pass 447 /
fail 0 / skipped 0`; `security-probe` held 51 of 51; `e2e` and `e2e:durable` each
played a full game to `COMPLETED`; the browser pass reported `consoleErrors: []` at
1440, 820, 390 and 360 pixels wide. Details in §10.

**Seventh pass, Phase 18, 31 October:** every gate in §1 was re-run on the Phase 18
tree, which rebuilds the player's ticket and gameplay surface, validates persisted
tickets on recovery, and adds four test files (69 tests) plus three browser
harnesses (`.preflight/tools/p18-player.mjs`, `p18-audit.mjs`, `p18-perf.mjs`).
`npm test` printed `tests 516 / pass 516 / fail 0 / skipped 0`; `security-probe`
held 51 of 51; `e2e` and `e2e:durable` each played a full game to `COMPLETED`; the
player journey harness held 78 of 78 checks with `consoleErrors: []` at 360, 390,
430, 768 and 1440 pixels wide; the accessibility and call-cost audit held 35 of 35.
Details in §11.

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
npm run verify           # lint + build + test + secret-scan, one command
npm run e2e              # a complete game through the real engine, in memory
npm run e2e:durable      # the identical game against real Postgres persistence
npm run db:backup        # pg_dump + manifest
npm run db:restore-check # restores it into a throwaway database and proves it
node .preflight/tools/p17-caller.mjs   # the caller console in a real browser (server on :4000)
```

`npm test` needs a reachable PostgreSQL for the durable, persistence and backup
tests. Without a database those tests **skip and say so** rather than passing
quietly. The run recorded below had a live database and reported `skipped 0`, so
all 408 of them actually executed.

Two suites also need artefacts a bare checkout does not have: the smoke suite asks a
live server for the built client, so `client/dist` must exist, and the backup suite
dumps the database `DATABASE_URL` points at and requires its migration ledger, so
`npm run migrate` must have run. Phase 18 found GitHub CI failing on exactly that
(defect 7 in §11.5) and fixed the ordering in `.github/workflows/ci.yml` and in
`npm run verify`. Neither assertion was weakened; the environment was made to match
the promise the test makes.

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
  final tree: `203 file(s) inspected (4 from client/dist, the rest
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
- **L3 deep security review, pre-push, 31 October** — run against the committed tree
  before `2f93352` went to `origin/main`, and it answered exactly this and nothing
  more: `{"layer":"l3","findings_count":0,"findings":[]}`. A clean agent review of
  one commit range is not a penetration test and is not treated as one — §9 keeps
  that caveat — but the gap this report used to record as "offered and skipped" is
  now closed for this release.
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
- **No independent security review.** The L3 deep review ran and found nothing, and the
  51-check probe holds, but both were produced inside this project. Nobody outside it has
  tried to break this build.
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

---

## 10. Phase 17 — the caller console

Recorded 31 October 2026 on this working tree (base `108c6aa`), server on
`127.0.0.1:4000` with the durable database, one application instance.

### 10.1 Automated suite — 447 of 447

```
ℹ tests 447
ℹ suites 18
ℹ pass 447
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 12648.8379
```

The 39 new tests are `tests/caller-console.test.js` (22), `tests/caller-voice.test.js`
(9) and `tests/caller-realtime.test.js` (8). They cover, in the same order a
reviewer would ask:

- **The view-model** — every interval preset is inside the server's accepted range;
  an invalid one is refused before it is sent; `intervalPayload()` carries
  `{ intervalMs }` and no `enabled` key; `formatClock` and `elapsedAt` never go
  negative and never advance a paused round; the action matrix in all four states;
  `roomSummary` counts; `callRows` ordering and ordinals; the hotkey map.
- **The sealed next slot** — for every state and for `remaining` in
  `{null, 0, 1, 37, 90}`, `nextCallPreview()` returns exactly the keys
  `label`, `remaining`, `sealed` and no `number` field.
- **The engine behind it** — the snapshot carries the console's read-outs and still
  reveals no future draw; pause stops the clock, resume continues it, end freezes
  it, reset clears it; a non-host socket cannot pause; changing the cadence
  mid-round re-times the next call without drawing twice; a cadence change while
  paused applies on resume and a wild value is refused; rapid calls stay distinct.
- **The voice queue** — settings round-trip and clamp; a browser with no engine
  says so and refuses a repeat; a repeat never stutters, clears the backlog, and
  leaves the official dedupe intact; a muted or dead queue refuses a repeat; the
  watchdog scales with the speaking rate (a 0.5× voice is allowed longer than a
  1× one before it is called dead).
- **The real transport** — host-only cadence; ack, broadcast and snapshot agree;
  illegal cadences are refused with the pace preserved; the round clock is the
  server's and pause really stops it; a second start and a call after completion
  are refused while the results stay readable; a player cannot move state; ten
  simultaneous call intents draw ten distinct numbers; a second host tab takes live
  control while the old tab is told `NOT_HOST`.

### 10.2 Gates

| Gate | Result |
|---|---|
| `npm run lint` | clean, `--max-warnings 0` |
| `npm run build --prefix client` | 130 modules; CSS 42.76 kB, JS 376.63 kB |
| `npm run secret-scan` | PASSED — 214 files inspected, no credential value or shape |
| `npm run verify` | exit 0 (test + lint + build + secret scan) |
| `npm run security-probe` | **RESULT: PASS — 51 of 51 checks held** |
| `npm run e2e` | PASS — `COMPLETED` on call 82, 6 awards, John 40 pts |
| `npm run e2e:durable` | PASS — `COMPLETED` on call 76, 6 awards, Ravi 60 pts, throwaway schema dropped |
| `node .preflight/tools/p17-caller.mjs` | pass — `consoleErrors: []` |

### 10.3 Browser pass — what the DOM actually said

Headless Chrome launched by the harness, real clicks, real keys, real Socket.IO
traffic at `Emulation.setDeviceMetricsOverride` viewports. **Browser-viewport
simulation on a desktop OS — not a physical tablet or phone.** Transcribed:

| Step | Measured |
|---|---|
| Desktop 1440×900 | `hasConsole/hero/controls/log/hall/voicePanel` all true; `gridColumns 457.328px 505.469px 409.203px`; `boardTiles 90`; `stateChip RUNNING`; `scrollWidth 1440 <= innerWidth 1440` |
| Three manual calls | `callSheetRows 3`, `boardCalled 3`, hero strip `["86","?","87","3 / 90"]` — the sealed slot shows `?`, not a number |
| Keyboard | four `Tab` presses; two controls with `outlineWidth 2px`, `outlineStyle solid`, `outlineColor rgb(239, 212, 154)`; `C` grew the sheet 3 → 4 |
| Pause | chip `PAUSED`; clock `00:08` read twice, 1.4 s apart, identical |
| Resume | chip `RUNNING`, clock `00:09` |
| Cadence | `AUTO-CALL ON · 8S` → click `5s` → `AUTO-CALL ON · 5S` |
| Voice | toggle `clicked`; settings `{"speech":true,"chime":true,"speechLang":"hi","voiceURI":null,"rate":1.25,"volume":0.6}`; `speechSynthesis` present, 22 voices listed; line `VOICE READY … Repeat number R` |
| Tablet 820×1180 | `gridColumns 385.969px 385.969px`; `scrollWidth 820 <= innerWidth 820` |
| Phone 390×844 | `gridColumns 370px`; bar `display flex`, `barBottom 0`; `scrollWidth 390 <= innerWidth 390` |
| Phone 360×740 | bar pinned; `scrollWidth 360 <= innerWidth 360` |
| Refresh mid-round | route `/host/game`, chip `PAUSED`, call sheet `6 → 6` rows, 2 seats — nothing lost |
| Resume after refresh | `Resume` clicked; chip `RUNNING`, clock `00:20`, rows still 6 |
| End round | first click armed it (`Click again to confirm.`), second click → chip `COMPLETED`, call sheet still 6, `Reset room` offered |
| Page errors | `[]` on the host and on the guest |

Images: `.preflight/p17_01_player_waiting_390.png` … `p17_15_player_results_390.png`
(desktop console before and after calls, keyboard focus, paused, voice panel,
tablet, 390, 360, call sheet at 390, after-reload, player screen, host final
results, completed console, player results). The machine-readable transcript is
`.preflight/p17-caller.json`.

### 10.4 What this pass does not prove

- **Speech was configured, not heard.** Headless Chrome exposes
  `speechSynthesis` and 22 voices, and the harness proves the settings persist, the
  queue state is honest and a repeat is accepted — but no audio device was listened
  to, so audibility on a real laptop or phone is unverified here.
- **Two host tabs were proven over sockets, not in two browser windows.** The
  `NOT_HOST` behaviour is asserted in `tests/caller-realtime.test.js` against the
  real server; the browser pass uses one host tab.
- **Contrast was measured through the design tokens, not by a contrast tool.** The
  console reuses the existing OBSIDIAN HALL palette; no automated ratio audit was
  run in this phase.
- **The widths are emulation.** 820, 390 and 360 px are
  `Emulation.setDeviceMetricsOverride` viewports in a desktop Chrome: no iOS
  Safari, no touch, no on-screen keyboard.



## 11. Phase 18 — the player's tickets and gameplay

Seventh pass. Everything below was printed by a command or read out of a live page
on 31 October 2026; nothing is inferred from source. The server was the durable
build (`/healthz` reporting `mode: durable`, `migrations 004_multi_ticket.sql`,
`pool 2/8`, one live instance) and the client was served from `client/dist` by that
same process.

### 11.1 Gates

| Gate | Command | Result |
|---|---|---|
| Unit + integration | `npm test` | `tests 516 / suites 18 / pass 516 / fail 0 / skipped 0 / todo 0` — 11 599 ms, re-run against the shipped commit at 16 380 ms |
| Lint | `npm run lint` | clean, `--max-warnings 0` |
| Production build | `npm run build --prefix client` | 132 modules, `index.css` 46.53 kB (gzip 9.75), `index.js` 385.05 kB (gzip 116.07), 1.68 s |
| Secret scan | `npm run secret-scan` | 221 files inspected, 2 `.env` values and 7 credential shapes checked, `SECRET SCAN PASSED` |
| Security probe | `npm run security-probe` | `RESULT: PASS — 51 of 51 checks held` |
| Full game, in memory | `npm run e2e` | `PASS`, 77 calls, 6 awards, 6 rejected claims, engine integrity assertion passed |
| Full game, durable | `npm run e2e:durable` | `PASS`, 74 calls, 6 awards, 6 rejected claims, throwaway schema dropped |
| GitHub CI on the pushed commit | `.github/workflows/ci.yml`, run 41201303689 | **FAILED first, then fixed** — `tests 516 / pass 514 / fail 2`, both failures CI-environment ordering (defect 7), not Phase 18 behaviour. Every CI run on this repository since the workflow was written had been red for the same two reasons |
| GitHub CI after the fix | run 41202342043 on `d04f347` | **SUCCESS** — 22/22 steps green: migrations, client build, `tests 516 / pass 516 / fail 0`, lint, secret scan, security probe 51/51, in-memory e2e `COMPLETED` on call 83, durable e2e `COMPLETED` on call 85, `npm run db:backup` (51 035-byte dump), `RESTORE CHECK PASSED`, production env gate, backup artifact uploaded; the `docker` job built and started the image |
| L3 deep security review | before each push | `findings_count: 0` on both Phase 18 commits (`672e153`, `d04f347`) |

The suite grew from 447 to 516 with four files that did not exist before Phase 18:

| File | Tests | What it pins |
|---|---:|---|
| `tests/ticket-integrity.test.js` | 12 | a persisted grid is re-validated on recovery; duplicate ticket numbers, duplicate grids, out-of-range counts and a tampered cell each freeze the room instead of being dealt |
| `tests/ticket-properties.test.js` | 20 | 3×9/15/5-per-row/1–3-per-column/decade/ascending/unique invariants over a 20 000-ticket sweep, plus a 5 000-ticket distribution check |
| `tests/ticket-view.test.js` | 18 | the derived view (called set, row chips, progress, empty cells) never invents a mark the history does not contain |
| `tests/ticket-play.test.js` | 19 | the 1/2/3/max lifecycle, refusal of a change after start, claim attribution, hydrated-round restoration, reconnect after a claim, spectator semantics, cross-room isolation |

### 11.2 The player journey in a browser

`.preflight/tools/p18-player.mjs` drives a real Chromium against the real server:
it creates a room as a host, joins as a player at 390×844, picks one, two and four
tickets, reads every ticket, starts the round from the host, calls numbers, claims,
reloads, drops the network, reconnects, measures five viewports, has the host end
the round and reads the personal result.

**78 of 78 checks held, `consoleErrors: []` on both surfaces.** Selected lines as
they printed:

```
  ok picker states the count against the room maximum          1 of 4 selected
  ok the ticket the seat will play is already previewed        cells 27, ticket 1
  ok keyboard picks two tickets and the server dealt two
  ok count reads 4 of 4 with the maximum stated
  ok tabs are a tablist with aria-controls
  ok each tab advertises its own progress                      "Ticket 3, 7 of 15 numbers called"
  ok a refresh keeps all four tickets
  ok the ticket is a 3x9 ARIA grid                             3 rows, aria-colcount 9, 27 cells
  ok every cell carries a spoken label                          27/27
  ok the board and the ticket agree on the history              board 12 == bar 12
  ok a refused claim says why                                   "Not this time - full house incomplete"
  ok a real win is awarded and names its ticket                 "Ticket 1 · you completed Bottom Line · +10"
  ok the call history survives a refresh
  ok a dropped connection catches up on the calls it missed
  ok chat history is not duplicated by the reconnect
  ok 360/390/430/tablet/desktop: no horizontal overflow
  ok host arms the end of the round / the armed second press ends it
  ok a personal result panel appears at the end
  ok claims are closed once the round is over
  ok no console or runtime errors on either surface
```

Two of those deserve a footnote. The winning claim is not chosen by the harness: it
polls the visible board to find a pattern the engine has actually completed, presses
that button, and waits for the server's verdict — the award in the transcript is the
engine's decision. And the chat check exists because history is fetched on every
reconnect; the feed dedupes by the server's message id, so the probe message is
present exactly once after an offline/online cycle.

**Viewport measurements** (Chromium `Emulation.setDeviceMetricsOverride`; the ticket
cells and boxes are `getBoundingClientRect()` of the live elements):

| Viewport | scrollWidth / innerWidth | Ticket cell | Ticket box | Board box | Ticket tabs | Claim button |
|---|---|---|---|---|---|---|
| 360×780 | 360 / 360 | 30×30 | 336×232 | 302×271 | 117×44 | 88×44 |
| 390×844 | 366 / 390 | 33×33 | 366×242 | 332×298 | 117×44 | 88×44 |
| 430×932 | 430 / 430 | 38×38 | 404×255 | 370×333 | 117×44 | 88×44 |
| 768×1024 | 768 / 768 | 71×71 | 722×359 | 688×619 | 117×44 | 88×44 |
| 1440×900 | 1440 / 1440 | 54×54 | 568×308 | 506×455 | 117×44 | 88×44 |

Images: `.preflight/p18_01_waiting_four_tickets_390.png`,
`p18_02_ticket_tab_three_390.png`, `p18_03_waiting_after_reload_390.png`,
`p18_04_game_started_390.png`, `p18_05_keyboard_tab_390.png`,
`p18_06_refused_claim_390.png`, `p18_07_winning_claim_390.png`,
`p18_08_after_reload_390.png`, `p18_09_after_network_loss_390.png`,
`p18_10_viewport_{360,390,430,tablet,desktop}.png`, `p18_11_completed_390.png`,
`p18_12_completed_desktop.png`. The machine-readable transcript is
`.preflight/p18-player.json`.

### 11.3 Accessibility and call cost

`.preflight/tools/p18-audit.mjs` audits the live DOM and CSSOM (accessible names,
duplicate ids, heading order, alt text, the ARIA wiring, contrast computed from the
resolved background, and the presence of a reduced-motion rule) and then measures
what one official call costs a seat with four tickets against a seat with one, in
the same room, in the same browser, each measured while it was the front tab.

**35 of 35 checks held.**

| Audit | Waiting room | Game screen |
|---|---|---|
| Controls missing an accessible name | 0 | 0 |
| Duplicate ids | 0 | 0 |
| Skipped heading levels | 0 | 0 |
| Images without alt | 0 of 0 | 0 of 0 |
| Reduced-motion rules found in the stylesheet | 1 | 1 |
| Text samples meeting WCAG AA | 18 of 18 | 123 of 123 |
| Text on a gradient (not measurable as one colour) | 35 | 58 |
| Lowest measured ratio | 5.38:1 | 5.38:1 |

The lowest ratio in both screens belongs to `--oh-text-faint`, and it is 5.38:1
*because* the audit failed it first: the token was `#6b717e`, which measured 3.86:1
on the chip that paints it, and was raised to `#828997` before this run.

| Call cost | 4 tickets | 1 ticket |
|---|---|---|
| DOM nodes | 351 | 333 |
| Grid cells in the DOM | 27 | 27 |
| First DOM mutation → painted frame | p50 4 ms / p95 9 ms | p50 6 ms / p95 14 ms |
| Long tasks (>50 ms) while 20 calls landed | 0 | 0 |
| Frame gaps | p50 17 ms / p95 17 ms, max 17 ms | p50 17 ms / p95 17 ms, max 17 ms |

Four tickets add **18 DOM nodes** and no measurable call cost, because only the
selected ticket is mounted; the other three cost one small state update each.

### 11.4 The server path, measured

`.preflight/tools/p18-perf.mjs` runs the real controller against PostgreSQL in a
throwaway schema (created here, dropped here): one host seat plus seats holding 1, 4
and 12 tickets — the hard ceiling, because the room was configured with
`maxTicketsPerPlayer: 12` for the run.

| Measurement | Result |
|---|---|
| Snapshot bytes, 1 / 4 / 12 tickets | 1 343 / 1 727 / 2 752 |
| `number:called` payload | 77 B — the only event per call |
| Bytes per client per call | 76 B, independent of ticket count |
| Durable call wall time, 12 calls | p50 4.65 ms / p95 15.98 ms |
| Rows written per call | 2 (`draw_calls` insert, `audit_events` insert) |
| Ticket rows updated per call | 0 |
| `index scan` on `draw_calls` / `games` / `rooms` | 12 / 24 / 24 over the 12 calls |
| Integrity pass over the room | p50 0.09 ms, max 0.71 ms |
| Snapshot build for the 12-ticket seat | p50 0.00 ms, p95 0.01 ms |
| Persisted ticket rows | 18, equal to the 18 tickets issued |

### 11.5 Defects found by testing, and what closed them

1. **The waiting room promised tickets it could not show.** The server stores a
   ticket *count* until a round starts, so a refresh in the waiting room rendered
   an empty preview (the harness measured `{"tabs":0,"cells":0}`). Fixed by asking
   the server once for the count the seat already holds; the preview is now the
   real grids.
2. **The picker's live region repeated a stale sentence.** After a successful pick
   it kept announcing "Selected 2 of 4 tickets." instead of the recomputed count.
3. **Claim buttons were 32px tall** (`{w:63,h:32}` measured at 360px) and ticket
   tabs 40px. Both are 44px at every width now, and the harness asserts it at all
   five viewports.
4. **The quietest ink failed WCAG AA** at 3.86:1; raised to 5.38:1.
5. **The preview sat below the fold on a phone.** On a 390×844 screen the ticket
   began at y≈690 behind the roster. The preview moved above the roster and the
   hero and picker were tightened; the whole ticket now fits in the first screen.
6. **A test fixture was wrong, not the engine.** The first draft of the hydrated
   round set `draw: [1..90]` while claiming `TOP_LINE` had been called, and the
   engine refused it (`call 1 does not match the stored draw plan`) — the new
   integrity check working as designed.
7. **GitHub CI had been red since the workflow existed** — and every local gate was
   green, which is exactly the gap this defect hides. Run 41201303689 (the Phase 18
   push) printed `tests 516 / pass 514 / fail 2`; run 41188587224 (the Phase 17 push)
   printed `tests 447 / pass 445 / fail 2`, the same two tests both times:
   - `tests/smoke-deploy.test.js` starts a real server and asks `/` for the built
     SPA, but CI ran `npm test` **before** the client build step, and
     `server/index.js` answers 503 "the web client has not been built yet" with no
     `client/dist`. On a developer machine the directory is left over from the last
     build, so the test passes locally and lies about a clean checkout.
   - `tests/hardening.test.js` dumps the `DATABASE_URL` database and asserts the
     manifest records the migration ledger. CI's `postgres:16-alpine` service
     container had never been migrated, so it has no `schema_migrations` table, and
     `scripts/pg-cli.js` reads a missing ledger as `[]`. Again the local database
     *was* migrated, so the assertion only held at the desk.

   Both were reproduced before being fixed: an empty scratch database was created
   locally and `scripts/backup.js` run against it wrote `migrationLedger: []`
   (the assertion fails); `npm run migrate` on that same database then produced a
   ledger of 4 entries over 18 tables (it passes). The fix is ordering, not the
   assertions: `ci.yml` now migrates and builds before `npm test`, and
   `npm run verify` runs `lint → build → test → secret-scan` so the local gate has
   the same honest dependency order. No assertion was relaxed and no test was
   skipped. **Verified on GitHub:** run 41202342043 on `d04f347` finished SUCCESS —
   `tests 516 / pass 516 / fail 0`, both e2e games `COMPLETED`, `RESTORE CHECK
   PASSED`, backup artifact uploaded, docker job green. This was the first CI run
   ever to pass on this repository.

### 11.6 What this pass does not prove

- **No phone was involved.** Every mobile figure is Chromium viewport emulation on
  a desktop OS — no iOS Safari, no on-screen keyboard, no real touch.
- **Four tickets is not the ceiling.** The browser measured 4 (the room default
  maximum); 12 was measured on the server path only.
- **The load numbers are not this phase's.** Phase 16B's durable run (50 rooms ×
  250 players) still stands as the capacity evidence; nothing here adds to it.
- **Audio, screen readers and OS-level zoom were not exercised.** The audit checks
  what the DOM and CSSOM expose; it does not hear a screen reader speak.
- **Chat remains in memory.** A server restart keeps the game and empties the room's
  chat, which is deliberate and documented in `docs/PLAYER-GAMEPLAY.md` §7.

## 12. Five new winning patterns — Star, Box, Early Seven, Second Full House, Half Sheet

Base commit `093e58f`. This slice adds five opt-in categories (off by default) without
touching the six approved rules. Definitions and coordinates: `docs/NEW-WINNING-PATTERNS.md`.

### 12.1 Automated suite — 626 of 626 (19 suites)

`npm test` runs 626 tests, 626 pass, 0 fail, with `DATABASE_URL` present (durable) and
again clean with it absent (the durable file skips and says so). The new coverage:

- **`tests/pattern-geometry.js`/`.test.js`** — every required coordinate of Star, Box and
  Half Sheet on the example ticket, plus near-misses, and that `patternViews`/
  `patternCatalog`/`patternExample` publish the server's cells (the diagram and the
  evaluator read one source).
- **Five in-memory suites** (`pattern-star`, `pattern-box`, `pattern-early-seven`,
  `pattern-second-full-house`, `pattern-half-sheet`) — qualify / one cell short /
  unrelated cells / wrong ticket / multi-ticket / multi-player / simultaneous /
  duplicate / invalid / after-completion / the **6-7-8 Early Seven boundary** / first-vs-
  second Full House exclusion / attribution / the completion call.
- **`tests/pattern-durable.test.js` — 12 tests against real PostgreSQL** on throwaway
  schemas: opt-in persists and diagrams are byte-identical after a rebuild; a
  non-opted-in room stays `UNKNOWN_PATTERN`; award row shape (`player_id, pattern,
  points, call_index, winner_ordinal, ticket_no, ticket_nos`); duplicate and late
  refusals; REJECTED claims + `claim-rejected` audit; **Second Full House ticket
  exclusion surviving a cold restart** (the reason `005_award_ticket.sql` exists);
  Half Sheet naming three tickets; and **two processes sharing one DB paying exactly one
  Star** under `pg_advisory_xact_lock`.

### 12.2 Browser evidence — observed in a live browser

Driven through the real UI at `http://127.0.0.1:4000` (durable mode), host + player in
separate tabs, screenshots in `.preflight/vp_*.png`:

- **Host "Extra prizes" panel — PASS.** All five appear with name, points, explanation
  and diagram. Cells highlighted (`data-pattern="true"`) matched the server exactly:
  Star = 4, 85, 9, 90 + centre 56; Box = 34, 38, 41, 56, 59; Second Full House = all 15;
  Half Sheet = its two example cells + the italic note; Early Seven = an "Any 7" badge,
  no grid. Toggling all five on worked, persisted across a tab restart, and locked once
  the round started.
- **Player "Winning Patterns" panel — PASS.** With the room opted in, the board lists the
  five with the same diagrams and the server's own eligibility text ("star incomplete",
  "fewer than seven ticket numbers called", "the first Full House has not been claimed
  yet", "half sheet needs three tickets, this seat holds 2"). A completed row flipped to
  "You've completed this — claim it" with a gold Claim button; incomplete rows keep the
  button disabled with the reason beside it — no dead controls.
- **Reconnect — PASS.** Reloading mid-round silently resumed the seat, restored both
  tickets with server-true marks and the full panel.
- **Console — no errors** recorded on the host form, waiting room (after all five
  toggles) or player board pages checked.

### 12.3 What this pass does not prove (browser)

- **A live AWARDED attribution screenshot was not captured.** The evaluator reached
  "claim too late" because the room's default `claimWindowCalls: 0` must be beaten by a
  manual claim, and the browser automation drive-one-tab-at-a-time limitation let the
  host connection drop (auto-pause). The awarded state, winner and ticket attribution
  (including Half Sheet's `ticket_nos` and Second Full House's `winner_ordinal`) are
  fully proven by the durable and in-memory suites in §12.1, and the panel renders those
  exact fields, but the end-to-end click-to-award was not photographed in the browser.
- **Mobile 390×844 of the new panel was not screenshotted** for the same reason (the
  session's Chrome tab group was lost mid-run). Mobile behaviour of the shared ticket CSS
  is otherwise established in §9/§11.
- Re-running those two sub-checks needs a fresh browser window (the automation bridge was
  left disconnected); no code is known to be wrong, only not yet photographed.

### 12.4 Defect found by browser testing, and closed

- **Paused host showed live waiting-room controls.** A host resuming into a
  RUNNING/PAUSED/COMPLETED round landed back on `/host/room` with "Start Game" and the
  prize toggles enabled — controls the server refuses outside WAITING. Fixed in
  `client/src/HostRoom.jsx`: any non-WAITING snapshot routes to the caller console. Found
  by the browser pass, not by a simulated test.
## Moderator security milestone (31 October 2026)

### Focused and release-gate results

- `node --env-file-if-exists=.env --test --test-concurrency=1 tests/moderator.test.js`: **PASS**, 2 tests. Covers credential verification, MFA enrollment and encrypted storage, grant and room ownership checks, cross-instance room substitution, CSRF, MFA-required access, moderator socket namespace, non-subscription to gameplay room broadcasts, live socket grant revocation, session revocation, suspension, and append-only audit enforcement.
- `npm test -- --test-concurrency=1`: **FAIL / migration contention**. 615 passed, 2 failed, 12 cancelled of 629 tests. PostgreSQL migration tests timed out (`57014 canceling statement due to statement timeout`).
- Strict serial rerun: each of the 40 `tests/*.test.js` files was launched in its own sequential `node --test --test-concurrency=1` process: **629 passed, 0 failed, 0 cancelled, 0 skipped**. This isolates test-file migrations and completes the serial suite gate.
- `npm run security-probe`: **PASS — 51/51**.
- `npm run e2e`: **PASS** — in-memory gameplay reached `COMPLETED`, 6 awards.
- `npm run e2e:durable`: **PASS** — PostgreSQL throwaway-schema gameplay reached `COMPLETED`, 6 awards.
- `npm run migrate`: **PASS** — no pending migrations; latest is 009.
- `npm run db:backup` + `npm run db:restore-check`: **PASS** — 27 tables, 12,963 rows, migration ledger 9; isolated restore passed inventory, row-count, ledger, and game-history checks. Moderator security tables are present in the archive; no moderator credentials were inserted in the public production-like schema for this check.
- `npm run lint`: **PASS** — zero warnings.
- `npm run build`: **PASS** — Vite production bundle built. npm install reported dependency advisories: 2 moderate in root dependencies and 17 in client dependencies (16 moderate, 1 high); not changed in this security-scoped work.
- `npm run secret-scan`: **PASS** — 248 files inspected, no credential leakage.
- L3/deep security review: **NOT RUN** — no independent security-review tool is available in this workspace. No review findings are claimed.

The full cross-identifier leakage matrix (player/ticket/game/history substitution), full existing endpoint isolation audit, explicit owner moderator-management integration tests, and moderator-data-specific backup/restore fixture remain incomplete. Do not interpret the green serial suite as complete isolation proof.

## Multi-tenant security closure follow-up (31 October 2026)

This follow-up supersedes the moderator gate results above for the current working tree; it does not erase the coverage limitation stated above.

- `npm test`: **PASS**, 629 tests, 19 suites, 629 passed, 0 failed/cancelled/skipped. This ran with the default parallel test runner after changing migration advisory locking to be schema-scoped. The initial parallel run before the socket regression fix had 2 realtime assertion failures (same-room join and payload-error ordering); both were corrected while preserving cross-room rejection, and the final run passed all 629.
- `node --env-file-if-exists=.env --test --test-concurrency=1 tests/moderator.test.js tests/instances.test.js`: **PASS**, 3 tests, 0 failed/skipped. Then the expanded Regular/Bumper/Legacy recovery test passed individually: 1/1.
- `npm run security-probe`: **PASS**, 51/51.
- `npm run e2e`: **PASS**, in-memory full game to `COMPLETED`, six awards.
- `npm run e2e:durable`: **PASS**, throwaway-schema PostgreSQL full game to `COMPLETED`, six awards; the suite removed its throwaway schema.
- `npm run migrate`: **PASS**, latest migration `010_moderator_recovery.sql`, no pending migration.
- `npm run db:backup` + `npm run db:restore-check`: **PASS**, 28 tables and 12,964 rows, ledger 10; restore performed into and removed a throwaway database. The public source database contained no populated moderator rows, so this does not prove real moderator-record round-trip; see `docs/SECURITY-THREAT-MODEL.md` for the safe synthetic restore drill still needed.
- `npm run lint`: **PASS**, zero warnings. `npm run build`: **PASS**, Vite 6.4.5 production bundle.
- `npm run secret-scan`: **PASS**, 249 files inspected; no credential leakage or credential-shaped content in shipped output.
- `npm audit --json`: **PASS**, 0 vulnerabilities. `npm audit --prefix client --json`: **PASS**, 0 vulnerabilities. The original audit findings and changes are recorded in `docs/DEPENDENCY-SECURITY.md`.
- Independent L3 review: **NOT AVAILABLE / NOT RUN**. Manual threat model and surface inventory are in `docs/SECURITY-THREAT-MODEL.md`; external review remains a production blocker.

The implemented integration coverage is representative but not the entire requested Cartesian matrix for every principal and every entity identifier. Current automation proves cross-room and cross-player moderator scoping, reports/history/settings/player-management grants, live grant revocation, reconnect and socket-room isolation, recovery, and existing player/host rules. It does not claim a separate moderator API attack for ticket/game/claim/award/player-session IDs where no such entity-addressing moderator endpoint exists. A populated synthetic moderator backup restore also remains to be demonstrated.

## Final multi-instance verification (1 November 2026)

This section records the latest verification after expanding the moderator fixtures and adding the isolated moderator backup/restore drill. It supersedes earlier gate counts above where they differ.

- `npm test -- --test-concurrency=1`: **PASS**, 629 tests, 19 suites, 629 passed, 0 failed/cancelled/skipped (39.8 seconds).
- `node --env-file-if-exists=.env --test --test-concurrency=1 tests/moderator.test.js tests/instances.test.js`: **PASS**, 3 tests, 0 failed/skipped. Includes Regular/Bumper/Legacy ownership checks, cross-instance room/player substitutions, room summaries and socket-ticket replay/expiry.
- `npm run db:moderator-restore-drill`: **PASS**, isolated synthetic dump and throwaway-database restore verified 2 accounts, 3 grants, 2 sessions, 2 recovery tokens, 1 consumed socket ticket and 3 audit rows; scratch database/schema and archive removed.
- Reference video: full 8:57 playback observed with timestamped samples in [`docs/REFERENCE-VIDEO-ANALYSIS.md`](docs/REFERENCE-VIDEO-ANALYSIS.md). All six supplied `super777tambola.com` routes failed ordinary HTTPS with `ERR_CERT_COMMON_NAME_INVALID`; no TLS warning was bypassed. The video is from a different publisher/domain and is treated as product reference only.
- Product requirements and decisions are captured in [`docs/COMPLETE-PRODUCT-REQUIREMENTS.md`](docs/COMPLETE-PRODUCT-REQUIREMENTS.md); no payment or payout feature is authorized by the reference footage.

Additional gates completed for this milestone:

- `npm run security-probe`: **PASS**, 51/51 checks against listening HTTP and Socket.IO servers.
- `npm run e2e`: **PASS**, in-memory game reached `COMPLETED` with six awards and rejected premature, invented and duplicate claims.
- `npm run e2e:durable`: **PASS**, PostgreSQL throwaway-schema game reached `COMPLETED` with six awards; throwaway schema dropped.
- `npm run migrate`: **PASS**, no pending migration; latest is `010_moderator_recovery.sql`.
- `npm run db:restore-check`: **PASS**, existing archive restored into a throwaway database; 28 tables, 12,964 rows, ledger 10; table inventory, row counts and game-history checks matched; scratch database dropped. The moderator-specific synthetic drill separately verified populated moderator records.
- `npm run lint`: **PASS**, zero warnings. `npm run build`: **PASS**, Vite 6.4.5 production bundle.
- `npm run secret-scan`: **PASS**, 254 files inspected, no credential values or credential-shaped text in shipped output.
- `npm audit --json` and `npm audit --prefix client --json`: **PASS**, zero vulnerabilities in both dependency trees.
- Browser/reference inspection: the third-party reference video was watched through 8:57 and timestamped observations recorded. The six supplied Super777 routes were not inspectable because ordinary HTTPS returned a certificate-name mismatch. A separate local UI regression pass was not run for this milestone.

Independent L3 review, deployment-environment security checks, MFA key escrow verification, and an exhaustive Cartesian identifier fuzz campaign are outside the evidence produced here; several entity IDs have no moderator CRUD/lookups to attack. No commit, push or deployment was performed.

## Master platform implementation slice (1 November 2026)

- `npm test -- --test-concurrency=1`: **PASS**, 632 tests, 19 suites, 632 passed, 0 failed/cancelled/skipped.
- Targeted moderator and public-instance checks: **PASS**. The socket regression confirms a bad same-room session token cannot clear an already-attached room binding and then switch to another room. Tagged public joins enforce the persisted room instance; untagged legacy joins remain compatible.
- `npm run lint`: **PASS**, zero warnings. `npm run build`: **PASS**, Vite 6.4.5.
- Browser check on a disposable PostgreSQL schema: host route restored room code after SPA resume; `/games/regular` disclosed no room code; `/player?instance=regular` joined a matching room and received its authoritative server-issued ticket. The disposable server and schema were stopped and removed; the existing local server on port 4000 was untouched.
- The repeat reference-video playback reached the end of its 8:57 runtime; the player had reset to 0 after the final sampled timestamp (8:54.7). This remains product reference evidence only. The supplied external routes remain blocked by the previously recorded normal HTTPS certificate-name mismatch.
- Full platform completion is still in progress. Poster studio, complete moderator and Super Admin UX, runtime instance identity/locales, responsive/accessibility review, load/recovery testing and actual Hostinger account verification remain open in [`docs/MASTER-BUILD-IMPLEMENTATION-TRACKER.md`](docs/MASTER-BUILD-IMPLEMENTATION-TRACKER.md).

No independent L3 review was available. No purchase, upgrade, DNS edit, secret modification, deployment, commit or push was performed.

## Booking and room-assignment milestone (1 November 2026)

- Focused booking lifecycle: `node --env-file-if-exists=.env --test --test-concurrency=1 tests/bookings.test.js tests/bookings-rate-limit.test.js` — **PASS**, 3/3. Includes capacity contention, expiring holds, private credentials, cancellation, tenant separation, one-time confirmed reservation assignment to a waiting room, ticket-count lock, and cold-process durable recovery.
- Full current worktree: `node --env-file-if-exists=.env --test --test-concurrency=1 "tests/*.test.js"` — **PASS**, 635 tests, 19 suites, 635 passed, 0 failed/cancelled/skipped (70.7 seconds).
- `npm run lint` and `npm run build` — **PASS**, zero lint warnings; Vite 6.4.5 production bundle built.
- `npm run secret-scan` — **PASS**, 282 files inspected; no credential values or credential-shaped text in shipped output.
- `npm audit` and `npm audit --prefix client` — **PASS**, zero vulnerabilities in both dependency trees.
- `git diff --check` — **PASS**.
- Booking UI was not exercised in a browser in this milestone. The previously recorded browser pass covers public instance join and host resume, not reservation creation/lookup/cancellation. Moderator booking UI/permission, retention/cleanup policy, responsive/accessibility review and independent L3 review remain open.

No database migration was run against the existing local application schema; integration tests use isolated schemas. The server on port 4000 was not touched. No purchase, upgrade, DNS edit, secret modification, deployment, commit or push was performed.

## Booking security and end-to-end milestone follow-up (1 November 2026)

- Serial full suite: **PASS**, 636 tests, 19 suites, 636 passed, 0 failed/cancelled/skipped (74.4 seconds). Command: `$files = Get-ChildItem tests -Filter '*.test.js' | ForEach-Object { $_.FullName }; & node --env-file-if-exists=.env --test --test-concurrency=1 @files`.
- Focused booking suite: **PASS**, 3/3, including backup/restore of a session, reservation and audit history in an isolated schema. Focused moderator suite: **PASS**, 2/2, including scoped booking access and explicit-grant enforcement.
- The backup fixture initially exposed a real verifier defect: `collectSnapshot` read `schema_migrations` through the default search path while counting tables from the requested schema. It now pins the requested schema in `search_path`; the backup/restore fixture and full suite pass with this fix.
- `npm run lint --prefix client`, `npm run build --prefix client`, and `npm run secret-scan`: **PASS**. The secret scan inspected 285 files and checked built content.
- `npm audit --json` and `npm audit --json --prefix client`: **PASS**, zero vulnerabilities in both dependency trees.
- `npm run security-probe`: **PASS**, 51/51 real HTTP and Socket.IO boundary checks using ephemeral in-memory servers.
- `npm run e2e` and `npm run e2e:durable`: **PASS**, both real-engine games completed with six awards; the durable runner removed its temporary schema.
- `git -c core.whitespace=cr-at-eol diff --check`: **PASS** for the repository's CRLF files.
- The isolated local server at port 4123 reported ready with migration 013 current and no pending migrations. A fresh local browser tab rendered the public directory, Regular hall, scheduled session list and booking form.
- Browser flow: **PASS for one synthetic create → lookup → release journey**. The hold and private recovery lookup rendered. After authorized release, PostgreSQL showed `status=cancelled` and a `hold.cancel` audit row. The UI retained a stale lookup label (`held`) after release; the handler now updates the lookup result from the cancellation response, but that final display change was not rechecked in browser because the one-time code is no longer available.
- Mobile: booking page visually inspected at **390×844**; `document.documentElement.scrollWidth` was 375px versus `innerWidth` 390px (no horizontal overflow). This is a focused layout check, not a complete responsive/accessibility audit.
- A synthetic booking fixture remains in isolated schema `codex_book_ui_milestone_20261103`, including the cancelled reservation and audit rows, consistent with the owner’s keep-until-policy instruction. The local server on port 4123 was stopped after the browser pass. Existing server port 4000 was untouched.
- Owner retention decision: keep reservation and audit records until the owner provides a policy. No retention deletion job was added. No migration was applied to the existing local application schema, and no deployment, purchase, DNS change, commit or push was performed.

The milestone is not complete: recheck the post-release status display, verify authenticated owner/moderator UI in a browser, complete broader accessibility/responsive review, and obtain independent L3 review.

## Reviewed theme store milestone (1 November 2026)

- Added migration 014 with three original token themes, immutable theme packages, version-level draft/approval state, append-only publication history, global active/previous pointers, schedule configuration, instance selection mode and room-snapshot backfill. The theme version trigger permits only the one-way draft-to-approved metadata transition; package bytes and identifiers cannot be edited.
- Added strict color/token/font/radius/shadow allow-lists and contrast validation; owner-protected draft, version, approval, publish, retire, rollback, schedule, and instance-selection APIs; public reviewed library and active-instance/room delivery; and a timezone-aware, once-per-local-day scheduler gated by the existing database lease.
- Added the public `/themes` preview store and owner `/admin/themes` management UI with real ticket/number-board preview, draft creation, per-version approval, schedule configuration, release history, rollback, and instance selection. Runtime theme delivery maps only validated tokens to existing CSS variables; clearing a preview restores build-time brand accents.
- `tests/themes.test.js`: **PASS**, 3/3 isolated PostgreSQL tests. Covers invalid packages and contrast, per-version review gates, timezone due-time and idempotency, rollback/history, instance selection, room-snapshot stability, package immutability, public delivery, and owner-only management reads.
- Serial full suite including current theme and poster implementation: **PASS**, 641 tests, 19 suites, 641 passed, 0 failed/cancelled/skipped (35.1 seconds).
- `npm run lint --prefix client`, `npm run build --prefix client`, and `npm run secret-scan`: **PASS**.
- Browser loaded `/themes` against a disposable migrated schema at port 4123; public library displayed all three original designs and current-release preview. The app process was stopped and only the disposable schema `codex_theme_ui_milestone_20261101` was dropped. The existing app schema and port 4000 were untouched.
- Owner-authenticated management browser flow and broad responsive/accessibility review remain open. This completes the theme-store implementation slice, not the master platform build. No deployment, purchase, DNS change, commit or push was performed.

## Poster studio implementation slice (1 November 2026)

- Added migration 015 for four original poster compositions (`classic`, `festival`, `spotlight`, `minimal`), immutable and review-gated template versions, append-only template publication history, timezone-based daily library additions, per-instance poster drafts, and append-only published poster snapshots.
- Added owner APIs for template creation, versioning, approval, publishing, daily rotation, poster drafts, edits, duplication and publication. Public APIs expose only published templates/posters; the public poster response omits the internal instance ID. Poster text and colors are bounded and validated; client rendering uses text nodes and fixed vector layouts without arbitrary HTML, CSS or image URLs.
- Added `/admin/posters` with template review, per-instance poster editor, approved game-theme selection, details, mobile/desktop preview frame, draft save, duplicate, publish, and SVG/PNG export. Added `/poster/:posterId` for published shares.
- `tests/posters.test.js`: **PASS**, 2/2 (including isolated PostgreSQL schema). Covers field validation, draft→approval→publish gates, version-level review, daily scheduler due time/idempotency, poster publication, immutable historical content, public API delivery and owner-route protection.
- Browser loaded a published synthetic poster at `/poster/32eba025-c849-4e3e-96c3-a9c6d8e2d974` from disposable schema `codex_poster_ui_20261101` on port 4124. The share page rendered the published title, composition and instance link. The server was stopped and the disposable schema dropped; port 4000 and the booking retention schema were untouched.
- Client lint and production build passed. Route-level code splitting keeps the editor out of the main player bundle (about 486 KB minified main JS); the editor, poster renderer and styles are separate chunks. Latest serial full suite: **PASS**, 641/641, including template-version assertions and implementation (35.1 seconds).
- Not complete: the authenticated owner editor and actual SVG/PNG downloads were not browser-tested; instance logo management, format-specific visual review, broad accessibility/responsive checks and independent L3 review remain. No deployment, purchase, DNS edit, commit or push was performed.

## Runtime instance identity milestone (1 November 2026)

- Added migration 016 and curated local Regular/Bumper brand marks. Instance branding is validated on write and sanitized on public reads; theme runtime, instance directory/hall pages, booking links and poster publication snapshots retain each instance's identity.
- `tests/public-instances.test.js`, `tests/themes.test.js`, and `tests/posters.test.js`: **PASS**, focused PostgreSQL-backed coverage for identity isolation, unsafe stored-value stripping, and immutable poster branding snapshots.
- Full serial suite: **PASS**, 642 tests, 19 suites, 642 passed, 0 failed/cancelled/skipped (102.4 seconds).
- Browser verified the public directory and Regular/Bumper hall identities on disposable schema `codex_instance_brand_ui_20261101`, port 4125; app process stopped and schema dropped. Earlier disposable checks covered theme store and poster share. Port 4000 and the retained booking schema were not touched.
- `npm run secret-scan`: **PASS**, 312 files inspected; no credential values or credential-shaped text in shipped content or built bundle. `git -c core.whitespace=cr-at-eol diff --check`: **PASS** after removing the extra trailing blank line in the instance editor styles.
- Client lint and production build pass on current branding work. Owner-authenticated instance editor browser flow, broad accessibility/responsive review and independent L3 review remain open.

No migration was applied to the existing application schema. The authorized synthetic reservation and its audit history remain in isolated schema `codex_book_ui_milestone_20261103` per the keep-until-policy instruction; the authorized release is recorded as a cancellation. Port 4000 was untouched. No deployment, purchase, DNS edit, commit or push was performed.

## Instance reporting slice (1 November 2026)

- Added owner-protected `GET /api/admin/reports/instances` with strict UTC date validation, inclusive ranges capped at 366 days, optional instance filtering, and persisted aggregate totals for rooms, rounds, participants, tickets, claims, awards and reservation states. Daily aggregates retain instance identifiers and expose no player names or booking credentials.
- Added migration 017 with date-window indexes for the report joins, an Admin/Super Admin Reports view, CSV export with spreadsheet-formula neutralization, and direct report links from each instance row.
- Isolated PostgreSQL verification proves report totals match seeded Legacy records and the Regular report contains no Legacy room activity. The endpoint returns `DURABLE_REQUIRED` in memory mode, and unauthenticated reads remain behind the owner gate.
- Focused admin suite: **PASS**, 34/34. Full serial suite: **PASS**, 643 tests across 19 suites, 0 failures (102.8 seconds). Client lint and production build: **PASS**.
- Remaining: browser review of report filters/export at narrow and wide sizes; reporting does not yet include moderator-count/health/backup-operation summaries. No report is written to or used to mutate game state.

## Reporting migration verification refresh (1 November 2026)

- After adding migration 017's reporting indexes and an index-existence assertion, the complete serial suite passed **644/644** tests across 19 suites (103.8 seconds). The latest focused admin suite passed **35/35**, including the current migration chain, index presence, tenant separation, and date-window report totals.
- Client lint/build, secret scan and CRLF-aware `git diff --check` pass for the reporting implementation. Reports have not yet had a browser visual/export review.

## Super Admin moderator management UI slice (1 November 2026)

- Added `/admin/moderators` and `/super-admin/moderators`, backed by the existing owner-protected moderator APIs. The screen provisions invitations, optionally selects an explicit initial grant, edits per-instance permission sets, revokes grants, suspends/reactivates accounts, revokes sessions, issues recovery, and shows grant history and recent activity.
- Permission choices are rendered individually and remain unchecked by default. One-time invite/recovery tokens stay in component memory, are never placed in browser storage, and can be copied or dismissed. The UI does not send invitations or recovery tokens to anyone.
- Added route-level code splitting so the 12.8 KB moderator screen does not push the main player bundle beyond 500 KB. `npm run lint --prefix client` and `npm run build --prefix client`: **PASS**. Secret scan: **PASS**, 316 files inspected. CRLF-aware diff check: **PASS**.
- An authenticated browser pass was not performed. Windows computer-use instructions prohibit automating authentication dialogs; the report and moderator pages remain on the authenticated-browser review list. The moderator invite-acceptance/sign-in/MFA UI and permission-adaptive room dashboard remain future implementation slices; this screen completes only owner-side access administration.

- Added `tests/admin-moderator-management.test.js`: real owner-authenticated HTTP coverage in a throwaway PostgreSQL schema verifies that unauthenticated reads fail, provisioning without a grant produces no instance access, one-time invite tokens are stored only as hashes, explicit grants can be changed/revoked, bad permissions are refused, sessions revoke immediately, suspension/reactivation and recovery work, and actions appear in audit history. Focused API test passes 1/1; focused moderator security suite passes 2/2.

### Full-suite refresh after moderator management UI/API coverage

- Full serial suite on the current worktree: **PASS**, 645 tests across 20 suites, 0 failed/cancelled/skipped (104.8 seconds). This includes the new real owner-authenticated moderator administration API fixture and all existing migration, booking, game, security and theme/poster suites.
- Final client lint/build, secret scan (317 files) and CRLF-aware diff check pass. Main player bundle remains below 500 KB; moderator access is a separate 12.8 KB lazy chunk.

## Booking milestone verification refresh (1 November 2026)

- Fresh complete serial suite: **PASS**, 648 tests, 20 suites, 648 passed, 0 failed/cancelled/skipped (103.6 seconds). This includes PostgreSQL capacity contention and idempotency, expiry/cancellation, tenant isolation, one-time waiting-room assignment, ticket-count lock, booking backup/restore, and explicit moderator grant enforcement.
- Booking status browser recheck: **PASS for UI rendering only**. At 390×844, a local Vite build used mocked `/api/public/*` responses to reproduce hold creation → lookup → release. The lookup panel changed from “Reservation held” to “Reservation cancelled”; the processed-request notice also showed “cancelled”. `scrollWidth` equaled `innerWidth` at 390 px. Screenshot: `.preflight/booking-release-status-390.png`. This browser check wrote no database records.
- Prior real local browser journey: **PASS for one synthetic create → lookup → release** against isolated schema `codex_book_ui_milestone_20261103`; the reservation and `hold.cancel` audit record remain retained per owner instruction. That run verified database status was `cancelled`. The current display fix was checked separately with mocked API responses because the one-time booking code is no longer available; no second reservation was created.
- `npm run security-probe`: **PASS**, 51/51 checks. `npm run e2e` and `npm run e2e:durable`: **PASS**, both games reached `COMPLETED`; durable run dropped its throwaway schema. Client lint and production build: **PASS**. Secret scan: **PASS**, 325 files. Root and client `npm audit`: **PASS**, zero vulnerabilities in both trees.
- Migration and backup/restore behavior is covered by the full isolated PostgreSQL suite; no migration or restore was run against the existing application schema. Port 4000 and the retained booking schema were untouched in this refresh.
- **Still incomplete/unverified:** authenticated owner and moderator booking screens were not browser-automated because the computer-use policy prohibits automating authentication dialogs. The full authenticated host → assignment → player ticket allocation journey, duplicate assignment browser rejection and broader responsive/accessibility checks still need a permitted review. Automated API and integration tests cover assignment and server-side count locking. Retention remains “keep records until the owner provides a policy”; no deletion job exists.

No purchase, deployment, DNS edit, production secret change, commit or push was performed.

## Public instance join isolation browser check (1 November 2026)

- Started the built application on an ephemeral local port against generated schema `codex_public_join_ui_43f83887`; no existing application schema was migrated. The browser host created a Regular room through the real socket API.
- **Cross-instance denial: PASS.** A fresh player browser opened `/player?instance=bumper&room=<Regular room>`. It displayed the generic “no game with that room code” response, stayed on the join form, and a direct query of the isolated schema showed the room still had only its host member. This confirms the rejection did not create an unauthorized player seat.
- **Matching instance join: PASS.** A fresh browser opened the same room through `instance=regular`; it reached `/player/room`, and the database member count increased from one to two.
- Directory, Regular hall and Bumper denial pages were checked at 360, 390, 768, 1024 and 1440 px; all measured `scrollWidth` values equaled `innerWidth`. The Regular hall did not contain the host room code. At 390×844, the denial screenshot `.preflight/public-join-denied-bumper-390.png` exposed overlapping connection/helper text; the player entry footer was restyled into a stacked narrow-screen layout and the screenshot was recaptured with the text separated and readable.
- The test harness closed the browser and application, dropped only its generated schema, and verified that schema was absent afterward. Port 4000, schema `codex_book_ui_milestone_20261103`, and its retained reservation/audit rows were not touched. No purchase, deployment, DNS edit, commit or push was performed.
- Client lint and production build pass after the footer fix. The latest full serial run remains 648/648 across 20 suites; this CSS-only adjustment does not change server behavior.

## Booking language and local-time verification (1 November 2026)

- Added focused checks for English/Hindi selection fallback, localized reservation statuses, Devanagari quantity formatting, explicit device-local time-zone labels, and invalid-date fallback: **3/3 passed**.
- Current full serial test suite: **651/651 passed** across 20 suites. Client lint and production build pass. Production build still reports the existing main-chunk advisory (>500 KB); no chunk-splitting changes were made in this milestone.
- Browser interaction coverage is recorded for the player join screen below; the booking page language switch still lacks a browser interaction check. Booking labels/errors not covered by the English/Hindi dictionary and the rest of the gameplay interface remain English; broader responsive/accessibility review stays open.

## Player experience localization browser check (1 November 2026)

- Built client preview browser check at 390×844: **PASS**. English/Hindi selector switched the room-entry page to Hindi, the `main` language became `hi`, short-name validation appeared in Hindi, and the choice persisted after reload. A synthetic browser-only seat opened the idle game route with mocked theme/socket traffic; localized current-call/progress, ticket picker, roster, board and call history appeared, including Devanagari board digits. `scrollWidth` equaled `innerWidth`. Screenshot: `.preflight/player-game-language-hindi-390.png`.
- That earlier browser check used no real room and verified the idle layout only. Active-round claims, chat, awards and results are now covered by the socket-backed journey below; additional locales, viewports and accessibility modes remain open.
- The booking locale unit suite remains 3/3; current full suite on the updated worktree passes 651/651 across 20 suites. Client lint/build and secret scan pass; the main bundle is now 526.64 KB and triggers Vite's chunk advisory.
- Browser review of the idle synthetic game showed localized headings, status, board digits, roster, claim/results labels, and chat controls. The active-round socket-backed coverage is recorded below.

## Active-round Hindi browser verification (1 November 2026)

- Added a real socket-backed browser journey using an ephemeral local HTTP port and `memoryOnly` server. A host creates a room through the UI; a Hindi player joins through the UI, receives a server-issued ticket, switches to Hindi, sends live chat, and claims a server-evaluated eligible prize. Hindi preset chat category/message, the game main landmark, localized keyboard skip link/focus movement, visible-control names and image alt attributes are checked as well. The browser confirms the authoritative award, localized claim acknowledgement and celebration, translated completion reason/results, and no horizontal overflow at 360, 390, 430, 768, 1024 or 1440 px.
- **PASS:** active-round Hindi journey, live Hindi chat delivery and quick replies, focused structural/keyboard accessibility checks, localized claim toast/celebration/completion reason, authoritative award, completed results, six-width overflow matrix. This is not a full WCAG audit. The run generated no database writes and did not use port 4000 or the retained reservation schema. Screenshot: `.preflight/player-live-round-hindi-390.png`.
- Known game refusal codes and claim reasons are translated in Hindi across player join, ticket selection, claim, host action, chat and Socket.IO error notices. Unknown server messages preserve their original detail. Focused unit coverage includes rate limits, ticket caps, incomplete/late claims, and unknown codes; the active browser pass receives a Hindi `app:error` event and verifies the rendered message.
- Client lint and production build pass; focused locale and celebration suites pass; secret scan passes (328 inspected files). The client bundle is 535.64 KB before gzip and continues to emit Vite's >500 KB advisory.
- Full serial suite after the player game locale, refusal and landmark updates: **PASS**, 652 tests across 20 suites, 0 failed/cancelled/skipped (35.3 seconds). Client lint/build and secret scan pass; the browser journey passes its six-width and structural/keyboard checks.

## Host caller console localization browser verification (1 November 2026)

- Extended the English/Hindi selector to the host caller console: call controls and confirmation steps, round state, call history, room summary, voice controls/statuses, keyboard hints, counts and interval values now follow the selected locale. The host uses the persisted English/Hindi preference.
- Added a real socket-backed browser journey on an ephemeral local port in memory-only mode. The host creates a room through the UI, a Hindi player joins, and the host switches to Hindi while the real game is active. The browser verifies localized caller controls, number log and hall summary, a single `main` landmark, a first-stop skip link that focuses main on Enter, and accessible names for every visible control.
- At 360, 390, 430, 768, 1024 and 1440 px, the caller console has no horizontal overflow. Updated screenshot: `.preflight/host-console-hindi-390.png`. The matching active-round player flow remains verified at those widths in `.preflight/player-live-round-hindi-390.png`.
- The full in-memory suite ran with `DATABASE_URL` unset: **589 passed, 0 failed, 42 skipped**. Skips require PostgreSQL; a configured PostgreSQL attempt was unavailable at `127.0.0.1:55432` (`ECONNREFUSED`). This result is not represented as a fresh database-backed full-suite pass.
- Host UI journey, lint/build and secret-scan refresh results are recorded for this worktree below. No database was started, no persistent booking data was touched, and port 4000 remains untouched.
- Final refresh: `npm run lint`, `npm run build --prefix client`, `npm run secret-scan` (328 files), and `git -c core.whitespace=cr-at-eol diff --check`: **PASS**. Build output retains the >500 KB Vite advisory (main JS 554.77 KB minified, 162.14 KB gzip).

## Booking suite and durable verification refresh (1 November 2026)

- Started a new disposable PostgreSQL 16 container on `127.0.0.1:55433` for verification; the pre-existing stopped `tambola-pg` container, port 4000, and retained schema `codex_book_ui_milestone_20261103` were not touched. Applied migrations 001–017 only to the new test database. The complete serial suite passed **653/653**, 0 failed, 0 skipped, across 20 suites. This included the durable booking/assignment/capacity tests and real isolated booking backup/restore coverage.
- The first attempt exposed local configuration that pointed backup helpers at a stopped container; setting the tool driver to the new disposable container resolved that setup issue. The isolated restore test then required the public migration chain and passed after applying it to the disposable database.
- `npm run e2e` and `npm run e2e:durable`: **PASS**, both completed the authoritative game; the durable run removed its throwaway schema. `npm run security-probe`: **PASS**, 51/51. Client lint and production build pass; root and client `npm audit` report 0 vulnerabilities each; secret scan passes (328 files); CRLF-aware diff check passes.
- Build retains Vite's >500 KB chunk advisory: main JS 554.77 KB minified (162.14 KB gzip). The only local reservation remains the previously authorized, released record and audit history in `codex_book_ui_milestone_20261103`; no additional booking was created during this verification.
- Browser evidence still does not cover authenticated owner/moderator assignment, player credential claim/allocation, duplicate assignment, or refresh/reconnect through the full booking lifecycle. The owner retention policy remains “keep records until I provide a policy.”

## Responsive owner control-centre navigation (1 November 2026)

- Added a compact owner menu below 900 px with an 11-destination two-column navigation, `aria-expanded` / `aria-controls`, Escape dismissal with focus return, and close-on-navigation. The wide-screen sidebar remains persistent.
- Browser test against the built client used mocked session/read responses. **PASS:** all 11 links were available; Escape returned focus to the toggle; selecting Instances closed the menu; no overflow at 360, 390, 430, 768, 900, 901, 1024 or 1440 px; no browser runtime errors. Screenshot: `.preflight/admin-nav-mobile-390.png`. This is UI verification only; real owner authentication/authorization remains unverified in a browser.
- `npm run lint` and production build pass after the change. The main bundle is 555.17 KB minified (162.29 KB gzip) and retains Vite's >500 KB advisory.

## Moderator permission-adaptive UI browser check (1 November 2026)

- The built `/moderator/bookings` workspace was opened with mocked moderator session and instance responses; the single synthetic reservation existed only in the browser's intercepted response. No reservation or audit record was written.
- **PASS:** zero permissions produces no operations tabs; MFA unenrolled produces the setup gate; `bookings.read` exposes only Bookings and no Cancel action; `bookings.manage` exposes Cancel for an unassigned confirmed fixture. No overflow at 390 or 1440 px; zero runtime errors. Screenshot: `.preflight/moderator-bookings-only-390.png`.
- The mock validates UI filtering only. Full serial PostgreSQL tests cover actual authorization, immediate grants/revocation, MFA requirements, audit and tenant isolation. Authenticated browser verification remains open.

## Mobile moderator booking rows (1 November 2026)

- The 390 px browser check exposed that the six-column booking table clipped useful fields behind an internal horizontal scroller. Reworked narrow-screen reservations into labelled cards while keeping the semantic table on desktop. The refreshed screenshot shows Player, Session, Tickets, Status, Allocation and Actions together.
- **PASS:** all six labels render, allocation is visible, card layout has no horizontal overflow at 390 px; desktop table has no page overflow at 1440 px. Combined mocked permission UI still shows no Cancel for a reader and the eligible Cancel control for a manager. Browser runtime errors: 0. Screenshot: `.preflight/moderator-bookings-only-390.png`.
- Client lint and production build pass. Main JS remains 555.17 KB minified (162.29 KB gzip); the lazy moderator workspace CSS is 5.10 KB (1.36 KB gzip).

## Booking milestone verification rerun (1 November 2026)

- Repeated the full serial run against a fresh disposable PostgreSQL 16 container on `127.0.0.1:55434`; applied migrations 001–017 only to its test database. All **653/653 tests passed** across 20 suites, with 0 failures and 0 skips. The backup/restore test initially found the public migration ledger absent; initializing that disposable database resolved the setup issue, and the rerun passed, including real booking backup/restore and room-assignment tests.
- Memory-only serial suite: **589 passed, 0 failed, 42 PostgreSQL-dependent skipped**. `npm run security-probe`: **51/51 passed**. Client lint, production build, root/client production dependency audits, and secret scan passed. The current build's main JavaScript chunk is 554.60 KB minified (162.12 KB gzip), retaining Vite's existing >500 KB advisory.
- The disposable database container was stopped and removed after verification. Port 4000, the old stopped project container, and retained schema `codex_book_ui_milestone_20261103` were not touched. No additional reservation was created. `git -c core.whitespace=cr-at-eol diff --check` passes.
- The complete authenticated booking browser journey remains open: owner/moderator assignment, player allocation claim, duplicate assignment UI refusal, and booking refresh/reconnect have not been browser-verified. The existing authorized local hold is released and retained, so it cannot demonstrate assignment. No second booking was submitted.

## Public booking discovery browser check (1 November 2026)

- A real Chromium run used the built client and mocked read-only API responses to browse `/games` → Regular Tambola → scheduled sessions → booking form. It verified 11/24 availability, the four-ticket room limit, no room code on the public session card, and the display-name/ticket-choice form. No booking API mutation was submitted; this does not verify server behavior or reservation submission.
- At 390 px and 1440 px, all pages had no horizontal overflow; browser runtime/console errors: 0. Screenshots: `.preflight/booking-sessions-390.png` and `.preflight/booking-form-390.png`.
- This extends public entry and form presentation coverage only. The authenticated assignment and player allocation journey remains open pending a separately authorized new reservation.

## Owner booking management mobile browser check (1 November 2026)

- The first owner-screen browser capture exposed internal clipping in both the scheduled-session and reservation tables at 390 px: allocation and later action columns were hidden even though the page itself did not overflow. Converted those two tables to visibly labelled mobile cards while keeping the semantic tables at desktop widths.
- The rebuilt client passed a real Chromium review with mocked owner/session/reservation read APIs. At 390 px, all six fields in each card (including allocation and actions) are visible with no inner horizontal scroller; at 1440 px the table view has no page overflow. Reservation detail and the eligible Cancel control render. The harness observed no API writes and no browser errors; Cancel was not clicked.
- Client lint and production build pass. Main JS is 556.16 KB minified (162.32 KB gzip), retaining the existing Vite advisory. Screenshots: `.preflight/admin-bookings-390.png` and `.preflight/admin-bookings-detail-1440.png`.
- This uses mocked owner/read data and verifies presentation only. It does not verify owner authorization or real reservation mutation. Full assignment/allocation browser coverage remains open.

### Mocked cancellation interaction

- Extended the same Chromium harness with a browser-only reservation fixture using a separate synthetic UUID. The owner clicked Cancel, confirmed the browser dialog, and the intercepted API returned a cancelled reservation. **PASS:** the prompt names the two-ticket reservation, exactly one cancellation request is sent to the mock, the row and activity refresh to cancelled, the Cancel action disappears, and focus moves to the status announcement after the control is removed.
- The mobile cancelled state had no overflow at 390 px and its screenshot shows the announcement unobstructed. Persisted writes: **0**; browser errors: **0**. Screenshot: `.preflight/admin-bookings-cancelled-390.png`. This validates UI state handling only; backend authorization and durable cancellation remain supported by integration tests, not this mock.

## Public reservation hold and confirmation UI (1 November 2026)

- A real Chromium run opened the built booking page, selected three of four allowed tickets, submitted the display name, received a mocked hold, and confirmed it. The confirmation showed the reference, one-time booking code, reserved ticket count and the instance-bound join link. The booking code/reference were absent from local and session storage.
- The hold and confirm POSTs were intercepted browser fixtures only: 2 mock requests, **0 persisted writes**. At 390 and 1440 px there was no horizontal overflow or browser error. A duplicate free-play disclaimer found in the confirmation screenshot was consolidated into the single complete notice in the footer.
- Client lint/build pass; main JavaScript is 556.19 KB minified (162.36 KB gzip), retaining the >500 KB Vite advisory. Screenshots: `.preflight/public-booking-hold-390.png`, `.preflight/public-booking-confirmed-1440.png`. This verifies public UI state handling, not API/server behavior or the actual assignment journey.

## Confirmed booking to player join handoff review (1 November 2026)

- Reviewed the confirmation link and join form through the server join controller. The link contains only the instance slug and assigned room code. Players enter the reservation reference and private code in the join form; both remain in component memory and are sent in the one-time Socket.IO join request, with no URL or browser-storage persistence.
- The durable controller checks that the booking belongs to the room and is confirmed, supplies the reserved display name from the server record, assigns the reserved ticket count, and locks that count. The booking integration test also covers missing credentials, replay and cross-instance rejection, reconnect, and ticket-count tampering. These assertions passed in the prior full isolated PostgreSQL run (653/653).
- A focused rerun on 1 November could not connect because the disposable PostgreSQL service had already been stopped (`127.0.0.1:55432`, `ECONNREFUSED`). No reservation was created or changed during this review. This source and prior-test evidence does not replace a real browser booking-to-join run; the retained authorized reservation is released and cannot demonstrate allocation.

## Poster studio save, publish, and export browser check (1 November 2026)

- Rebuilt the client and opened the owner poster studio in Chromium with a mocked authenticated owner session and intercepted APIs. Saved a draft, exported SVG and PNG, and published the poster. **PASS:** SVG contains the current title, PNG signature and portrait dimensions are 1080×1350, the public link appears, and published content cannot be edited in place. All three mutation requests were intercepted; persistent writes: **0**.
- Testing a long title exposed text extending beyond the poster bounds. The shared SVG renderer now wraps the complete title to up to four lines and sizes each line to its available width; the browser asserts the measured bounds stay inside the canvas. No overflow at 390/1440 px and no runtime errors. Screenshot: `.preflight/admin-poster-studio-1440.png`.
- Client lint/build and secret scan pass; main JS is 556.19 KB minified (162.36 KB gzip) and retains Vite's >500 KB advisory. This mocked-session/API check verifies UI and export behavior, not owner authorization, durable poster persistence, public-link delivery, or authenticated template review.

### Authenticated durable poster pass

- Follow-up Chromium run used the real owner sign-in, actual poster APIs, and an ephemeral PostgreSQL 16 container with a generated schema. The owner created and updated a draft, downloaded SVG and 1080×1350 PNG files, published it, and opened the public share route. Durable rows and append-only audit actions were verified (`poster.draft.create`, `poster.draft.update`, `poster.publish`); the public page captured the Regular instance branding and kept the long title within the SVG bounds at 360, 390, 768, 1024 and 1440 px.
- This exposed two production-browser defects: immediate Blob URL revocation prevented reliable downloads, and the server's `img-src` CSP blocked Blob-backed SVG rasterization for PNG. Downloads now keep the source URL alive for the browser handoff, and CSP permits Blob images only under `img-src` while `script-src` stays same-origin. The full authenticated pass then succeeded with zero browser errors.
- The ephemeral database used tmpfs, the generated schema was dropped and verified absent, and its container was stopped and removed. No retained booking schema, project database, port 4000, deployment, or production credential was used. Screenshot: `.preflight/admin-poster-published-public-1440.png`.

## Booking room assignment, player allocation, and refusal browser pass (1 November 2026)

- With the owner's approval, created one real synthetic free-play reservation in the new retained schema `codex_booking_claim_20261101`. Chromium created a Regular waiting room, the authenticated owner attached it to a scheduled session and opened the session, then the player placed a three-ticket reservation, confirmed it, and joined through the assigned instance/room link. PostgreSQL confirms one reservation-bound member, the expected player identity, and a locked `ticket_count=3`; audit history is `hold.create`, `hold.confirm`, `hold.assign`.
- The end-to-end harness then hit an assertion mismatch because its synthetic name was 21 characters while the input correctly caps names at 20. This did not interrupt the application flow: the reservation had already joined and was durably assigned. The private code remained memory-only and was not logged or persisted. A subsequent no-write browser refusal check used a deliberately invalid credential and confirmed no second room member or audit event was added. The complete valid-code replay is covered by the booking integration test from the earlier 653/653 PostgreSQL run; this browser refusal check does not itself replay the correct private code.
- Restarted the dedicated PostgreSQL container and re-read the reservation and audit events successfully. The stopped container `codex-booking-browser-20261101` and named Docker volume `codex-booking-browser-20261101-data` retain the schema and records per the owner's instruction. Reservation reference: `a830ed97-2f1b-457d-ba20-f4dbf3837e53`. No second reservation was created; the existing retained booking schema, port 4000, and production services were untouched. Screenshots: `.preflight/booking-replay-refused-390.png`.

## Owner instance creation and branding browser verification (1 November 2026)

- Rebuilt the client and used real Chromium with owner authentication against PostgreSQL 16 in an isolated generated schema. The owner created a synthetic instance, then changed its display name, curated local logo and browser icon, tagline, primary color, and public-directory visibility.
- **PASS:** persisted instance identity/branding/visibility matched the submitted values; reload restored the saved tagline and icon; append-only owner audit recorded `INSTANCE_CREATE` and `INSTANCE_UPDATE`. At 390 px the page had no horizontal overflow, and browser runtime/console errors were 0.
- The generated schema was dropped after verification. The retained booking schema `codex_booking_claim_20261101` remained present and was not modified. Container and volume retention continue per the reservation retention instruction.
- This closes authenticated browser coverage for instance identity/branding; instance control-center, reports/export, theme editor, moderator credential and permission-combination workflows remain open.


## Authenticated owner theme release browser verification (1 November 2026)

- Rebuilt client and exercised the real owner login and theme editor in Chromium against a fresh isolated PostgreSQL schema. Created a theme draft from the reviewed package, approved it, published it, and selected the published immutable version as the Regular instance's fixed theme.
- **PASS:** durable catalog/version status, active publication, fixed instance selection, and ordered audit actions (`theme.draft.create`, `theme.approve`, `theme.publish.manual`) matched the UI flow. At 390 px there was no horizontal overflow and there were no browser runtime/console errors. Screenshot: `.preflight/theme-editor-auth-390.png`.
- The generated schema was dropped. The retained booking schema was not modified. Authenticated instance detail, report/export, moderator credential, and permission-combination workflows remain open.

## Authenticated instance detail, reports, and responsive table verification (1 November 2026)

- A real owner-authenticated Chromium run used a fresh disposable PostgreSQL schema, created a synthetic tenant, and persisted one waiting room through the game controller. The instance detail page displayed the correct tenant, connected database health, one room/open room, its room row, host membership, and scoped `INSTANCE_CREATE` audit entry.
- The owner report was filtered to that tenant and the current UTC date. Summary and daily activity both showed one room created and one open room. The browser downloaded a UTF-8 BOM CSV with the expected aggregates; inspection confirmed the export contains aggregate columns only and no room/player names or booking credentials.
- Visual review caught clipped table columns on narrow screens despite no page-level overflow. Instance detail and report tables now render labelled cards through 1080 px and retain table layout on wider screens. The authenticated journey passed at 360, 390, 640, 641, 768, 900, 901, 1024, 1080, 1081 and 1440 px; card fields remained visible at card widths, page overflow was zero, and browser errors were zero. Screenshots: `.preflight/owner-instance-detail-390.png`, `.preflight/owner-instance-report-390.png`.
- Client lint and production build pass. The main JS bundle remains above Vite's 500 KB advisory (556.93 KB minified, 162.43 KB gzip). The generated schema was dropped; the retained booking schema and record were checked and left intact.

## Authenticated moderator invitation, MFA, and read-only RBAC browser pass (1 November 2026)

- Real owner and moderator browser sessions ran against a fresh disposable PostgreSQL schema with a test-only MFA encryption key. The owner issued a one-time invitation without an initial grant; the synthetic moderator accepted it using a URL-fragment token. The browser removed the fragment before submitting, and the acceptance request URL did not contain the token. The active account and consumed invitation were verified durably.
- The moderator signed in, enrolled TOTP, and received no instance operations before a grant. After the owner issued exactly `room.read`, the moderator saw only the Rooms tab and one waiting room. Start, end, room creation, and player identity remained unavailable; the room detail response withheld members because `players.read` was absent. Durable grants and owner/moderator audit entries matched the flow.
- Screenshot review caught clipped room actions in the mobile workspace. Room, player, history, and report tables now render labelled cards through 900 px. The authenticated run passed at 360, 390, 640, 768, 900, 1024 and 1440 px with no page overflow or browser errors. Screenshot: `.preflight/moderator-room-reader-390.png`.
- Browser verification exposed an invalid HTML username pattern under Chromium's `v`-flag parsing. The client pattern now expresses hyphen as a separate alternative; lint, build and the full browser flow pass. One-time invitation token and MFA secret remained in process memory only. No reservation was created; the generated schema was dropped and the retained booking schema remained intact.

## Moderator suspension, reactivation, and recovery browser verification (1 November 2026)

- Chromium completed a real owner and moderator lifecycle against isolated PostgreSQL: invite acceptance, password sign-in, TOTP enrollment, owner suspension, reactivation, recovery issue, and recovery completion. Suspension revoked the active session; reactivation did not revive that old session.
- Recovery-link fragment removal and request-URL safety were verified. The one-time recovery token was consumed, password changed, account restored to active, and old encrypted/confirmed MFA state cleared. The moderator had to reenroll TOTP before the workspace returned; recovery restored no instance grants.
- Durable state and audit history matched suspension, reactivation, recovery issue/completion and MFA reenrollment. Browser errors: 0. Invitation/recovery tokens, passwords and MFA values remained in process memory; the generated schema was dropped. The retained booking reservation was not modified.

## Moderator permission matrix and restricted-detail UI (1 November 2026)

- The moderator workspace now renders read-only issued ticket allocations when `tickets.manage` is granted. Player names remain hidden unless `players.read` is also granted; ticket grids remain server-generated and immutable. The owner grant label now describes viewing allocations. Moderators with `room.read` + `players.manage` can remove a known player ID without receiving the player roster.
- A Chromium matrix passed all 15 individual permission-to-tab mappings and targeted combinations for booking read/manage, room read + player management, ticket visibility with/without player identity, and the all-grants workspace at 390 px. No horizontal overflow or browser errors. This matrix uses mocked APIs and verifies UI visibility only; endpoint authorization is covered separately by authenticated integration/recovery checks.
- Client lint and production build pass. The Vite main bundle advisory remains at approximately 557 KB minified.

## Approved booking assignment, player allocation, and replay refusal browser verification (1 November 2026)

- With the owner's approval, ran the durable Chromium flow in new isolated schema `codex_booking_ui_alloc_20261101`; the earlier retained booking schema `codex_booking_claim_20261101` was not modified. The owner signed in, created a Regular waiting room, attached it to a scheduled session, and opened bookings. A synthetic player reserved and confirmed three tickets, then joined with the private booking credentials.
- **PASS:** the player's 390×844 screen showed the confirmed reservation locking the selection at 3/4 and rendered three server-generated ticket grids. Durable state linked exactly one reservation-bound seat to the expected player and room with `ticket_count=3`. Audit recorded `session.create`, `session.open`, `hold.create`, `hold.confirm`, and `hold.assign`.
- Replaying the same reservation credentials in a second browser was refused. The room retained the same two members (host plus booked player), the reservation linkage remained unchanged, and no duplicate booking audit event was added. Browser runtime/console errors: 0. Screenshot: `.preflight/booking-allocation-player-390.png`.
- Both the earlier and new schema each retain one reservation; the new schema retains all five booking audit rows under the owner's keep-until-policy instruction. The dedicated Postgres container was stopped after the read-only integrity check. Ports 4000 and 55435 were clear. This closes the real-browser owner/session assignment, player allocation, ticket-count lock, ticket display, and duplicate replay checks. It does not claim browser coverage of moderator booking operations, refresh/reconnect after allocation, or every expired/cancelled/unavailable state; those remain separate gaps.

### Post-browser verification gates (1 November 2026)

- Memory-only serial test suite: **589 passed, 0 failed, 42 PostgreSQL-dependent tests skipped** (631 total). `DATABASE_URL` was explicitly blanked so tests could not reach the configured non-loopback database.
- Security probe: **51/51 passed** using two in-memory app instances and ephemeral ports. Client lint, production build, secret scan, and CRLF-aware `git diff --check` passed. Root and client production dependency audits each reported zero vulnerabilities.
- The build retains Vite's existing large-chunk advisory: main JS 556.93 KB minified (162.43 KB gzip). The database-backed full suite was not run against the configured external database; the approved browser flow used only isolated local PostgreSQL schemas.

## Platform-wide branding control surface (1 November 2026)

- Implemented durable owner-managed platform identity using the existing `platform_settings.branding` table. Owner UI lives at `/admin/branding` and `/super-admin/branding`; public clients read a sanitized `/api/public/branding` payload. Updates require the owner session, CSRF, mutation throttling, strict name/metadata validation, curated local asset references, contrast-checked colors, HTTPS-only optional links, and append-only audit.
- Real authenticated Chromium/PostgreSQL verification saved the brand, checked the durable row and audit action, loaded public metadata/icon/name, and confirmed those values after reload. At 390 px landing page overflow is 0 and browser errors are 0. The test found/fixed 3 px overflow from fixed ticket-preview cells. The temporary verification schema was dropped. Screenshot: `.preflight/platform-branding-390.png`.
- Owner navigation now exposes 12 destinations; mocked-session viewport check passed at 360, 390, 430, 768, 900, 901, 1024 and 1440 px, with Escape focus return and close-on-navigation. Visual review also found a clipped longer platform name in the 390 px header; the responsive type sizing now shows “Roundhouse Ninety” completely.
- Verification after the code changes: memory-only serial suite **592/592 passed**, 42 PostgreSQL-dependent tests skipped; platform-branding focused suite **3/3**; security probe **51/51**; client lint/build, secret scan and CRLF-aware diff check pass. The configured non-loopback `DATABASE_URL` remained disabled for the suite. Main JS bundle: 564.72 KB minified / 164.73 KB gzip (Vite advisory >500 KB).
- Runtime palette rule: an active approved theme (or instance theme) controls its complete token set; platform brand accents supply the fallback. Global branding does not alter tenant identity.

## Full PostgreSQL-backed suite (1 November 2026)

- **PASS:** `npm test` completed serially with 656 tests passed, 0 failed, 0 skipped and 0 todos across 20 suites. The run includes durable PostgreSQL behavior and the real isolated backup/restore integrity test.
- Scope was restricted to local container `codex-booking-browser-20261101` at `127.0.0.1:55435`, schema `codex_platform_suite_20261101`, migrated through 017. The configured external `DATABASE_URL` was overridden for this command and never contacted. Backup and restore used that same local test database; restore-check created and dropped its own throwaway database.
- The two retained reservation schemas and their audit history were not used as test targets. Their rows were checked before and after. The throwaway suite schema was removed after verification. No production service, port 4000 or deployment was touched.

## Moderator booking permission boundary regression (1 November 2026)

- Added explicit durable API assertions that `bookings.read` permits only assigned-instance list/detail, while cancellation is refused unless `bookings.manage` is also explicitly granted. A denied cancellation leaves the confirmed reservation unchanged.
- Moderator booking list and detail payloads are verified to omit both the private booking token and its stored token hash. The focused moderator test passed (2/2), followed by the full serial PostgreSQL-backed suite (656/656, zero skips). The browser-control helper was unavailable due to a missing kernel-assets path, so this verification is server/API coverage rather than a new browser pass.
- Test data remained in the existing generated-and-cleaned isolated durable test schemas; retained reservation records were not modified.

## Public booking lifecycle and route-change isolation (1 November 2026)

- Durable HTTP assertions now verify cancellation restores session capacity immediately, an expired reservation is returned as `expired` to its credential holder, a sold-out session stays visible with zero availability, and a cancelled session returns unavailable from public detail.
- `PublicBooking` now keys displayed session facts to the current route ID, clears session-bound reservation credentials/state on a session change, aborts the previous session's requests, and ignores responses from an obsolete request controller. This prevents stale booking details or a private code from appearing under a different session route.
- Focused PostgreSQL booking suite: **3/3 passed**. Client ESLint, production build and CRLF-aware diff check pass. Current main JS bundle is 565.58 KB minified / 164.87 KB gzip (Vite's >500 KB advisory). The Windows browser helper was unavailable due to its missing kernel-assets path, so lifecycle assertions are HTTP/API checks; visual browser states remain open.
- Local test container stopped. Retained booking schemas were checked after the run and still each contain one reservation and five audit events.

## Route-level client bundle splitting (1 November 2026)

- Host/player game screens, public instance/session/booking pages, moderator screens, and the Admin/Super Admin console now load on route entry. Owner-console, booking, and theme styles are split with their routes; shared shell and runtime theme styles stay on the initial page.
- **PASS:** client ESLint has zero warnings; Vite production build succeeds with separate route chunks. Initial JavaScript fell from 565.58 KB minified / 164.87 KB gzip to 207.17 KB / 68.52 KB, a 63% minified and 58% gzip reduction. The large-chunk advisory is gone.
- **PASS:** memory-only serial suite: 593 passed, 0 failed, 42 PostgreSQL-dependent skips. `DATABASE_URL` was explicitly blanked so no external database could be used. The previous full isolated PostgreSQL suite passed 656/656.
- Route chunks were verified in build output. The Windows browser helper remains unavailable, so interactive navigation and lazy-load rendering still need a browser pass.

## Moderator booking workspace English/Hindi coverage (1 November 2026)

- `/moderator/bookings` now includes the persisted English/Hindi language selector. Sign-in, invitation/recovery links, MFA enrollment, assigned-instance controls, permission navigation, booking filters, reservation details, statuses, allocation labels, cancellation confirmation and date formatting follow the selected language. The workspace exposes its selected `lang` to assistive technology.
- **PASS:** locale dictionary suite 7/7; refreshed memory-only suite 596 passed, 0 failed, 42 PostgreSQL-dependent skips; client ESLint and production build pass. `DATABASE_URL` was explicitly blanked during the full memory-only run.
- Extended English/Hindi copy across room creation and lifecycle actions, member removal, player memberships, history, operational summaries, instance description settings, room states, membership roles, booking audit events, and known moderator API error codes. Unknown error detail remains visible in English and falls back to a generic Hindi message.
- Focused locale tests: **7/7 passed**. Client ESLint and production Vite build passed. A mocked Chromium pass verified all five operations tabs in English and Hindi at 390 px, with translated mobile table labels; room details and player membership states were also checked in Hindi. The workspace had no overflow at 390 or 1440 px, no mutation requests, and no browser errors. Screenshots: `.preflight/moderator-rooms-hi-390.png`, `.preflight/moderator-players-hi-390.png`, `.preflight/moderator-history-hi-390.png`, `.preflight/moderator-reports-hi-390.png`, and `.preflight/moderator-instance settings-hi-390.png`.

## Authenticated moderator reservation cancellation (1 November 2026)

- With explicit authorization, created one confirmed, unassigned synthetic reservation in isolated schema `codex_moderator_cancel_20261101`; the schema, reservation, and audit rows are retained under the keep-until-policy. No production database or port 4000 was used.
- An MFA-enrolled moderator with explicit `bookings.read` and `bookings.manage` permissions cancelled the reservation through the real moderator browser UI. The durable reservation is `cancelled`; immutable reservation history records `hold.create` → `hold.confirm` → `hold.cancel`, with the final event attributed to `cancel-review-moderator`. Platform audit records `moderator.booking.cancel` with result `success`.
- A follow-up authenticated browser pass reopened the retained reservation and verified its cancelled state/history with zero browser errors. The initial action run reached and persisted the cancellation, then its check stopped on an incorrect expected toast string; the expectation was corrected and the read-only persisted-state/history pass passed. Screenshot: `.preflight/moderator-cancelled-reservation-390.png`.

## Final milestone verification refresh (1 November 2026)

- **Complete serial PostgreSQL suite:** `npm run migrate` applied migrations 001–019 to fresh disposable PostgreSQL 17 container `codex-moderator-full-20261101` on port 55439; `npm test` passed **660/660**, 20 suites, 0 failures, skips, or todos. This includes booking, moderator, tenant-isolation, and backup/restore tests. The disposable container was stopped; retained booking container/schema on 55437 and port 4000 were untouched.
- **Complete memory-only serial suite:** `DATABASE_URL` and `TEST_DATABASE_URL` blank; **596 passed, 0 failed, 42 PostgreSQL-only skips**.
- **Quality/security:** client ESLint and production build passed; secret scan passed (383 files, 2 `.env` values, 7 credential-shape checks); fresh online npm audits reported **0 vulnerabilities** across 145 root and 461 client packages. A previous security probe remains **51/51**; no server security code changed in this final UI pass.
- **Browser:** real authenticated moderator cancellation and durable audit verification passed in retained schema `codex_moderator_cancel_20261101`; mocked Chromium checked all five moderator operations tabs in English/Hindi, translated mobile table labels, room/member details, zero writes, zero runtime errors, and no horizontal overflow at 390/1440 px. Existing real browser evidence for public discovery, reservation confirmation, host allocation, replay refusal, and durable player refresh/reconnect remains in the preceding sections.
- **Retention/owner decision:** continue retaining the synthetic reservation and its append-only audit rows in `codex_moderator_cancel_20261101`, and all previously approved fixtures, until the owner supplies a retention policy. No cleanup job is authorized. Mocked browser checks cover expired/cancelled/unavailable views; a durable expired-record browser journey and broad assistive-technology review remain open.

## Live-game keyboard and modal focus verification (1 November 2026)

- Closed a concrete modal accessibility gap: the win/final celebration dialog previously declared `aria-modal="true"` and moved focus to Continue, but Tab could escape behind the dialog and dismissal did not restore focus. The overlay now traps forward/backward Tab, keeps Escape dismissal, and returns focus to the invoking control when it still exists or to the main game region when the claim button was removed after the authoritative win.
- Extended the real socket-backed Hindi player journey. Chromium focused the eligible claim button and activated it with Enter, verified initial focus in the win dialog, Shift+Tab wrapping from the first control to the last, Tab wrapping back, Escape close and main-focus restoration. The final-results dialog also received focus, closed with Enter, and restored main focus. The authoritative award and localized result stayed intact.
- The same host/player journey used real Tab traversal from the main region to the eligible claim control, then Enter activated it. It remained free of horizontal overflow at 360, 390, 430, 768, 1024 and 1440 px, with one main landmark, no unnamed visible controls or unlabeled images, and no database writes (memory-only ephemeral server). **PASS:** client lint, production build, and browser flow. Screenshot: `.preflight/player-live-round-hindi-390.png`.
- Scope: this verifies keyboard behavior for claim activation and the two celebration dialogs. Full screen-reader review, broader keyboard traversal of every game/admin control, and physical-device testing remain open.

## Fresh dependency and public route verification (1 November 2026)

- **PASS:** `npm audit --json` and `npm audit --prefix client --json` report zero vulnerabilities across 145 root and 461 client packages. This confirms the prior client `react-router-dom` 6.x advisory is resolved by the current 7.18.5 dependency; it does not replace future audits.
- **PASS:** built-client Chromium smoke traversed public directory → Regular hall → sessions → reservation form. At 390 and 1440 px there was no horizontal overflow; browser errors: 0; booking mutations: 0. The smoke script now waits for the booking route itself and intercepts the public branding read, avoiding a false early match on the previous page's session heading.
- The database container was stopped after a read-only check confirmed retained allocation schema `codex_booking_ui_alloc_20261101` still has one reservation and five audit records. No retained booking was modified. Port 4000 and the preview port were left clear.

## Node 22 production image and local deployment smoke (1 November 2026)

- **PASS:** `docker build --pull=false -t codex/tambola-platform:local-verification .` built the production Node 22 image; client and production dependency install steps reported zero vulnerabilities.
- **PASS:** the image ran with `NODE_ENV=production`, secure-cookie and trusted-proxy settings, generated test-only MFA key, and an isolated PostgreSQL 16 container. `npm run smoke -- --url http://127.0.0.1:4174 --full` passed all 11 checks: liveness, readiness, current migrations, built SPA, Socket.IO handshake, host socket, room creation, guest join, ticket issue, call fan-out and completed game.
- The app, disposable PostgreSQL container, volume and network were removed. Port 4000, both retained booking schemas, Hostinger credentials, DNS and production systems were not used. This verifies the production image and local runtime only; reverse-proxy/TLS, a real VPS plan, off-site backup, recovery and production capacity remain unverified.

## Player seat refresh and transport reconnect verification (1 November 2026)

- Added a visible connection state to the player waiting room. In a real headless Chromium run against an ephemeral memory-only server, a host created a room and a player joined through the actual forms and selected three server-generated tickets.
- **PASS:** reloading the player route resumed the same player ID on a new socket, restored the exact three ticket grids, and kept room membership at two (host + one player). Taking the player browser context offline changed the live status to Offline; restoring connectivity returned it to Connected and rebound the same seat on a fresh socket without duplicate membership. No uncaught page errors or 390 px horizontal overflow.
- This verifies the general player recovery mechanism and visible waiting-room connection state. It creates no booking or database record and does not prove refresh/reconnect specifically for a durable booking-allocated seat; that narrower durable booking check remains open. Screenshots: `.preflight/booking-player-before-reconnect-390.png`, `.preflight/booking-player-after-reconnect-390.png`.
- Verification: client lint/build pass; memory-only serial suite **593 passed, 0 failed, 42 expected PostgreSQL skips** with `DATABASE_URL` blanked; secret scan and CRLF-aware diff check pass.

## Owner control-centre skip navigation (1 November 2026)

- The owner shell already provided a skip link, but its main landmark was not programmatically focusable. Added `tabIndex=-1` to the owner `<main>` target so fragment navigation moves keyboard focus into the content.
- **PASS:** fresh-page Chromium keyboard check confirms the skip link is the first tab stop and Enter focuses `#adm-content`. The responsive owner navigation suite also passes with 12 destinations, Escape focus return, close-on-navigation, and no horizontal overflow at 360–1440 px across eight breakpoints. Browser page errors: 0. This is a focused keyboard check, not a complete owner-console accessibility audit.

## Reviewed theme catalog and full database suite (1 November 2026)

- Migration 018 adds six reviewed, versioned token themes, bringing the public library to nine distinct packages across all nine supported categories. Existing active global and instance themes are unchanged; no theme is published and the daily schedule remains disabled by default.
- Focused theme integration tests: **3/3 passed**. Complete serial PostgreSQL suite: **657 passed, 0 failed, 0 skipped**. Backup/restore round-trip passed after migrations were applied to `public` in the disposable database for the legacy backup fixture.
- The suite used only disposable local PostgreSQL container `codex-theme-library-20261101` on port 55436. No retained booking schemas, port 4000, production database, or public service was used. The container was removed after verification.
- The expanded catalog has validated token packages and descriptions. Nine theme-specific decorative vector motifs were added to previews in the follow-up slice below; poster-grade illustration and broad visual/accessibility review remain open.

## Theme preview artwork (1 November 2026)

- Added nine distinct, original SVG line-art motifs keyed to the reviewed theme IDs. Both public and owner previews show the motif above the live 90-number board and sample ticket; unknown/draft IDs do not receive an unrelated catalog motif. The SVG is decorative to assistive technology because theme name and category remain available as text.
- Focused motif regression tests: **2/2 passed**. Client lint and production build pass; the initial JS bundle remains 207.17 KB minified / 68.51 KB gzip.
- The first screenshot exposed that preview CSS was imported only by the lazy owner route. Moved the stylesheet import into the shared preview component, then rebuilt and repeated the browser run. This fixed the public route’s collapsed ticket/board and unstyled SVG.
- Mocked Chromium verifies all nine unique motifs and the public modal preview at 390/1440 px. The modal now focuses its close control on open, wraps Tab and Shift+Tab between its two controls, closes on Escape, and returns focus to the invoking preview button whether closed by Escape or Done. Browser/console errors: 0; non-GET requests: 0. Screenshot: `.preflight/theme-store-art-390.png`. Test data is mocked and does not verify the live API/database response.
- This is lightweight decorative vector art, not a complete poster-grade illustration package. Wider visual browser review and broader accessibility checks remain open.

## Public entry keyboard focus and booking-state browser checks (1 November 2026)

- Mocked Chromium checked `/games`, `/games/regular`, `/games/regular/sessions`, the public booking route and `/themes` at 390×844. On each route, Skip to main content was the first Tab stop; Enter moved focus to `main#main-content`. Browser/console errors: 0. The journey issued no mutations.
- A separate mocked booking pass checked Sold out and unavailable-session views, then simulated expired and cancelled hold responses. Both processed states were announced, exposed no confirm/join action, and caused zero browser errors at 390×844. Two synthetic POSTs were intercepted by Playwright; no request reached an application server and no persistent reservation or audit row was created.
- These checks verify public UI response and keyboard focus only. Live lifecycle outcomes remain backed by the PostgreSQL/API suite; real authenticated moderator booking operations and durable allocated-seat refresh/reconnect still need browser verification.

## Authenticated moderator booking read and grant boundary (1 November 2026)

- Chromium completed owner invitation, moderator acceptance and MFA enrollment against a fresh PostgreSQL test schema. The owner granted only `room.read` and `bookings.read`; the moderator successfully loaded and filtered the actual instance-scoped reservation endpoint and saw its empty state. Search changes kept the Bookings tab selected after fixing a bootstrap effect that previously reset it to Rooms.
- The authenticated moderator attempted cancellation with a valid CSRF token but without `bookings.manage`. The server returned non-enumerating `404 NOT_FOUND`, and append-only audit recorded both successful booking reads and the denied permission check. Seven widths from 360–1440 px had no overflow; browser runtime errors: 0 (the expected network-level 404 was accounted for separately).
- The test schema was dropped. No reservation was created, and no retained booking schema was touched. This verifies authorized read and manage denial; successful cancellation with an existing eligible fixture and refresh/reconnect after durable allocation remain open.

## Player 90-ball board accessibility semantics (1 November 2026)

- Replaced the board’s incomplete `role="grid"` (which lacked grid rows/cells) with a read-only semantic list. All 90 number tiles expose `role="listitem"`; the official current number alone has `aria-current="true"` and its accessible label says “called, current call” (localized in Hindi too).
- The booking-locale suite passes **6/6**. In-memory Chromium verification used the actual host and player screens: host created a room, player joined at 390×844, host started play and called a number through the normal control. The player DOM exposed 90 list items and one current-call label, with no horizontal overflow or browser errors. Screenshot: `.preflight/number-board-a11y-390.png`.
- Client lint and production build pass. The app ran in memory mode on port 4188 and was stopped after the check; it did not touch port 4000, any PostgreSQL container, or retained booking data. This targeted check does not complete full screen-reader/keyboard accessibility review.

## Additional approved booking allocation browser verification (1 November 2026)

- An owner created and published a Regular session assigned to a real host-created room. A synthetic player completed the public hold and confirmation flow for three tickets, then joined the room with the reservation reference and private code. The durable reservation was confirmed and assigned to exactly one player seat with the reserved display name and all three ticket grids locked to the reservation.
- A second browser replayed the same booking credentials. The server refused the join, the room-member count did not increase, and the reservation retained its original assignment. The reservation's ordered audit actions are `hold.create`, `hold.confirm`, and `hold.assign`; browser runtime/console errors: 0. Screenshot: `.preflight/booking-allocation-player-390.png`.
- Retained synthetic fixture: schema `codex_booking_alloc_browser_20261101`, session `2ef639b8-9437-438f-8f44-ceebf088f413`, reservation `4845f396-8066-4285-bd4f-f41b5731c773`, room `MPRPNH69`, display name `Booking Browser Gues`, three tickets. One reservation remains in the schema. The dedicated PostgreSQL container `codex-booking-alloc-browser-20261101` is retained on loopback port 55437 with its own persistent Docker volume, per the keep-records instruction. The previously retained booking database and ports 4000/55432/55435 were not used or changed.
- Full memory-only serial suite: **595 passed, 0 failed, 42 PostgreSQL-dependent tests skipped**. Secret scan passed (379 files; 2 local env values and 7 credential shapes checked), and CRLF-aware `git diff --check` passed. This browser pass verifies allocation and replay protection; durable refresh/reconnect after booking allocation and authenticated moderator booking operations remain open.

## Full PostgreSQL suite revalidation through migration 018 (1 November 2026)

- Serial run against a fresh disposable PostgreSQL 17 container: **659 passed, 0 failed, 0 skipped** across 20 suites, including booking/multi-tenant/moderator coverage and both booking and general backup/restore round trips. Migrations were applied to `public` through 018 because the general backup fixture requires a populated ledger there; suite-created schemas and scratch restore databases remained isolated.
- The `.env` pointed backup tools at stopped container `tambola-pg`; it was not started or changed. The successful run explicitly targeted the disposable container `codex-full-suite-20261101` via `PG_CONTAINER`, then stopped it. The retained booking container on 55437 and all earlier retained schemas were untouched. No production database was contacted.

## Daily theme release notifications and migration 019 (1 November 2026)

- Scheduled release publication, append-only release audit, and one unread notification per existing owner now commit together. Owner/event uniqueness prevents retry duplicates; listing and acknowledgement are owner-scoped. Acknowledgement is a one-time `read_at` transition and creates `theme.notification.read` audit history. No mail provider or third-party messaging dependency was added.
- Authenticated Chromium verification on the actual built admin console: a scheduled Obsidian Hall release appeared in the global admin notification area at 390×844; the owner followed the review link and marked it read; a separate database connection verified the durable read timestamp and audit action. Horizontal overflow: none. Browser errors: 0. Screenshot: `.preflight/theme-daily-release-notification-390.png`.
- Focused theme tests: **3/3 passed**. Full serial PostgreSQL suite through migration 019: **659/659 passed, 0 skipped**. Client lint and production build pass; security probe: **51/51**. Final secret scan and CRLF-aware diff check pass. All test databases ran in a disposable PostgreSQL 17 container that was stopped afterward; the retained booking database on 55437 was untouched.

## Bounded in-memory staged load and reconnect check (1 November 2026)

- Ran `node scripts/loadtest.mjs staged --stages 5:25 --calls 5` with both `DATABASE_URL` and `TEST_DATABASE_URL` empty. The harness created a memory-only server on an ephemeral loopback port; no PostgreSQL database or retained booking fixture was involved.
- Five rooms reached 25/25 total seats (five per room), with 0 join failures and 0 other errors. Five rooms started and all 25 calls were acknowledged; premature full-house claims were refused 5/5, duplicate calls were 0, and the initial harness reported 15/15 still-connected seats synced. Follow-up review found it excluded the five intentionally disconnected samples; the corrected rerun below verifies all 20 player seats before disconnect.
- All five reconnect attempts resumed successfully. Call ack p50/p95/p99: 1.5/2.7/2.8 ms; join ack p50/p95/p99: 16.8/17.3/17.3 ms; call-to-screen fan-out p50/p95/p99: 1.6/2.9/3.0 ms. Run duration was 0.4 s, peak RSS 77.3 MB, event-loop delay p99 28 ms.
- This is a small local functional/load baseline. It does not replace the previously documented durable 50-room/250-player burst, a long soak, handset profiling, or production-capacity evidence.

## Dependency audit refresh (1 November 2026)

- `npm audit --offline` passed for the root and client lockfiles: **0 vulnerabilities** in each dependency tree. The offline flag used the current local npm advisory cache; see the dated audit records above for prior online audit evidence.

## Public entry narrow-screen browser pass (1 November 2026)

- Chromium loaded the built application from an ephemeral memory-only server and exercised `/games`, `/games/regular`, `/games/regular/sessions`, and the session booking form at widths **320, 360, 390, 768, and 1440 px** (20 route/viewport samples). Public API reads were intercepted with labeled synthetic UI fixtures; no reservation or other server data was written.
- Every viewport had no document or main-content horizontal overflow and no clipped instance/session/form cards. Browser page/console errors: **0**; non-GET requests: **0**. 320 px screenshots: `.preflight/public-entry-directory-320.png`, `.preflight/public-entry-hall-320.png`, `.preflight/public-entry-sessions-320.png`, `.preflight/public-entry-booking-320.png`.
- This verifies narrow rendering of public entry and booking UI with mocked responses; it does not verify live availability or booking lifecycle state, and it does not close the wider game-screen/accessibility review.

## Durable booking allocation refresh and reconnect (1 November 2026)

- Chromium and isolated PostgreSQL schema `codex_booking_reconnect_5336e95d` verified a real owner-published Regular session attached to a live host room, public confirmation, and allocation of three server-generated tickets to the reserved display name. The browser refreshed the assigned player page, then went offline/online to force Socket.IO reconnect. Both resumed the same player ID and session credential, restored the exact same three ticket grids, and kept room membership at two rows (host + player); both transitions attached a new socket. Browser errors: **0**; no page overflow at 390 px.
- Reservation UUID `5c278d57-c2bc-408f-9b31-c86405be01c5`, session `56e0a3ab-97e1-4c8c-85df-50259a6d63e7`, room `L57JCKBL`, display name `Booking Refresh User`, three tickets. Audit actions remain ordered `hold.create`, `hold.confirm`, `hold.assign`. The schema and records are retained under the owner keep-until-policy instruction; no production DB or port 4000 was used. Screenshots: `.preflight/booking-allocation-before-refresh-390.png` and `.preflight/booking-allocation-after-reconnect-390.png`.
- This closes the durable assigned-seat browser refresh/transport-reconnect gate. The same reservation cannot also test operator cancellation because assignment intentionally makes it ineligible for cancellation; a separate confirmed, unassigned fixture is required for that browser check.

### Authorized fixture scope

- The owner separately authorized a confirmed-unassigned cancellation fixture. It is retained in schema `codex_moderator_cancel_20261101`; see the authenticated cancellation verification section above. The assigned reconnect fixture and cancellation fixture remain distinct because an assigned reservation is intentionally ineligible for cancellation.

## Staged load harness correctness gate (1 November 2026)

- Fixed the staged Socket.IO harness so it verifies fan-out for every player before disconnecting its reconnect sample (previously it counted only still-connected players), checks join/start/call/claim/reconnect and teardown invariants, rejects malformed stage/call arguments, and sets a non-zero exit code on failed correctness or cleanup.
- Corrected in-memory rerun (5 rooms × 5 seats, 5 calls each): **20/20 player seats** received every call before reconnect; five sampled reconnects passed; five premature claims were refused; duplicate calls/errors/join failures: 0; every room was closed; output ended `RESULT: PASS`. p95 call/join/fan-out: 2.6/17.4/2.7 ms. Invalid `--stages` and `--calls` arguments each exited 1. The run used no database URL and did not access retained booking data.

## Live player board narrow-device and shared-control check (1 November 2026)

- A real Chromium session used the built UI and an isolated memory-only game server. The host created a room, a player joined, play started and the server made the first official call. The player board exposed 90 semantic list items and one correctly labelled current call.
- Responsive checks passed at **320×844, 360×800, 390×844, 568×320 landscape, 768×900, and 1440×900** with no document/main overflow or browser errors. The shared language selector rendered with its component stylesheet at every route; computed foreground/background contrast was **12.97:1**. Screenshots: `.preflight/number-board-a11y-320.png` and `.preflight/number-board-a11y-568.png`.
- The 320 px capture exposed the selector's missing styles in player routes (it had inherited a white native control). Styles now load with the shared selector component, including dark option colors and keyboard focus indication. Client production build and this browser rerun pass. This remains browser viewport emulation, not a handset or comprehensive screen-reader audit.

## Moderator booking UUID input validation (1 November 2026)

- Moderator booking session filters, reservation detail, and cancellation now require canonical UUID segment layout before invoking the booking service. Malformed 36-character hex strings are rejected with the existing `400 INVALID_INPUT` session-filter response or non-disclosing `404 NOT_FOUND` reservation response.
- The complete moderator integration file passed **2/2** against a fresh disposable PostgreSQL 17 container. Its HTTP checks cover malformed filter/detail/cancel IDs alongside valid booking list/detail/cancel flows, MFA, CSRF, instance grants and audit behavior. The disposable container was stopped; retained booking schemas were not used, and port 4000 was untouched.
- This closes the malformed UUID cast edge for these booking routes only. The broader cross-identifier Cartesian campaign and independent security review remain open.

## Cross-tenant identifier matrix follow-up (1 November 2026)

- Durable isolation now probes all six ordered cross-instance pairs among Regular, Bumper and Legacy, attempting to attach each source tenant's player identifier to another tenant's ticket, claim and award. All **18** inserts were rejected by the composite foreign keys; persisted ticket/claim/award counts were unchanged. The existing host/player session resume matrix continues to check all six source/target pairs and confirms denied resumes do not load the recipient room.
- Moderator HTTP checks now substitute a Bumper session ID and reservation ID into Regular booking list/detail/cancel routes. The foreign session filter returns an empty list, detail and cancel return `404`, and the Bumper reservation remains confirmed. Combined moderator and durable tenant suites pass **3/3** on fresh disposable PostgreSQL 17 with no skips; container stopped, retained booking schemas untouched.
- Moderator Socket.IO checks now attempt all five state-changing room actions (`start`, `pause`, `resume`, `end`, `reset`) against both foreign Bumper and Legacy rooms while signed in with only a Regular grant. All ten requests were denied and both foreign rooms remained `WAITING`.
- The equivalent HTTP matrix denies all ten foreign room lifecycle requests and both foreign-room member-removal requests. Removal checks also reject foreign Bumper/Legacy players and a Regular player from a different Regular room; all affected room states and memberships remain unchanged. Moderator and tenant suites pass **3/3**, no skips, on disposable PostgreSQL 17; the container was stopped.
- This materially expands the matrix for existing exposed identifiers. Ticket, game, claim and award direct moderator lookup routes do not exist; exhaustive endpoint Cartesian fuzzing, all other route-parameter combinations and independent security review remain open.

## Super Admin moderator identifier validation (1 November 2026)

- Added a router-level canonical UUID guard to the Super Admin moderator-management route family, covering detail, profile update, status, recovery, session revocation, and grant update/revoke. Malformed IDs return the same non-disclosing `404 MODERATOR_NOT_FOUND` response before handler queries or mutation budgets.
- The owner-authenticated PostgreSQL integration test passed **1/1** with all seven malformed-ID routes exercised together. The test confirmed no platform-audit rows were added; existing valid provisioning, grants, suspension/reactivation, recovery and session revocation also passed. Disposable PostgreSQL 17 was stopped afterward.
- Resulting HTTP requests were logged as non-disclosing 404s; no SQL UUID-cast error escaped through the handler. Syntax checks passed for the router and integration test.

## Shared UUID validation (1 November 2026)

- Added `server/identifiers.js` as the single canonical RFC UUID predicate and applied it to public/owner booking session and reservation routes, moderator booking filters/actions, and Super Admin moderator-ID routes. This keeps malformed path/query values out of PostgreSQL casts and prevents the route families from drifting to different syntax rules.
- The focused serial run passed **7/7** across the UUID unit cases, durable booking, moderator authorization/booking, owner moderator management, and booking backup/restore suites, with no skips. Backup/restore ran using `PG_CONTAINER=codex-shared-uuid-20261101` and stayed inside that disposable PostgreSQL 17 container. It was stopped after the run; retained booking schemas and port 4000 were untouched.

## Poster template review and rollback browser verification (1 November 2026)

- Authenticated Chromium created an original template draft, approved and published its initial version, created/reviewed/published version 2, then restored version 1 as a new immutable version 3. PostgreSQL verified the three approved version rows, publication sources `manual`, `manual`, `rollback`, and corresponding audit entries. Responsive checks at **360, 390, 768, 1024 and 1440 px** found no horizontal overflow; browser page/console errors: **0**.
- The isolated schema `codex_poster_review_95d4e400` was removed by the browser script. No booking or customer data was involved. Screenshot: `.preflight/admin-poster-template-rollback-390.png`; repeatable check: `.preflight/tools/admin-poster-template-review-rollback-check.mjs`.
- Client ESLint and production build passed before the browser run. The initial script expected an extra approval action for version 1; the service contract approves it with the template, so the check was corrected and rerun successfully. Disposable PostgreSQL container was stopped afterward.

## Full suite after shared UUID validation (1 November 2026)

- Memory-only suite: **597 passed, 0 failed, 42 database-dependent skips** with database URL variables blanked.
- Full serial PostgreSQL suite: migrations **001–019** on a fresh disposable PostgreSQL 17 database; **661 passed, 0 failed, 0 skipped** across 20 suites, including both backup/restore drills. The fresh database required `npm run migrate` against `public` before the general backup test, matching the documented suite setup.
- The disposable database container was stopped; retained booking schemas and port 4000 were untouched.

## Poster studio toggle accessibility (1 November 2026)

- Poster template selection cards and Desktop/Mobile preview controls expose selection with `aria-pressed`; the authenticated Chromium workflow verifies the state changes when each control is activated, then completes the existing review/publish/rollback flow.
- Client ESLint and production build passed. The associated browser run found no horizontal overflow at 360, 390, 768, 1024 and 1440 px and no browser errors. Disposable schema `codex_poster_review_8a040c44` was dropped; database container stopped.

## Public booking state, accessible names and route isolation (1 November 2026)

- Headless Chromium at 390×844 exercised sold-out sessions, unavailable session details, and synthetic expired/cancelled reservation responses. The two reservation POST requests were intercepted by the browser harness; no reservation or audit rows were created.
- Every visible button, link and form control on the booking route had an accessible name. After an SPA navigation from an expired/cancelled reservation to another session, focus moved to the main landmark and the former status and private booking credential were absent from the page.
- Browser runtime/console errors: **0**. Repeatable check: `.preflight/tools/public-booking-states-browser-check.mjs`. This is mocked UI evidence; durable expiry/unavailability journeys and real screen-reader checks remain open.
- Client ESLint and production build passed (171 modules; initial JavaScript 207.24 kB minified / 68.55 kB gzip).

## SPA route focus for lazy-loaded public pages (1 November 2026)

- Added a route focus manager that focuses the destination page's primary heading when client-side navigation changes the pathname. It waits for a lazy-loaded page heading to appear, gives the heading programmatic focusability where needed, and leaves initial page load and query-only changes alone. The booking page retains its more specific focus behavior when its session route parameter changes.
- Headless Chromium navigated public directory → lazy-loaded theme store → directory, then to owner sign-in, moderator workspace and moderator recovery; focus landed on each destination heading. This exposed and fixed the owner sign-in screen's missing main landmark. A synthetic authenticated-session response then exercised protected owner overview → Instances navigation and verified focus at both headings. The check also reran skip-link-first keyboard checks on the directory, hall, session list, booking and theme routes. Browser errors: **0**; non-GET requests: **0**.
- Owner and moderator session responses and owner page data were mocked as GETs; no real credentials or server data were used. Client ESLint and production build passed. Repeatable check: `.preflight/tools/public-skip-link-browser-check.mjs`. Real authenticated owner workflow and assistive-technology behavior remain unverified.
- The same synthetic owner session exercised the Instances screen at **360, 390, 768, 1024 and 1440 px**. There was no horizontal overflow, and every visible button, link and form control had an accessible name at all five widths. No writes were issued.
- Expanded the synthetic-session browser walk across all **12 owner navigation sections**. Focus landed on the destination heading for each route. The other ten sections (excluding the separately audited Instances page and initial Overview) had no horizontal overflow and no unnamed visible controls at **390 and 1440 px**. Browser errors: **0**; non-GET requests: **0**. All owner API data and the session were mocked; this verifies UI routing/accessibility only, not authenticated authorization or populated-data behavior.

## Durable moderator cancellation browser verification (1 November 2026)

- With the owner's authorization, a fresh schema `codex_moderator_cancel_ui_20261101` was created inside local test PostgreSQL container `codex-booking-alloc-browser-20261101` on loopback port 55437. The browser signed in a synthetic moderator, enrolled a test TOTP factor, loaded the confirmed unassigned reservation and submitted the cancellation action.
- Reservation `295cb50a-df17-40d7-994f-16191d981248` in session `d091b222-6cee-42ec-a0af-27949ce1fd00` is durably `cancelled`, with no player assignment or room. Independent SQL readback confirmed ordered reservation events `hold.create`, `hold.confirm`, `hold.cancel`; the cancellation actor is `cancel-review-moderator`. The separate `moderator.booking.cancel:success` platform-audit event is present.
- Browser errors: **0**; mobile horizontal overflow: **none**. The fixture schema and reservation/audit records are retained under the owner's keep-until-policy instruction. The existing assigned reconnect fixture `5c278d57-c2bc-408f-9b31-c86405be01c5` remains `confirmed`, assigned to room `L57JCKBL`, with its original `hold.create`, `hold.confirm`, `hold.assign` audit sequence. No production database or port 4000 was used. Repeatable workflow: `.preflight/tools/moderator-booking-cancel-durable-browser-check.mjs`.
## Moderator unknown-instance and unknown-room audit regression (1 November 2026)

- Added a focused HTTP regression matrix using a Regular-only moderator against foreign Bumper, archived Legacy and nonexistent instance IDs. Five list/read routes plus player detail, booking detail/cancel, settings update and room creation returned `404` for each target (30 requests total); unknown-room detail, start and player-removal requests also returned `404`.
- The test reproduced and closed an audit-write edge: audit foreign keys now resolve only existing instance/room rows, while bounded requested identifiers remain in metadata. This prevents an unknown path ID from turning the intended denial into an FK error/500.
- `node --env-file-if-exists=.env --test --test-concurrency=1 tests/moderator-instance-id-isolation.test.js` passed **1/1** against the local test PostgreSQL endpoint. The disposable `modidmatrix` schema was dropped by the harness. The test asserted there were zero `ticket_reservations`; retained booking schemas and port 4000 were untouched.
- This adds route-specific evidence; remaining identifier combinations and independent security review remain open.
## Authenticated owner-console navigation review (1 November 2026)

- A synthetic owner signed in to a fresh PostgreSQL-backed app schema and navigated all **12** owner-console sections over the real authenticated API. All headings loaded, every visible control had a name, and no horizontal overflow occurred at **390 px and 1440 px** (24 route/viewport samples). Browser page/console errors: **0**.
- The only API write was synthetic owner sign-in. No instance, booking, poster, theme or other product records were created or changed. The owner/authentication schema was dropped by the harness.
- Repeatable check: `.preflight/tools/admin-owner-live-nav-check.mjs`; results: `.preflight/owner-live-nav-results.json`. This proves authenticated route loading and UI control naming at two emulated widths, not complete owner workflows, screen-reader behavior or physical-device rendering.

## Moderator booking assignment and retained cancellation follow-up (1 November 2026)

- Migration 020 adds the explicit `bookings.assign` grant without changing any moderator grants. Migration 021 preserves both immutable assignment audit actions (`hold.assign` for player allocation and `session.assign_room` for moderator room attachment). Focused serial PostgreSQL checks passed **2/2**: atomic same-instance session-to-waiting-room assignment (including concurrent contention and idempotency) and Super Admin explicit grant management. They used disposable schemas in the local PostgreSQL test database on 55437; both schemas were dropped. The assignment test asserted **zero** reservation rows and verified actor/session audit data, cross-instance and wrong-instance room denial, and denial without `room.read` or `bookings.assign`.
- Client ESLint and production build passed. Root and client `npm audit` each reported **0 vulnerabilities**; the secret scan inspected **389 files** and passed. Authenticated mocked Chromium permission matrix passed **16/16** single-grant views and targeted combinations: `bookings.assign` without `room.read` showed no room selector; adding `room.read` exposed an eligible room and sent the expected `{roomCode}` request. Browser errors: **0**. This is a UI mock; the database integration test is the evidence for server-side assignment and audit.
- Reopened retained schema `codex_moderator_cancel_ui_20261101` in authenticated Chromium at 390×844. Its approved synthetic unassigned reservation `295cb50a-df17-40d7-994f-16191d981248` was already cancelled before this resumed pass, so the browser verified its cancelled state, absence of a repeat-cancel action, and activity history read-only. PostgreSQL still records `hold.create` → `hold.confirm` → `hold.cancel` with the moderator actor and a successful `moderator.booking.cancel` platform audit; runtime errors: **0**, horizontal overflow: none. No duplicate cancellation was sent. Screenshot: `.preflight/moderator-cancelled-reservation-390.png`.
- The first full-suite run through migration 020 exposed that its audit check omitted the established `hold.assign` action (**662/663 passed**). Additive migration 021 restores that action while retaining `session.assign_room`; the focused reservation-to-room test then passed **1/1**. The complete serial PostgreSQL suite passed **663/663**, 20 suites, 0 failures/skips/todos, through migrations 001–021 in a new disposable PostgreSQL 17 container, which was stopped and removed after the run. The memory-only serial suite passed **597**, with **44** database-only skips. All approved reservation/audit rows remain under the owner’s keep-until-policy. No production database, port 4000, or prior reconnect schema was touched.

## Booking expiry during session cancellation (1 November 2026)

- Fixed session cancellation so unobserved elapsed holds are recorded as expired first. The database transaction appends `hold.expire`; the session cancellation path then cancels only remaining active, unassigned reservations.
- The added durable regression checks the final `expired` status and exact `hold.create` → `hold.expire` audit sequence. Serial `tests/bookings.test.js` passed **3/3**, including backup/restore, against local test PostgreSQL on loopback port 55437. The test generated and removed its own schemas and scratch backup files; retained booking schemas were not changed.
- An initial run failed only because the backup helper selected stopped container `tambola-pg`. Setting `PG_CONTAINER=codex-booking-alloc-browser-20261101` resolved the test harness target; the rerun passed all three tests. No production database or port 4000 was used.

## Booking assignment integrity during room recovery (1 November 2026)

- Room recovery loads assigned reservations with their linked member row and rejects missing or mismatched player, room, confirmed status, or reserved ticket count. The room is frozen with a recovery error before registration; no ticket quantity is silently changed.
- Durable corruption test: **1/1 passed**, confirming `RECOVERY_REQUIRED`, persisted freeze reason, unchanged reservation values and no fabricated audit event.
- Full serial suite: **665/665 passed**, 20 suites, 0 failures, 0 skipped, 0 todos, migrations 001–021. It ran on a fresh PostgreSQL 17.11 disposable container; public migrations were initialized before backup/restore checks. The container was removed afterward. The retained booking database/schemas and port 4000 were not used for this full run.

## Owner room recovery retry browser verification (1 November 2026)

- Added `POST /api/admin/games/:roomId/recover` behind the owner session and CSRF guards. Every accepted owner attempt is appended to the owner audit. Retry is allowed only for a durable, open room with a recorded recovery error. It clears the old note only while rerunning recovery; any remaining integrity issue records a new error and keeps the room frozen. No data repair is attempted by the endpoint.
- Controller regression passed: a synthetic booking/member ticket-count mismatch failed closed on retry, and after correcting the durable count, the same room recovered with its reservation relationship intact. Recovery audit entries show failed → cleared → failed → cleared across the two checks.
- Real Chromium used a generated disposable schema and synthetic owner/room. Anonymous POST with valid CSRF was denied **401**; the authenticated retry returned success, cleared the recovery note, restored the WAITING room, and appended exactly one `admin.room.recover` success event attributed to the owner. Ordinary round actions stayed disabled while frozen and became available after recovery. No reservation rows were created; the schema was dropped.
- The first mobile pass found 7 px page overflow from the participants table. The owner roster now renders labelled cards on small screens. Recheck passed at **390×844** and **1280×900**, with zero browser errors. Screenshot: `.preflight/admin-room-recovery-390.png`; repeatable harness: `.preflight/tools/admin-room-recovery-browser-check.mjs`.
- Client ESLint and production build passed. Full serial PostgreSQL suite passed **665/665**, 20 suites, 0 failures/skips/todos, migrations 001–021. Both `pg_dump`/`pg_restore` checks passed after pointing `PG_CONTAINER` at the fresh disposable PostgreSQL 17.11 test container; it was removed after the run. The retained booking container/schemas and port 4000 were not used.

## Booking-linked room recovery integrity matrix (2 November 2026)

- A new table-driven regression exercises every reservation/seat relationship asserted by hydration: reservation room, player presence, confirmed status, member player, member room, and locked ticket count. All six corruptions throw an integrity failure; a valid assignment retains its ticket-selection lock.
- The durable integration test continues to create a real confirmed reservation and assigned seat, corrupt the locked count, confirm recovery refuses and leaves the room out of the registry, retry while still inconsistent, then repair the authoritative count and verify successful recovery. Reservation rows and `hold.create` → `hold.confirm` → `hold.assign` history remain unchanged by the failed attempts; recovery attempts are separately recorded.
- Focused recovery suite: **2/2 passed**. Full serial PostgreSQL suite: **666/666**, 20 suites, 0 failures/skips/todos. Migrations 001–021 and both backup/restore checks ran on fresh disposable PostgreSQL 17.11; that container was removed. The retained booking container on 55437 was not used for the full run.

## Cold recovery after game reset and lifecycle consistency (2 November 2026)

- Recovery now checks that the room's current round row matches `room.game_number` and the lifecycle pair is valid: running/paused rooms have a running game row, completed rooms have a completed game row, and a waiting room may have no game (initial state) or a completed previous game (after reset). Other combinations fail closed.
- On `COMPLETED → WAITING`, the prior game's stored draw, calls and tickets remain validated as history but are no longer hydrated into the new waiting-room state. The player roster and selected ticket counts survive; the new projection has no draw, calls, tickets or awards. The durable integration test cold-recovers the room, resumes the same host session, starts game 2, and confirms game 1's calls remain unchanged.
- Focused persistence, booking recovery and ticket-integrity files: **41/41 passed**. Full serial PostgreSQL suite: **669/669**, 20 suites, 0 failures/skips/todos, migrations 001–021; both backup/restore checks passed on a fresh disposable PostgreSQL 17.11 container, removed after the run.
- Client ESLint and production build passed. Secret scan passed; root and client dependency audits found **0 vulnerabilities**. The retained booking database on 55437 and port 4000 were not used for the full suite.

### Reset recovery validation refinement (2 November 2026)

The cold-reset test also changes a player's next-round quantity from two tickets to one before restart, verifying that historical validation uses the previous game's stored ticket rows while the new waiting projection keeps the new selection. A corrupt prior-round award is rejected before any completed-round projection is omitted. Final full serial PostgreSQL suite: **670/670**, 20 suites, 0 failures/skips/todos, migrations 001–021, including both backup/restore checks on disposable PostgreSQL 17.11. Client lint/build and secret scan pass; root and client dependency audits found 0 vulnerabilities. The disposable container was removed; port 4000 and retained booking fixtures were untouched.

### Award recovery relationship validation (2 November 2026)

Recovery now cross-checks stored awards against pattern definitions, point values, winner membership, call history, owned ticket numbers, duplicate-winner rules and contiguous ordinals. Optional historical ticket attribution and ordinals remain nullable for pre-attribution records. Focused ticket-integrity checks passed **17/17**; the durable standings test now records an actual call before its award. The complete serial PostgreSQL suite passed **672/672**, 20 suites, with no failures/skips/todos through migrations 001–021, including both backup/restore checks on a fresh disposable PostgreSQL 17.11 container. The CUA bridge failed initialization, so the separately approved moderator cancellation click was not performed and its retained fixture/audit data remain unchanged.

### Owner overview activity and backup signals (2 November 2026)

The owner overview now reports recent owner and moderator platform audit events and a credential-free backup summary that distinguishes manifest validity and restore-check outcomes. Durable regression checks both audit streams. Owner API tests passed **36/36**; complete serial PostgreSQL suite passed **673/673** across 20 suites, migrations 001–021, with both backup/restore drills. Lint, build, both dependency audits, secret scan and diff check passed. Windows computer-use initialization failed twice before exposing a browser window, so the separately approved moderator cancellation remains unsubmitted and its retained reservation/audit state remains unchanged.

### Instance-scoped defaults for new rooms (2 November 2026)

The owner can configure a validated room capacity, ticket limit, auto-call interval and auto-call switch independently for each instance. These values are copied into new rooms only; existing room configurations remain unchanged. A durable owner API regression verifies CSRF-authenticated update, rejection without mutation for invalid values, exact audit metadata, new-room application, tenant isolation, and existing-room immutability. Full PostgreSQL suite: **675/675** across 20 suites and both backup/restore checks; final focused API test: **1/1**. Lint/build, dependency audits, secret scan and diff check passed. Separately, read-only queries confirm both retained moderator cancellation fixtures already have cancelled reservations and matching success audit entries; no fixture was changed during this turn.

## Instance defaults owner-browser verification (2 November 2026)

An authenticated Chromium pass on a fresh PostgreSQL 17.11 container edited the room-capacity, per-player ticket-cap, auto-call interval and auto-call switch through the Super Admin instance page. Regular and Bumper were given distinct values; the persisted configuration and both `INSTANCE_UPDATE` audit rows matched. After reload the UI restored each value. New rooms inherited the matching instance defaults, while rooms created before the edits retained their original configuration. At 390 px and 1440 px the document had no horizontal overflow; browser page/console errors: **0**. The synthetic schema and dedicated container were removed; retained booking schemas and port 4000 were untouched. The browser harness is `.preflight/tools/instance-room-defaults-ui-durable-check.mjs`.

## Moderator route and identifier boundary matrix (2 November 2026)

Expanded the durable moderator isolation regression to cross real Regular, Bumper and Legacy room/player/reservation/session identifiers with mismatched instance paths. It exercises room detail and all five moderator room actions, player detail/removal, reservation read/cancel, session-to-room assignment, unknown identifiers and the assigned-instance directory. The test verifies denied operations leave foreign room states, player memberships, booking state, and reservation audit rows unchanged, with no FK audit failures. The four moderator-focused PostgreSQL test files passed **5/5** on a fresh PostgreSQL 17.11 container. That container was removed; no retained booking schema or port 4000 was used. Exhaustive Cartesian fuzzing across every path/query/body input remains open.

## Moderator account password change (2 November 2026)

- Focused moderator and booking-locale tests: **9/9 passed** against a fresh disposable PostgreSQL database. Coverage includes MFA gating, wrong-current-password refusal without revoking the active session, unchanged-password refusal, CSRF enforcement, successful session replacement, prior-session revocation, socket-ticket invalidation, and old/new credential behavior.
- Client ESLint and production Vite build passed. Disposable database container removed; retained booking fixture and port 4000 untouched.
- Authenticated Chromium verified the password-change success notice, replacement-session persistence after reload, and database state: new credential hash valid, old password invalid, one active session, and a success audit row. Responsive widths 360–1440 px had no horizontal overflow; browser errors: **0**. The isolated schema and container were removed; no reservation was created.

## Award claim proof during room recovery (2 November 2026)

- Recovery now re-evaluates stored award rows against the winner's durable tickets and the call prefix at the recorded award index, using the room's saved rules and prior award history. Ticket attribution must match the winning ticket set; unsupported awards fail closed.
- The regression now rejects a valid-looking early-five award recorded before completion. The durable finished-room standings test now earns early five through real calls and `controller.claim`, rather than constructing an impossible award directly.
- Focused persistence and ticket-integrity suites passed **42/42**. Full serial PostgreSQL suite passed **675/675**, 20 suites, no failures/skips/todos, migrations 001–021, including backup/restore. Client lint/build and secret scan passed. Disposable PostgreSQL 17.11 was removed; retained booking fixture and port 4000 were untouched.

### Seat-scoped award attribution refinement (2 November 2026)

- Recovery now rejects a seat-scoped award when its stored ticket list is only a subset of the tickets that satisfied the pattern. The new Half Sheet regression proves exact attribution and fail-closed behavior.
- Final full serial PostgreSQL suite passed **676/676**, 20 suites, no failures/skips/todos, migrations 001–021, including both backup/restore drills. The disposable PostgreSQL 17.11 container was removed; retained booking fixture and port 4000 were untouched.

## Public entry axe accessibility sweep (2 November 2026)

- Automated axe-core 4.14.0 scans found and fixed an undefined background token causing poor contrast on primary actions and decorative hall-ticket numbers, plus a brand-link accessible-name mismatch.
- Rebuilt Chromium scans covered directory, hall, scheduled sessions and booking at **390 px and 1440 px**: zero violations for WCAG 2 A/AA, WCAG 2.1 A/AA, WCAG 2.2 AA and best-practice tags. Some contrast checks remain incomplete for visual effects/backgrounds and need manual review; this does not constitute a whole-app WCAG audit.
- Client lint/build and secret scan passed. axe-core was installed only in ignored `.preflight/tools`; no product dependency changed.

## Owner-console accessibility sweep (2 November 2026)

- Authenticated Chromium plus axe-core 4.14.0 scanned all 12 owner sections at 390 px and 1440 px. Zero violations for WCAG 2/2.1 A/AA, WCAG 2.2 AA and best-practice tags; no unnamed visible controls, overflow, or browser errors. Manual review remains for contrast checks that axe marked incomplete; this is not complete assistive-technology or device coverage.
- Shared controls, scroll-table keyboard focus, color-picker targets and preview landmarks were corrected. Client lint/build passed. The temporary scanner stayed under ignored `.preflight`; disposable database removed.

## Moderator cancellation browser verification (2 November 2026)

- The retained synthetic fixture in `codex_moderator_cancel_ui_20261101` is cancelled, with `hold.create`, `hold.confirm`, and `hold.cancel` history and a successful `moderator.booking.cancel` platform audit. Authenticated Chromium confirmed the cancelled state/history with zero browser errors. The fixture had already been cancelled, so this verification performed no second write; records remain retained per policy.

## Moderator multi-identifier Cartesian denial matrix (2 November 2026)

- Crossed Regular/Bumper/Legacy/unknown tenant paths with real and unknown room, player, reservation and session IDs, plus room IDs supplied to session assignment. Covered room detail and lifecycle actions, player detail/removal, booking detail/cancellation, and session assignment.
- **237 denied combinations** and read-only authorized controls passed against disposable PostgreSQL 17.11. Durable assertions confirmed no player removal, reservation/cancellation audit change, session assignment or foreign room mutation. Focused test: **1/1 passed**; disposable container removed.
- Malformed-input parameter fuzzing and independent L3 review remain open; this matrix does not cover every possible HTTP body or identifier encoding.

## Moderator socket denial audit hardening (2 November 2026)

- Unknown but well-formed room IDs on moderator Socket.IO actions no longer cause the denial audit insert to violate the room FK. Audit rows retain the requested ID in metadata and use a nullable room reference.
- The durable regression covers all five socket room actions, verifies `NOT_ALLOWED` rather than `INTERNAL`, and checks five failure audit rows with no dangling reference. Moderator route/auth suites: **3/3 passed** across disposable PostgreSQL 17.11 databases; containers removed.

## Moderator malformed-ID and request-payload probes (2 November 2026)

- Added 28 durable probes across malformed instance, room, player, reservation and session IDs, including SQL-like and oversized values, plus invalid session-assignment `roomCode` formats and JSON types. Expected 400/404 responses were returned without internal errors.
- Existing durable assertions confirmed the probes did not change rooms, player memberships, reservations/audits or session assignments. Focused isolation test passed **1/1** on disposable PostgreSQL 17.11; container removed. Unicode/protocol-wide fuzzing remains open.

## Moderator Socket.IO malformed-payload matrix (2 November 2026)

- Tested six malformed payload shapes against all five moderator room actions (**30 cases**); every case returned `BAD_PAYLOAD`. The test config alone raised the socket budget so validation was exercised; runtime defaults are unchanged.
- Unknown well-formed room IDs continue to return `NOT_ALLOWED` with safe, FK-valid audit rows. Moderator suite: **2/2 passed** against disposable PostgreSQL 17.11; container removed.

## Live host/player gameplay axe scan (2 November 2026)

- Real in-memory host/player game flow scanned the live caller console and player game at 320, 390, 768 and 1440 px with axe-core 4.14.0: **8 samples, zero violations** for WCAG 2/2.1 A/AA, WCAG 2.2 AA and best-practice tags. No viewport overflow or browser errors; no persistent database or booking data was used.
- The scan found missing level-one headings. Localized screen-reader headings were added to both views; client lint and production build passed. Some ARIA and contrast checks remain axe-incomplete and need manual review. Harness: `.preflight/tools/live-game-axe-audit.mjs`.

## Live-game and final-results accessibility coverage (2 November 2026)

- A real in-memory browser flow scanned active host and player screens, then ended the round through the host confirmation UI and scanned the delivered final-results modal. **16/16 axe samples** passed WCAG 2/2.1 A/AA, WCAG 2.2 AA and best-practice tags at 320, 390, 768 and 1440 px for both roles/states.
- Focus remained inside both result dialogs at all widths. Overflow and browser errors: **0**. No persistent database or booking data was used. Some contrast/ARIA cases remain axe-incomplete for manual review; no physical-device or screen-reader certification is claimed.

## Full serial PostgreSQL regression closeout (2 November 2026)

- `node --env-file-if-exists=.env --test --test-concurrency=1 'tests/*.test.js'`: **676/676 passed**, 20 suites, no skips/todos/failures, migrations 001–021. Both backup/restore tests ran using `PG_CONTAINER` pointed at the same disposable PostgreSQL 17.11 instance; the initial unconfigured attempt exposed this required harness setting, and the corrected run passed. The disposable container was removed; retained booking port 55437 was untouched.

## Live-game ARIA follow-up (2 November 2026)

- axe incomplete-node review found two caller `aria-label`s attached to unroled `div`s. Added `role="timer"` to the elapsed clock and `role="group"` to the sealed next-call tile. Rebuilt axe scan reports no remaining ARIA-incomplete cases; only gradient-backed color contrast remains for manual review. Client lint/build pass; live/result scan: 16 samples, zero violations, zero browser errors/overflow.

## Security gate refresh (2 November 2026)

- Root and client dependency audits: **0 vulnerabilities**. Secret scan: **393 files**, two `.env` values and seven credential patterns inspected; passed.
- Combined with client lint/build, full PostgreSQL suite **676/676**, and live-game accessibility scan **16/16**, all scoped gates for this turn pass.

## Super Admin runtime health dashboard (2 November 2026)

- The authenticated overview now reports readiness, database status, current/pending migrations, instance-lease state, live/frozen rooms, scheduler timers/overdue state, database-pool occupancy/waiters/errors, uptime, and the existing local backup summary. `/api/admin/health` exposes the same owner-only bounded summary. It omits lease tokens, connection strings, passwords, and pool internals beyond counters.
- Focused owner/admin and health-signal suites: **31/31 passed**. Full serial suite on disposable PostgreSQL 17.11: **677/677 passed**, 20 suites, no skips/todos/failures, migrations 001–021, including both backup/restore checks. Client lint and production build passed.
- Authenticated Chromium visited all 12 owner sections at 390 and 1440 px. The health overview had **0 axe violations**, no unnamed controls, no overflow or browser errors; the only API write was the synthetic owner sign-in. The disposable schema `codex_owner_nav_97f760ce` was dropped. Screenshots: `.preflight/admin-health-overview-390.png` and `.preflight/admin-health-overview-1440.png`.
- Host-side alert delivery and thresholds remain unconfigured pending confirmation of the actual production account and plan. No production data, retained booking schema, or port 4000 was touched.

## Authenticated moderator accessibility pass (2 November 2026)

- Extended the durable moderator Chromium journey to scan invitation acceptance and confirmation, sign-in, MFA setup, the MFA-enrolled no-grant workspace, `room.read` details with identities restricted, and all granted rooms/players/bookings/history/reports/instance-settings views using axe-core 4.14.0 at 390 and 1440 px. **28/28 samples had zero violations**, no unnamed visible controls, and no overflow. Existing responsive checks also passed at 360, 390, 640, 768, 900, 1024 and 1440 px; unexpected browser errors: 0.
- The journey verified credential rotation/session replacement, explicit least-privilege grants, denial of cancellation without `bookings.manage`, and durable audit events. It created no reservation. Its isolated PostgreSQL schema was dropped; the retained booking schema was untouched. Harness: `.preflight/tools/moderator-invite-mfa-rbac-durable-check.mjs`; result: `.preflight/moderator-a11y-results.json`.
- Axe marks color contrast incomplete on a 390 px `span[aria-hidden="true"]` containing only a non-text menu glyph. It does not identify a text node or determine contrast for that glyph. The harness now asserts this is the sole incomplete finding; the scan reports no contrast violations. This does not certify physical-device or screen-reader behavior.

## Moderator cancellation fixture follow-up (2 November 2026)

- The already-retained synthetic reservation `295cb50a-df17-40d7-994f-16191d981248` was verified as cancelled in its isolated schema. It has ordered create, confirm and moderator-cancel history plus a successful `moderator.booking.cancel` audit event. The authenticated browser confirmed the cancelled state and history with zero runtime errors. Since it was already cancelled, this run was read-only and did not submit a duplicate action.

## Booking backup/restore content verification (2 November 2026)

- Strengthened the isolated PostgreSQL backup regression to keep the restore database temporarily, compare the complete restored confirmed-reservation fields (including token hash and lifecycle timestamps) and exact ordered reservation audit events/metadata with the source, and explicitly drop the restore database afterward.
- Focused booking suite: **3/3 passed**, 0 skips, including the strengthened backup/restore journey. It used a throwaway schema on the retained local PostgreSQL service; the fixture schema, restore database and scratch archive directory were cleaned. Existing retained booking records were not queried or changed by this test.

## Staged load harness call-stream isolation check (2 November 2026)

- The staged Socket.IO harness now compares every player's ordered `(index, number)` call stream with that room's authoritative host acknowledgements before reconnect. It reports stream mismatches and fails the run for cross-room, missing, unexpected or reordered call events.
- Memory-only run: `node scripts/loadtest.mjs staged --stages 2:6,3:9 --calls 4`. Both stages passed: **4/4** and **6/6** player streams matched exactly, zero stream mismatches or duplicate calls, all premature claims refused, all sampled reconnects passed, and all rooms were torn down. The server used an ephemeral loopback port; no database URL or retained reservation schema was used.
- This closes the harness's previously unimplemented cross-room fan-out assertion. It is a short functional check, not a long soak or production-capacity measurement.

## 50-room staged burst and heartbeat soak (2 November 2026)

- Ran `node scripts/loadtest.mjs staged --stages 50:250 --calls 15 --soak-ms 65000` in memory-only mode on the harness's ephemeral loopback server. It created no database schema and did not touch retained bookings or port 4000.
- All 50 rooms and 250 seats initialized; 750 calls were acknowledged, all **200/200 player call streams** matched their authoritative room sequence, duplicate/cross-room/missing events were **0**, all 50 premature full-house claims were refused, and **50/50** reconnects succeeded.
- During the 65-second idle hold, which spans multiple Socket.IO heartbeat intervals, **250/250** connected clients remained attached, with zero unexpected disconnects and all 50 rooms intact. The harness then closed every room successfully. p95 join/call-ack/call-fan-out latency was **25.6/12.6/12.6 ms**; peak RSS was **124.5 MB**; event-loop p99 was **35.6 ms**; CPU averaged **2% of one core** over the full 65.9-second run.
- This adds short in-memory heartbeat-soak evidence at the established 50-room/250-seat burst size. It does not replace a multi-hour soak, durable database load, handset profiling, or production-host measurement; capacity claims remain limited to existing documented durable evidence.

## Claim-decision and award recovery integrity (2 November 2026)

- `loadRoomBundle` now reads claim decisions alongside calls, tickets, and awards in its consistent snapshot. Recovery validates decision participant and call-index references; every persisted award must have exactly one matching `AWARDED` claim row and vice versa. Legitimate rejected attempts are preserved, including unknown-pattern attempts.
- Focused unit recovery/ticket-integrity command `node --test tests/recovery-integrity.test.js tests/ticket-integrity.test.js`: **20/20 passed**. Focused PostgreSQL command `node --test --test-concurrency=1 tests/persistence.test.js tests/pattern-durable.test.js`: **39/39 passed** on a fresh disposable PostgreSQL 17.11 database.
- Complete serial command `node --test --test-concurrency=1 "tests/*.test.js"`: **681/681 passed**, 20 suites, no failures/skips/todos, through migration 021, including both backup/restore checks. A fresh disposable database and container on loopback port 55438 were used; migrations were applied to its `public` schema for the restore test's configured driver. The container was removed. Retained booking records and port 4000 were untouched.

## Recovery lifecycle timestamp integrity (2 November 2026)

- Recovery now rejects a missing/invalid game start time, a completion time on a running game, a completed game without a completion time, or completion earlier than start. This ensures the restored round clock and room/game lifecycle cannot disagree silently.
- Focused recovery, persistence, and booking-recovery suites: **28/28 passed**, 0 skips. The suite exercised normal restart, completed-to-waiting history, failed booking-link recovery and repair, and the new timestamp corruption matrix on disposable schemas.

## Full serial regression after recovery and booking-restore hardening (2 November 2026)

- Fresh disposable PostgreSQL 17.11 migrated through 021; full serial suite: **678/678 passed** across 20 suites, 0 failures, skips or todos. This includes exact restored booking-content assertions and the new recovery lifecycle timestamp corruption cases.
- The disposable full-suite container was removed. The retained booking container on port 55437 is still running; no application server on port 4000 was used. `git diff --check` passed.

## Post-soak full-suite and local gate refresh (2 November 2026)

- After the completed 7,202.9-second durable socket/heartbeat soak, a fresh disposable PostgreSQL 17.11 database was migrated through migration 021 and the complete serial test log reports **681/681 passed**, 20 suites, no failures, skips, cancellations or todos. The disposable container was removed; retained booking schemas and port 4000 were not used.
- Current-worktree checks: client lint passed; Vite production build passed (172 modules, 210.12 KB initial JS / 69.65 KB gzip); the security probe passed **51/51**; secret scan inspected **396 files** and passed; root and client dependency audits each reported **0 vulnerabilities**.
- A volatile memory-only app on port 4177 was reviewed with Windows Narrator running. Browser accessibility output for the public landing, instance directory, host setup/waiting room, live caller console and live player view exposed named skip links/navigation, destination headings, room/call status, call controls, language/audio controls, ticket choices, patterns, chat and a labelled 1–90 board. Focus moved to the skip link and route destination headings. A volatile room and player were created only in memory; no PostgreSQL or retained reservation data was touched.
- This was an accessibility-tree and keyboard-focus inspection while Narrator was enabled, not an auditory assessment of the spoken output. Full screen-reader review, physical handset checks, manual gradient contrast review, independent external L3 review and production-host alert/configuration review remain open. No accessibility certification is claimed.
- The server and temporary browser tabs were shut down after review. The festival redesign remains queued because locally controllable accessibility and recovery review is not complete.

## Expanded recovery corruption matrix (2 November 2026)

- Added a table-driven recovery test covering 13 malformed cases: missing/unknown room, no active participant, missing or mismatched current game, unfinished/wrong lifecycle state, missing/short draw, call-number mismatch, non-contiguous call index, inactive recorded host, and a live round with no ticketed seat. Each case is rejected by `buildHydrationSource` with its expected integrity error.
- Focused `node --test tests/recovery-integrity.test.js`: **2/2 passed**. Fresh disposable PostgreSQL 17.11 full serial run through migration 021: **682/682 passed**, 20 suites, 0 failures/skips/cancellations/todos; both backup/restore checks passed. Numeric suite process exit code was 0 and the disposable container was removed.
- Other recovery paths not represented by this matrix (including engine-level draw-permutation checks and additional state corruption) still need review. This expands unit coverage; it does not close the broad recovery or accessibility gate.

## Persisted draw permutation recovery check (2 November 2026)

- Added engine hydration regressions for a 90-entry draw with a repeated number and a 90-entry draw containing 91. Both are refused by the room integrity guard as invalid permutations before the room is considered playable.
- Combined recovery and ticket-integrity tests passed **22/22**. A new fresh serial PostgreSQL 17.11 run through migration 021 passed **683/683**, 20 suites, 0 failures/skips/cancellations/todos, including both backup/restore checks; the captured suite exit code was 0 and the disposable container was removed.
- This closes the tested draw-permutation gap. Additional game/booking lifecycle corruption and manual assistive-technology review remain open.

## Durable recovery freeze for a corrupt draw (2 November 2026)

- The persistence integration suite now corrupts one JSONB draw element without changing array length, cold-recovers the room, and verifies recovery refuses to register it and durably records `rooms.recovery_error`. The first fixture attempt used PostgreSQL array indexing against JSONB and appended an extra item; the corrected JSONB path mutation exercises the intended repeated-number integrity branch.
- Focused persistence suite: **28/28 passed** on disposable PostgreSQL 17.11. The latest full serial run on a fresh disposable PostgreSQL 17.11 database, migrations through 021: **684/684 passed**, 20 suites, 0 failures/skips/cancellations/todos; both backup/restore checks passed and suite exit code was 0. The test container was removed.
- This verifies the durable fail-closed path for a corrupt draw. Full manual screen-reader review, physical-device coverage, further recovery corruption cases, external security review and target-host readiness remain open.

## Recovery isolation across healthy and corrupt rooms (2 November 2026)

- Added a durable mixed-room restart case with two running games: one has a same-length JSONB draw corrupted to repeat a number, and one remains valid. Cold recovery freezes and durably marks only the corrupt room, leaves its scheduler disarmed, recovers the healthy room, and invokes the scheduler hook for that healthy room.
- Focused persistence suite passed **29/29** on disposable PostgreSQL 17.11. Full serial suite after the change passed **685/685**, 20 suites, through migration 021, with no failures/skips/cancellations/todos; both backup/restore checks passed and the captured exit code was 0. The disposable container was removed.
- This verifies per-room fault isolation in recovery. Other lifecycle combinations, audible screen-reader behavior, handset checks, manual gradient contrast, external L3 review and target-host checks remain open.

## Durable load rollback attribution (2 November 2026)

- The staged-load database profiler now captures application transaction failures as `(error code, call site, committed flag)` without logging SQL text, values or connection details, alongside PostgreSQL's rollback counter. This will distinguish application transaction errors from unattributed database counter changes in future long soaks.
- `node --check scripts/loadtest.mjs` and memory-only staged fan-out checks passed. A short durable 50-room/250-seat run with 15 calls and a one-second heartbeat hold passed: **250/250** joins, **750/750** call acknowledgements, zero duplicate calls, stream mismatches, claim awards, failed reconnects, disconnects, pool errors, transaction rollbacks or captured application transaction failures. Call ack p99 was **52.1 ms**; fan-out p99 **52.2 ms**; pool use peaked at 8/8 with 42 waiters. The disposable PostgreSQL 17.11 container and per-run schema were removed.
- This short run did not reproduce the single rollback from the 7,202.9-second soak, so its cause remains unknown. The earlier harness output-level PASS and missing numeric exit code caveat are unchanged.

## Moderator workspace permission matrix (2 November 2026)

- Extracted moderator workspace tab rules into a pure client permission model and added a matrix test against the server's canonical 16 permissions. The test evaluates all **65,536** grant combinations, including deterministic tab order/default selection and non-tab grants; it passed. Client lint and production build passed.
- The complete serial PostgreSQL suite passed **686/686** across 20 suites, with no failures, skips, cancellations or todos, after running against a disposable PostgreSQL 17 database migrated through 021. Backup and restore checks used `pg_dump`/`pg_restore` from that same temporary container. The container was removed afterward; the retained booking container on 55437 and port 4000 were untouched.

## Durable soak supervisor exit-code and ownership hardening (2 November 2026)

- The two-hour rerun's log says `RESULT: PASS`, but its supervisor status had `exitCode: null` and labelled the run failed. The supervisor now runs Node through a small child wrapper that writes the numeric child exit and signal to an atomic per-run sidecar, records the wrapper code separately, and requires both codes to be zero plus the exact staged `RESULT: PASS` line before reporting completion.
- Cleanup is now conditional on this invocation having successfully created the named PostgreSQL container. A collision check with a pre-existing stopped container confirmed the runner refused it and preserved it; the synthetic sentinel was then removed by the verification command.
- A real supervised 50-room/250-seat durable check with a 5-second heartbeat hold passed: **250/250** joins, **750/750** call acknowledgements, **200/200** player streams in sync, **50/50** reconnects, 0 unexpected disconnects, 0 duplicate calls, 0 stream mismatches, 0 rollbacks and 0 application transaction failures. The sidecar and status both recorded exit code 0; exact `RESULT: PASS` matched; the temporary container was cleaned. This validates the supervisor path, not a replacement multi-hour soak. The historical two-hour run's OS exit code remains unavailable until a full soak is rerun.
- Child exit propagation tests passed **2/2** for exit codes 0 and 7. Full PostgreSQL suite after adding them: **688/688**, 20 suites, no failures or skips; security probe **51/51**; root and client dependency audits report 0 vulnerabilities; secret scan passed.

## Schema-scoped deployment lease and runbook correction (2 November 2026)

- Corrected operational documentation to match implementation: the advisory lease is keyed by `DB_SCHEMA`, so one process is allowed per database/schema pair. Independent schema-isolated deployments may share one PostgreSQL database and its capacity; product tenants such as Regular and Bumper remain in the same application schema/process. Migration guidance now reflects the current checked-in chain through 021.
- Added a durable integration case proving two schemas in the same database can hold separate leases concurrently while a second lease for the same schema is rejected. Persistence suite: **26/26 passed**.
- Fresh disposable PostgreSQL 17.11 migrated through 021; complete serial suite: **679/679 passed** across 20 suites, no failures/skips/todos. The container was removed; the retained booking container on port 55437 remains the only running PostgreSQL test container. No app on port 4000 was touched. `git diff --check` passed.

## Owner-console accessibility follow-up (2 November 2026)

- Added `role="group"` to the labeled overview-statistics and theme-preview regions, resolving axe's `aria-prohibited-attr` incomplete findings for those containers. Client lint and production build passed.
- Authenticated Chromium visited all 12 owner sections at 390 and 1440 px: **24/24 samples, zero axe violations**, no unnamed visible controls, no horizontal overflow, and no browser or console errors. The only API write was the synthetic owner's sign-in; the disposable schema was dropped.
- Axe still reports `color-contrast` as incomplete on gradient-backed page elements, where it cannot determine the rendered background. No contrast pass is claimed. Detailed output: `.preflight/owner-live-nav-results.json`.

## Live player keyboard navigation and lazy-route focus (2 November 2026)

- Fixed a focus race during lazy player-game navigation. The route focus manager records the interaction count and active element when the History API changes routes; if the player uses the keyboard or pointer while the lazy game chunk loads, the later route observer does not move focus unexpectedly. Navigation without intervening interaction still focuses the destination heading.
- The socket-backed in-memory Chromium journey delays both PlayerGame and GameScreen chunks by 400 ms. At 390×844 it selects two tickets with the ticket-count radiogroup's ArrowRight key, navigates between the issued ticket tabs with ArrowRight, tabs to the active ticket panel, and submits an eligible Early Five claim with Enter. The authoritative award appears in the player UI. **Three consecutive runs passed**; each had zero horizontal overflow and browser errors. The room/app were memory-only and discarded on shutdown.
- The existing public skip-link and route-focus browser check passed against a separate memory-only app on port 4175: public, moderator and all owner routes retained heading focus; public routes retained skip-link-first order; there were zero browser errors or API mutations. The temporary app was stopped. Port 4000 and all databases were untouched.
- Client lint and production build pass. Repeatable keyboard harness: `.preflight/tools/player-keyboard-live-check.mjs`.

## Branding continuity and durable soak status (2 November 2026)

Branding metadata and install-manifest tests pass 8/8; lint and custom/default production builds pass. The first supervised two-hour durable run correctly recorded a failure: all 250 clients disconnected during the final heartbeat hold. Windows Modern Standby overlapped the run, so this is not accepted as a product-only diagnosis or a pass. A guarded rerun started on isolated PostgreSQL 17.11 at loopback port 55440, but the local runner session ended after about 90 seconds; Docker showed its task-owned container exited with code 255. The stopped container was removed after checking its exact name, and the status was marked `interrupted`; no test result or exit-code claim is accepted. No long-running test is active now. The temporary system-required guard changes no saved power-plan setting.
## Unicode identifier boundary hardening and durable soak correction (2 November 2026)

- Extending the moderator identifier corpus with encoded NUL uncovered an actual 500: PostgreSQL text/JSONB rejected an unsafe path identifier before the denial could complete. Shared `isSafePathIdentifier` validation now rejects control characters, Unicode lookalikes and separators before any path ID reaches a query; denial audit stores only sanitized attempted IDs and parameterizes database references only for valid ASCII identifiers. Moderator player detail/removal paths are validated before their SQL queries.
- The expanded durable tenant-isolation test passed **1/1** on disposable PostgreSQL 17.11, including full-width digits, zero-width characters, combining Unicode, encoded separators/NUL and hostile body values. The full serial PostgreSQL suite passed **694/694** across 20 suites, migrations through 021, no failures/skips/todos. The disposable database container was removed. Client lint and production build pass; security probe **51/51**; secret scan inspected 401 files and passed.
- The supervised two-hour 50-room/250-seat run completed its 7,200,000 ms hold but correctly failed: joins **250/250**, call acks **750/750**, stream sync **200/200**, reconnects **50/50**, 0 transaction rollbacks/failures and 0 call mismatches; however, **250/250** clients disconnected during the idle hold. Child and wrapper both exited 1 and the runner cleaned its own container. The captured log did not record disconnect reasons.
- Windows System events show Modern Standby from **17:25:23 to 17:34:51** during the soak, overlapping the heartbeat measurement. The run cannot be counted as a pass. The supervisor now holds a temporary per-process system-required execution request (no saved power-plan changes) and releases it in `finally`; it passed a supervised five-second durable check with both exit codes 0 and owned-container cleanup. The load harness also records disconnect reason counts for the next run. A fresh two-hour rerun is still required.

## Audit closeout — current verification state (2 November 2026)

The latest current-worktree full test command was `npm test` on a fresh disposable PostgreSQL 17.11 container migrated through 021: **694/694 pass**, 20 suites, 0 failures/skips/cancellations/todos, duration **11,116.6 ms**. It includes the encoded-NUL moderator denial fix and the safe path identifier unit test. The fresh container was removed. Focused `node --env-file-if-exists=.env --test tests/moderator-instance-id-isolation.test.js` passed **1/1** in **3,157.2 ms**. Client lint and production build passed; `npm run security-probe` passed **51/51**; `npm run secret-scan` passed after checking **401 files**. Root and client dependency audits were last recorded at 0 vulnerabilities in an earlier same-day check and were not rerun as part of this closeout. The memory-only/durable `npm run e2e` evidence below is historical and was not rerun in this closeout.

The 50-room/250-seat supervised two-hour run is **not passed**: its 7,200,000 ms idle hold finished but 250/250 clients had disconnected. It reported 250/250 joins, 750/750 calls, 200/200 synchronized player streams, 50/50 reconnects, no duplicate calls or stream mismatches, no DB rollback/deadlock or profiled transaction failures; child and wrapper both exited 1 and the runner cleaned its container. A later guarded rerun was interrupted after approximately 90 seconds when the local runner session ended and its container exited 255. No current soak is active. Do not describe either run as a successful long soak.

## Festival art and full-bleed frontend checkpoint (2 November 2026)

- Client lint passed; the Vite production build passed with 183 modules (main JS 245.97 KB / 80.92 KB gzip). No backend, database, reservation, or game-authority code was changed in this visual slice.
- `node .preflight/tools/festival-platform-visual-check.mjs` passed the landing, game discovery/hall, theme store, booking fixture, host, player, admin sign-in and Super Admin sign-in at 360/390/768/1024/1440 px. It checked that the hero fills the viewport with no border/radius, 12 landing sections, Play Now/FAQ interactions, distinct Diwali/Holi hero scenes, no document overflow, and zero browser errors. Booking/discovery responses were read-only fixtures.
- `node .preflight/tools/theme-art-browser-check.mjs` passed 22 distinct theme motifs and modal initial focus, Tab/Shift+Tab wrap, Escape close and focus restoration at five viewport sizes; zero browser errors or persistent mutations.
- `FESTIVAL_VISUAL_THEME=holi-colours node .preflight/tools/festival-live-game-capture.mjs` passed a memory-only room, one official call, voice sample interruption without overlap, and caller/player captures at five viewport sizes. No audible output or database write was produced by the synthetic fixture.
- Screenshots: landing `.preflight/festival-landing-{360,390,768,1024,1440}-expanded.png`; theme store `.preflight/theme-store-{360,390,768,1024,1440}-fullbleed.png`; Holi caller/player `.preflight/festival-{caller,player}-holi-colours-{360,390,768,1024,1440}.png`. Holi, Navratri, Eid and Christmas original environment art was generated and optimized locally; together with the existing Diwali scene, this yields five environment scenes, not a complete 22-theme art set. Asset provenance/release-review notes are in `docs/FESTIVAL-ASSET-REGISTER.md`.
- This is a focused frontend checkpoint, not completion of the redesign or the release gate. Admin/moderator route review, full booking/game-result visuals, complete theme packages, Hindi editorial/audio, broad accessibility and performance review remain open. The prior two-hour soak failure is unchanged. No deployment, purchase, commit or push occurred.

## Durga Puja and Halloween environment integration (2 November 2026)

- Added locally bundled original Durga Puja pandal and family-friendly Halloween haveli scenes and mapped each to its runtime theme, landing lookbook art and public theme preview. The optimized WebP files are about 241 KB and 238 KB; generated PNG sources remain under `.preflight/assets/` and are not shipped. Owner commercial/legal release review is still pending.
- Client lint passed and the production build passed (183 modules). The 5-width landing/cross-route visual check passed and asserts the full-bleed hero selects the correct assets for Diwali, Holi, Durga Puja and Halloween. The theme-art browser check passed with **22/22 unique motifs**, seven environment images fetched successfully, full-atmosphere theme preview behavior, modal keyboard focus/return, five responsive sizes, zero browser errors, and zero mutations.
- This is still a partial art expansion: only **7 of 22** named themes have scene environments, and other screen-specific package art and product-wide route review remain. No database or booking record was accessed or changed.

## Ganesh Chaturthi and Onam environment integration (2 November 2026)

- Added original Ganesh Chaturthi mandap and Onam pookalam courtyard artwork to full-page runtime theme switching, theme-store previews, and the landing festival lookbook. Optimized WebP payloads are ~329 KB and ~337 KB; original generated PNGs are retained under `.preflight/assets/` and are not part of the public build. Commercial/legal release review remains due.
- Client lint and Vite build passed (183 modules). The landing/cross-route fixture passed at 360/390/768/1024/1440 px and confirmed both page-canvas assets across discovery, hall, booking fixture, theme store, host, player, admin and Super Admin routes. The theme-art fixture fetched all nine current original scenes, verified 22 unique motifs, keyboard modal focus/return, zero browser errors, and zero persistent writes.
- Current theme environment coverage is **9/22**, not complete. Full art packages, additional route review, Hindi review/audio, accessibility/performance and final release verification remain open. `git -c core.whitespace=cr-at-eol diff --check` passed; plain `git diff --check` reports CRLF line-ending noise across the large pre-existing worktree.

## Pongal and New Year environment integration (2 November 2026)

- Added and optimized original Pongal harvest-courtyard and New Year fireworks-terrace art. Both are included in full-page runtime backgrounds and theme-store package previews; Pongal is also in the landing lookbook. The optimized WebP payloads are ~335 KB and ~316 KB, with generated PNG sources retained outside the public build under `.preflight/assets/`.
- Client lint/build passed (183 modules). The refreshed cross-route browser check passed all five widths with no overflow/errors and verifies eight festival canvas selections on the landing, discovery, hall, booking fixture, theme store, host, player, admin sign-in and Super Admin sign-in. Theme art preview passed for 22 motifs and all **11/11** original environment assets, with keyboard focus behavior, zero browser errors and zero writes.
- Visual environment coverage remains **11/22**; full theme packages and product-wide route/accessibility/performance review remain open. No database, production data, deployment, purchase, commit or push was changed.

## 2 November 2026 — full-viewport atmosphere follow-up

- Client lint passed. Client Vite production build passed with 183 modules.
- `git -c core.whitespace=cr-at-eol diff --check` passed.
- Read-only IAB review confirmed full-viewport courtyard artwork behind host setup (390×844 and 1440×900), landing hero (1440×900) and owner sign-in (1440×900), with no horizontal overflow at the inspected layouts. Existing route fixtures remain the source for data-driven player/caller/workspace captures.
- Live local API was unavailable from the IAB: the player/host route showed reconnecting; owner availability returned HTTP 500. No sign-in, fixture creation, database write, or game action was attempted.
- This is a focused CSS/layout verification only. Full route-by-route visual, accessibility, performance and release checks remain open; see `design-qa.md` and `docs/MASTER-BUILD-IMPLEMENTATION-TRACKER.md`.

## Ticket-catalog and live-call presentation correction (3 November 2026)

- `npm run lint --prefix client`: **passed**.
- `npm run build --prefix client`: **passed**, Vite 6.4.5, 183 modules.
- `node --test tests/ticket-view.test.js tests/ticket-integrity.test.js tests/ticket-inventory-engine.test.js tests/theme-runtime.test.js tests/caller-console.test.js`: **69 passed, 0 failed, 0 skipped**.
- Real Chromium with disposable PostgreSQL 17 created/persisted separate 200-ticket public and authenticated Admin/Bumper catalogs, and captured full-page screens at 390, 430, 768, 1440 and 1920 CSS px. The browser assertion verifies the first paper title is exactly `TKT-0001` and no “Ticket NaN” appears. Browser report: zero page/console errors, failed HTTP responses, or horizontal overflow.
- Real server-authoritative one-call room flow: host created room, player joined, host started game and committed one official call. Host/player waiting and live screens plus caller controls captured at all five widths as full-page images; browser errors and failed responses were zero. These records were synthetic in disposable app/database state; no production data was accessed.
- Randomized visual QA schemas and the task-owned Postgres test container were removed after verification. No long regression/soak, external provider call, deployment, purchase, commit or push ran.
- This does not verify poster generation, claim/result flows, full accessibility/performance, or every route at full-page depth. Those gates remain open in `design-qa.md` and `docs/GAP-REPORT.md`.
# Prompt-driven Poster Studio focused verification (3 November 2026)

- `node --test tests/poster-image-provider.test.js tests/posters.test.js`, using disposable PostgreSQL 17 on `127.0.0.1:55439`: **9 passed, 0 failed, 0 skipped**. Covered input limits, no-key fail-closed behavior, server-only request shape, requested PNG dimensions, transient retry/provider errors, template publication, synthetic-provider persistence, instance isolation, real session timezone/availability/pattern points, revisions and explicit public publication.
- The integration uses a synthetic provider implementation; **no external OpenAI request** or generated image was used. OpenAI configuration is absent.
- `npm run lint --prefix client`: passed. `npm run build --prefix client`: passed (Vite 6.4.5, 184 modules).
- Additional `node --test tests/poster-image-provider.test.js tests/posters.test.js tests/bookings.test.js`: poster/provider tests passed; two booking tests passed; one backup/restore test failed because its harness expects a stopped preconfigured `tambola-pg` container. The relevant poster-only DB run passed cleanly afterward. No booking backup success is claimed.
- No browser capture, authenticated owner flow, real artwork quality review, or external social crawler test was performed. No long regression suite ran. Temporary poster database container was stopped and removed; existing port 55437 container remains untouched.

## Current-turn focused verification (3 November 2026)

- `npm run lint --prefix client` — passed.
- `npm run build --prefix client` — passed; Vite 6.4.5 transformed 184 modules.
- `node --test tests/poster-image-provider.test.js tests/posters.test.js tests/branding-metadata.test.js tests/platform-branding.test.js tests/theme-runtime.test.js tests/caller-console.test.js tests/ticket-view.test.js tests/ticket-integrity.test.js tests/ticket-inventory-engine.test.js` — 86 total; 84 passed, 0 failed, 2 skipped (DB-backed poster cases).
- This run did not perform full DB game lifecycle, security regression, screenshot/browser checks, or the full serial suite. Those gates remain open.

## Live runtime milestone verification (3 November 2026)

- Full serial suite using task-owned disposable PostgreSQL 17.11: **723 passed, 0 failed, 0 skipped**, 20 suites (~70 seconds). Included PostgreSQL backup/restore helpers using the task-owned DB container.
- `npm run lint --prefix client`: passed.
- `npm run build --prefix client`: passed (Vite 6.4.5, 184 modules; main JS about 247.57 KB / 81.48 KB gzip).
- `git -c core.whitespace=cr-at-eol diff --check`: passed.
- Browser: host creates waiting room; player joins; host starts; three server calls; player reload restores ticket/history; both roles captured at 390/430/768/1440/1920 in waiting and live states. No horizontal overflow, browser errors, HTTP errors or failed requests. Reduced motion and keyboard skip-link focus checked. Evidence `.preflight/live-runtime/current-results.json`.
- Browser claim/results: Early Five and Full House approved and visibly awarded; host completed round at 87 calls. Engine/controller durable E2E also passed all supported awards and rejected premature, fabricated-ticket and duplicate claims. Evidence `.preflight/live-runtime/claim-results.json`.
- No production DB, production credentials, external poster request, deploy, purchase, commit or push. The synthetic DB/container was removed. Earlier poster-focused suite details remain above; this current full test run is the milestone suite.

## Scheduled session time validation audit (7 November 2026)

- Focused timezone/form/service/scheduler command: **14 passed, 0 failed, 1 skipped** (the PostgreSQL-backed Regular/Bumper integration test).
- Final serialized test suite: **804 total; 721 passed, 0 failed, 83 skipped**. The test process had `DATABASE_URL` unset; skipped tests are PostgreSQL integration and migration cases, not passes.
- Client ESLint and Vite production build passed (210 modules).
- Security probe: **51/51 passed**. Root and client full `npm audit`: **0 vulnerabilities** each. Secret scan and `git -c core.whitespace=cr-at-eol diff --check` passed.
- Migration 035 was authored but not applied or PostgreSQL-validated. Docker Engine and local PostgreSQL client/service are absent. Chromium/browser QA is unavailable. Local production-policy config check is not a production config verification; production is NOT VERIFIABLE.
- See [`docs/SCHEDULED-SESSION-TIME-AUDIT.md`](docs/SCHEDULED-SESSION-TIME-AUDIT.md) for pipeline, root cause, behaviors and operator steps.

## Phase 2 session visibility and multiplayer admission verification (7 November 2026)

- Isolated PostgreSQL **17.11** was run on `127.0.0.1:55439`; schema-per-test migration harness applied the local migrations through **036**. No production database was used.
- Targeted database tests: booking holds/status/closed/cancelled listing, booked late admission, exact numbered ticket identity and grid, process reconnect, and Regular/Bumper timezone/publication idempotency all passed (**4 named tests**, plus the full DB-backed suite cases).
- Full serialized run: **827 total, 825 passed, 0 skipped, 2 failed**. Both failures are backup/restore integration checks that invoke Docker Desktop `tambola-pg`; the Linux Docker Engine named pipe is unavailable. The previous three non-backup failures found during the first parallel run were resolved (idempotent retry after publication and auto-start state consistency); the expiration test passed serialized.
- Isolated browser workflow: **4/4 passed** with Chromium and synthetic owner/player identities. Verified standalone room absent from session listing, draft hidden, published Regular/Bumper visible, future session visible as `not_open`, five separate player contexts booking distinct tickets from 200 generated Regular tickets, booking/player associations, and room entry. Current screenshots are listed in `docs/REGULAR-TAMBOLA-BROWSER-QA-REPORT.md`.
- Client lint and Vite production build passed (210 modules). Security probe **51/51**. Secret scan passed (760 files, including build output). Root and client `npm audit`: **0 vulnerabilities** each. CRLF-aware `git diff --check`: passed.
- Production configuration is **NOT VERIFIABLE**. No 250-seat stress test or room `SKGLEDXV` verification was performed. The exact reported “Room is full” wording was not returned by the isolated server; this turn reproduced and fixed the linked scheduled reservation’s separate `SESSION_UNAVAILABLE` start-state rejection. No deploy, purchase, commit, push, or production write.

## Admin-issued ticket serial continuity correction (7 November 2026)

- Fixed player ticket identity display: an official serial such as `TKT-0087` is shown on the ticket paper, tab, and award, while the stable local `ticket.no` remains the engine/claim/navigation key. Legacy tickets retain the existing numeric label.
- Confirmed booking seats now see a read-only assigned-ticket serial summary and do not see the shared room ticket ceiling as a selection control.
- Focused checks: 48/48 unit/engine/recovery-integrity tests passed; client lint passed; Vite production build passed (210 modules).
- Isolated Playwright workflow passed 1/1. It authenticated the synthetic QA owner, generated a 200-ticket Regular catalog, booked five distinct serials using five separate browser contexts, confirmed each reservation, joined the assigned room, and verified each actual ticket title/summary against the selected serial. Mobile screenshot: `artifacts/browser-qa/player-ticket-serial-mobile.png` (390 px).
- Current-turn defects caught and resolved during verification: existing browser selectors targeted outdated Admin form labels; the initial run used a stale prebuilt client bundle. The corrected test was run against the newly built bundle and passed.
- Four newest `browser_qa_*` schemas from this browser run were dropped manually after confirming the Windows test runner did not invoke its shutdown cleanup. The other 27 pre-existing random QA schemas were left untouched. Task-owned PG17 cluster stopped; the unrelated `main` 5432 cluster was untouched.
- No full regression suite was run. Durable database claim attribution is resolved through the exact game ticket relation and was unit-tested at engine/recovery mapping level; an actual DB-backed won claim/recovery was not run this turn. Multi-viewport route audit and production state remain unverified.
