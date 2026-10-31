# Tambola

A free-to-play, real-time multiplayer Tambola (Housie / Bingo) you can run for a
live game night: one person hosts, everyone else joins from their phone with a
code or a link, and the server draws the numbers and decides every win.

**No money is involved anywhere.** There are no entry fees, wagers, purchases or
prize payouts — only points on a scoreboard. That is a product rule, not an
unfinished feature.

---

## How a game actually goes

1. **Host** opens the site, names the game and gets an 8-character room code
   (`E99YSN4A`) plus a share link. The code alphabet deliberately excludes the
   look-alikes `I`, `O`, `0` and `1`.
2. **Players** join with the code or the link and pick how many tickets they want
   (1–4 by default, 12 at most). Tickets are issued by the server, never typed in:
   the picker shows the grids the round will actually deal, one at a time behind a
   tab rail, and the moment the room's ceiling is reached the control says so and
   stops accepting taps.
3. **Host starts.** Ticket selection locks, and the server has already fixed the
   order of all 90 numbers for the round.
4. **Numbers are called** on the server's clock (8 seconds apart by default), or
   manually by the host. Every official number is written to the database *before*
   it is broadcast, so no two clients can disagree about what was called. A player
   who turns on the `VOICE` chip has each call read aloud by their own browser —
   English or Hindi number words, one at a time, in call order, never more than
   two numbers behind the board. Voice is a per-device convenience; the board
   stays the truth for everyone.
5. **Players claim patterns** by pressing a tile. The claim is only an intent: the
   server re-checks the ticket against its own call history and either awards it
   or refuses with the reason ("line incomplete", "no ticket number 7 belongs to
   you", …). Nothing a browser says can create a winner. A ticket marks itself as
   numbers are called — marks come from the official history, so there is nothing
   to tap and nothing to un-tap, and a refresh cannot leave a ticket looking fuller
   than it is.
6. **Chat** works during the game — free text plus quick messages in English and
   Hindi, so a table that mixes languages still plays together. A seat that arrives
   mid-round is given the last few messages it missed, from memory, so nobody joins
   a silent-looking panel while the room is talking.
7. **The round ends** when the host ends it or all 90 numbers have been called.
   Full House is normally the last claim standing. The scoreboard, the award list
   and the call history stay available, and the host can reset the room for a fresh
   round with the same players and the same ticket counts — but brand-new tickets,
   dealt again by the server — and start it again from the same screen.

Joining after the start is allowed and useful: you watch the round in progress and
you can chat, but ticket selection is closed once a round starts, so a late joiner
has no ticket to claim with and picks tickets for the next round. Nobody — early
or late — can claim a pattern their own ticket does not complete, because the
server checks it.

## The caller console (the host's screen)

A host does not get an admin dashboard; they get a **caller console** at
`/host/game` — the desk a real caller sits at. It shows the number just called in
the same ball the players see, the previous number, a deliberately **sealed** next
slot that can only say how many numbers are left, the full 1–90 board, the whole
call sheet with its ordinals, the round's elapsed clock, and the hall's roster with
seated / connected / away / ticket counts. One primary control — *Call next number*
— plus Pause, Resume, Auto, the calling cadence (3s–30s), End and Reset; the two
destructive ones need a second click. `C`, `P` and `R` work from the keyboard
outside text fields.

Two rules make it trustworthy. **The console never decides anything**: it sends an
intent and renders the snapshot that comes back, so the board, the call log, the
host's screen and every phone cannot disagree, and the next number does not exist
client-side until the server draws it. **Voice is per device**: the host can pick
English or Hindi, a listed voice, a rate and a volume, repeat the current number,
and the panel states plainly when the browser has no speech engine, no Hindi voice,
or a voice that stopped — none of which can slow the calling clock.

The full behaviour, including what happens on a refresh mid-round, a second host
tab and a server restart, is in [`docs/CALLER-CONSOLE.md`](docs/CALLER-CONSOLE.md).

## The player's screen

A player never types a number. The waiting room shows **the ticket the round will
deal** — the grids come from the server, the count control states the room's
ceiling in words (*4 of 4 selected · room maximum*) and disables itself there, and
every count is a real radio button, so a keyboard or screen-reader user jumps
straight to "3 tickets". One ticket at a time sits behind a tab rail, because four
stacked tickets push the game off a phone; the ticket itself is a 3×9 ARIA grid
whose every cell speaks its position and state (*"Number 47, row 2 column 4,
called"*).

During the round the ticket **marks itself** from the official call history: called
cells fill gold, the number just called carries a ring, and the header and each row
carry their own count (`9/15`, `R1 3/5`) so "is the top line close?" is a glance
rather than arithmetic. There is no tap-to-mark by design — a local mark could never
be evidence, and two disagreeing notions of "marked" is how real products lose
disputes. A claim is an intent sent with its ticket number; the server re-checks it
against its own history, awards once, and names the ticket that won. A refresh — in
the waiting room or mid-round — re-claims the seat and returns the same tickets.

The full behaviour, including every refusal message, the marking model and the
reconnect semantics, is in [`docs/PLAYER-GAMEPLAY.md`](docs/PLAYER-GAMEPLAY.md).

## Rules that are in play

| Pattern | Points | What the server verifies |
|---|---:|---|
| Early Five | 20 | five of one ticket's numbers called (optionally inside a call window) |
| Top Line | 10 | all five numbers of the ticket's top row |
| Middle Line | 10 | all five numbers of the middle row |
| Bottom Line | 10 | all five numbers of the bottom row |
| Corners | 20 | the four corner numbers of the ticket |
| Full House | 30 | all fifteen numbers on the ticket |

Each pattern is awarded once, to the first valid claim (`multipleWinnersPerPattern`
is off by default). Rules live in [`server/game/patterns.js`](server/game/patterns.js)
and nowhere else — the client's pattern labels are cosmetic and are filtered
against what the server says is enabled for the room.

**Not implemented, on purpose:** Early Seven, Star, Middle Number, 1 2 3 / 143 and
Pyramid. They were on the old UI as buttons with no server rule behind them, so
they were removed instead of left as controls that cannot be honoured. They are
listed in `DEFERRED_PATTERNS` with the reason, so nobody re-adds a tile without a
predicate.

## Defaults and limits

| Setting | Default | Range | Variable |
|---|---:|---|---|
| Players per room | 100 | — | `MAX_PLAYERS` |
| Tickets per player | 4 | 1–12 | room config `maxTicketsPerPlayer` |
| Time between calls | 8000 ms | 500–120000 | `CALL_INTERVAL_MS` |
| Chat cooldown per player | 2000 ms | — | `CHAT_INTERVAL_MS` |
| Chat message length | 120 chars | — | engine `maxChatLength` |
| Chat the room remembers for a new seat | 24 messages | — | engine `CHAT_HISTORY` (in memory only) |
| Reconnect grace | 60000 ms | — | engine `disconnectGraceMs` |
| Session idle window | 7 days | — | `SESSION_IDLE_MS` |

A room is for one game night, not for ten thousand concurrent players: the design
holds exactly **one** app instance (see [Operations](#operations)). Measured
capacity is in [`server/RUNBOOK.md`](server/RUNBOOK.md) §5 — the newest durable
run held **50 rooms × 250 players**, 750 back-to-back calls, p95 acknowledgement
85 ms with the default pool, zero duplicate calls and 50/50 reconnects
(`docs/DEPLOYMENT-READINESS.md` §7).

## Architecture in one paragraph

React 18 + Vite 5 + Tailwind single-page client, built to static files and served
by the same Express process. Socket.IO for the game traffic, with a strict ack
contract ([`server/net/CONTRACT.md`](server/net/CONTRACT.md)). A server-authoritative
engine (`server/game/engine.js`) owns state, and every mutation that matters goes
through a durable path (`server/persist/controller.js`) that writes PostgreSQL
before it broadcasts. Rooms, tickets, calls, claims, awards and reconnect
sessions all survive a restart; a boot-time recovery pass rebuilds live rooms from
the database rather than from what any browser remembers.

## Run it

Requires **Node.js 22 or newer** (the production image is `node:22-alpine`).

```bash
npm install
npm install --prefix client

cp .env.example .env       # then read it: DATABASE_URL is the one that matters
npm run build              # installs both workspaces and builds client/dist
npm start                  # http://localhost:4000
```

Without a `DATABASE_URL` the server refuses to boot. Deliberately running without
a database (games vanish on restart, no control centre) needs an explicit opt-in:

```bash
ALLOW_MEMORY_ONLY=1 npm start
```

### With Docker

```bash
docker compose up -d --build     # one app instance + PostgreSQL 16, on :4000
```

Compose reads secrets from your local `.env`. Put TLS in front of it and set
`TRUST_PROXY=1` / `TAMBOLA_COOKIE_SECURE=1`; see
[`deploy/README.md`](deploy/README.md).

### Tests and verification

```bash
npm test                 # the whole suite (Node's built-in runner)
npm run migrate          # apply the schema to DATABASE_URL (the backup suite asserts against it)
npm run lint             # client ESLint, zero warnings allowed
npm run e2e              # a complete game through the real engine, in memory
npm run e2e:durable      # the identical game against real Postgres persistence
npm run db:backup        # pg_dump + a manifest describing exactly what was saved
npm run db:restore-check # restores that archive into a throwaway database and proves it
npm run secret-scan      # no credential in shipped content or in the built bundle
npm run security-probe   # 51 live checks of the HTTP and socket surface, in-process
npm run env:check        # validate this environment before a deploy (no values printed)
npm run smoke -- --url http://127.0.0.1:4000 --full   # prove a running server, board and socket
npm run verify           # lint + build + test + secret-scan, in one command
```

The caller console and the player's screens each have their own driveable browser
pass over the Chrome DevTools Protocol, which prints what the DOM said and what the
layout measured at 1440, 820, 430, 390 and 360 pixels wide (each needs a server on
`:4000` and writes `.preflight/p17_*.png` and `.preflight/p18_*.png`):

```bash
node .preflight/tools/p17-caller.mjs   # the host's console
node .preflight/tools/p18-player.mjs   # the whole player journey, 78 checks
node .preflight/tools/p18-audit.mjs    # accessibility + cost of one call to the screen
```

The player pass is deliberately not just a screenshot run: it walks the journey
through the real socket contract (join, pick 1/2/3/4 tickets, the ceiling, marking on
every ticket, all six awards, a refused early claim, a reload mid-round, chat,
results), and the audit checks roles, accessible names, heading order, 44px touch
targets and computed WCAG contrast rather than trusting the CSS.

`npm test` needs a reachable PostgreSQL for the durable and backup tests; without
one those tests skip and say so instead of passing quietly. Two suites also assert
things a bare checkout does not have yet: the smoke suite asks a live server for the
built client, so `client/dist` must exist, and the backup suite dumps the database
`DATABASE_URL` points at and requires the migration ledger in it, so `npm run
migrate` must have run. `npm run verify` therefore builds before it tests, and CI
migrates and builds before it runs the suite. The results of the most recent full
run are in [`TEST-REPORT.md`](TEST-REPORT.md).

## Re-branding it

[`client/src/config.js`](client/src/config.js) is the only file to edit for a
different product name, tagline, logo, accent colour, footer notice, legal links
or default language. `VITE_*` build-time overrides for the ones that change per
deployment are documented in [`.env.example`](.env.example). Everything there is
display only — gameplay limits and rules stay on the server — and every switch is
actually read by the UI, because a setting that does nothing is worse than no
setting.

**Never put a secret in a `VITE_*` variable.** The client bundle is public.

## Operations

- [`DEPLOYMENT.md`](DEPLOYMENT.md) — what to provision and why serverless does not work here.
- [`docs/PHASE-16B-REPORT.md`](docs/PHASE-16B-REPORT.md) — the deployment-readiness report: what is deployable now, what blocks a public launch, the measured numbers and every approval that remains.
- [`docs/DEPLOYMENT-READINESS.md`](docs/DEPLOYMENT-READINESS.md) — the deploy gate, the smoke test, rollback, pool sizing and the exact approvals that remain.
- [`docs/FREE-INFRASTRUCTURE-RESEARCH.md`](docs/FREE-INFRASTRUCTURE-RESEARCH.md) — every free-tier claim checked against the provider's own page, and the two architectures that actually cost $0.
- [`deploy/README.md`](deploy/README.md) — Render / Fly.io / Railway steps, with the safety controls to preserve.
- [`docs/CALLER-CONSOLE.md`](docs/CALLER-CONSOLE.md) — the caller console: every control, the sealed next slot, the round clock, voice honesty, and what each control refuses to do.
- [`docs/PLAYER-GAMEPLAY.md`](docs/PLAYER-GAMEPLAY.md) — the player's game: the journey, why tickets are issued rather than chosen by number, the marking model, claims, multiple tickets, recovery and accessibility.
- [`server/RUNBOOK.md`](server/RUNBOOK.md) — configuration, boot, recovery, backups, shutdown, load.
- [`server/DATABASE.md`](server/DATABASE.md) — schema, the durability contract, how a room is rebuilt.
- [`server/ADMIN.md`](server/ADMIN.md) — the owner control centre at `/admin` (accounts, MFA, audit trail).
- [`TEST-REPORT.md`](TEST-REPORT.md) — end-to-end evidence for a complete game.
- [`CHANGELOG.md`](CHANGELOG.md) — what changed and what is still open.

## Client-facing papers

- [`docs/MARKET-BENCHMARK.md`](docs/MARKET-BENCHMARK.md) — how this compares with three shipped Indian Tambola products, with sources and the rules decision matrix.
- [`docs/RULES-DECISIONS.md`](docs/RULES-DECISIONS.md) — the five deferred patterns and the configuration values a client must sign off.
- [`docs/CLIENT-REQUIREMENTS.md`](docs/CLIENT-REQUIREMENTS.md) — the inputs (brand, domain, language, rules, scale, legal) needed for the final release.
- [`docs/HOSTING-OPTIONS.md`](docs/HOSTING-OPTIONS.md) — the four hosting architectures, their monthly cost, and why nothing has been purchased yet.
- [`docs/CLIENT-SIGNOFF.md`](docs/CLIENT-SIGNOFF.md) — the eighteen decisions that need the client (fourteen product, four legal), on one page, with proposed defaults.
- [`docs/GAP-REPORT.md`](docs/GAP-REPORT.md) — every remaining gap, ranked P0/P1/P2 with the client decision attached to it.

One instance, always. A second process pointed at the same database fails closed
on an advisory lease rather than double-calling numbers — that is intended
behaviour, not a fault to work around.

## Known limits

Written plainly, because they are the things a client will ask about:

- **Single instance.** Horizontal scaling is a redesign (per-room ownership), not a dial.
- **Six patterns.** The five deferred ones (Early Seven, Star, Middle Number,
  1 2 3 / 143, Pyramid) have neither a server rule nor a button — see
  [`CHANGELOG.md`](CHANGELOG.md) for why.
- **No tap-to-mark.** A ticket is marked because the official call history contains
  the number, not because someone tapped a cell. It is a deliberate difference, and
  the client should sign it off rather than "fix" it (see
  [`docs/PLAYER-GAMEPLAY.md`](docs/PLAYER-GAMEPLAY.md) §4).
- **Rooms are closed on a clean stop.** `SIGTERM` closes the live rooms durably; a hard
  crash leaves them open for the next boot's recovery pass, which rebuilds every
  room the database still calls open. There is no automatic age-out of abandoned
  rooms — an owner closes them from the control centre.
- **No accounts for players.** A seat is a server-issued session token held per
  browser tab; that is enough for a game night and is not an identity system.
- **Chat is unmoderated** beyond length and rate limits. It is meant for a room of
  people who already know each other.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Short version: the server decides, the
client displays — a change that lets a browser assert a fact about the game will
be rejected in review.

## License

MIT — see [LICENSE](LICENSE), whose copyright is held by the original author,
Sumeet Umbalkar (2024). This repository is a continuation of that project: the
server-authoritative engine, durable persistence, recovery, the owner control
centre and the test suite were added on top of the original game.
