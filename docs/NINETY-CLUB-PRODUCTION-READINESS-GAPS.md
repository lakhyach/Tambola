# Ninety Club production readiness gaps

Updated 5 November 2026. **Decision: FAIL — CONFIRMED BLOCKERS REMAIN.** Local product tests and browser evidence do not certify authenticated roles, a production deployment or Supabase provider readiness. No production database, deployment, DNS or real-money flow was accessed.

## Verified local facts

- Fresh production image ninety-club-audit:2026-11-05 built and ran in isolated containers. App bound to 127.0.0.1:4000; dedicated PostgreSQL 17 container on 127.0.0.1:55463, temporary storage, schema chromeacceptance.
- /readyz reported ready durable service, migrations through 027, lease held and zero pool errors.
- Latest available full Node suite: 759/759 pass, 0 fail, 0 skipped across 20 suites, explicit loopback PostgreSQL, .env bypassed. Client lint/build passed; no Vite chunk advisory after Three.js split.
- Actual Chrome verified host/player create/join, ticket assignment, manual calls, valid Early Five UI claim, synchronized settlement, 20 points, reload recovery, end and reset. DB rows matched one claim and award.
- chromeacceptance.owner_accounts count is zero. User must run supported owner provisioning and enter the secret locally.
- Strict production environment check on the local-only profile returned NOT READY. Its HTTP origin and absent TLS DB/proxy settings are expected for this isolated test, not evidence that a production profile passed.

## Confirmed release blockers

| ID | Severity | Blocker | Required closure |
|---|---|---|---|
| PR-01 | Critical | Authenticated Owner/Admin/Super Admin acceptance incomplete | Provision local test owner using supported CLI; user signs in; exercise MFA, CSRF, session rotation/recovery/logout/expiry/throttling and Admin actions. Establish and separately test any distinct Super Admin tier. |
| PR-02 | High | Moderator current Chrome/backend authenticated acceptance incomplete | Recreate disposable invite, accept and authenticate manually; test grants and denials in this browser/backend. |
| PR-03 | High | Full role/action acceptance incomplete | Only sampled Host/Player/Public actions and protected guards observed. See complete 46-template ledger in role matrix. |
| PR-04 | Critical | Supabase target/staging identity and migration history unresolved | Earlier owner:list package command may load .env. Current sanitized inspection classifies ignored .env target as non-loopback Supabase, schema public. Historical owner:list implementation invoked migrations; connection success/commit is unknown. Authorized operator must verify project identity, migration ledger, schema and provider logs read-only. Do not assume empty or rollback blindly. |
| PR-05 | Critical | Production environment and deployed host not validated | No deployment secrets/origin/proxy supplied. Run strict check against explicitly selected real deployment and validate HTTPS/WSS, cookies, CORS, proxy IP, rate limits and external health in authorized staging. |
| PR-06 | High | Supabase compatibility not verified against authorized staging | Session pooler/advisory-lock and CA requirements are code/docs findings only. Validate connection mode, CA, grants, DDL migrations, limits, backup/restore, latency and recovery in confirmed staging. |
| PR-07 | High | Accessibility/device/provider acceptance incomplete | Complete keyboard pass, screen reader, contrast combinations, physical devices and voice playback remain open. |
| PR-08 | High | Duplicate/invalid rejection not sent through actual Chrome | UI hides awarded claim and disables ineligible claims; tests cover rejection. Controlled browser duplicate/invalid attempt and no-second-award verification remain open. |

## Database target forensics

Current continuation DB: isolated disposable PostgreSQL 17, loopback-only port 55463, database codex, schema chromeacceptance; fresh migrations through 027. It served this Chrome acceptance. Room JEEP2U5H is reset to WAITING; historical claim/award remain in the disposable DB.

Earlier CLI uncertainty: a prior npm run owner:list was invoked without verified loopback overrides. package.json uses --env-file-if-exists=.env, so it loads ignored .env unless overridden. Sanitized read-only inspection classifies its target as Supabase/non-loopback and schema public. Historical source indicates the earlier owner:list invoked migrations; the CLI was later changed to avoid migration-on-list. An attempted remote migration is therefore possible, but connection or committed DDL is unproven. No remote follow-up or rollback was performed.

Confidence: high that the current DB is isolated; high that the earlier command could target .env's remote host; low/unknown whether it authenticated, connected or committed. Project identity/staging status remains unconfirmed.

## Production configuration review

- Required settings include DATABASE_URL, PUBLIC_ORIGIN, TRUST_PROXY, OWNER_MFA_KEY and NODE_ENV=production.
- Owner cookie is HttpOnly and Secure in production, SameSite Strict; CSRF double-submit, exact CORS allowlist, same-origin sockets, rate limiting and signal shutdown were reviewed in source.
- TRUST_PROXY must match ingress topology. Generic Compose and Docker examples bind app port to loopback; same-host TLS proxy expected.
- Docker healthcheck uses /readyz. Readiness includes durable DB/migration/lease state. Strict env gate is not automatically guaranteed by npm start/Docker CMD; deploy automation must run it explicitly.
- Migrations 001–027 run on application boot and need DDL-capable grants and session-level advisory locking. Production needs controlled migration leadership and tested restore.
- Supabase session pooling must preserve session-level advisory lock; transaction pooling is incompatible with that assumption. TLS CA and hostname verification are required by deployment docs. Provider validation remains unverified.
- No production secret was read into this report.

## Operator prerequisites

1. Confirm intended Supabase project identity, staging/production status and whether earlier command reached it; inspect logs/migration ledger read-only.
2. Select deployment host, proxy topology, HTTPS origin, DB/pooler mode, CA, backup plan and secret injection.
3. In isolated local container only, run owner provisioning; user enters password privately and signs in manually.
4. Complete Owner/Admin/Super Admin and Moderator matrix with positive and negative authorization tests.
5. Verify duplicate/invalid claim browser rejection; complete accessibility and device/audio checks.
6. In confirmed non-production staging, pass strict env checks and capture HTTPS/WSS, cookies, CORS, rate-limit and readiness evidence.

Until critical PR-01, PR-04 and PR-05 close, production readiness is **FAIL — CONFIRMED BLOCKERS REMAIN**.


## 5 November 2026 — authenticated-role mission checkpoint

The owner-provisioning command was reviewed before execution. The supplied npm script invokes Node with --env-file-if-exists=.env, so it was deliberately not used for the operator step. The safe direct command is:
docker exec -it ninety-audit-app-20261105 node scripts/owner.js create

Sanitized container checks confirm the running app is on the dedicated Docker network with the disposable PostgreSQL container; app DB identity is database codex/schema chromeacceptance, with DB container internal address 172.17.0.3 and host publication only at 127.0.0.1:55463. The isolated owner_accounts count remains zero. No OWNER_USERNAME or OWNER_PASSWORD is preloaded; OWNER_MFA_KEY is configured. The script's create path runs the migration runner before owner insert, refuses a second owner, prompts for username, and asks for password through a hidden interactive prompt. The direct Node invocation inherits the already-verified container environment and does not parse .env. No provisioning was run because the password must be entered by the user privately; no credential was generated, requested in chat, or handled by the agent.

Source review confirms client /admin and /super-admin route trees are the same ownerRoutes mounted under AdminRoot. AdminGate is a navigation convenience; API security is server-side and requires a verified owner session. Server admin routes use requireOwner and mutations require double-submit CSRF. The reviewed implementation does not establish separate Admin and Super Admin accounts, roles, or authorization tiers. Therefore Admin and Super Admin acceptance cannot honestly be reported as separate role sessions unless product policy/code first establishes those roles.

Existing automated coverage includes owner login throttling, CSRF rejection, anonymous and host/player denial, owner session handling, moderator grant scoping, host-only socket event refusal, cross-room seat token isolation, duplicate claims, and invalid claim behavior. These are code/test results, not actual-Chrome authenticated role acceptance. Actual owner provisioning and browser-authenticated acceptance await the user's interactive local step.

## Sanitized operator handoff: earlier owner:list ambiguity

Command involved: npm run owner:list, whose package script resolves to node --env-file-if-exists=.env scripts/owner.js list. In the earlier CLI revision, list initialized through the migration runner. Because --env-file-if-exists loads .env values not already in the process environment, a host invocation without explicit DATABASE_URL/DB_SCHEMA overrides could select the ignored .env endpoint and its public schema. Sanitized inspection classified that endpoint as a remote Supabase pooler, not loopback. The current CLI implementation changed list to read-only and no longer runs migrations, but that later code does not establish what the earlier process ran.

Historical sanitized evidence from the target investigation recorded migration versions 001–003 present and matching local checksums; versions 004–027 were pending at that later read-only observation. If the earlier invocation used that same target and successfully authenticated, migrations 004–027 were the possible pending range; if timing/target differed, the exact set may differ. There is no captured connection result, transaction log, command stdout, project identity confirmation, or proof of committed DDL. Treat this as possible impact, not a finding that migration occurred.

Authorized operator should establish project reference and environment first, then inspect provider audit/connection logs around the command time, migration tracking rows/checksums, schema object definitions and ownership, and relevant database logs. Capture a provider snapshot/backup before any corrective action. Compare the actual schema to the repository migration chain and application version. If no migration ran, record that with evidence and retain state. If some/all ran, determine compatibility and whether application startup/normal writes occurred afterward; prefer a forward repair migration where safe. Restore/rollback only from a verified backup and only after impact analysis; never blindly delete migration rows or reverse DDL.

## 5 November 2026 — superseding local acceptance update

The local owner and moderator authentication blockers are closed for disposable acceptance: the owner was provisioned without loading `.env`, and actual Chrome completed owner MFA sign-in and the moderator invitation/MFA flow against the isolated `chromeacceptance` database. Actual Chrome rendered all 46 route templates, including authenticated owner-protected pages. Selected Owner and Moderator actions and denial cases are recorded in the role/action matrix. Full role/action acceptance is still incomplete; `/admin` and `/super-admin` use the same owner model, and there is no evidence for distinct Admin or Super Admin roles. Socket ticket issuance was checked, but an actual moderator socket operation and session revocation lifecycle were not.

Full Node regression passed 759/759; client lint/build, 51 security probes, 675-file secret scan, root/client dependency audits (zero vulnerabilities), and an isolated production image startup/readiness check passed. Production deployment remains blocked by missing deployment-specific settings, unverified HTTPS/WSS/provider behavior, the unresolved earlier `owner:list` target ambiguity, and remaining accessibility/audio/browser action coverage. Do not contact the unconfirmed Supabase target; operator investigation must be read-only first.

## Role-model correction (5 November)

The Owner and Super Admin UI alias has been removed. `/super-admin/*` now fails closed pending an approved distinct role model; Owner API calls continue to require verified Owner sessions. New Owner activity is attributed as `owner` after migration 028, while legacy audit rows remain unchanged. A separate Admin role, Super Admin provisioning/revocation, instance-scoped Admin policy and complete action matrix remain product/security blockers. This local correction does not close production readiness.

## Post-correction verification (5 November)

Migration 028 ran successfully in disposable schema `roleauditfinal`; production-mode container readiness passed. Full suite passed **759/759**, client lint/build passed, security probes **51/51**, secret scan passed (679 files), and root/client npm audits showed zero vulnerabilities. Actual Chrome confirmed `/super-admin/settings` is fail-closed and `/admin/signin` remains accessible. This reduces the risk of accidental Owner/Super Admin equivalence but does not implement a new Super Admin identity or an instance-scoped Admin role. The readiness decision remains FAIL.

### Operator handoff for the earlier `owner:list` ambiguity

Do not reconnect to the unconfirmed Supabase endpoint from this development session. An authorized operator must, in an approved read-only workflow:

1. Confirm the provider project reference and whether it is staging or production using the console/account owner.
2. Preserve provider logs/audit logs for the command time; establish whether a connection and DDL transaction occurred.
3. Read the migration ledger, checksums, actual schema objects, ownership/grants, and database logs; compare with repository migrations 001–028.
4. Capture/export a provider snapshot before any repair. Record exact evidence and timeline.
5. If changes are present, assess app writes and compatibility and plan a forward repair or verified restore with change control. Never delete migration rows, reverse DDL, or perform a blind rollback.

## Latest local role-security verification — 5 November 2026

The previous PR-01 wording is superseded for local Owner/Super Admin separation: separate persisted roles, server-side authorization, CLI-only promotion/revocation, audit recording, session revocation, and last-Super-Admin protection are now implemented and tested. A separate Admin role remains unavailable because its instance capabilities and grant policy are not defined. Local role separation is not equivalent to full role/action acceptance or production readiness.

Actual Google Chrome on a fresh production-mode container (loopback-only port 4004, PostgreSQL schema `rolebrowser`) confirmed Owner settings/reload, Owner 403s for global overview/instances, Super Admin MFA, authorized overview/instances reads, and 401 after sign-out. Schema migrations reached 029. The browser run had zero page errors and zero unexpected console errors; expected denial responses produced three console entries. The machine-readable record and screenshots are listed in `NINETY-CLUB-CHROME-ACCEPTANCE-EVIDENCE.md`.

Current local checks: Node **761/761** (20 suites); client lint/build pass; security probes **51/51**; secret scan **681 files** pass; root and client dependency audit report zero vulnerabilities; fresh Docker build and production-mode readiness pass. These local checks do not close incomplete Chrome action coverage, Moderator live socket UI acceptance, browser-submitted adversarial claims, or manual accessibility/device/provider testing.

### Remaining blockers and operator handoff

| Blocker | State | Required evidence to close |
|---|---|---|
| Admin role policy | Not implemented by design | Product owner defines instance capability list, assignment, provisioning, revocation, MFA, audit and recovery before implementation |
| Full role/action browser acceptance | Partial | Exercise every meaningful Owner/Super Admin/Moderator/Host/Player action, positive/negative path, persistence, audit and recovery in browser |
| Moderator live Socket.IO lifecycle | Server integration tests pass; Chrome action untested | Actual Chrome socket action, invalid/cross-room/cross-instance events, expiry, revocation disconnect, reconnect denial, and MFA/session lifecycle |
| Claim attack acceptance | Automated tests cover core rejections; adversarial Chrome actions untested | Controlled invalid, duplicate, forged, cross-room, unauthorized and concurrent claims with DB evidence and no duplicate award |
| Accessibility and media | Partial/untested | Keyboard pass, screen reader, contrast combinations, reduced motion, mobile devices, audio controls and voice-provider playback |
| Supabase earlier `owner:list` ambiguity | Unresolved; remote access prohibited | Authorized operator confirms project/environment and inspects provider logs, migration ledger, checksums and schema read-only; compare migrations 001–029; preserve snapshot before any corrective work |
| Production host/configuration | Not supplied or tested | Authorized staging values and evidence for DB URL/provider behavior, HTTPS origin/TLS, proxy, MFA secret injection, WSS, cookies, CORS, limits and readiness |

Do not deploy or contact the unconfirmed Supabase target. Any external operator handoff remains read-only until the project identity is confirmed and an approved change plan exists.

## Final local verification checkpoint — 5 November 2026

Local verification after the role/MFA boundary fix: Node **761/761** (20 suites, zero skips) against the disposable loopback PostgreSQL container; client lint/build; security probes **51/51**; post-build secret scan **685 files**; full root/client dependency audits with zero vulnerabilities; production-mode Docker acceptance app healthy with `/readyz` ready and schema at migration 029. This does not alter the readiness decision because the application/browser gaps and external prerequisites in the table above remain unresolved.
