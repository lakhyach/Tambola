# Final product gap report

Phase 16 · 31 October 2026 · build `2063f0b` (pushed to `origin/main`) · **updated in Phase 16B**,
base `0a4de55` · evidence in `TEST-REPORT.md`, `docs/MARKET-BENCHMARK.md`, `docs/RULES-DECISIONS.md`,
`docs/CLIENT-REQUIREMENTS.md`, `docs/CLIENT-SIGNOFF.md`, `docs/HOSTING-OPTIONS.md`,
`docs/FREE-INFRASTRUCTURE-RESEARCH.md`, `docs/DEPLOYMENT-READINESS.md`

Every status below is either **verified by a gate that ran in this release** or marked as not done.
Nothing is "probably fine".

Priority: **P0** blocks client acceptance · **P1** blocks a public launch · **P2** optional later.

> Phase 16B closed the deployment, monitoring and measurement gaps that were open here. The rows
> below carry the new evidence; §7 lists what changed in this phase and §8 what it deliberately did
> not do. No winning rule changed, and nothing was deployed.

## 1. Gap matrix

| Area | Current status | Remaining work | Priority | Client approval required |
| --- | --- | --- | --- | --- |
| **Gameplay** | Full 90-number round runs to COMPLETED on both the in-memory and the durable stack; 383/383 tests; 800 sequential room lifecycles with 0 errors | None for the current rules. Every rules change waits on `docs/RULES-DECISIONS.md` | — | No (unless rules change) |
| **Voice** | Web Speech EN + हिं, per device, 7/7 scenarios with `problems=[]` and `maxOverlapMs=0`; watchdog + RETRY chip; honest about engine blocks | Voice picker (male/female/pitch) is not available portably; custom call phrases are not built | P2 | No |
| **Tickets** | 1–4 default, cap 12, per-ticket tab rail, server-minted grids (CSPRNG), roster promises what the round issues, tested | Default should be 3 to match the market (configuration only) | P1 (config) | **Yes** — tickets per player |
| **Winning rules** | Six patterns, exclusive, completion ordinal on every one, late-claim window enforced at prepare *and* commit; boundaries pinned by tests | Five deferred patterns need written definitions. **Early Seven now has one** — exact rule, six fixtures, unregistered (`server/game/proposed-patterns.js`) — and needs only a points value and an approval. Star/Middle Number is still the riskiest | P1 | **Yes** |
| **Celebrations** | Overlay on award, host and player views, verified in browser; end-of-game standings and final results both sides | Winner reactions and out-of-app notifications are not built | P2 | No |
| **Chat** | Room chat, EN + HI content, rate-limited, not persisted; sits in a panel, never over the hero number | Profanity filter, report flow, host broadcast banner, kick/ban | P1 (public rooms) / P2 (banner) | Partly |
| **Administration** | Owner sign-in with TOTP MFA, room audit, health snapshot, durable history, backup/restore verification | No in-room host moderation (kick/ban); no player approval or ticket approval | P1 | **Yes** — admission policy |
| **Branding** | A complete, working default identity ("Tambola" / "Obsidian Hall", Champagne-gold accent, generated icon set), every part overridable through `VITE_*` build vars — but it is an example, not the client's brand | All of §1 of `docs/CLIENT-REQUIREMENTS.md`: real name, logo, icon set, colours, tagline. Now asked for on one page in `docs/CLIENT-SIGNOFF.md` | P0 | **Yes** |
| **Security** | 51/51 live probe (headers, CORS origin echo, CSRF, body limits, socket contract, rate budgets); secret scan clean and now run in CI; admin boundary tested; production dependency audit **0 vulnerabilities** after the `socket.io`/`ws` patch upgrades; **L3 deep security review run before the 16B push, `findings_count: 0`** | No third-party pentest and no review by anyone outside this project. Client bundle still carries **2 moderate `react-router-dom` 6.x advisories** whose fix is the 7.x major (SSR-only paths this app does not use) | P1 (before public launch) | No |
| **Performance** | 400 concurrent joins, 0 failures; call-to-screen p95 53 ms; call ack p95 70 ms; event-loop p99 32 ms; 800 room lifecycles, 0 errors. **Phase 16B, durable PostgreSQL, 50 rooms × 250 players**: 250 joins, 0 failures, 750 acks, ack p50 44.6 / p95 84.8 ms with the default pool, p95 65.0 ms at `DB_POOL_MAX=16`, 150/150 room syncs, 50/50 reconnects, **0 duplicate calls**, RSS 143 MB, and a database profiler proving the queue was pool checkout (peak 7 active, longest query 23 ms, cache hit 100%, 0 deadlocks) | No hours-long soak, no test above 250 concurrent players, no slow-phone profiling | P1 | No |
| **Deployment** | Docker image, compose, Render/Fly/Railway manifests, Supabase TLS pinning verified, runbook complete. **Phase 16B adds**: `npm run env:check` (production gate), `npm run smoke -- --full` (live proof, 11/11 against a running server), a CI workflow that runs every gate and builds the image, rollback and pool-sizing procedures, and `docs/DEPLOYMENT-READINESS.md` | **Nothing is deployed.** A host, a domain and the account owner must be chosen; the zero-cost options are a workstation behind a Quick Tunnel (URL changes on restart) or Oracle Always Free (card required) | P0 | **Yes** |
| **Mobile** | 390×844 verified: `scrollWidth 390`, zero overflow, tabbed tickets, header wrap fixed; mid-round join explained on screen | No real hardware, no iOS Safari, no touch-gesture testing; no PWA install | P1 | No |
| **Monitoring** | `/livez`, `/readyz`, `/healthz` (now with **scheduler heartbeat** and **pool pressure**), draining signal, structured logs, health check in the image, a scheduled `uptime.yml` that opens and closes an issue, and a smoke test that fails if a guest does not receive a call | No external uptime account (UptimeRobot needs an account), no error-tracking account (Sentry), no alert recipient, no scheduled backup — all of it needs a human, see `docs/DEPLOYMENT-READINESS.md` §10 | P1 | **Yes** — who is on call |
| **Documentation** | README, RUNBOOK, ADMIN, DATABASE, CONTRACT, DEPLOYMENT, TEST-REPORT, CHANGELOG, market benchmark, rules decisions, requirements, hosting paper, **free-infrastructure research, deployment readiness, client sign-off, this report** | Nothing blocking; keep the runbook current | — | No |
| **Legal / privacy** | No policy, no terms, no support contact in the product | Privacy policy, terms (incl. no-cash-prizes), support contact, retention statement | P0 | **Yes** |
| **Monetisation** | None. Free-to-play only; nothing processes payments | Decide free-to-play in writing; anything else is a different, regulated product | P0 (decision) / — (build) | **Yes** |

## 2. Required for client acceptance (P0)

1. **Product identity** — name, logo, colours, favicon. The build ships a working example identity ("Tambola" / "Obsidian Hall", gold accent); shipping it as-is would be shipping a placeholder brand rather than the client's.
2. **A host, a domain and an account owner** — nothing is deployed. `docs/HOSTING-OPTIONS.md`
   recommends Render Frankfurt + the existing Supabase project (~$32/mo with managed backups) for a
   paid launch; `docs/FREE-INFRASTRUCTURE-RESEARCH.md` shows why no genuinely free managed host keeps
   the calling clock alive, and prices the two $0 paths.
3. **Legal surface** — privacy policy, terms, support contact, retention statement, and a written
   free-to-play confirmation.
4. **The rules answers** — tickets per player, winning patterns and their values, late-join and
   multiple-winner policy (`docs/RULES-DECISIONS.md` sign-off block).
5. **Scale expectations** — rooms and concurrent players, so the hosting tier is chosen for the real
   peak rather than a guess.

## 3. Required before a public launch (P1)

1. **Admission control or moderation** — anyone with an 8-character code joins today; there is no kick,
   ban, approval, profanity filter or report flow. Fine for invited family; not fine for strangers.
2. **A soak test** — the load evidence is a burst, not a Saturday evening. Run a multi-hour room
   session with reconnects before announcing a public launch.
3. **External monitoring and an on-call name** — a `/readyz` endpoint nobody watches is a dashboard,
   not monitoring.
4. **Marketing-default settings** — 3 tickets per player, 0-call claim window for prize games,
   multiple winners above ~10 seats.
5. **One real handset pass** — the mobile evidence is Chrome emulation at 390×844, not iOS Safari on
   glass.
6. **An independent security review** and a dependency audit. *(Phase 16B ran the audit,
   patched the production dependencies to 0 vulnerabilities and ran the L3 deep review
   before the push — `findings_count: 0`. The client bundle still carries 2 moderate
   `react-router-dom` advisories that need a 7.x major. What is still missing is a review
   by someone who is not the author.)*

## 4. Optional future enhancements (P2)

- Early Seven (low cost, strong market presence — recommended first).
- Star / Middle Number / 143 / Pyramid — only with written definitions.
- QR join on the host screen; host broadcast banner; winner reactions.
- Voice picker (male/female/pitch) where the device exposes voices.
- Out-of-app notifications (lock screen / Dynamic Island equivalents).
- PWA install prompt and offline shell.
- Custom host call phrases; more Indian language packs (device-dependent, must be described as such).

## 5. What is *not* a gap, and should stay that way

- **No chips, no events, no entry fees, no cash prizes.** Those belong to the money-table shape of the
  market and drag the product into real-money regulation.
- **No account, no email, no install for players.** The friction-free end of the market is the correct
  end to be on.
- **No marking-by-tap.** Marks derive from official calls; this removes an entire class of disputes.
  It is a deliberate product difference, and the client should sign it off rather than "fix" it.
- **Single instance.** The advisory lease is a correctness feature (one engine writes calls); a second
  instance is not "scaling", it is a bug.

## 6. Release verification summary

### Phase 16 (build `2063f0b`)

| Gate | Result |
| --- | --- |
| `npm run verify` (383 tests + lint + build + secret scan) | PASS, exit 0 |
| `npm run security-probe` | PASS — 51/51 |
| `npm run e2e` (in-memory, real engine to COMPLETED) | PASS — Full House on call 70 |
| `npm run e2e:durable` (PostgreSQL, throwaway schema) | PASS — Full House on call 78 |
| `npm run db:backup` + `db:restore-check` | PASSED — 18 tables, 10 498 rows, invariants match |
| `git show --check 2063f0b` | Flags trailing whitespace on CRLF files only — a pre-existing repository convention (118 such files already on `origin/main`); no content defect |
| Push | `b62bdd9..2063f0b main -> main`; remote `main` = `2063f0b6ec217f74cdb6fcd3a29b14af9d7b54ad` |
| Production deployment | **Not performed** (by instruction) |

### Phase 16B (base `0a4de55`)

| Gate | Result |
| --- | --- |
| `git push origin main` of the Phase 16 docs commit | `2063f0b..0a4de55`; remote = local = `0a4de553fa9cbad6db484797b7198bfde83c9757`; tree clean |
| Link check over every tracked Markdown file | PASSED — every relative link resolves |
| `npm run verify` (408 tests + lint + build + secret scan) | PASS, exit 0 — 408 pass, 0 fail, 0 skipped |
| `npm run security-probe` | PASS — 51/51, re-run after the dependency patch |
| `npm run e2e` (in-memory) | PASS — Full House on call 77, then call 74 on the re-run |
| `npm run e2e:durable` (PostgreSQL, throwaway schema) | PASS — Full House on call 78, then call 73 on the re-run |
| `npm run db:backup` + `db:restore-check` | PASSED — 18 tables, 10 498 rows, ledger 4 entries, invariants match |
| `npm run env:check` (development) | 6 ok, 4 warnings, 0 errors — READY |
| `npm run env:check -- --production` on a laptop | **exit 1**, 4 errors — the gate refuses an unsafe environment instead of printing a green report |
| `npm run smoke -- --url http://127.0.0.1:4000 --full` | PASS — 11/11, including a real Socket.IO round (both seats saw the same number) |
| `/healthz` against the running server | lease held, migrations `004_multi_ticket.sql` current, `scheduler.ticking true`, `pool 2/8 idle`, `reasons []` |
| Durable load, 50 rooms × 250 players, 750 calls | 0 join failures, 0 duplicate calls, 150/150 syncs, 50/50 reconnects; ack p50 44.6 / p95 84.8 ms at `DB_POOL_MAX=8`, 65.0 ms at 16; profile captured (`docs/DEPLOYMENT-READINESS.md` §7) |
| Browser pass, headless Chrome over CDP | Landing at 1440×900 (`scrollWidth 1440`), host room created through the real form (`V5P9XJBC`, 1 seated), the same room at 390×844 (`scrollWidth 390`, no overflow), guest joined through the real join form at 390×844, host then saw **2 seated** with both names, **0 console errors** on either tab. Screenshots `.preflight/p16b_01..05_*.png` |
| `npm audit --omit=dev` (repository root) | **0 vulnerabilities** after the `socket.io` / `ws` / `engine.io` patch upgrades |
| `npm audit --omit=dev` (client) | 2 moderate — `react-router-dom` 6.x; the fix is the 7.x major, not taken |
| Production deployment | **Not performed** (by instruction). No account, card, domain or URL was created. |

## 7. What Phase 16B closed

| Gap (§1 row) | What closed it |
| --- | --- |
| **Deployment** was a checklist a human had to remember | `npm run env:check` turns it into an assertion that exits non-zero; `npm run smoke -- --full` proves a running deployment in one command; `docs/DEPLOYMENT-READINESS.md` writes the procedure, rollback included |
| **Performance** was a burst with no attribution | A database profiler in the load harness (transaction percentiles, `pg_stat_activity`, `pg_stat_database`, `pg_stat_wal`) plus a 50-room/250-player durable run. Result: the queue is pool checkout, not database capacity — and the pool had been left at its default in the earlier measurement |
| **Monitoring** was a dashboard nobody watched | `scheduler` and `pool` signals in `/healthz`, a scheduled probe that opens an issue, a CI workflow that runs every gate, and a documented primary alert (UptimeRobot) waiting for an account |
| **Winning rules** had five undefined patterns and no work done | Early Seven is now specified, implemented and tested as an **unregistered** proposal; the other four have a written blocker each. No rule changed |
| **Client requirements** were 38 blank rows | §10 resolves all 38 with the standing default and its consequence; `docs/CLIENT-SIGNOFF.md` extracts the eighteen that genuinely need a decision |
| **Free infrastructure** was unverified opinion | Every claim was checked against the provider's own page on 31 October 2026, with the disqualifying detail quoted (`docs/FREE-INFRASTRUCTURE-RESEARCH.md`) |
| **Security** had an unpatched production dependency tree | `socket.io`/`ws`/`engine.io` patched, `nodemon` moved out of production dependencies, audit at 0 for the root; the secret scanner caught a fixture in this phase's own test, and the fixture was fixed rather than the scanner |

## 8. What Phase 16B deliberately did not do

- **No deployment, no account, no card, no domain, no purchase.** Every one of those is listed with
  its exact approval in `docs/DEPLOYMENT-READINESS.md` §10.
- **No winning-rule change.** Early Seven is proposed, not registered; the admin console cannot offer
  it, and a test asserts the live registry still refuses a claim for it.
- **No client decision invented.** Brand, legal identity, jurisdiction, prize values and the
  free-to-play statement remain the client's.
- **No hours-long soak and no real handset.** Both are still P1 in §3, and neither can be produced by
  this machine alone.
- **No database touched that was not disposable.** Load tests ran against a throwaway schema behind
  `TEST_DATABASE_URL`; the live configuration was read, never written.
