# Contributing to Tambola

Thanks for helping. This is a real-time multiplayer game whose whole value is that
**the server decides and the client displays** — a change that lets a browser
assert a fact about the game will be rejected in review, however well intentioned.

## Get oriented

| Where | What it owns |
| --- | --- |
| `server/game/` | the authoritative engine: state, draw, tickets, patterns, awards |
| `server/persist/` | the durable path. A mutation is written before it is broadcast |
| `server/net/` | the socket transport and [`CONTRACT.md`](server/net/CONTRACT.md), the event surface |
| `client/src/` | React screens. `client/src/lib/` holds the pure derivations that screens render from |
| `tests/` | Node's built-in runner, one file per concern |

Read [`README.md`](README.md) first, then the document that matches your change:
[`DEPLOYMENT.md`](DEPLOYMENT.md), [`server/RUNBOOK.md`](server/RUNBOOK.md),
[`server/DATABASE.md`](server/DATABASE.md), [`server/ADMIN.md`](server/ADMIN.md),
[`TEST-REPORT.md`](TEST-REPORT.md).

## The rules that matter

1. **The server is the only authority.** A client may display state and send
   intent; it may never compute a win, a ticket, a number or a score. Anything a
   browser can type into a payload must be re-checked server-side.
2. **Every protocol change updates `server/net/CONTRACT.md` in the same commit**, and
   gets a transport test. New events are additive; never revive a legacy event name
   (there is a deny list, and a test that guards it).
3. **No control that does nothing.** A button either works in the current state or is
   visibly unavailable *with the reason*. Misleading text counts as a bug — it is how
   a correct server looks like a broken game.
4. **Rules live in `server/game/patterns.js` and nowhere else.** A pattern without a
   predicate does not get a tile; if you cannot state the traditional rule, add it to
   `DEFERRED_PATTERNS` with the reason instead of guessing.
5. **Never put a secret in the client.** Anything reachable from `import.meta.env` is
   public. `VITE_*` variables are branding strings only.
6. **Free to play, always.** No money, wagers, entry fees or prize payouts — that is a
   product rule, not an unfinished feature.

## Before you open a pull request

```bash
npm run migrate   # once per database: the backup suite asserts against the migration ledger
npm run lint      # client ESLint, zero warnings allowed
npm run build     # the client bundle (the smoke suite serves client/dist)
npm test          # the whole suite; durable tests skip (and say so) without a database
npm run verify    # lint + build + test + secret-scan, in one command
```

`npm run verify` passing is the bar. Add a test for what you changed: the suite runs
plain client modules in Node by feeding them real engine snapshots, so derivation
logic does not need a browser to be proven.

Never commit `.env`, `backups/`, `client/dist/`, `.pgdata/` or `.preflight/` — the
`.gitignore` already excludes them; double-check with `git status` before `git add .`.

## The usual workflow

1. Fork the repository and create a branch: `git checkout -b fix-room-lease-message`.
2. Make the change, with its test and its documentation in the same commit.
3. `npm run verify`.
4. Commit with a message that says what a player or operator would notice, and push.
5. Open a pull request against `main`. Explain the behaviour, not the diff.

Small, self-contained changes land far faster than a rewrite. If you want to change
the rules of the game, the deployment shape or the event contract, open an issue
first — those decisions are deliberate and documented, and they interact with the
single-instance lease in ways a patch cannot undo.
