# Changelog

What changed in this product, and what is still open. Dates are the dates the work
was verified, not the dates a feature was first sketched. Entries describe
behaviour a player or an operator can actually notice; internal file moves are only
mentioned where they explain a boundary.

Format is roughly [Keep a Changelog](https://keepachangelog.com/) with the
deliberate difference that each entry names the thing a reader would see, because
this file doubles as the handover note for a paid build.

## Phase 18 — the player's tickets and gameplay (31 October 2026)

Base commit `e5c6e99`. This slice changes what a PLAYER sees and can do: how
tickets are chosen and read, how a ticket marks itself, how claims name the ticket
that won, and what a phone actually shows. No winning rule changed, no ticket
format changed, nothing was deployed and no payment surface was added. Full
behaviour in [`docs/PLAYER-GAMEPLAY.md`](docs/PLAYER-GAMEPLAY.md); numbers in
[`TEST-REPORT.md`](TEST-REPORT.md) §11.

### Added

- **A real ticket experience** (`TicketRail`, `TambolaTicket`, `TicketCell`,
  `client/src/lib/ticketview.js`): the seat's tickets behind an ARIA tab rail
  (`tablist`/`tab`/`tabpanel`, roving tabindex, `Left/Right/Home/End`), one ticket
  at readable size, a `9/15` header, a per-row chip (`R1 3/5`) that turns gold the
  moment a line completes, a 3×9 ARIA grid whose every cell speaks its position
  and state, and the same component in the waiting room as in the round.
- **A picker that says where the ceiling is**: "4 of 4 selected · room maximum",
  a `+` that disables itself at the ceiling, every count as a real radio
  (`radiogroup`, arrow keys, `Home`/`End`), and the server's own refusal shown
  under the control when a host lowers the limit mid-wait.
- **Your result** (`YourResult.jsx`): after the round a seat sees its own points,
  its awards with the ticket number that won them, and the final standings —
  instead of a board that simply stops.
- **Ticket integrity on recovery** — `recovery.js` now runs the generator's own
  `validateTicket` over every persisted grid and refuses a room with a duplicate
  `(player, ticketNo)`; `integrityErrors()` does the same in memory. A hand-edited
  database row freezes the room (visible on `/healthz`) instead of being dealt.
- **Four new test files**: `ticket-integrity` (12), `ticket-properties` (20),
  `ticket-view` (18) and `ticket-play` (19) — generator invariants, a 20 000-ticket
  statistical sweep, persistence/recovery, the 1/2/3/max multi-ticket lifecycle,
  claim attribution, cross-room isolation and reconnect behaviour.

### Changed

- The waiting room previews **the tickets the seat will actually play**, not a
  decorative sample, and asks the server for the default count once on entry so
  the preview is real rather than empty.
- On a phone the ticket now sits directly under the count control and above the
  hall roster: the whole ticket, its tabs and its row chips fit in the first 844px
  of a 390px screen.
- Every touch target a player uses to play is 44px tall at every width — ticket
  tabs, count steppers, count radios and claim buttons — not only on phones.
- `--oh-text-faint` was raised from `#6b717e` to `#828997` after an automated
  audit measured 3.86:1 on the chip it painted. It is now 4.9:1 on a panel and
  5.4:1 on an inset chip.

### Fixed

- A refresh in the waiting room showed an empty preview area even though the seat
  held tickets (the server stores a count, not grids, until the round starts).
- The picker's live region kept repeating a confirmation sentence after a
  successful pick instead of announcing the new count.
- Claim buttons were 32px tall — under the 44px minimum — and ticket tabs were
  40px; both are now 44px.
- **GitHub CI was red on every run since the workflow was written** while all six
  local gates were green, because the suite ran before the environment it assumes
  existed: `npm test` ran before the client build (the smoke suite asks a live
  server for `client/dist`, and `/` answers 503 without it) and against a service
  database that had never been migrated (the backup suite dumps that database and
  asserts the manifest records its migration ledger, and an unmigrated database
  reports an empty one). `ci.yml` now migrates and builds before it tests, and
  `npm run verify` runs `lint → build → test → secret-scan` for the same reason.
  Both causes were reproduced against a scratch database before either line was
  changed; no assertion was relaxed and no test was skipped.

### Verified

`npm test` printed **516 tests / 516 pass / 0 fail** (18 suites); `npm run lint`
clean at `--max-warnings 0`; production build 132 modules, CSS 46.53 kB (gzip
9.75), JS 385.05 kB (gzip 116.07); `secret-scan` clean over 221 files;
`security-probe` **51 of 51**; `e2e` and `e2e:durable` each played a full game to
`COMPLETED` with valid, premature, invented and duplicate claims; the browser
harness held **78 of 78** checks with **0** console errors across 360, 390, 430,
768 and 1440 pixel viewports; the accessibility and call-cost audit held **35 of
35** (123 of 123 measurable text samples pass WCAG AA, 27/27 grid cells carry
direction, 0 long tasks, 4 tickets settle 9 ms at p95 against 14 ms for one);
and 12 durable calls wrote **2 rows each** with **0** ticket-row updates.

### Not done

Early Seven, Star, Middle Number, 1 2 3 / 143 and Pyramid are still not claimable:
no approved predicate exists for them. No physical phone was used — every mobile
figure is a Chromium viewport emulation, and the report says so where it matters.

## Phase 17 — the caller console (31 October 2026)

Base commit `108c6aa`. This slice changes what the HOST sees and how a host runs a
round. No winning rule changed, no player-facing screen was redesigned, nothing was
deployed and no payment surface was added. Full behaviour in
[`docs/CALLER-CONSOLE.md`](docs/CALLER-CONSOLE.md); numbers in
[`TEST-REPORT.md`](TEST-REPORT.md).

### Added

- **A dedicated caller console at `/host/game`** (`client/src/components/caller/`):
  the current number in the players' own ball, the previous number, a **sealed**
  next slot that carries only a count, the full 1–90 board, the whole call sheet
  with ordinals and NOW/PREV tags, the round's elapsed clock, the hall's roster
  (seated / capacity / connected / away / tickets / per-seat state) and the room
  chat. Three columns from 1180px, two from 820px, one scrolling column below
  760px with the draw bar pinned to the bottom edge.
- **`client/src/lib/caller.js`** — the console's whole view-model as pure
  functions: the action matrix, the sealed next-call preview, the call-sheet rows,
  the roster summary, the honest voice status, the hotkey map, the clock.
- **Keyboard**: `C` call, `P` pause/resume, `R` repeat — single keys, never chords,
  and never while the host is typing in chat or dragging a slider.
- **A voice panel per device**: English/Hindi, a listed voice, rate (0.75–1.5×),
  volume, chime, Voice on/off, **Repeat number**, a Retry after the engine stops,
  and a sentence for the case where this browser has no speech engine or no Hindi
  voice at all. Settings persist in `localStorage` and are clamped before use.
- **A round clock the server owns** — `startedAt`, `elapsedMs`, `endedAt` on every
  snapshot, advanced by one hook in the state machine, continuing across a process
  restart from `games.started_at`. The browser ticks locally only while `RUNNING`.
- **Three new test files** (39 tests) and a browser harness:
  `tests/caller-console.test.js`, `tests/caller-voice.test.js`,
  `tests/caller-realtime.test.js` (real sockets on an ephemeral port) and
  `.preflight/tools/p17-caller.mjs` (headless Chrome over CDP at 1440×900,
  820×1180, 390×844 and 360×740).
- **`docs/CALLER-CONSOLE.md`** — what every control may do, what it deliberately
  does not, and how each promise is verified.

### Changed

- **`client/src/components/HostControls.jsx` is deleted.** Its strip is fully
  superseded; there is now exactly one surface a host operates a room from.
- **A cadence change is visible room state**: `setAutoCall()` emits `game:state`,
  so players' read-outs no longer keep an old interval until the next call.
- **The interval control sends `{ intervalMs }` alone** — a pace change must not
  switch auto-calling off. While running, the next call is re-timed from now; while
  paused it applies on resume; an invalid value is refused and the pace is kept.
- **Speech settings widened**: `announce.js` now stores voice, rate and volume, and
  a saved voice is honoured only if the browser still lists it *and* it matches the
  spoken language, falling back with a sentence that says so.
- **The mobile console reserves room for its pinned bar**, so the draw controls and
  the voice panel are never hidden behind it at 390px or 360px.

### Fixed

- **A host who refreshes mid-round no longer wonders what happened**: the round is
  restored on the same route with its call sheet intact. Because the host socket
  dropped, the room pauses (an unreachable owner is not a gone owner) and the
  console says `PAUSED` until the host resumes — verified in the browser pass.
- **A second host tab cannot double-drive a room**: resuming the host session there
  moves live control, and the old tab receives `NOT_HOST` on every intent while
  still being able to read the room.
- **The console no longer promises a next call after the round ends** — the voice
  line and the sealed slot both read "round complete".
- **`utter` construction is guarded**: a browser that throws on
  `new SpeechSynthesisUtterance` degrades to "failed" instead of breaking the
  announcement queue.

### Verified

- `npm test`: **447 of 447**, `skipped 0`, 12.6 s.
- `npm run verify`: tests + lint (0 warnings) + build + secret scan, all clean.
- `npm run security-probe`: **51 of 51**.
- `npm run e2e` and `npm run e2e:durable`: a full round to `COMPLETED` on both
  stacks, with valid and refused claims.
- `node .preflight/tools/p17-caller.mjs`: console, 90 tiles, three manual calls,
  keyboard focus outlines, the `C` hotkey, pause (clock equal twice), resume,
  cadence change to 5s, the voice panel, tablet/390/360 layouts with no horizontal
  overflow, a reload during a live round, resume after it, and the two-click end of
  the round — **0 page errors**.

## Phase 16B — deployment readiness and free-infrastructure research (31 October 2026)

Base commit `0a4de55`. This slice adds no gameplay feature and changes no winning
rule: it makes the build deployable, proves it under durable load, and writes down
exactly which free infrastructure is genuinely free. Full evidence in
[`docs/PHASE-16B-REPORT.md`](docs/PHASE-16B-REPORT.md) and
[`TEST-REPORT.md`](TEST-REPORT.md).

### Added

- **`npm run env:check`** — the production environment gate. It reads the same
  environment the server reads and exits non-zero on a missing or unparseable
  `DATABASE_URL`, a default database password, a remote database without
  TLS verification, `ALLOW_MEMORY_ONLY=1`, a missing/non-https `PUBLIC_ORIGIN`,
  `TRUST_PROXY` off, insecure cookies, a malformed `OWNER_MFA_KEY`, or
  `DB_POOL_MAX` above the ceiling. It prints no values.
- **`npm run smoke`** — proves a running deployment instead of a build: `/livez`,
  `/readyz` (refusing a memory-mode server), `/healthz` (requiring current
  migrations), the SPA, a real Socket.IO handshake, and with `--full` one complete
  round in a room of its own.
- **`/healthz` now reports the calling clock and the pool**: `scheduler { armed,
  nextDueInMs, overdue, ticking }` and `pool { total, idle, waiting, max, errors }`.
  A stopped clock and an empty database finally look different from outside.
- **Continuous integration** (`.github/workflows/ci.yml`): a PostgreSQL service,
  the full suite, lint, build, secret scan, security probe, both end-to-end games,
  backup + restore check with the archive as an artifact, a self-test that the
  environment gate actually fails on an unsafe environment, and an image build
  whose `/livez` is curled.
- **Scheduled uptime probes** (`.github/workflows/uptime.yml`): every 20 minutes,
  open an issue when `/readyz` or `/healthz` is not 200, close it on recovery. With
  no `DEPLOY_URL` secret the job exits green and says so.
- **A database profiler in `scripts/loadtest.mjs`**: transaction duration
  percentiles, `pg_stat_activity` sampling, `pg_stat_database`, `pg_stat_wal` and
  `max_connections`, so a queue can be attributed to the pool or to the database.
- **Early Seven as a proposal** (`server/game/proposed-patterns.js`): an exact
  definition, six fixtures and a completion-ordinal contract, deliberately not
  registered, so no game can award it before a client approves the points value.
  Star, Middle Number, 143 and Pyramid remain unimplemented, each with the written
  blocker that stops them.
- **New papers**: `docs/FREE-INFRASTRUCTURE-RESEARCH.md` (every free-tier claim
  checked against the provider's own page), `docs/DEPLOYMENT-READINESS.md` (gate,
  smoke, rollback, pool sizing, approvals), `docs/CLIENT-SIGNOFF.md` (the eighteen
  decisions that need the client, on one page), and §10 of
  `docs/CLIENT-REQUIREMENTS.md`, which resolves all 38 inputs with the default that
  stands and its consequence.

### Changed

- `npm run env:check` loads `.env` exactly as `npm start` does, so the gate sees
  the configuration that will actually run.
- `nodemon` moved from `dependencies` to `devDependencies`: it is a development
  runner, and the production image no longer installs it.
- `.env.example` documents `DB_POOL_MAX` and `DB_POOL_ACQUIRE_TIMEOUT_MS` and
  points at the gate and the smoke test.
- `server/RUNBOOK.md` §5 carries the Phase 16B measurement, including what the
  database reported while the connection pool was 42 deep.

### Fixed

- **The secret scanner caught the new environment-gate test.** Its fixture
  contained a fully-formed credential URL, which is exactly what the scanner is for.
  Fixed by interpolating the fake password instead of teaching the scanner to ignore
  the file: the shape stays flagged for everyone else.

### Security

- **L3 deep security review** run against the committed tree before the push, per the
  repository's pre-push gate: `{"layer":"l3","findings_count":0,"findings":[]}`. A
  clean review of one commit range is not a penetration test; the remaining gap is an
  independent review, recorded in `docs/GAP-REPORT.md`.
- `socket.io`, `ws`, `engine.io` and `socket.io-parser` updated within their    
  majors to clear the reported denial-of-service advisories. Production dependency
  audit is now **0 vulnerabilities** at the repository root.
- The client's production audit still reports **2 moderate advisories in
  `react-router-dom` 6.x**, whose fix is the 7.x major. Not taken in this phase: the
  advisories concern SSR hydration and a `deserializeErrors` path this
  client-rendered app does not use. Recorded as an open item in
  `docs/GAP-REPORT.md`, not silently accepted.

## Unreleased — the client-ready build (30–31 October 2026)

Release notes for the whole of this build are in [`TEST-REPORT.md`](TEST-REPORT.md):
383 automated tests with none skipped, two complete games through the real engine
(one against live Postgres) with their exact winning sequences, a backup-and-restore
round trip, a secret scan of the shipped bundle, and the browser observations that
do and do not back each change.

### Added

- **Up to four tickets per seat.** A player picks 1–4 (the room's ceiling comes from
  the server), sees the exact sheets the server dealt before the round starts, and
  claims against a named ticket. New migration `004_multi_ticket.sql`.
- **Celebrations that can only come from the server.** A pattern win or the final
  result raises an overlay built from the verified `claim:result` / `game:completed`
  events, once per event, and a refresh does not replay the past.
- **Quick chat in English and Hindi**, on the same documented `chat:send` path as
  typed messages, so it inherits the same rate limit, room isolation and validation.
  The catalogue lives in `client/src/i18n/messages.js`; nothing is hard-coded in a
  component.
- **Spoken calls that follow the board instead of tripping over it.** The `VOICE`
  chip makes the browser read each official call aloud — one at a time, in call
  order, never overlapping, never cancelling an utterance mid-flight — in English
  or Hindi (`EN` / `हिं` number words), with the chime riding on its own utterance
  so sound and voice stay together. The voice may trail the board by at most two
  numbers and a lag dot says when it does; if the browser's speech engine stalls
  or Chrome's autoplay policy refuses, a watchdog releases the queue, the chip
  becomes a one-tap `RETRY`, and a reload never re-reads the history. Speech and
  chime are separate opt-ins that persist per device, and win sounds use the same
  chime switch — no new autoplay surface. `client/src/lib/announce-queue.js` and
  `number-words.js`; browser evidence: seven scenarios with zero overlapping
  utterances, zero duplicates and order preserved (31 October, Phase B).
- **Chat keeps a short tail.** A seat that joins while the room is already talking
  asks `chat:history` and sees what it missed (last `CHAT_HISTORY = 24` messages,
  in memory only, never in a snapshot, never written to the database).
- **A client configuration layer** (`client/src/config.js` + documented `VITE_*`
  build vars): product name, tagline, logo, brand mark, accent colours, footer
  notice, legal links, default language, bilingual picker. Display only — gameplay
  rules and limits stay server-authoritative — and every switch is read by the UI.
- **A per-tab seat credential** (`client/src/lib/seatStore.js`, session storage with
  a device-level recovery copy), so several tabs in one browser are several players
  and a dropped connection re-claims its own seat rather than somebody else's.
- **Honest refusals.** `client/src/lib/refusals.js` turns the server's refusal codes
  into sentences a player can act on — the server's own reason when it has one
  ("Not this time - line incomplete", "no ticket number 4 belongs to you") and a
  plain sentence when it does not, rather than a toast that says `INVALID_STATE`.
- **Second-click confirmation for End game and Reset**, replacing native dialogs:
  the control re-labels, the panel says what is lost, and the arm clears on Cancel,
  on expiry, or as soon as the server reports a different state.
- **Scripts that make the product checkable:** `npm run e2e` and `npm run e2e:durable`
  (a full game to a COMPLETED state, including three claims that must never score),
  `npm run secret-scan` (shipped content *and* the built bundle),
  `npm run security-probe` (51 live checks of the HTTP and socket surface against
  two in-process instances),
  `scripts/loadtest.mjs` (the staged capacity run quoted in the runbook), and
  `npm run verify` to run test + lint + build + secret-scan as one gate.

### Changed

- **A seat that joins mid-round is now told it is watching.** The server has always
  locked ticket selection at the start, so a late joiner holds no tickets; the screen
  used to draw a fabricated empty grid headed `…'S TICKET 0/15 MARKED` next to claim
  buttons the server would refuse. It now says `Watching this round / You joined
  mid-game`, draws no ticket, and disables the claim controls with the reason.
- **A new tab is asked before it takes a remembered seat.** It used to resume the
  last seat written to the device silently, which made two tabs collapse into one
  player. It now offers that seat with its name and room code and waits.
- **The host's primary control follows the round.** `Start game` while the room is
  waiting — including the waiting state a Reset returns to, where there was
  previously no way to start again without leaving the screen — and `Call next`
  once numbers are being drawn.
- **State-bound wording.** The claim panel says `this round is finished` instead of
  promising `claims open while running` after the last call; the roster says
  `3 seated` before a round and `3 playing` during one.
- **Production logging and managed-database TLS** were corrected on the path to this
  build (see the 28 October commits below).

### Fixed

- **Response-surface fixes found by the live security probe.** An
  allow-listed `Origin` is now echoed as itself in `Access-Control-Allow-Origin`
  instead of the word `true` (the plain-HTTP allow-list silently worked for no
  browser); responses no longer advertise Express with `X-Powered-By`; `/livez`
  answers liveness only and no longer hands out uptime; and a request that
  declares a body and then stalls is answered `408 REQUEST_TIMEOUT` after
  `HTTP_REQUEST_TIMEOUT_MS` (default 30 s) instead of parking a parser socket —
  Node's own request timeout does not fire once a body has started.
- Backup scoping and `db:restore-check` diagnostics: the check now reports the
  ledger, table inventory, row counts and the call-log-vs-draw sequence instead of
  failing opaquely, and the dump is written outside the live data directory.
- A host tab visiting the player join page was bounced into a player lobby by the
  new seat logic; a host seat is never auto-resumed there.

## Phase 16 — release review and client papers (31 October 2026, `2063f0b`)

- **Pushed to GitHub.** `b62bdd9..2063f0b main -> main` on
  `github.com/lakhyach/Tambola`; the remote and local `main` both resolve to
  `2063f0b6ec217f74cdb6fcd3a29b14af9d7b54ad`. Nothing was deployed, no production
  database was connected to, and no provider account or paid resource was created.
- **Every gate re-run on the committed tree, not remembered:** `npm run verify`
  (383/383, lint, build, secret scan) exit 0, `npm run security-probe` 51/51,
  `npm run e2e` and `npm run e2e:durable` both COMPLETED, `npm run db:backup` plus
  `db:restore-check` PASSED (18 tables, 10 498 rows).
- **The market research was re-checked against the live sources** rather than
  trusted from the previous note: all four full sources re-read, every competitor
  claim still present. Three dimensions the first pass lacked — number-calling
  conventions, mobile gameplay conventions, administrative capability — are now
  sections 3a–3c of the benchmark, with §4a as the rules decision matrix.
- **The five deferred patterns are written down, not just deferred:**
  `docs/RULES-DECISIONS.md` states what each pattern means, what the market
  publishes about it, why the old marked-count check was wrong, how it would be
  validated, and whether it can change who wins. The engine is untouched.
- **Client-facing papers added:** the benchmark (`docs/MARKET-BENCHMARK.md`), the
  rules decisions, the inputs still needed (`docs/CLIENT-REQUIREMENTS.md`), the
  hosting architectures and their monthly cost (`docs/HOSTING-OPTIONS.md`) and the
  ranked gap report (`docs/GAP-REPORT.md`).

## 28 October 2026 — production hardening (`d54c98d` … `b62bdd9`)

- Server-authoritative engine with durable-before-authoritative writes, boot-time
  recovery of live rooms from the database, and a single-instance advisory lease
  that makes a second scheduler fail closed rather than double-call numbers.
- Owner control centre at `/admin`: accounts, MFA, audit trail, operator actions.
- Strict socket contract (`server/net/CONTRACT.md`) with payload validation, a
  deny list for the legacy events the old client used, per-player rate limits and
  room isolation.
- Docker image and `docker-compose.yml`, health endpoints (`/livez`, `/readyz`,
  `/healthz`), graceful drain on SIGTERM, `db:backup` / `db:restore-check`.
- Hosting guidance for Render / Fly.io / Railway and managed Postgres, including
  why serverless is the wrong shape for this app.
- Corrected the production logger shim and documented Supabase session-pooler TLS,
  including the private-CA problem with `verify-full`.

## Original game (2024)

The Tambola/Housie game itself, the client design and the pattern names come from
Sumeet Umbalkar's original project (MIT, see [`LICENSE`](LICENSE)), which this
repository continues. Several of its UI controls had no server rule behind them;
the ones that could not be honoured were removed rather than left clickable, and
are recorded in `DEFERRED_PATTERNS` in `server/game/patterns.js` with the reason.

---

## Still open, in plain terms

- **Browser verification of the five newest interface changes is done** (31 October,
  §4.2 of [`TEST-REPORT.md`](TEST-REPORT.md)): the `Start game` control a reset
  returns to the host's game screen, the second-click confirmation on End game and
  Reset including its 8-second self-expiry and its Cancel, the state-bound claim
  wording in all five states, `seated` / `playing` / `played` in the roster, and the
  chat history a mid-round joiner is shown. What still has no rendered-page evidence
  is a second browser engine, a screen reader, a physical handset and the deployed
  URL.
- **No production deployment has been verified.** The public URL was deliberately
  left untouched, so provider TLS, proxy headers and cookie flags remain post-deploy
  checks rather than confirmed facts. The hosting options and their cost are in
  [`docs/HOSTING-OPTIONS.md`](docs/HOSTING-OPTIONS.md); none has been purchased.
- **One browser engine tested** (Chromium). No Safari or Firefox run; no screen-reader
  pass; narrow-layout evidence comes from a 434 px Chrome window with its layout
  container pinned to 390 px, not from a handset on a network.
- **Single instance by design.** Horizontal scaling needs per-room ownership, which
  is a redesign, not a configuration.
- **Five patterns remain deferred** (Early Seven, Star, Middle Number, 1 2 3 / 143,
  Pyramid) — each needs a rules decision, and none has a button. What each one means
  and what it would take is in [`docs/RULES-DECISIONS.md`](docs/RULES-DECISIONS.md).
- **Rooms do not age out on their own.** A clean stop closes them durably; abandoned
  rooms are closed by the owner from the control centre.
- **Chat is unmoderated** beyond length and rate limits, and there are no player
  accounts — both are product boundaries, agreed, not unfinished work.
- `caniuse-lite` in the build toolchain reports outdated browser data; refreshing it
  (`npx update-browserslist-db@latest`) is a maintenance chore, not a behaviour fix.
