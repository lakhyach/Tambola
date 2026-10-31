# Changelog

What changed in this product, and what is still open. Dates are the dates the work
was verified, not the dates a feature was first sketched. Entries describe
behaviour a player or an operator can actually notice; internal file moves are only
mentioned where they explain a boundary.

Format is roughly [Keep a Changelog](https://keepachangelog.com/) with the
deliberate difference that each entry names the thing a reader would see, because
this file doubles as the handover note for a paid build.

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
  checks rather than confirmed facts.
- **One browser engine tested** (Chromium). No Safari or Firefox run; no screen-reader
  pass; narrow-layout evidence comes from a 434 px Chrome window with its layout
  container pinned to 390 px, not from a handset on a network.
- **Single instance by design.** Horizontal scaling needs per-room ownership, which
  is a redesign, not a configuration.
- **Five patterns remain deferred** (Early Seven, Star, Middle Number, 1 2 3 / 143,
  Pyramid) — each needs a rules decision, and none has a button.
- **Rooms do not age out on their own.** A clean stop closes them durably; abandoned
  rooms are closed by the owner from the control centre.
- **Chat is unmoderated** beyond length and rate limits, and there are no player
  accounts — both are product boundaries, agreed, not unfinished work.
- `caniuse-lite` in the build toolchain reports outdated browser data; refreshing it
  (`npx update-browserslist-db@latest`) is a maintenance chore, not a behaviour fix.
