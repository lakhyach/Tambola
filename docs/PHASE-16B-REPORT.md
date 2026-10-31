# Phase 16B — autonomous completion, free-infrastructure research and deployment readiness

31 October 2026 · branch `main` · base commit `0a4de55` (Phase 16 documentation, pushed
to `origin/main`) · no winning rule changed · nothing deployed · no card entered ·
no account created · no domain bought.

This document answers, in order, the eleven statements the brief requires. Every
number in it came out of a command that ran on this working tree; where a claim
rests on a vendor's own documentation it says so, and where it is an assumption it
says that instead. Evidence classes are the same as
[`FREE-INFRASTRUCTURE-RESEARCH.md`](FREE-INFRASTRUCTURE-RESEARCH.md): **D** =
provider documentation read on 31 October 2026, **T** = tested on this machine in
this phase, **A** = assumption, labelled as such.

---

## 0. The answer in one paragraph

The platform is technically deployable today on a zero-cost architecture that keeps
every part of its durable contract — but the only $0 configuration that does so is
this workstation running the existing Docker Compose stack behind a Cloudflare Quick
Tunnel, whose public URL changes whenever the tunnel restarts. A stable public URL at
$0 requires an Oracle Cloud Always Free VM, which requires a payment card for identity
verification and is therefore outside this phase's authorization. The cheapest
reliable paid path is ~$3.69/month (Fly.io 512 MB + Supabase Free) or ~$28.69/month if
the client wants provider-managed backups. Everything that can be built, gated,
measured and documented without money or a client decision has been built, gated,
measured and documented; the remaining blockers are a host, a domain, a brand, legal
text, four rules answers and a person on call.

---

## 1. What was implemented

| # | Change | Where | What proves it |
| --- | --- | --- | --- |
| 1 | **Production environment gate.** Refuses to call an environment "ready" when the database is unverified TLS, the transaction pooler is in use, default credentials survive, `PUBLIC_ORIGIN` or `TRUST_PROXY` is missing in production, memory mode is proposed as a deployment, or the MFA key is too weak. Prints `ok / warning / error` per check and exits non-zero on any error. | `scripts/env-check.mjs`, `npm run env:check` (loads `.env` via `--env-file-if-exists`) | `tests/env-check.test.js` (11 tests); the gate itself exits 0 on this machine's dev profile and 1 on a production profile that is genuinely not ready |
| 2 | **Deployment smoke test.** Probes `/livez`, `/readyz`, `/healthz`, `/` and the socket handshake against a running URL, then with `--full` seats two clients, starts a round and asserts both tabs see the same number. Fails non-zero on any miss. | `scripts/smoke-deploy.mjs`, `npm run smoke -- --url … [--full]` | `tests/smoke-deploy.test.js` (4 tests); live run 11 of 11 checks against the local server |
| 3 | **Scheduler heartbeat and pool pressure on `/healthz`.** `scheduler: {armed, nextDueInMs, overdue, ticking}` and `pool: {total, idle, waiting, max, errors}`. `overdue` is reported but deliberately **not** a readiness failure — a late tick is a symptom, and failing readiness would drain a room that is still playing. | `server/observability/health.js`, `server/index.js` | `tests/health-signals.test.js` (4 tests), including one that no connection string can reach the payload |
| 4 | **Database profiler in the load harness.** Wraps every game transaction for duration percentiles and samples `pg_stat_activity`, `pg_stat_database` and `pg_stat_wal`, so pool saturation is attributed rather than guessed at. Instrumentation only: no query changed. | `scripts/loadtest.mjs` | §8 below; the profiler is what produced the "the database was idle at 42 waiters" finding |
| 5 | **Early Seven, specified and deliberately unregistered.** An exact rule, four properties, six fixtures and a four-step enable checklist — and no entry in the live registry, so the engine cannot award it. | `server/game/proposed-patterns.js`, `docs/RULES-DECISIONS.md` §1.1a | `tests/proposed-patterns.test.js` (6 tests) asserts the live registry cannot produce it |
| 6 | **CI that runs every gate.** Two jobs on a public repository's free runners: `verify` (tests against a real PostgreSQL 16 service, lint, build, secret scan, security probe, both e2e runs, backup + restore check, the production env gate as a self-test) and `docker` (builds the image, starts it, curls `/livez`, prints logs, removes it). | `.github/workflows/ci.yml` | The env-gate step was reproduced locally with the workflow's exact environment: exit 0, `9 ok, 2 warning(s), 0 error(s)` |
| 7 | **Scheduled availability probe.** Every 20 minutes against a `DEPLOY_URL` repository secret; opens one issue on failure and closes it on recovery. Inert until the secret exists. | `.github/workflows/uptime.yml` | Not activatable without a deployed URL — documented as such, not claimed as working |
| 8 | **Production dependency patch.** `socket.io` / `engine.io` / `ws` upgraded for the advisories `npm audit` reported; `nodemon` moved from `dependencies` to `devDependencies` where it always belonged. | `package.json`, `package-lock.json`, `client/package-lock.json` | `npm audit --omit=dev` at the repository root: **0 vulnerabilities**; the client's 2 moderate `react-router-dom` 6.x advisories remain and are documented, because the fix is a 7.x major |
| 9 | **Documentation.** Four new papers and nine updated files. | `docs/FREE-INFRASTRUCTURE-RESEARCH.md`, `docs/DEPLOYMENT-READINESS.md`, `docs/CLIENT-SIGNOFF.md`, this report; `README`, `TEST-REPORT`, `CHANGELOG`, `docs/GAP-REPORT.md`, `docs/CLIENT-REQUIREMENTS.md`, `docs/RULES-DECISIONS.md`, `DEPLOYMENT.md`, `server/RUNBOOK.md`, `.env.example` | `npm run secret-scan` over every one of them |
| 10 | **Tests for all of the above.** 25 new tests, 383 → 408. | `tests/env-check.test.js`, `tests/smoke-deploy.test.js`, `tests/health-signals.test.js`, `tests/proposed-patterns.test.js` | §8 |

Not implemented, deliberately: no new gameplay, no new pattern enabled, no provider
SDK, no analytics, no email, no service worker, no schema migration.

---

## 2. What was researched and verified

Nineteen components were researched against provider documentation read on
31 October 2026, not against blog posts: application hosting, PostgreSQL, persistent
WebSockets, background processes, domain/DNS, TLS, object storage, backups, uptime
monitoring, error tracking, logging, analytics, email, CDN/DDoS, secrets, CI/CD,
database monitoring, scheduled backups and alerting. Each candidate was scored on the
eleven criteria the brief set (free allowance, card, risk of unexpected charge, sleep
and pause rules, WebSocket compatibility, persistent process support, database limits,
backups, geography, fit to this architecture, and what happens when the quota is
exceeded) in [`FREE-INFRASTRUCTURE-RESEARCH.md`](FREE-INFRASTRUCTURE-RESEARCH.md).

The three findings that decided the architecture:

1. **A free web tier that sleeps is incompatible with a game clock.** Render Free spins
   the process down after 15 minutes with no HTTP *or WebSocket* traffic. A room waiting
   for its next number, between games, or on a quiet evening is exactly that. When it
   wakes, the in-process scheduler is not running; players see a loading page and lose
   the round. (D)
2. **A free database with a deletion date is not a database.** Render's free Postgres
   expires 30 days after creation and is deleted after a 14-day grace. Neon's free plan
   gives 100 CU-hours, while 24/7 at the 0.25 CU minimum costs 182.5 CU-hours — the
   lease heartbeat alone exhausts it before month end. Supabase Free is the best free
   managed option: 500 MB, no card, no expiry, but **no provider backups** and a pause
   after a week of total inactivity. (D, and the pause is why the 30-second lease
   heartbeat matters: a running site never pauses.)
3. **Only own hardware satisfies the contract for $0.** The in-process scheduler, the
   single-instance advisory lease and the durable-before-broadcast writes all assume a
   process that stays alive and a database that stays awake. That is this workstation
   (T) or an Oracle Always Free VM (D, card required).

Supporting services that are genuinely free and do not need a card: Cloudflare's free
plan (CDN, DDoS, TLS), GitHub Actions on a public repository, GitHub Actions cron,
UptimeRobot's free tier (50 monitors, 5-minute interval), Sentry Developer (5k
errors/month, 1 cron monitor), Cloudflare R2 (10 GB-month, free egress — but R2
activation does require a payment method on the account), and Resend (3,000 emails/month,
not needed: the product sends no email).

---

## 3. Which providers are genuinely free, which require a card

"Free" below means: no payment card, no expiry date, and no inactivity behaviour that
breaks the calling clock.

### 3.1 Genuinely free and suitable

| Service | What it gives | Used here |
| --- | --- | --- |
| This workstation + Docker Compose + `cloudflared` Quick Tunnel | a full stack, 24/7 while the machine is on, an ephemeral public HTTPS URL | **Yes** — the only $0 path that meets the contract (T) |
| Local PostgreSQL 16 container | unlimited (own hardware), backed up by `db:backup` + verified by `db:restore-check` | **Yes** (T: 18 tables, 10 498 rows, restored and compared) |
| Cloudflare free plan | CDN, DDoS mitigation, universal TLS, Web Analytics | Recommended in front of any public URL; not yet in front of one |
| GitHub Actions (public repository) | unlimited standard runners | **Yes** — `ci.yml`, `uptime.yml` |
| UptimeRobot Free | 50 monitors, 5-minute interval, alerts | Recommended; **needs an account (A4)** |
| Sentry Developer | 5k errors/month, 1 cron monitor, 30-day retention | Recommended; **needs an account (A3)** |
| Cloudflare Quick Tunnel | free HTTPS hostname, no account | **Yes** — ephemeral by design |
| GitHub Actions cron | free scheduled jobs on a public repository | **Yes** — backup probe layer |

### 3.2 Free but limited or conditional

| Service | The condition | Fit |
| --- | --- | --- |
| Supabase Free | 500 MB, 2 projects, **no backups**, pauses after a week of total inactivity | Best free *managed* database; fine for the app, not for "sleep at night" |
| Cloudflare R2 | 10 GB free, but **activating R2 requires a payment method** | Optional offsite dumps — blocked by the card rule |
| Railway Free | $1 of credit per month, no custom domains, ~146 h at 0.5 GB | Free but not 24/7 |
| Koyeb free Postgres | "free 5h" instance | Not a database, a demo |
| Fly.io auto-stop | off by default; if enabled, same clock problem as Render | Cheap, not free |
| Oracle Always Free | **card for identity verification**, account idle 30 days may be reclaimed | The best $0 public option; blocked |

### 3.3 Free trial only

Render (free web service without a card, but the free Postgres expires in 30 days),
Railway's $5 one-time trial, Google Cloud / AWS / Azure free tiers (12 months, card).

### 3.4 Paid

Render Starter (~$7/mo), Fly.io (~$2.19–3.69/mo), Koyeb Pro ($29/mo + compute),
Supabase Pro (~$25/mo), Railway Hobby ($5/mo), any domain ($10–15/year).

**Note on the brief's warning.** Render, Railway and Koyeb all advertise a free tier and
none of them is called "free" above in the sense this application needs. Each is
classified by what it would actually do to a running game.

---

## 4. The recommended zero-cost architecture

**B1 — this workstation, the existing stack, the existing tunnel.**

```
players ──HTTPS/WSS──▶ https://<random>.trycloudflare.com   (Cloudflare Quick Tunnel)
                              │
                              ▼
                   127.0.0.1:4000  Node 24 + Express + Socket.IO   ← one process, in-process scheduler,
                              │                                      single-instance advisory lease
                              ▼
                   127.0.0.1:55432  PostgreSQL 16 (Docker, tambola-pg)
                              │
                              └──▶ backups/  pg_dump + manifest, verified by db:restore-check
```

- **Cost:** $0/month, $0/year. No card, no account, no expiry (T).
- **Why it is the recommendation:** it is the only configuration that satisfies all
  seven contract requirements — server-authoritative engine, persistent Postgres,
  persistent Socket.IO, in-process scheduler, single-instance lease, durable recovery,
  TLS-verified database — at zero cost. It is also the configuration every gate in §8
  actually ran against.
- **What it costs you in practice:** the machine must stay powered and online; the
  public URL changes every time the tunnel restarts, so invite links do not survive a
  restart; 200 concurrent in-flight requests through the tunnel; one disk holds both the
  live database and its dumps; home-connection upload and jitter are the latency floor;
  no uptime guarantee of any kind.
- **What it is good for:** client demos, UAT, the acceptance round, and a permanent
  staging environment. **What it is not:** a public product URL.
- **Operating it:** `deploy/free-start.ps1` and `deploy/free-stop.ps1`, then
  `npm run smoke -- --url <tunnel> --full` before every demo, and
  `npm run db:backup` after every session.

**B2 — Oracle Cloud Always Free Ampere A1 VM, same image.** $0/month forever, a stable
public IP, your own TLS, 24/7 — and a credit/debit card for identity verification plus a
real operational commitment (patching, firewall, certificate renewal, backups). This is
the recommended $0 *public* architecture and it is blocked on approval A1/A2, not on
engineering.

**The two architectures that are rejected, with reasons:** A (free managed host + free
managed Postgres) fails on the sleep timer and the database deletion date; Cloudflare
Workers + Durable Objects would need a rewrite of the engine's process model, which is
Phase 17 work at the earliest and out of scope here.

---

## 5. The cheapest reliable paid architecture

| Combination | Monthly | Annual | What the money buys |
| --- | --- | --- | --- |
| Fly.io `shared-cpu-1x` 512 MB + Supabase Free | **~$3.69** | ~$44 | always-on process, stable `*.fly.dev` hostname, no spin-down; backups are our own dumps only |
| Fly.io 512 MB + Supabase Pro | ~$28.69 | ~$344 | adds daily provider backups, no pause, 8 GB database |
| Render Starter + Supabase Free | ~$7 | ~$84 | the same, on a friendlier platform |
| Render Starter + Supabase Pro | ~$32 | ~$384 | the "sleep at night" configuration |
| any of the above + a domain | +$10–15/yr | — | a name the client owns and keeps |

Measured sizing input for the choice: 50 rooms × 250 players used **137–143 MB RSS**,
about half of one core, an event-loop p99 of 29–34 ms and zero duplicate calls (T). A
256 MB machine is sufficient at this scale; 512 MB lets the Node heap breathe.

---

## 6. What is fully deployable now

Nothing is deployed. Everything needed *to* deploy, verify and roll back exists and has
been exercised:

1. **Image** — `Dockerfile` builds a production image that starts and serves `/livez`
   (built and started by the CI `docker` job; built locally in earlier phases).
2. **Configuration gate** — `npm run env:check` (or `node scripts/env-check.mjs
   --production`) must print `READY` before a deploy is allowed to proceed. On this
   machine's development environment it prints `READY`; on a production profile missing
   its origin, proxy setting, MFA key and verified-TLS database it exits 1.
3. **Schema** — migrations are idempotent and applied at boot; the ledger is at
   migration 004 and `/healthz` reports it.
4. **Health** — `/livez` (process only), `/readyz` (lease, migrations, database,
   draining), `/healthz` (the detail: scheduler heartbeat, pool pressure, session
   counts). The image declares a container health check.
5. **Shutdown** — `SIGTERM` drains, closes rooms durably, releases the lease and exits;
   the runbook explains why the replacement must wait for the release.
6. **Data safety** — `npm run db:backup` writes a `pg_dump -Fc` archive plus a manifest
   with a SHA-256; `npm run db:restore-check` restores it into a throwaway database and
   compares the migration ledger, table inventory, row counts and the
   call-log-versus-draw sequence, then drops it.
7. **Proof it works** — `npm run smoke -- --url … --full` against the running server:
   11 of 11 checks, including two real sockets seeing the same called number.
8. **Automation** — CI runs every gate above on each push; the scheduled probe is
   written and inert until `DEPLOY_URL` exists.
9. **Procedure** — [`DEPLOYMENT-READINESS.md`](DEPLOYMENT-READINESS.md) §6 has deploy,
   verify and rollback; §4 has the secret table and the one key that cannot be rotated
   while MFA enrolments exist; §7 has the pool sizing with measurements;
   `server/RUNBOOK.md` has the incident procedures and `DEPLOYMENT.md` the appendices.

The one-command deploy sequence on an already-provisioned host is:
`docker compose pull && docker compose up -d` → `npm run env:check` →
`npm run smoke -- --url https://… --full` → `npm run db:backup`, with the health
endpoints watched for ten minutes afterwards.

---

## 7. What still blocks public deployment

In the order they bite. Each is something this phase is not authorized to do, or
something only the client can decide.

| # | Blocker | Who resolves it | What it unblocks |
| --- | --- | --- | --- |
| 1 | **A host and an account owner** (A1). Oracle Always Free needs a card for verification | the client | a stable process; B2 becomes available |
| 2 | **A domain** (A2), ~$10–15/year | the client | `PUBLIC_ORIGIN`, a named tunnel, invite links that survive a restart, a certificate the client controls |
| 3 | **Legal surface** (L1–L4): privacy policy, terms including the no-cash-prizes statement, support contact, retention statement | the client's legal identity | the footer, the join page and the admin export policy |
| 4 | **Brand** (C1–C6): name, logo, icon set, colours, tagline, host display name | the client | replacing the working example identity ("Tambola" / "Obsidian Hall") |
| 5 | **Four rules answers** (C7–C12): tickets per player, which patterns and their values, late-join policy, multiple winners, and whether Early Seven is switched on and at what points | the client | the room defaults and the pattern registry |
| 6 | **Admission and moderation** (P1): anyone with an 8-character code joins today; there is no kick, ban, approval, profanity filter or report flow | product decision | opening rooms to strangers |
| 7 | **Monitoring accounts** (A3–A5, A7): Sentry, UptimeRobot, the `DEPLOY_URL` secret, and a named person on call | the client | "we would know within 20 minutes" instead of "we would find out from a player" |
| 8 | **A scheduled backup** (A6): a cron entry or provider cron running `db:backup` | the host owner | daily dumps instead of dumps when someone remembers |
| 9 | **One real handset pass** — iOS Safari on glass, on a cellular network | whoever holds the phone | the remaining mobile claim; the emulated 390×844 pass is in §8 |
| 10 | **An L3 deep security review** — ran on `2f93352` before the push and returned `findings_count: 0`. What remains is a review by someone other than the author, or a third-party penetration test | the repository owner | independent assurance, not a gate that is currently red |
| 11 | **A capacity expectation** — the durable evidence stops at 250 concurrent players | the client | the right host size the first time |

Nothing on this list is an engineering gap. Every one is an approval, an account, a
purchase or a decision.

---

## 8. Actual test results and performance measurements

Everything below ran on this working tree on 31 October 2026, after the dependency
patch. "PASS" means the command exited 0 and printed what is quoted.

| Gate | Result |
| --- | --- |
| `npm run verify` (tests + lint + build + secret scan) | **exit 0**; `tests 408 / pass 408 / fail 0 / skipped 0`; lint clean; client build succeeded |
| `npm run secret-scan` | **PASSED** — 203 files inspected on the final tree (4 from `client/dist`), 2 `.env` values checked for leakage, 7 credential shapes checked |
| `npm run security-probe` | **RESULT: PASS — 51 of 51 checks held** |
| `npm run e2e` (in-memory, real engine to COMPLETED) | **PASS** — Full House on call 69 (John, ticket #1); Meena top of the leaderboard with 50 points |
| `npm run e2e:durable` (PostgreSQL, throwaway schema) | **PASS** — Full House on call 75 (Asha, ticket #3), throwaway schema `tambola_e2e_84d339` dropped afterwards |
| `npm run db:backup` | 179 004 bytes, SHA-256 `3b0afb57057dfe23…`, 18 tables, 10 547 rows |
| `npm run db:restore-check` | **RESTORE CHECK PASSED** — throwaway database `tambola_rc_be2b409117`, ledger, tables, rows and game invariants all matched, then dropped |
| `npm run env:check` (development profile) | `READY` — `6 ok, 4 warning(s), 0 error(s)`; every warning is the correct setting for a single host with a local database |
| `npm run env:check` (a deliberately incomplete production profile) | exit 1, 4 errors — the gate refuses |
| `npm run smoke -- --url http://127.0.0.1:4000 --full` | **RESULT: PASS** — 11 of 11 checks, including a multiplayer round where both sockets saw number 86 and the room completed |
| `/healthz` while running | `lease: held`, migrations `004`, `scheduler: {ticking: true, overdue: false}`, `pool: {total: 2, max: 8, waiting: 0}` |
| Browser pass (headless Chrome over CDP, production build) | landing 1440×900 `scrollWidth 1440`; host created room `7BXX8KDA` through the real form; 390×844 on the waiting room and the join page, `scrollWidth 390`; guest joined through the real form; host then read `2 seated` with both names; **zero console errors** |
| `npm audit --omit=dev` (root) | **0 vulnerabilities** after the patch |
| `npm audit --omit=dev` (client) | 2 moderate `react-router-dom` 6.x advisories; fix is the 7.x major, not taken |
| L3 deep security review (pre-push, `2f93352`) | `{"layer":"l3","findings_count":0,"findings":[]}` |

### 8.1 Durable performance — 50 rooms × 250 players

`scripts/loadtest.mjs staged 10:50,50:250`, local PostgreSQL 16.14, one instance,
throwaway schema, with per-transaction profiling:

```
joins 250 · failures 0 · acks 750 · duplicate calls 0
ack p50 48.8 ms · p95 87.0 ms · p99 121.0 ms
room syncs 150/150 · reconnects 50/50 · event-loop p99 29.3 ms
rss 137.6 MB · cpu 50 % · pool 8/8 · waiting 42
db: 1400 transactions · tx p50 47.3 / p95 161.1 / p99 213.1 ms
    peak active 7 · longest query 48 ms · lock waits 0 · cache hit 100 %
    wal 1.8 MB / 19869 records
```

The Phase 13 bottleneck is now attributed rather than described: **the queue is pool
checkout plus per-room serialisation, not database capacity.** At 42 waiters the
database was idle — 7 of 8 backends active, longest query 48 ms, 100% cache hit, zero
lock waits. Raising the pool to 16 takes ack p95 from 84.8 to 65.0 ms; raising it to 32
buys ~8 more ms of p95 while introducing 16 lock waits and a 321 ms transaction p99,
which is the wrong trade for a game whose worst failure is a frozen room. Default stays
8, `DB_POOL_MAX=16` is documented as the setting for a known ~50-room peak, and
`DB_POOL_MAX` is capped at 50 to stay under a session pooler's client limit.

**What was not measured:** anything above 250 concurrent players, any multi-hour soak,
and any run against the production database (the harness refuses Supabase hosts by
design). No claim beyond 250 concurrent players is made anywhere in this repository.

### 8.2 Real versus simulated

- **Real**: two headless Chrome instances driving the built bundle over the DevTools
  Protocol at true 1440×900 and 390×844 viewports, typing into the real inputs and
  clicking the real buttons; real Socket.IO clients for the smoke round and the load
  run; a real PostgreSQL 16 with a throwaway schema; a real `pg_dump`/`pg_restore`
  round trip.
- **Simulated**: the load harness's players are scripted clients, not humans; the
  390×844 viewport is device *emulation*, not a phone; the browser pass ran on one
  engine (Chromium) on one operating system.

### 8.3 The feature areas re-checked in this phase

The brief named eight areas to review for genuine defects. Each was read against its
code and its gate; the gates all ran inside the 408-test suite above, and no new
defect was found in these areas this phase (the defects that *were* found — F19, plus
the dependency advisories — are in §1 and `TEST-REPORT.md` §5).

| Area | What covers it | Verdict |
| --- | --- | --- |
| Late joiners | `multiticket.test.js`, `player-experience.test.js`, the browser mid-round join recorded in `TEST-REPORT.md` §4.1 | correct: no tickets, no claim buttons, an honest `You joined mid-game`, chat still available |
| Chat history and reconnect semantics | `chat-messages.test.js`, `chat-feed.test.js`, `realtime.test.js`, and a live mid-round joiner receiving a line she was never pushed | correct: bounded 24-message tail, `chat:history` on mount and on every reconnect, dedupe by id |
| Multiple tickets per player | `multiticket.test.js` (19 tests), the smoke round, the browser pass | correct: 1–4 selectable, cap 12, selection locked at start, per-ticket claims |
| Host controls and destructive actions | `host-confirm.test.js` (9 tests), `engine.test.js`, the live inventory recorded in `TEST-REPORT.md` §4.2 | correct: the primary button follows server state; End game / Reset need a second click and expire after 8 s |
| Hindi and English number calling | `announce.test.js` (15 tests) | correct: per-device Web Speech, a queue that never overlaps, an honest message when the engine has no voice |
| Voice synchronisation | `announce.test.js`, the seven-scenario voice pass recorded in `GAP-REPORT.md` (`problems=[]`, `maxOverlapMs=0`) | correct |
| Mobile | the 390×844 CDP pass (§8 table above), `scrollWidth` measured on two screens | correct for overflow and wrapping; a handset remains unproven (§7 item 9) |
| Winner and game-completion flows | `e2e`, `e2e:durable`, `celebration.test.js`, `refusals.test.js`, `assertIntegrity()` on every completed game | correct: six awards, exclusive patterns, refused premature and duplicate claims, no celebration replay after reload |

---

## 9. Git commits and push status

| Commit | Contents | Status |
| --- | --- | --- |
| `2063f0b` | Phase 15, commercial readiness | pushed to `origin/main` in the previous phase |
| `0a4de55` | Phase 16 documentation release | **pushed and verified**: local `HEAD` and `origin/main` both read `0a4de553fa9cbad6db484797b7198bfde83c9757` before this phase began |
| `2f93352` | the ten items in §1 plus this document — 28 files, 4523 insertions, 1195 deletions | **pushed**: `0a4de55..2f93352  main -> main`; `git ls-remote origin refs/heads/main` reads `2f933528958cbded308c79e65bb5f4ad1df297c9`, identical to local `HEAD`; working tree clean afterwards |

Each `e2e` run draws a fresh sequence, so the winning call numbers differ between runs;
what does not differ is the set of invariants asserted at the end of each game (six
awards, one per pattern, three refused illegal claims, `assertIntegrity()` passing).
The numbers quoted in §8 are from this phase's final run.

The Phase 16B working tree contained only intended changes: four new test files, two
new scripts under `scripts/` (plus the browser evidence harnesses, which live in
`.preflight/` and are not version-controlled), one new game module, two workflows,
four new papers, nine updated files and the dependency patch. No file was deleted, no
database was touched, no history was rewritten, and no force-push was used.

---

## 10. Every remaining approval

### 10.1 Infrastructure and operations (from `DEPLOYMENT-READINESS.md` §10)

| # | Approval | Blocks |
| --- | --- | --- |
| A1 | a hosting account in the client's name (Oracle Always Free needs a card for identity verification) | a stable public URL |
| A2 | a domain (~$10–15/year) or the client's existing one | `PUBLIC_ORIGIN`, a named tunnel, durable invite links |
| A3 | a Sentry account (free Developer plan) | error grouping, the `db:backup` cron monitor |
| A4 | an UptimeRobot account (free) | the primary availability alert |
| A5 | permission to set `DEPLOY_URL` as a repository secret | turns on `uptime.yml` |
| A6 | permission to schedule `db:backup` | daily backups |
| A7 | a named person on call | who reads the alert |
| A8 | client sign-off on rules, brand, legal text and budget | every P0 item in `GAP-REPORT.md` |

### 10.2 Product decisions (from `CLIENT-SIGNOFF.md`)

Eighteen decisions, fourteen product and four legal. The five that change behaviour if
answered differently: tickets per player (room default 1–4, hard cap 12, market default
3); which winning patterns are live and their points; the claim window (room setting
`claimWindowCalls`, default `0` — a claim must beat the next call; up to 10 calls of
grace is allowed); multiple winners per pattern; and whether Early Seven is switched on
— **not live, and a complete tested rule is waiting for a points value and a yes**.

### 10.3 Legal (from `CLIENT-SIGNOFF.md` L1–L4)

Privacy policy, terms including the no-cash-prizes statement, a support contact and a
retention statement. None can be authored without the client's legal identity.

### 10.4 Explicitly not requested, and therefore not done

No card was added, no subscription started, no cloud resource purchased, no billing
plan changed, no domain bought, nothing deployed, no public URL published, no database
or user data deleted, no client-approved rule changed, and no C-drive cleanup was
performed.

---

## 11. Decision register — what was decided without asking, and why

| Decision | Rationale | Reversible? |
| --- | --- | --- |
| Early Seven stays **unregistered** although its rule is fully specified and tested | the engine must never award a prize on an unapproved pattern; the points value is the client's | yes — four steps in `RULES-DECISIONS.md` §1.1a |
| `DB_POOL_MAX` default stays **8**, with 16 documented for ~50 rooms | 8 is safest for a session pooler with an unknown client limit; the measurement is written down so the change is a conscious one | yes — one environment variable |
| `scheduler.overdue` is **not** a readiness failure | a late tick is a symptom; failing readiness would drain a room that is still playing, converting a slow moment into a lost game | yes |
| `env:check` loads `.env` through `--env-file-if-exists` instead of reading a file itself | one mechanism, the same one the server uses; found because the gate initially reported a database that was there | yes |
| **No provider accounts** were created | every one needs a human, an email or a card; an account created by an agent is not the client's to close | yes |
| CI runs on **public-repository free runners** only | no card, no minute cap, and the jobs are the same gates run by hand | yes |
| `uptime.yml` is a **backup** layer at a 20-minute cadence, not the primary alert | GitHub cron is best-effort and can be delayed; it is free and needs no account | yes |
| The load harness **profiles** transactions without changing queries | attributing the bottleneck is safe; rewriting hot paths on unverified assumptions is not | yes |
| The client papers were **default-filled, not invented** | branding, legal identity and winning rules are marked "needs client"; nothing was silently decided | yes |
| `react-router-dom` stays at **6.x** | the advisories affect SSR paths this single-page client does not use; a major upgrade days before a release is the larger risk | yes |
| Every new script ships with tests | an untested gate is a claim; 25 tests were added so each one fails loudly when it should | — |

---

## 12. What this phase deliberately did not do

No Phase 17 feature work. No winning rule was changed, enabled or reweighted. No
provider was signed up for, no card entered, no domain bought, no subscription started,
no billing plan altered. Nothing was deployed and no public URL was published. No
database, schema, table or row of client data was deleted; the load and e2e harnesses
create **throwaway** schemas and the restore check creates and drops a **throwaway**
database, never the live one. No repository history was rewritten and no force-push was
used. No C-drive cleanup was performed.

The L3 deep review was run **before** the push, on the committed tree, and reported no
findings; it is not a substitute for an independent review, and §7 item 10 says so.

The next phase's first decision is not technical: it is A1/A2 plus the eighteen
sign-offs, in that order, because everything else on the deployment path is already
built, measured and verified.
