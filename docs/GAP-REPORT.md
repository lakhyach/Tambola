# Final product gap report

Phase 16 · 31 October 2026 · build `2063f0b` (pushed to `origin/main`) · **updated in Phase 16B**,
base `0a4de55` · **updated in Phase 17**, base `108c6aa` · **updated in Phase 18**, base `e5c6e99` ·
evidence in `TEST-REPORT.md`, `docs/MARKET-BENCHMARK.md`, `docs/RULES-DECISIONS.md`,
`docs/CLIENT-REQUIREMENTS.md`, `docs/CLIENT-SIGNOFF.md`, `docs/HOSTING-OPTIONS.md`,
`docs/FREE-INFRASTRUCTURE-RESEARCH.md`, `docs/DEPLOYMENT-READINESS.md`, `docs/CALLER-CONSOLE.md`,
`docs/PLAYER-GAMEPLAY.md`

Every status below is either **verified by a gate that ran in this release** or marked as not done.
Nothing is "probably fine".

Priority: **P0** blocks client acceptance · **P1** blocks a public launch · **P2** optional later.

> Phase 16B closed the deployment, monitoring and measurement gaps that were open here. The rows
> below carry the new evidence; §7 lists what changed in this phase and §8 what it deliberately did
> not do. No winning rule changed, and nothing was deployed.
>
> **Phase 17** gives the host a real caller console (current/previous number, a sealed next slot,
> the call sheet, a server round clock, cadence control, a per-device voice panel, the hall roster)
> and closes the host-experience gap that the matrix below used to leave out. §9 and §10 record what
> that changed and what it did not. No winning rule changed, nothing was deployed.
>
> **Phase 18** does the same for the player: a ticket picker that shows the real grids, a tab rail
> that keeps four tickets inside a 390px phone, a ticket marked from the official call history, a
> per-ticket `9/15` and row chips, and a results panel. It also closed two visible defects (an
> empty ticket preview in the waiting room, and the quietest ink failing WCAG AA at 3.86:1) and one
> hole nobody could see: tickets replayed from PostgreSQL were never re-validated before being dealt
> back to a seat. §11 and §12 record what it changed and what it deliberately did not.

## 1. Gap matrix

| Area | Current status | Remaining work | Priority | Client approval required |
| --- | --- | --- | --- | --- |
| **Gameplay** | Full 90-number round runs to COMPLETED on both the in-memory and the durable stack; 383/383 tests; 800 sequential room lifecycles with 0 errors | None for the current rules. Every rules change waits on `docs/RULES-DECISIONS.md` | — | No (unless rules change) |
| **Voice** | Web Speech EN + हिं, per device, 7/7 scenarios with `problems=[]` and `maxOverlapMs=0`; watchdog + RETRY chip; honest about engine blocks. **Phase 17** adds a chosen voice (from those the browser lists), rate 0.75–1.5×, volume, Repeat-current-number, and a sentence for every way speech can be missing (no engine, no Hindi voice, voice stopped) | A voice can only be picked from the browser's own list (OS-dependent); no pitch control; custom call phrases are not built | P2 | No |
| **Tickets** | 1–4 default, cap 12, server-minted grids (CSPRNG), per-ticket tab rail, roster promises what the round issues, tested. **Phase 18** makes the picker show the real grids, keeps 1–12 inside one tab rail on a phone, re-validates every replayed grid, and adds 69 tests across four suites (integrity, properties, view model, multi-ticket play), including a 20 000-ticket statistical sweep and a 5 000-ticket invariant sweep | Default should be 3 to match the market (configuration only) | P1 (config) | **Yes** — tickets per player |
| **Winning rules** | Six patterns, exclusive, completion ordinal on every one, late-claim window enforced at prepare *and* commit; boundaries pinned by tests | Five deferred patterns need written definitions. **Early Seven now has one** — exact rule, six fixtures, unregistered (`server/game/proposed-patterns.js`) — and needs only a points value and an approval. Star/Middle Number is still the riskiest | P1 | **Yes** |
| **Celebrations** | Overlay on award, host and player views, verified in browser; end-of-game standings and final results both sides | Winner reactions and out-of-app notifications are not built | P2 | No |
| **Chat** | Room chat, EN + HI content, rate-limited, not persisted; sits in a panel, never over the hero number | Profanity filter, report flow, host broadcast banner, kick/ban | P1 (public rooms) / P2 (banner) | Partly |
| **Administration** | Owner sign-in with TOTP MFA, room audit, health snapshot, durable history, backup/restore verification | No in-room host moderation (kick/ban); no player approval or ticket approval | P1 | **Yes** — admission policy |
| **Branding** | A complete, working default identity ("Tambola" / "Obsidian Hall", Champagne-gold accent, generated icon set), every part overridable through `VITE_*` build vars — but it is an example, not the client's brand | All of §1 of `docs/CLIENT-REQUIREMENTS.md`: real name, logo, icon set, colours, tagline. Now asked for on one page in `docs/CLIENT-SIGNOFF.md` | P0 | **Yes** |
| **Security** | 51/51 live probe (headers, CORS origin echo, CSRF, body limits, socket contract, rate budgets); secret scan clean and now run in CI; admin boundary tested; production dependency audit **0 vulnerabilities** after the `socket.io`/`ws` patch upgrades; **L3 deep security review run before the 16B push, `findings_count: 0`** | No third-party pentest and no review by anyone outside this project. Client bundle still carries **2 moderate `react-router-dom` 6.x advisories** whose fix is the 7.x major (SSR-only paths this app does not use) | P1 (before public launch) | No |
| **Performance** | 400 concurrent joins, 0 failures; call-to-screen p95 53 ms; call ack p95 70 ms; event-loop p99 32 ms; 800 room lifecycles, 0 errors. **Phase 16B, durable PostgreSQL, 50 rooms × 250 players**: 250 joins, 0 failures, 750 acks, ack p50 44.6 / p95 84.8 ms with the default pool, p95 65.0 ms at `DB_POOL_MAX=16`, 150/150 room syncs, 50/50 reconnects, **0 duplicate calls**, RSS 143 MB, and a database profiler proving the queue was pool checkout (peak 7 active, longest query 23 ms, cache hit 100%, 0 deadlocks). **Phase 18, durable, 1 + 4 + 12 ticket seats**: 1 343 / 1 727 / 2 752-byte snapshots, 77-byte `number:called` (the only event per call, independent of ticket count), call p50 4.65 / p95 15.98 ms, **2 rows written per call and 0 ticket rows updated**, integrity pass p50 0.09 ms; in the browser 4 seats vs 1 ticket were 351 vs 333 DOM nodes with 0 long tasks | No hours-long soak, no test above 250 concurrent players, no slow-phone profiling | P1 | No |
| **Deployment** | Docker image, compose, Render/Fly/Railway manifests, Supabase TLS pinning verified, runbook complete. **Phase 16B adds**: `npm run env:check` (production gate), `npm run smoke -- --full` (live proof, 11/11 against a running server), a CI workflow that runs every gate and builds the image, rollback and pool-sizing procedures, and `docs/DEPLOYMENT-READINESS.md` | **Nothing is deployed.** A host, a domain and the account owner must be chosen; the zero-cost options are a workstation behind a Quick Tunnel (URL changes on restart) or Oracle Always Free (card required) | P0 | **Yes** |
| **Host experience** | A dedicated caller console at `/host/game`: current/previous number, sealed next slot, 1–90 board, full call sheet, server round clock, start/pause/resume/end with two-click confirmation, cadence control, voice panel, hall roster; `C`/`P`/`R` hotkeys; desktop/tablet/390/360 verified with 0 page errors. **Phase 17** | No in-room moderation controls (no kick/ban/approve exists server-side); no caller notes or per-round commentary; no printable call sheet | P1 (moderation) / P2 (print) | **Yes** (admission policy) |
| **Player experience** | **Phase 18.** A waiting room that previews the grids the server will actually deal, a count control with the room's ceiling stated in words, a tab rail that holds 1–12 tickets, a ticket marked from the official call history with `9/15` and per-row chips, claim buttons only for enabled patterns with the server's own refusal text, and a personal result panel. Verified by a 78-check browser journey at five viewports with 0 console errors | No player-side profile or history across rooms (a seat ends with the round); no printable ticket; no haptics | P2 | No |
| **Mobile** | 390×844 verified: `scrollWidth 390`, zero overflow, tabbed tickets, header wrap fixed; mid-round join explained on screen. **Phase 17** adds the caller console at 390×844 and 360×740 with a pinned draw bar, `scrollWidth 390/360`, no overflow. **Phase 18** measures the player's game at 360, 390, 430, 768 and 1440: ticket cells 30–71px, the whole waiting-room ticket inside the first 844px, ticket tabs and claim buttons 44px tall at every width, no horizontal overflow at any of them | No real hardware, no iOS Safari, no touch-gesture testing; no PWA install | P1 | No |
| **Monitoring** | `/livez`, `/readyz`, `/healthz` (now with **scheduler heartbeat** and **pool pressure**), draining signal, structured logs, health check in the image, a scheduled `uptime.yml` that opens and closes an issue, and a smoke test that fails if a guest does not receive a call | No external uptime account (UptimeRobot needs an account), no error-tracking account (Sentry), no alert recipient, no scheduled backup — all of it needs a human, see `docs/DEPLOYMENT-READINESS.md` §10 | P1 | **Yes** — who is on call |
| **Documentation** | README, RUNBOOK, ADMIN, DATABASE, CONTRACT, DEPLOYMENT, TEST-REPORT, CHANGELOG, market benchmark, rules decisions, requirements, hosting paper, **free-infrastructure research, deployment readiness, client sign-off, this report**, **caller-console paper**, **player-gameplay paper** | Nothing blocking; keep the runbook current | — | No |
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
5. **One real handset pass** — the mobile evidence is Chrome emulation at 360, 390, 430, 768 and
   1440 pixels wide (Phase 18), not iOS Safari on glass.
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

### Phase 17 (base `108c6aa`)

| Gate | Result |
| --- | --- |
| `npm run verify` (447 tests + lint + build + secret scan) | PASS, exit 0 — 447 pass, 0 fail, 0 skipped, 12.6 s |
| `npm run security-probe` | PASS — 51/51 |
| `npm run e2e` (in-memory) | PASS — `COMPLETED` on call 82, 6 awards, John 40 pts |
| `npm run e2e:durable` (PostgreSQL, throwaway schema) | PASS — `COMPLETED` on call 76, 6 awards, Ravi 60 pts, schema dropped |
| Browser pass, headless Chrome over CDP (`.preflight/tools/p17-caller.mjs`) | PASS — console, 90 tiles, three calls, focus outlines, `C` hotkey, pause clock frozen at `00:08`, resume `00:09`, cadence 8s → 5s, voice panel (Hindi, 1.25×, volume 0.6, Repeat), 820/390/360 with no overflow, reload → `PAUSED` → resume → `RUNNING`, two-click end → `COMPLETED`; **0 page errors**. Screenshots `.preflight/p17_01..15_*.png` |
| Speaker audibility | **Not verified** — no audio device was listened to; the settings, the queue state and the repeat were. Listed in `TEST-REPORT.md` §10.4 |
| Production deployment | **Not performed** (by instruction). |

### Phase 18 (base `e5c6e99`)

| Gate | Result |
| --- | --- |
| `npm test` | PASS — `tests 516 / suites 18 / pass 516 / fail 0 / skipped 0 / todo 0`, 11 599 ms (69 of those tests are new in this phase) |
| `npm run lint` / `npm run build` | Clean at `--max-warnings 0`; 132 modules, CSS 46.53 kB (gzip 9.75), JS 385.05 kB (gzip 116.07) |
| `npm run secret-scan` | PASSED — 220 files, 2 `.env` values, 7 credential shapes, nothing found |
| `npm run security-probe` | PASS — 51 of 51 |
| `npm run e2e` (in-memory) | PASS — `COMPLETED`, 6 awards over 77 calls; premature, invented and duplicate claims all refused |
| `npm run e2e:durable` (PostgreSQL, throwaway schema) | PASS — `COMPLETED`, 6 awards over 74 calls, throwaway schema dropped |
| Browser journey, headless Chrome over CDP (`.preflight/tools/p18-player.mjs`) | PASS — **78 of 78** checks, **0 console errors**: join, pick 1/2/3/4 tickets, ceiling disabled at 4, ticket grids read at 360/390/430/768/1440 with no horizontal overflow, call marking on every ticket, all six awards, refusal of a premature claim, reload mid-round restoring every ticket, chat EN + HI, and the result panel. Screenshots `.preflight/p18_01..14_*.png` |
| Accessibility + call-cost audit (`.preflight/tools/p18-audit.mjs`) | PASS — **35 of 35**: 18/18 and 123/123 measurable text samples at WCAG AA (worst 5.38:1), 27/27 grid cells publishing row and column, 0 unnamed controls, 0 duplicate ids, 0 heading skips, 1 global reduced-motion rule; **0** long tasks, 4 tickets settling at 9 ms p95 against 14 ms for 1 |
| Server path, durable (`.preflight/tools/p18-perf.mjs`) | PASS — 1 343 / 1 727 / 2 752-byte snapshots, 77-byte `number:called`, call p50 4.65 / p95 15.98 ms, **2 rows written per call and 0 ticket-row updates**, integrity pass p50 0.09 ms, 18 persisted rows for 18 issued tickets |
| GitHub CI on the pushed commit | **RED on the first push, then fixed and re-verified** — run 41201303689 printed `tests 516 / pass 514 / fail 2`. Both failures are CI ordering, not product: the suite ran before the client build (the smoke test needs `client/dist`) and against a database that was never migrated (the backup test needs the migration ledger). Every CI run since the workflow existed had been red for the same two reasons — Phase 17's run printed `447 / 445 / fail 2`, the same two tests. Run 41202342043 on `d04f347` then finished **SUCCESS**, 22/22 steps: `tests 516 / pass 516 / fail 0`, both e2e games `COMPLETED`, `RESTORE CHECK PASSED`, backup artifact uploaded, docker job green |
| L3 deep security review before each push | `findings_count: 0` on both commits (`672e153` the phase, `d04f347` the CI fix) |
| Physical device / real screen reader / heard audio | **Not verified** — viewport emulation, DOM and CSSOM only |
| Production deployment | **Not performed** (by instruction). |

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

## 9. What Phase 17 closed

| Gap (§1 row) | What closed it |
| --- | --- |
| **Host experience** did not exist as a designed surface | A dedicated caller console replaces the pre-Phase-17 host strip (`HostControls.jsx` is deleted): current/previous number, a **sealed** next slot that carries a count and never a number, the 1–90 board, the full call sheet with ordinals, the server's round clock, start/pause/resume/end with a two-click confirm, the cadence chips, the hall roster and the chat |
| **Voice** was on/off, English or Hindi, at one speed | A per-device panel: a chosen voice from those the browser lists, rate 0.75–1.5×, volume, Repeat-current-number (the only deliberate re-speak, and it cannot overlap), a Retry after the engine stops, and a distinct sentence for no-engine, no-listed-voice and saved-voice-missing |
| **The host's clock was invisible** | `startedAt`/`elapsedMs`/`endedAt` on every snapshot, advanced by one hook in the state machine, frozen by pause, frozen by completion, cleared by reset, and continued across a restart from `games.started_at` |
| **Reliability** was known only from the player's side | Browser-proven now: refresh mid-round restores the console and its call sheet (and pauses, because the owner became unreachable), Resume continues the clock, a cadence change lands on the console; the second-tab `NOT_HOST` case is proven over real sockets |
| **Mobile host** was untested | Caller console verified at 820×1180, 390×844 and 360×740: `scrollWidth` equal to `innerWidth` at each, draw bar pinned to the bottom edge |
| **Documentation** had nothing about the host's screen | `docs/CALLER-CONSOLE.md` — every control, what it may do, what it refuses, and how each promise is re-verified |

## 10. What Phase 17 deliberately did not do

- **No winning-rule change, no player redesign.** The players' screens and the six patterns are
  untouched; the console reuses the same ball, board and chat components the players see.
- **No client-side number.** The next slot is sealed in `lib/caller.js` and asserted to have no
  numeric field; the draw sequence never leaves the server.
- **No moderation controls invented.** The authorization model has no kick/ban/approve event, so the
  roster shows state and nothing else; adding it is a server feature with an audit trail, not a
  button.
- **No claim of physical-device testing, and no claim of heard audio.** Every width is an emulated
  viewport in desktop Chrome, and speech was configured and inspected, not listened to.
 **No deployment, no purchase, no payment surface.** Unchanged from Phase 16B.

## 11. What Phase 18 closed

| Gap (§1 row) | What closed it |
| --- | --- |
| **The waiting room showed no ticket.** The server stores a ticket *count* until a round starts, so a refresh rendered an empty preview while the seat held tickets | The room asks the server once for the count the seat already holds, which materialises the real grids; the preview is now the ticket the round will actually deal, in the same component the round uses |
| **Tickets were tall and unbounded on a phone.** Four stacked previews pushed the game itself off the screen | One ticket at a time behind an ARIA tab rail, the ticket above the roster, and a tightened hero: the whole ticket, its tabs and its row chips fit inside the first 844 px of a 390 px screen |
| **A ticket explained nothing.** A player had to count cells to know whether a line was close | `9/15` in the header and a per-row chip (`R1 3/5`) that turns gold when the row completes — exactly the condition the Top/Middle/Bottom Line claim checks |
| **A picked ticket was a promise, not a grid** | The count control states the room's ceiling in words ("4 of 4 selected · room maximum"), disables `+` at it, exposes every count as a real radio in a `radiogroup`, and renders the server's own refusal when a ceiling drops under a waiting player |
| **The results screen was a board that stopped** | `YourResult.jsx` gives a seat its own points, its awards with the ticket number that won each, and the final standings |
| **Replayed tickets were never re-validated.** A grid written by an older build, a half-finished migration or a hand-edited row would have been dealt back and scored | `recovery.js` runs the generator's own `validateTicket` over every persisted grid and refuses a duplicate `(player, ticketNo)`; `integrityErrors()` does the same in memory. A bad row freezes the room (visible on `/healthz`) instead of being played |
| **Two accessibility defects** — claims at 32 px and tabs at 40 px (under the 44 px touch minimum), and the quietest ink at 3.86:1 (under WCAG AA) | Both fixed and now asserted by the harness at all five widths: 44 px at every width, worst measured text 5.38:1 |
| **The player journey had no test that played it** | Four new suites (69 tests) plus a 78-check browser journey over the real socket contract: generation, persistence, the view model, and the 1/2/3/4-ticket lifecycle through claims, refusal, reload and reconnect |
| **Nothing documented the player's side** | `docs/PLAYER-GAMEPLAY.md` — the journey, the issued-never-invented rule, the marking model and why it has no tap-to-mark, claims, multi-ticket, recovery (including the deliberate chat semantics) and the measured behaviour |
| **CI was silently red** — every run since the workflow was written, while all six local gates were green | `.github/workflows/ci.yml` now runs `npm run migrate` and the client build before `npm test`, and `npm run verify` builds before it tests, so the gate order matches what the suite actually needs. Both causes were reproduced locally (an unmigrated scratch database yields `migrationLedger: []`; no `client/dist` makes `/` answer 503) before either line changed. Run 41202342043 on `d04f347` is the first green CI run this repository has had. **No assertion was relaxed** |

## 12. What Phase 18 deliberately did not do

- **No winning-rule change and no ticket-format change.** Six patterns, 3×9, 15 numbers,
  5 per row, 1–3 per column — all unchanged. Early Seven, Star, Middle Number, 1 2 3 / 143 and
  Pyramid still have no button, because they still have no approved predicate.
- **No tap-to-mark.** Marks derive from the official call history, so a local tap can never
  become evidence, a reconnect cannot produce two disagreeing notions of "marked", and the
  draw sequence is untouchable from the browser. This is a product difference the client should
  sign off rather than "fix" (§5), and it is now explained in `docs/PLAYER-GAMEPLAY.md` §4.
- **No browser-side ticket.** The client sends a count; the server mints the grids. There is no
  code path by which a browser names a number or keeps a grid the server did not issue.
- **No standing in for a phone.** Every mobile figure is Chromium viewport emulation on a
  desktop OS. No iOS Safari, no on-screen keyboard, no real touch, no haptics.
- **No screen-reader listening and no colour-blind simulation.** The audit checks what the DOM
  and CSSOM expose — roles, names, indices, computed contrast, reduced-motion rules — not what
  a screen reader says out loud.
- **No capacity claim.** The Phase 18 measurements are one process, one machine, one room:
  what a call costs, not how many rooms fit in a box.
- **No new persistence writes for marking.** A call still writes two rows (`draw_calls`,
  `audit_events`) and zero ticket rows, because marks are derived, not stored.
- **No deployment, no purchase, no payment surface.** Unchanged from Phase 16B.
