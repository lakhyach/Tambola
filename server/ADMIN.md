# Owner control centre (`/admin`)

A private, owner-only management surface for the Tambola server. It is a real
separate app area, not a host toolbar or a hidden link: every page under `/admin`
requires an owner session, and every `/api/admin` route re-verifies that session
on the server before reading or changing anything.

The owner identity is deliberately **not** the same thing as a game host or a
player:

| | Owner | Game host | Player |
| --- | --- | --- | --- |
| Credential | owner session cookie (`tambola_owner`) | host session token over Socket.IO | player session token over Socket.IO |
| Stored in | `owner_sessions` (hashed) | `sessions` (hashed) | `sessions` (hashed) |
| Can reach `/api/admin` | yes | **no** | **no** |
| Created by | CLI on the server | creating a room | joining a room |

A host token cannot be exchanged for an owner session, and an owner session
cannot be used to resume a host or player seat. The admin layer drives the game
through the same persistence controller a connected host uses; nothing in the
browser writes game state.

---

## 1. Requirements

- PostgreSQL reachable through `DATABASE_URL`. Owner accounts, sessions, the
  audit trail, the shared sign-in throttle and the MFA state are durable; the
  dashboard refuses to sign anyone in when no owner account exists.
- Node 18+ (scrypt and `node:crypto` are built in; the project targets Node 24).
- `OWNER_MFA_KEY` **only if** you want the owner second factor (TOTP). Without it
  the control centre reports MFA as unconfigured and sign-in stays password-only.
  See §5 and `server/RUNBOOK.md` §6.
- The built client (`client/dist`) served by the same Node process, or the Vite
  dev server with the `/api` proxy in `client/vite.config.js`. The admin API is
  same-origin by design and does not enable credentialed CORS.

## 2. First-time setup

Apply the schema (idempotent, versioned and checksummed by
`server/db/migrate.js`):

```bash
npm run migrate
```

Create the owner account. Prefer the hidden prompt so the password never lands
in shell history:

```bash
npm run owner:create
# Owner username: operator
# Owner password: ********
```

For an automated environment you may pass the values instead:

```bash
OWNER_USERNAME=operator OWNER_PASSWORD='<at least 8 characters>' npm run owner:create
```

Only one account can be created this way. If an owner already exists, the CLI
refuses and points at `reset` / `remove`; there is deliberately no
"first visitor becomes admin" path and no public registration endpoint. Opening
`/admin` while no account exists shows a setup notice and cannot create one.

Then start the server and sign in at `/admin/signin`.

## 3. Account recovery and rotation

Run these on the server, with the same `DATABASE_URL` the game uses. They do not
need the game server to be stopped.

```bash
npm run owner:list                    # usernames, creation and last sign-in times
npm run owner:reset -- operator       # set a new password, revoke every session
npm run owner:mfa-reset -- operator   # destroy a lost second factor, revoke every session
npm run owner:remove -- operator      # delete the account and its sessions
```

`owner:mfa-reset` is the documented answer to "I lost my authenticator". It
requires `OWNER_MFA_KEY` to be set to the same value the server uses and refuses
to run without it, because a half-done reset could leave an account that cannot
sign in at all. On success it destroys the sealed secret, clears the confirmation,
revokes every live session and every outstanding challenge, and writes an
`owner.mfa.recovery-reset` audit row; the owner then signs in with the password
alone. The barrier is host access to the database - not anything the dashboard can
leak. See `server/RUNBOOK.md` §6.

`reset` and `remove` accept the username as an argument, `OWNER_USERNAME`, or a
prompt. The new password can be supplied as `OWNER_NEW_PASSWORD`; otherwise it
is read from a hidden prompt. `remove` asks for `remove <username>` unless
`OWNER_CONFIRM=1` is set.

Rotating the password from `/admin/settings` revokes every live owner session,
including the one that performed the rotation, and writes an
`admin.password.rotate` audit row.

If everyone with owner access is unavailable, `owner:reset` is the recovery
path. It never prints a password and never reveals a stored hash.

## 4. Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Required for owner accounts, sessions, audit, history and all durable queries. |
| `DB_SCHEMA` | Schema the server pins its connections to (default `public`). |
| `PUBLIC_ORIGIN` | Exact public origin used to build invite URLs and QR codes, e.g. `https://games.example.com`. Without it the invite link falls back to the request host and the UI shows a setup warning. |
| `TRUST_PROXY=1` | Set when a reverse proxy terminates TLS, so `req.ip` and `req.protocol` describe the client rather than the proxy. Leave unset for direct connections. |
| `NODE_ENV=production` | Marks owner cookies `Secure`. Requires HTTPS. |
| `TAMBOLA_COOKIE_SECURE=1` | Forces the `Secure` attribute independently of `NODE_ENV` (useful when testing behind HTTPS locally). |
| `ALLOWED_ORIGINS` | Browser origins allowed to open a game socket. It does **not** enable credentialed admin CORS; the admin app is same-origin only. |
| `OWNER_MFA_KEY` | 32-byte key (64 hex chars or base64) that encrypts each enrolled owner's TOTP secret at rest (AES-256-GCM). Absent → MFA reports unconfigured and enrollment is refused; malformed → the server fails at boot rather than storing an unopenable secret. **Back it up separately from the database** - a sealed secret is useless without it. |
| `MFA_ISSUER` | The label shown in authenticator apps (default `Tambola`). Cosmetic; changing it does not break enrolled devices. |

There are no admin secrets in the environment: no bootstrap token, no API key,
no shared password. The only secret is the owner's password, supplied once to
the CLI and stored only as a scrypt digest.

## 5. Security model

**Password storage.** `scrypt` with `N=16384, r=8, p=1`, a 16-byte random salt
and a 32-byte key, stored as `scrypt$N$r$p$salt$hash`. Verification uses
`timingSafeEqual`. A successful sign-in rehashes transparently if the stored
parameters are ever raised.

**Sessions.** Sign-in mints a fresh 32-byte random token (64 hex characters).
Only its SHA-256 hash is stored in `owner_sessions`, alongside the owner id, a
fingerprint of the client address and timestamps. Idle limit: 12 hours. Hard
limit: 7 days. Sign-out revokes exactly the current session. A password rotation
or CLI reset revokes every session for the owner. A login always creates a new
session, so a pre-set session token cannot survive authentication
(session-fixation defence).

**Cookies.**

| Cookie | Attributes | Purpose |
| --- | --- | --- |
| `tambola_owner` | `HttpOnly`, `SameSite=Strict`, `Secure` in production, `Path=/api/admin` | Owner session token. Never readable by page script and never sent to game routes. |
| `tambola_csrf` | not `HttpOnly`, `SameSite=Strict`, `Secure` in production, `Path=/api/admin` | Double-submit CSRF value. |

The CSRF value is returned in the response body of `GET /api/admin/session` and
`POST /api/admin/signin` (the Path scope hides the cookie from the `/admin`
document) and must be echoed in the `X-CSRF-Token` header on every non-GET
request. A mismatch is refused with `403 CSRF_FAILED` before any owner check.

**Login abuse.** The limiter is durable: counters live in the `auth_throttle`
table (migration `003_hardening.sql`), keyed by `(scope, sha256(key))` and
incremented inside a `SELECT ... FOR UPDATE` row lock, so two concurrent guesses
cannot both read "7 of 8", and a process restart - or a second process pointed at
the same database - cannot reset a lockout. There are independent budgets:
`username | sha256(address)` gets 8 failures per 15 minutes → 5 minute lock,
doubling per repeat offence up to 60 minutes; a bare-address budget (25 failures
→ 15 minutes) makes spraying many usernames from one source expensive; the
second factor gets its own 10-failure budget. A successful password clears its
key, so a legitimate owner is never punished after succeeding. Every lockout is
audit-recorded as `owner.signin.rate-limited`. Nothing logs a raw IP or username;
only the hash is stored. (A process-memory limiter remains only as the fallback
when there is no database at all - memory mode, which cannot sign an owner in
anyway.)

**Second factor (TOTP).** When `OWNER_MFA_KEY` is set, an owner can enroll an
authenticator under **Settings → Two-factor sign-in**: a QR/secret is generated
server-side, and one *current* code must be entered to confirm. Until confirmed,
the enrollment is *pending* and sign-in stays password-only, so an abandoned
enrollment can never lock the owner out. The base32 secret is stored only as an
AES-256-GCM envelope (`v1.<iv>.<tag>.<ct>`, owner-bound AAD) in
`owner_accounts.totp_secret_enc`; the plaintext and the provisioning URI never
reach the database, a log or a response after enrollment. Codes are verified with
RFC 6238 at ±1 step (`MFA_WINDOW=1`), and a spent step is recorded in
`totp_last_step` so a code cannot be replayed inside its window.

Once confirmed, a correct password no longer buys a session - it buys only a
short-lived, single-use **pre-authentication challenge** (`owner_mfa_challenges`,
hashed token, its own attempt budget and expiry, consumed exactly once, and never
a session cookie). The authenticator code at `POST /signin/mfa` is the only thing
that trades that challenge for a real session. Disabling MFA, rotating the
password and the CLI `owner:mfa-reset` all revoke every live session and every
outstanding challenge, keeping the security behaviour consistent. Losing
`OWNER_MFA_KEY` while enrolled owners exist means each must be recovered with
`npm run owner:mfa-reset`.

**Authorisation.** `requireOwner` runs on every protected route: it reads the
cookie, verifies the hashed session, re-loads the owner row, and only then
attaches `req.owner`. There is no client role flag, no URL secret and no
"trusted host token" path. Game mutations additionally pass through the
controller's room lock and the room's own managed credential, so an admin
action obeys exactly the same state machine and durable-before-authoritative
ordering as a host action.

**Audit.** Every sign-in decision, mutation and password rotation is written to
`admin_audit` with an actor username, an action code, an optional target, a
timestamp and safe metadata (counts, enabled patterns, hashed address). Never a
password, token or raw IP. Rows survive account and room deletion.

**Data minimisation.** Read queries never select `games.draw_sequence`, the
private draw plan. The dashboard shows the official `draw_calls` history only.
Admin responses are never cached (`Cache-Control: no-store`).

## 6. API surface

All routes below are mounted at `/api/admin`. Everything except `session` and
`signin` requires an owner session; every non-GET additionally requires the CSRF
header.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/session` | Session state, CSRF token, setup flag, persistence mode, MFA state. |
| POST | `/signin` | Step one: verify the password. With MFA enrolled returns only a short-lived single-use `challengeToken` (no cookie/session); otherwise mints a session and sets cookies. |
| POST | `/signin/mfa` | Step two: trade `challengeToken` + a current TOTP code for the session. The challenge is spent whether the code is right or wrong. |
| POST | `/signout` | Revoke the current session and clear the cookie. |
| GET | `/overview` | Counts, open rooms, recent winners/claims, health. |
| GET | `/games` | Paginated, filterable room directory. |
| POST | `/games` | Create a room (name, interval, patterns, auto-call). |
| GET | `/games/:roomId` | Full room detail: calls, members, tickets, claims, awards, rounds, engine audit. |
| GET | `/games/:roomId/invitation` | Invite URL, server-rendered QR data URL, WhatsApp link. |
| POST | `/games/:roomId/start` | Start a round. |
| POST | `/games/:roomId/call` | Call the next number. |
| POST | `/games/:roomId/pause` | Pause a running round. |
| POST | `/games/:roomId/resume` | Resume a paused round. |
| POST | `/games/:roomId/end` | End the current round. |
| POST | `/games/:roomId/reset` | Return a completed room to waiting. |
| POST | `/games/:roomId/autocall` | Turn automatic calling on or off. |
| POST | `/games/:roomId/close` | Close the room; keep all history. |
| DELETE | `/games/:roomId/members/:playerId` | Remove a seated player and revoke their session. |
| GET | `/players` | Paginated player directory. |
| GET | `/players/:playerId` | Memberships and awards for one player. |
| GET | `/history` | Durable room history with state/date filters. |
| GET | `/audit` | Owner audit trail, optionally filtered by room. |
| GET | `/settings` | Owner accounts, active sessions, origin, health, runtime, MFA state. |
| POST | `/settings/password` | Rotate the signed-in owner's password. |
| POST | `/settings/mfa/enroll` | Generate a pending TOTP secret + provisioning URI (requires `OWNER_MFA_KEY`; not confirmed yet, so this cannot lock the owner out). |
| POST | `/settings/mfa/confirm` | Prove one current code to activate the second factor. |
| POST | `/settings/mfa/disable` | Destroy the second factor and revoke every live session. |
| GET | `/health` | Database and persistence status. |

Mutation responses use honest status codes: `401` unauthenticated, `403` CSRF
failure, `404` unknown room/player, `409` invalid transition, `423` frozen or
recovery-required room, `429` rate limited, `503` database unavailable.

## 7. Schema

Migration `002_owner.sql` adds:

- `owner_accounts` — unique normalised username, scrypt hash, timestamps.
- `owner_sessions` — hashed token, owner id, client fingerprint, idle and
  absolute expiry, revocation reason. Partial indexes on active sessions and
  expiry.
- `admin_audit` — append-only actor/action/target/room/metadata log with
  descending indexes for the recent list and per-room view.

Migration `003_hardening.sql` adds, for the second factor and durable abuse
control:

- `owner_accounts` columns `totp_secret_enc` (AES-256-GCM envelope, never
  plaintext), `totp_confirmed_at` (NULL = pending enrollment, so it can never
  lock the owner out) and `totp_last_step` (replay guard), plus CHECK constraints
  bounding the envelope and forbidding a confirmed factor without a secret.
- `owner_mfa_challenges` — the short-lived, single-use pre-auth challenge: hashed
  token (unique), owner id (`ON DELETE CASCADE`), expiry, `consumed_at`, an
  `attempts` budget and a hashed `ip_hash`. Live indexes on the unconsumed rows.
- `auth_throttle` — the durable shared attempt counter, one row per
  `(scope, key_hash)` with failures, strikes, window and `locked_until`,
  incremented under `SELECT ... FOR UPDATE`; a decay index keeps the sweep cheap.
- `audit_events_player_idx` — a covering index for the per-player audit view.

Deleting an owner cascades its challenges and sessions, so a removed account
cannot leave a usable second factor or token behind.

Migration `001_init.sql` (rooms, games, players, members, tickets, draw calls,
claims, awards, game audit) is unchanged, so existing game data is untouched.

## 8. Running locally

1. `npm run migrate`
2. `npm run owner:create` (once)
3. `npm start` — serves the built client and the API on the same origin.
   Rebuild the client with `npm run build` after frontend changes.
4. For frontend development: `npm run dev --prefix client` and a server on
   `:4000`. The Vite config proxies `/api` to `VITE_SERVER_URL` or
   `http://localhost:4000`, preserving the same-origin cookie behaviour.

## 9. Tests

```bash
npm test                              # server, persistence, admin, regression
npm run lint --prefix client          # JSX lint, zero warnings tolerated
npm run build --prefix client         # production bundle
```

`tests/admin.test.js` covers the security boundary (anonymous refusal, CSRF,
host-token denial, session fixation, rate limiting, logout revocation), the
admin lifecycle against the real controller in memory mode, invitation contents,
player removal over a socket, and a durable layer in an isolated schema (owner
tables, sessions, audit, totals, room detail without the draw plan, history).

## 10. Known limitations

- **Single owner tier.** Accounts are all full owners; there is no read-only or
  per-room operator role. Multiple accounts are not created by the CLI.
- **Second-factor key custody.** MFA is real now, but a sealed TOTP secret can
  only be opened with `OWNER_MFA_KEY`. Losing that key while enrolled owners
  exist forces every one of them through `owner:mfa-reset`; back the key up
  separately from the database. There is still no hardware key / WebAuthn - only
  TOTP.
- **Rate limiting is durable but single-instance.** `auth_throttle` survives
  restarts and is shared by any process that can reach the database, so it is no
  longer per-process. It is still scoped per username+address / address / session,
  not globally across an arbitrary fleet; a real multi-instance deployment first
  has to resolve the single-instance lease (RUNBOOK §5).
- **Rate limiting is address-scoped.** Users behind one NAT share a lockout key
  when they also share the username; that is intentional but worth knowing.
- **Same-origin only.** Credentialed CORS is disabled on purpose. A separate
  admin domain would need the cookie `Domain`/`SameSite` and the CORS policy
  revisited deliberately.
- **No owner IP allow-list.** Access control is the session plus the password.
  Use network policy or a VPN in front of `/admin` if that is required.
- **Cold rooms are recovered, closed rooms are not.** A lifecycle mutation
  (start/call/pause/resume/end/reset) on a room this process never loaded is
  served by rehydrating it from the database through the persistence controller
  (`controller.ensureRoom`) before acting, with the same integrity checks as boot
  recovery: if its history cannot be trusted the room is frozen
  (`RECOVERY_REQUIRED`) rather than invented, and a genuinely closed room is
  refused (`ROOM_NOT_LIVE`). Nothing is fabricated to make an action look
  successful.
- **No money, prizes or payments.** The game is free to play; there is nothing
  financial to manage and no wagering feature to gate.
