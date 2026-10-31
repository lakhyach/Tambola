# Final product gap report

Phase 16 · 31 October 2026 · build `2063f0b` (pushed to `origin/main`) · evidence in
`TEST-REPORT.md`, `docs/MARKET-BENCHMARK.md`, `docs/RULES-DECISIONS.md`,
`docs/CLIENT-REQUIREMENTS.md`, `docs/HOSTING-OPTIONS.md`

Every status below is either **verified by a gate that ran in this release** or marked as not done.
Nothing is "probably fine".

Priority: **P0** blocks client acceptance · **P1** blocks a public launch · **P2** optional later.

## 1. Gap matrix

| Area | Current status | Remaining work | Priority | Client approval required |
| --- | --- | --- | --- | --- |
| **Gameplay** | Full 90-number round runs to COMPLETED on both the in-memory and the durable stack; 383/383 tests; 800 sequential room lifecycles with 0 errors | None for the current rules. Every rules change waits on `docs/RULES-DECISIONS.md` | — | No (unless rules change) |
| **Voice** | Web Speech EN + हिं, per device, 7/7 scenarios with `problems=[]` and `maxOverlapMs=0`; watchdog + RETRY chip; honest about engine blocks | Voice picker (male/female/pitch) is not available portably; custom call phrases are not built | P2 | No |
| **Tickets** | 1–4 default, cap 12, per-ticket tab rail, server-minted grids (CSPRNG), roster promises what the round issues, tested | Default should be 3 to match the market (configuration only) | P1 (config) | **Yes** — tickets per player |
| **Winning rules** | Six patterns, exclusive, completion ordinal on every one, late-claim window enforced at prepare *and* commit; boundaries pinned by tests | Five deferred patterns (Early Seven, Star, Middle Number, 143, Pyramid) need written definitions. Star/Middle Number is the riskiest | P1 | **Yes** |
| **Celebrations** | Overlay on award, host and player views, verified in browser; end-of-game standings and final results both sides | Winner reactions and out-of-app notifications are not built | P2 | No |
| **Chat** | Room chat, EN + HI content, rate-limited, not persisted; sits in a panel, never over the hero number | Profanity filter, report flow, host broadcast banner, kick/ban | P1 (public rooms) / P2 (banner) | Partly |
| **Administration** | Owner sign-in with TOTP MFA, room audit, health snapshot, durable history, backup/restore verification | No in-room host moderation (kick/ban); no player approval or ticket approval | P1 | **Yes** — admission policy |
| **Branding** | A complete, working default identity ("Tambola" / "Obsidian Hall", Champagne-gold accent, generated icon set), every part overridable through `VITE_*` build vars — but it is an example, not the client's brand | All of §1 of `docs/CLIENT-REQUIREMENTS.md`: real name, logo, icon set, colours, tagline | P0 | **Yes** |
| **Security** | 51/51 live probe (headers, CORS origin echo, CSRF, body limits, socket contract, rate budgets); secret scan clean; admin boundary tested; 4 defects fixed this cycle (F15–F18) | No L3 deep review was run for this push (user choice). No third-party pentest | P1 (before public launch) | No |
| **Performance** | 400 concurrent joins, 0 failures; call-to-screen p95 53 ms; call ack p95 70 ms; event-loop p99 32 ms; 800 room lifecycles, 0 errors | No soak test (hours-long), no test above 400 concurrent players, no slow-phone profiling | P1 | No |
| **Deployment** | Docker image, compose, Render/Fly/Railway manifests, Supabase TLS pinning verified, runbook complete | **Nothing is deployed.** A host, a domain and the account owner must be chosen | P0 | **Yes** — `docs/HOSTING-OPTIONS.md` |
| **Mobile** | 390×844 verified: `scrollWidth 390`, zero overflow, tabbed tickets, header wrap fixed; mid-round join explained on screen | No real hardware, no iOS Safari, no touch-gesture testing; no PWA install | P1 | No |
| **Monitoring** | `/livez`, `/readyz`, `/healthz`, draining signal, structured logs, health check in the image | No external uptime monitor, no alerting channel, no log drain configured — all host-side | P1 | **Yes** — who is on call |
| **Documentation** | README, RUNBOOK, ADMIN, DATABASE, CONTRACT, DEPLOYMENT, TEST-REPORT, CHANGELOG, market benchmark, rules decisions, requirements, hosting paper, this report | Nothing blocking; keep the runbook current | — | No |
| **Legal / privacy** | No policy, no terms, no support contact in the product | Privacy policy, terms (incl. no-cash-prizes), support contact, retention statement | P0 | **Yes** |
| **Monetisation** | None. Free-to-play only; nothing processes payments | Decide free-to-play in writing; anything else is a different, regulated product | P0 (decision) / — (build) | **Yes** |

## 2. Required for client acceptance (P0)

1. **Product identity** — name, logo, colours, favicon. The build ships a working example identity ("Tambola" / "Obsidian Hall", gold accent); shipping it as-is would be shipping a placeholder brand rather than the client's.
2. **A host, a domain and an account owner** — nothing is deployed. `docs/HOSTING-OPTIONS.md`
   recommends Render Frankfurt + the existing Supabase project, ~$32/mo with managed backups.
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
6. **An L3 deep security review** (was offered and skipped for this push) and a dependency audit.

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

## 6. Release verification summary (this cycle)

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
