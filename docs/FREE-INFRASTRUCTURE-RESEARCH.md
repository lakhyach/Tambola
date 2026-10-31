# Free infrastructure research — every component, checked against the vendor's own pricing page

Phase 16B deliverable. Research date **2026-10-31**. Every number below was read
from the provider's own pricing or documentation page on that date; the URL is
quoted next to it. Blog posts, comparison sites and "top 10 free hosting" listicles
were not used, because they are routinely a year out of date.

Evidence classes, same convention as `MARKET-BENCHMARK.md`:

- **D** — stated by the vendor's own documentation/pricing page (quoted).
- **T** — observed by this project in testing (a gate or a probe produced it).
- **A** — assumption; must be re-verified before anyone relies on it.

> **The one rule this document follows:** a service is not free because it has a
> trial, because it advertises a free tier, or because it is free for the first
> month. A service is free here only if the free allowance is permanent, needs no
> payment card, and does not silently convert the project into a bill.

---

## 1. What this application actually needs

The technical contract is not negotiable, so it is the filter every candidate is run
through (`docs/HOSTING-OPTIONS.md` §1, `DEPLOYMENT.md`):

| Requirement | Why | What breaks if it is missing |
| --- | --- | --- |
| One long-lived Node process | The game engine, the Socket.IO server and the room registry live in memory | Any platform that freezes, snapshots or scales the process to zero loses every live room |
| Persistent WebSocket | 250 players × per-call broadcasts | A request/response-only platform cannot run this game without a rewrite |
| In-process scheduler | Each RUNNING room holds one timer whose due time lives in the database | Spin-down during a game stops the calling clock mid-round |
| Exactly one active engine | Postgres advisory lease + lease row | Two processes calling numbers on one room is the one failure the database cannot undo |
| Durable PostgreSQL | Rooms, call history, tickets, awards, sessions, audit | Memory mode loses every game on restart and disables the owner console |
| TLS-verified database | Supabase's pooler is signed by a private CA | `sslmode=disable` puts credentials and game data in plaintext |
| Session pooler (5432) | Advisory locks and `search_path` are session-scoped | Transaction pooling (6543) silently breaks the lease |
| Backup + verified restore | `db:backup` / `db:restore-check` | A managed provider's free plan can drop the database without warning (Render: 30 days) |

Everything else — CDN, DDoS, domain, monitoring, error tracking, logs, email — is
replaceable, so it can be genuinely free.

---

## 2. Application hosting

| Provider | Free allowance (D) | Card? | Sleep / pause | WebSocket | Long-lived process | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| **Render** — [render.com/docs/free](https://render.com/docs/free) | 750 instance-hours/month, 512 MB | No | **Spins down after 15 minutes without HTTP *or WebSocket* traffic; ~1 minute cold start** | Yes | Only while awake | **Incompatible.** A quiet room's clock dies with the process. |
| **Render Postgres (free)** — same page | 256 MB RAM | No | **Expires 30 days after creation; after a 14-day grace it is deleted** | — | — | **Disqualified.** A free database with a deletion date is not a database. |
| **Koyeb** — [koyeb.com/pricing](https://www.koyeb.com/pricing) | No free plan. Pro $29/mo + compute; the only $0 line is a "Free 5h" Postgres instance | — | — | — | — | **No free tier.** |
| **Fly.io** — [fly.io/docs/about/pricing](https://fly.io/docs/about/pricing/) | No free tier since 2024. Smallest machine `shared-cpu-1x` 256 MB = **$2.19/mo**, 512 MB = **$3.69/mo**, billed by the second | Yes | Optional auto-stop (off by default) | Yes | Yes | **Cheap, not free.** |
| **Railway** — [railway.com/pricing](https://railway.com/pricing) | Free Trial $5 one-time for 30 days; **Free plan: $1 of usage credit per month**, max 0.5 GB/1 vCPU, **no custom domains** | No (trial) | No sleep, but the $1 credit is exhausted by ~146 h of 0.5 GB RAM ($10/GB-month) | Yes | Yes, until credit runs out | **Free but not 24/7.** $5 Hobby is the real floor. |
| **Oracle Cloud Always Free** — [oracle.com/cloud/free](https://www.oracle.com/in/cloud/free/) | Ampere A1 + AMD micro VMs, block storage, 10 TB egress/month, "available for an unlimited period of time" | **Yes — credit/debit card for identity verification** | No sleep; **accounts idle 30 days may be deemed abandoned** | Yes (own OS) | Yes | **Genuinely free 24/7, card required.** Excluded by this phase's rules. |
| **Google Cloud / AWS / Azure free tiers** | 12-month trials or always-free micro VMs in specific regions | **Yes** | — | Yes | Yes | **Trial or card.** Out. |
| **Cloudflare Workers + Durable Objects** | Generous free request allowance | No | Durable Objects hibernate when idle | Yes | Durable-object model, not a Node process | **Rewrite, not a migration.** Out of scope (no Phase 17 feature work). |
| **Replit / Glitch / Codespaces / HF Spaces** | Free tiers exist | No | Sleep on idle; Codespaces is billed in core-hours and is not a server product | Partial | No | **Demo-grade.** |
| **This workstation + `cloudflared` Quick Tunnel** | Free forever (own hardware + open-source daemon) | No | None — the machine and the tunnel stay up | Yes (verified, T) | Yes | **The only zero-cost option that meets the contract today.** |

### The Quick Tunnel, precisely

[developers.cloudflare.com — Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) (D):

- No Cloudflare account and no domain required.
- **No uptime guarantee.**
- **200 in-flight requests** per tunnel; beyond that, `429`.
- Server-Sent Events are not supported (unused here).
- **The hostname changes every time the tunnel restarts** (`https://<random>.trycloudflare.com`).
- "For testing and development. For production, create a Cloudflare Tunnel."

A named tunnel with a stable hostname is also free, but it requires a domain on
Cloudflare's free plan — and a domain costs money, which this phase may not spend.

---

## 3. PostgreSQL hosting

| Provider | Free allowance (D) | Card? | Idle behaviour | Backups on free | Limits that matter here |
| --- | --- | --- | --- | --- | --- |
| **Supabase** — [supabase.com/pricing](https://supabase.com/pricing) | 500 MB database, 2 active projects, shared CPU/500 MB RAM | No | **Paused after 1 week of inactivity** | **None** (Pro: 7 days) | The app's 30 s lease heartbeat counts as activity, so a running site never pauses — but a stopped site can |
| **Neon** — [neon.com/pricing](https://neon.com/pricing) | Permanent free plan: **100 CU-hours/project**, 1 GB storage/project, 20 GB total, 10 branches | No | **Autosuspends after 5 minutes, always, on Free** | None (instant restore is paid) | **100 CU-h is less than a month at the 0.25 CU minimum** (0.25 × 730 h = 182.5 CU-h). A 24/7 lease heartbeat would exhaust a free project before month end |
| **Koyeb serverless Postgres** | "Free 5h" instance only | — | Scales to zero | — | 5 hours/day |
| **Render Postgres** | 256 MB, **deleted after 30 days** | No | — | No | Unusable |
| **Railway / Fly Managed Postgres** | No free allowance | Yes | — | — | Paid |
| **Oracle Always Free block volume + self-hosted Postgres 16** | 200 GB block storage | **Yes** | Never | You own them (`pg_dump`) | Card required |
| **Local Docker PostgreSQL 16 (`tambola-pg`)** | Free | No | Never, while the container runs | `db:backup` + `db:restore-check` (T: 18 tables, 10,498 rows, restored and verified) | One machine, one disk |

**Consequence for the zero-cost design:** the only free database that both stays
awake and belongs to this project is the local PostgreSQL container. Supabase Free
is the best free *managed* option, with two caveats that must be written down for the
client: no provider backups on Free, and a pause after a week of total inactivity.

---

## 4. Supporting services

| Need | Service | Free allowance (D) | Card? | Used here? |
| --- | --- | --- | --- | --- |
| CDN, DDoS, TLS termination | **Cloudflare free plan** | Unmetered CDN + DDoS mitigation, universal TLS | No | Recommended in front of any public URL |
| HTTPS for a local origin | **Cloudflare Quick Tunnel** | Free, ephemeral hostname, 200 in-flight | No | **Yes — this is the current public path** |
| CI | **GitHub Actions** — [docs.github.com billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) | "Standard GitHub-hosted runners in public repositories" are free, no minute cap | No | **Yes — `.github/workflows/ci.yml`** |
| Scheduled probes | **GitHub Actions cron** | Free on a public repo | No | **Yes — `.github/workflows/uptime.yml`** (backup layer, 20-minute cadence) |
| Uptime monitoring | **UptimeRobot** — [uptimerobot.com/pricing](https://uptimerobot.com/pricing/) | 50 monitors, **5-minute** interval, no card | No | Recommended as the primary alert |
| Error tracking + 1 cron monitor | **Sentry Developer** — [sentry.io/pricing](https://sentry.io/pricing/) | 1 user, 5k errors/mo, 5 GB logs, 1 uptime + 1 cron monitor, 30-day lookback | No | Recommended; not activated (needs an account) |
| Logs | Container stdout + platform log store | Render/Railway/Fly keep 3–7 days free | No | **Yes — the app already logs structured JSON to stdout** |
| Analytics | Cloudflare Web Analytics / self-hosted Umami | Free | No | Not needed: the game has no marketing funnel to measure |
| Email | **Resend** — [resend.com/pricing](https://resend.com/pricing) | 3,000 emails/mo, 100/day, 1 domain | No | **Not required** — invite links are copy/paste + QR, no email is sent |
| Object storage (offsite dumps) | **Cloudflare R2** — [R2 pricing](https://developers.cloudflare.com/r2/pricing/) | 10 GB-month, 1M Class A, 10M Class B, **free egress** | R2 activation requires a payment method on the account (D) | Optional; the free alternative is a second disk or a private GitHub release |
| Secrets | Platform environment variables / GitHub Actions secrets | Free | No | **Yes** — no secret is ever committed (`npm run secret-scan` enforces it) |
| Domain + DNS | Cloudflare Registrar at cost (~$10–15/yr) or the free `trycloudflare.com` hostname | Not free (domain) | Yes | **Blocked:** buying a domain needs the client's approval and money |

---

## 5. Four architectures, priced

Costs are monthly at list price on 2026-10-31, excluding tax and excluding a domain.

### A. Free managed hosting + free managed Postgres

`Render Free web service (512 MB) + Supabase Free`

- **$0/month.** No card.
- **Does not satisfy the contract.** Render spins the process down after 15 minutes
  of HTTP *and* WebSocket silence — which is exactly a room waiting for its next
  number at an 8 s interval with 15 idle minutes between games, or any quiet
  evening. On wake, a ~60 s cold start means players see a loading page while the
  in-process scheduler is not running. A mid-game freeze is a lost game, not a
  slow page.
- Supabase Free adds: no provider backups, pause after a week of inactivity.
- **Verdict: advertised, plausible on paper, incompatible in practice.** This is the
  trap the brief warned about: "do not call a service free simply because it has a
  free tier".

### B. Free self-hosted

**B1. The workstation that already runs the stack** — `docker compose` + PostgreSQL
container + `cloudflared` Quick Tunnel.

- **$0/month**, no card, no account, full compatibility (T: this is what Phase 15/16
  gates ran against, and the smoke test in this phase passes against it).
- Limits, all real: the machine must stay powered; the URL changes on every tunnel
  restart; no uptime guarantee; 200 in-flight requests; one disk holds both the
  database and the dumps; a home connection's upload and jitter are the latency floor.
- **Verdict: genuinely free, genuinely suitable, not a public product.** Use it for
  client demos, UAT and the acceptance round.

**B2. Oracle Cloud Always Free Ampere A1 VM** — self-hosted Docker Compose + a local
PostgreSQL container, or Supabase Free as the database.

- **$0/month forever**, 24/7, stable public IP, your own TLS.
- Requires **a credit/debit card for identity verification** and an account that is
  not left idle for 30 days. That is outside this phase's authorization, and it is a
  genuine operational commitment (patching, firewall, fail2ban, cert renewal).
- **Verdict: the best zero-cost *public* option, blocked on a card + ops ownership.**

### C. Current local Docker + Quick Tunnel (what exists today)

Same as B1; it is the status quo, and it is what the repository's `deploy/free-start.ps1`
/ `free-stop.ps1` automate. Cost $0. Demo-grade only.

### D. Lowest-cost reliable paid (for comparison only)

| Combination | Monthly | Annual | What the money buys |
| --- | --- | --- | --- |
| Fly.io `shared-cpu-1x` 512 MB + Supabase Free | **~$3.69** | ~$44 | Always-on process, stable `*.fly.dev` hostname, no spin-down; database still has no provider backups |
| Fly.io 512 MB + Supabase Pro | ~$28.69 | ~$344 | Adds daily backups, no pause, 8 GB database |
| Render Starter (512 MB, always on) + Supabase Free | ~$7 | ~$84 | Same as above on a friendlier platform |
| Render Starter + Supabase Pro | ~$32 | ~$384 | The "sleep at night" configuration |
| Any of the above + domain | +$10–15/yr | — | A name the client owns |

Measured sizing input (Phase 16B, durable, local PostgreSQL): 50 rooms × 250 players
holds at **137–143 MB RSS** across two runs, ~50% of one core, event-loop p99
29–34 ms, with 750 call acks and zero duplicate calls. A 256 MB machine is therefore
sufficient at this scale; 512 MB leaves room for the Node heap to breathe.

---

## 6. Recommendation

**Zero cost, chosen:** B1 — the existing Docker Compose stack behind the Quick
Tunnel — for demos, UAT and the client acceptance round. It is the only $0
configuration that keeps all seven requirements in §1, and it is already proven by
the gates in this phase.

**Zero cost, if a stable public URL is required:** B2 — Oracle Always Free Ampere A1
with the same Docker image. It costs nothing but needs a card for verification and
an owner who will patch it.

**Cheapest reliable paid:** Fly.io 512 MB + Supabase Free (~$3.69/mo) if the client
accepts "no provider backups, our own dumps are the backup"; Supabase Pro
(~$28.69/mo) if they do not.

**Do not choose:** Render Free or Railway Free for the game server. Both are honest,
well-built products that this architecture cannot use, for the reasons measured
above. Choosing them would produce a demo that fails on a quiet evening.

---

## 7. What is deliberately not activated

- No account was created anywhere in this phase.
- No card was entered anywhere.
- No domain was bought.
- Sentry, UptimeRobot, R2 and Resend are documented and wired behind configuration,
  not activated: they need an account, and an account needs a human.
- Nothing was migrated. The current deployment (Supabase as the production
  database, no application host) is unchanged.

Every activation step that remains is listed in `docs/DEPLOYMENT-READINESS.md` §10
and `docs/PHASE-16B-REPORT.md` §10, with the exact approval each one needs.
