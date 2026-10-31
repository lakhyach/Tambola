# Client

The React single-page app: one codebase for the host screen, the player screen and
the owner control centre at `/admin`, built by Vite into `client/dist` and served by
the Node server itself in production.

The project-wide documentation lives in the [repository README](../README.md) and the
documents it links. This file only covers what is specific to working on the client.

## Running it against a local server

```bash
# terminal 1 - from the repository root
npm install
npm start                # the server on :4000 (reads .env; it refuses to boot without DATABASE_URL)

# terminal 2 - from client/
npm install
npm run dev              # Vite on :5173, proxying /api to the server on :4000
```

Open http://localhost:5173 for the dev server, or http://localhost:4000 to see the
same app served by the Node process from `client/dist` (`npm run build` first).
The proxy in [`vite.config.js`](vite.config.js) exists so the owner cookie, which is
scoped to `/api/admin`, keeps working during development the same way it does in
production. Socket.IO connects to the page's own origin, so the server must be
running for anything to move.

`npm run build` writes `client/dist`, which is gitignored; the server resolves it at
`../client/dist` and serves it as static files.

## How the code is arranged

- `App.jsx`, `Host*`, `Player*` — the entry and waiting screens, one per role.
- `GameScreen.jsx` — the data half of the in-game view: it owns the connection and
  mirrors the server snapshot into one plain `view` object.
- `components/GameShell.jsx` — the presentation half. It reads `view` and calls back
  out; it holds no game logic.
- `components/*` — everything else the shell composes (board, tickets, roster, chat).
- `lib/*` — the pure derivations, deliberately outside React so the Node suite can
  drive them with real engine snapshots:
  | Module | The decision it owns |
  | --- | --- |
  | `playerview.js` | which ticket state and which status sentence the screen may show |
  | `seatStore.js`, `joinSeat.js` | what this browser tab remembers, and when to ask before using it |
  | `chatFeed.js` | merging live chat with the history a new seat is given |
  | `celebration.js` | the celebration events that verified server facts support |
  | `refusals.js` | a server refusal code → a sentence a player can act on |
  | `confirmAction.js` | the second-click guard on destructive host actions |
  | `announce.js` | spoken numbers and the chime, and their opt-in |
- `config.js`, `brand.js`, `i18n/` — the client-facing configuration layer (brand,
  accent colours, links, languages) and the quick-chat catalogue. Display only: no
  value here can change how the game is played.

## Rules for client changes

The server decides, the client displays. Render what a snapshot says; never derive a
number, a ticket, a score or a win locally, and never let a control sit on the screen
that the server would refuse — disable it and say why. Protocol details the client may
use are in [`server/net/CONTRACT.md`](../server/net/CONTRACT.md).

```bash
npm run lint    # ESLint, zero warnings allowed
npm run build
```

Both are part of `npm run verify` at the repository root.
