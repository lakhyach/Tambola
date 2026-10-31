# The player's game

What a participant sees from the moment they open the link to the moment they read
their result, and the rules that decide what they can do at each step. This is the
player-side companion to [`CALLER-CONSOLE.md`](CALLER-CONSOLE.md), which covers the
host's screen.

Written for the client, the support desk and anyone who has to explain to a player
why the ticket "went grey" or why a claim was refused. Every behaviour described
here is enforced by the server; where a sentence says *the server*, a browser
cannot do it any other way.

---

## 1. The journey, step by step

| Step | Route | What the player can do | What the server decides |
|---|---|---|---|
| Land | `/` | Read what the game is; open *Join* or *Host* | Nothing yet |
| Join | `/player` | Type a name and the 8-character room code (or follow a share link) | Whether the code exists, whether the room is open, whether there is a free seat |
| Waiting room | `/player/room` | Choose how many tickets to play (**1 … the room's ceiling**), read every ticket, wait | How many grids exist, and that the count is inside `1..maxTicketsPerPlayer` |
| Start | `/player/game` | Nothing to press — the host starts | Locks the ticket count, fixes the order of all 90 numbers, issues the final grids |
| Playing | `/player/game` | Read the board, switch between their tickets, claim a pattern, chat | Draws each number, marks every ticket, decides every claim |
| Result | `/player/game` | Read their own points, awards and the final standings | Computes the leaderboard and stores the round |
| Reconnect | any | Reload, reconnect, switch from phone to laptop | Re-claims the seat by session, rebuilds the same tickets |

A late joiner is welcome: the room admits a seat mid-round, the player watches and
chats, and picks tickets for the next round. A seat with no ticket can never claim,
because a claim is evaluated against the tickets the server has issued to that
seat — and a mid-round seat has none yet.

## 2. Tickets are issued, never invented

The client asks for a **count**, never for numbers. `tickets:select` carries
`{ count }` and the server answers with grids it minted itself. There is no code
path by which a browser can name a number, reorder a row, or keep a grid the
server did not issue.

What the generator guarantees, on every ticket, every time
(`server/game/tickets.js`, pinned by `tests/ticket-properties.test.js`):

- 3 rows × 9 columns, exactly 15 numbers and 12 empty cells;
- exactly 5 numbers per row;
- 1–3 numbers per column, never 4;
- column *c* holds only numbers from its own decade (`10c–10c+9`, with the first
  column also owning 1–9 and the last also owning 80–90);
- numbers ascend down every column and never repeat inside a ticket;
- empty cells are real empties (`null` in the model, hatched in the UI), not zeros.

The **same validator** is used in three places, so a ticket cannot be valid in one
and invalid in another:

1. after minting (`createTicket` refuses to return a grid that fails);
2. when a room is hydrated from PostgreSQL (`server/persist/recovery.js`), so a
   hand-edited database row freezes the room instead of being dealt to a player;
3. in the engine's `integrityErrors()` pass, which also rejects a duplicate
   `(player, ticketNo)` pair or a duplicate grid inside one room.

A 20 000-ticket statistical sweep and a 5 000-ticket invariant sweep run as part of
`npm test`; both assert the distribution, not just the range.

## 3. Choosing tickets

The waiting room shows **the tickets the player will actually play**, not a
picture of a ticket. On entering the room the client asks the server for the
count the seat already holds, which materialises the real grids, so what is
previewed is what will be dealt when the host starts.

- The control states the count against the ceiling in words the screen reader
  also gets: *"4 of 4 selected · room maximum"*, and the `+` button disables
  itself at that point rather than silently ignoring the tap.
- Every count is a real radio button in a `radiogroup`, so a keyboard or
  screen-reader user jumps straight to "3 tickets" instead of pressing `+` twice.
  Arrow keys, `Home` and `End` move the selection.
- Tickets sit behind a **tab rail**: one ticket at a time, in the same component
  the round uses. Four stacked previews pushed the game itself off a phone screen
  in testing.
- A pick is sent to the server and the answer is rendered. A refusal (a host
  lowering the ceiling while a player is choosing) is shown under the control with
  the server's own reason, and the count snaps back to what the server holds.
- Selection is persistent: a refresh in the waiting room re-claims the seat and
  re-reads the same count and grids. Nothing is stored in the browser except the
  session token.

Once the host starts, the count is locked. The picker is not rendered during a
round at all, and the server refuses `tickets:select` with `INVALID_STATE` if an
old tab tries anyway.

## 4. Marking: the ticket marks itself

**This build deliberately has no tap-to-mark.** A cell is marked because the
official call history contains its number — nothing else. The reasoning, in the
order it matters:

1. A local mark can never be evidence. The server re-checks the ticket against
   its own `calledNumbers`, so a tap that only changed the screen would be a lie
   the player acts on.
2. A second, local notion of "marked" is where real products accumulate their worst
   bugs: two sources of truth disagree after a reconnect, and the player claims a
   line that "looks" complete.
3. Tambola is a watching game. The interesting question is *which numbers are
   left*, not *did I manage to tap them*.

So the read-out is derived, once per snapshot, by `client/src/lib/ticketview.js`:

| State | How it looks | What it means |
|---|---|---|
| Uncalled | graphite cell, ivory number | not drawn yet |
| Called | filled champagne gold, dark number | in the official history |
| Current | gold cell with a ring and a single reveal animation | the number just called |
| Empty | hatched cell with a centred dot | no number in this position |

Because the marks come from the snapshot, they are identical on every ticket tab,
identical on the board, and correct after a refresh or a reconnect — with no
reconciliation step to get wrong. Switching tabs or filters cannot change what the
server will accept. Nothing the player does in the UI can affect the draw order,
the call clock or the claim window.

The ticket also answers the two questions a line claim depends on without
arithmetic: *"9/15"* in the header, and a per-row chip (*R1 3/5*, *R2 5/5*,
*R3 1/5*) that turns gold the moment a row completes. `5/5` on a row is exactly
the condition the Top/Middle/Bottom Line claim checks.

## 5. Claims

Claim buttons exist only for patterns the room has enabled, and each one sends
`{ pattern, ticketNo }` — the intent, with the ticket it came from. The server:

1. refuses if the round is not `RUNNING` (`INVALID_STATE`), if the claim window
   has closed (`CLAIM_WINDOW_CLOSED`), if the pattern was already won
   (`ALREADY_AWARDED`) or if this seat already claimed it (`ALREADY_CLAIMED_BY_YOU`);
2. evaluates the pattern across **every ticket the seat holds**, and picks the one
   that completes it;
3. awards once, records `ticketNo` on the award, and broadcasts the result.

Feedback the player sees:

- success — a toast naming the ticket and the points: *"Ticket 2 · you completed
  Bottom Line · +10"*, plus the award list entry with the same ticket number;
- refusal — the server's own reason in plain words: *"Not this time - full house
  incomplete"*, *"Not this time - line incomplete"*; a refusal that carries no
  reason falls back to its code's sentence (*"someone else already won that one"*,
  *"too late — the next number was already called"*, *"you already claimed that"*).

Simultaneous claims are serialised per room: the first valid one is awarded, the
second is refused with `ALREADY_AWARDED`. Duplicate awards are impossible because
the award set is keyed by pattern, and a replayed `claim:submit` is refused before
it reaches the evaluator.

**Not implemented, on purpose:** Early Seven, Star, Middle Number, 1 2 3 / 143 and
Pyramid. They have no approved predicate, so they have no button. Adding one is a
rules decision (`RULES-DECISIONS.md`), not a UI change.

## 6. Several tickets

One seat, up to the room's ceiling (default 4, hard maximum 12).

- The rail shows every ticket with its own progress (`Ticket 3 · 7 of 15`), so a
  player can see at a glance which ticket is closest to a line.
- Only the selected ticket is mounted. Marking, progress and the row chips are
  computed from the same call history for every ticket in the rail, so switching
  tabs is instant and the per-call cost does not grow with the number of tickets
  (measured in §9).
- A claim is evaluated across all of them and names the winner in the award, so
  "which ticket won" is never ambiguous in the results.
- Tickets are private: they arrive on `ticket:assigned`, addressed to the seat's
  socket, never in a room broadcast, and the hydration path refuses a ticket whose
  owner is not in the room. A host's roster shows counts, never grids.
- Reconnecting restores the same set: the count and the grids are stored with the
  seat, so a refresh cannot lose or re-deal a ticket.

## 7. Recovery and reconnection

The server is the source of truth; the browser holds a session token and nothing
else about the game.

| Event | What happens |
|---|---|
| Refresh while waiting | Session re-claims the seat; the same count and grids come back; the tab that was open reopens |
| Refresh mid-round | Session re-claims the seat; the ticket set, the called history, the awards and the score come back; the player lands on the board |
| Network loss during calls | Socket.IO reconnects; the client re-claims the seat and receives a full snapshot, so missed calls are simply part of the history |
| Reconnect with several tickets | All of them return, in the same order with the same grid |
| Reconnect after a claim | The award, its ticket number and the score are in the snapshot |
| Reconnect after completion | The personal result panel and the final standings are rebuilt from the snapshot |
| A stale session (room closed, seat freed) | The seat is cleared once and the player is sent to `/player`; no half-seated state |

Duplicate events are safe: every mutation is applied to state the server sent, and
the client's chat feed dedupes by the server's message id.

### Chat history, deliberately

Chat is **on demand, never pushed**. A seat asks for `chat:history` when the chat
panel mounts and again on every socket `connect`, and the server answers with the
last `CHAT_HISTORY` (24) messages from memory. The history is not part of the game
snapshot and is never re-broadcast. The client dedupes by message id, so a
reconnect that arrives while messages are still queued shows each line once.

The consequence to know about: chat lives in memory, so a server restart empties
the room's chat while it keeps the game — a deliberate trade (chat is social, the
game is authoritative). A seat that joins mid-round sees the last lines it missed,
which is the behaviour §1 of the phase brief asked to be made explicit.

## 8. Accessibility

- **Structure**: the ticket is a real ARIA `grid` (3 rows, 9 columns, `aria-rowindex`
  on rows, `aria-colindex` on cells). Every cell has a spoken label —
  *"Number 47, row 2 column 4, called"*, *"Empty cell, row 3 column 9"* — so a
  screen-reader user hears position and state without seeing colour.
- **Tabs**: the rail is a `tablist` with roving tabindex, `aria-selected`,
  `aria-controls` and a `tabpanel` labelled by the active tab. `Left/Right/Home/End`
  move between tickets.
- **Announcements**: the current number is announced through a polite live region,
  the claim verdict through a toast, and the ticket count through the picker's own
  status line.
- **Focus**: one visible treatment across the app (2px gold ring, 2px offset).
- **Contrast**: every measurable text colour passes WCAG AA (4.5:1, or 3:1 for
  large text). The quietest ink was raised from `#6b717e` (3.86:1) to `#828997`
  (4.9–5.4:1) after an automated audit measured it in Phase 18.
- **Reduced motion**: one global `prefers-reduced-motion: reduce` rule collapses
  every animation and transition in the app to 0.001 ms, so the call reveal, the
  toasts and the soft transitions all become instant for a player who asks for
  that.
- **Touch**: ticket tabs, count controls and claim buttons are 44px tall at every
  width, not just on small screens.

## 9. Measured behaviour (Phase 18)

Automated audit, headless Chromium with an emulated viewport (not a physical
device), against the durable server:

| Viewport | Ticket cell | Ticket box | Board | Overflow |
|---|---|---|---|---|
| 360 × 780 | 30 × 30 | 336 × 232 | 302 × 271 | none |
| 390 × 844 | 33 × 33 | 366 × 242 | 332 × 298 | none |
| 430 × 932 | 38 × 38 | 404 × 255 | 370 × 333 | none |
| 768 × 1024 | 71 × 71 | 722 × 359 | 688 × 619 | none |
| 1440 × 900 | 54 × 54 | 568 × 308 | 506 × 455 | none |

Cost of one official call reaching the screen, same room, same browser, 20 calls
per seat, each measured while it was the tab in front:

| Seat | DOM nodes | Call → painted frame (p50 / p95) | Long tasks | Frame gaps |
|---|---|---|---|---|
| 4 tickets | 351 | 4 ms / 9 ms | 0 | 17 ms p50, 17 ms p95 |
| 1 ticket | 333 | 6 ms / 14 ms | 0 | 17 ms p50, 17 ms p95 |

Server side, durable, 12 calls with 1 + 4 + 12 ticket seats:

| Measurement | Value |
|---|---|
| Snapshot size, 1 / 4 / 12 tickets | 1 343 B / 1 727 B / 2 752 B |
| `number:called` payload | 77 B, the only event per call |
| Durable call wall time | p50 4.7 ms, p95 16 ms |
| Rows written per call | 2 — one `draw_calls` row and one `audit_events` row |
| Ticket rows updated per call | **0** (marking is derived, not persisted) |
| Integrity pass over a room at hydration | 0.09 ms p50 |

The honest reading of the p50/p95 row: four tickets are not measurably slower than
one, because only the visible ticket is in the DOM and the other three cost one
small state update each. These are single-machine, single-room numbers — not a
capacity claim.

## 10. Checking it yourself

```
npm run migrate          # once per database: the backup suite asserts the migration ledger
npm run build --prefix client   # the smoke suite asks a live server for client/dist
npm test                 # 516 tests, including the ticket property and lifecycle suits
npm run lint
npm run secret-scan
npm run security-probe   # 51 checks against a real listening server
npm run e2e              # a full game in memory, to COMPLETED
npm run e2e:durable      # the same game through PostgreSQL
npm start                # then play it at http://127.0.0.1:4000
```

`npm run verify` runs those gates in exactly that order — lint, build, test, secret
scan — because the suite legitimately needs a built client and a migrated database.
On 31 October 2026 GitHub CI was reordered the same way and passed for the first
time (run 41202342043, `tests 516 / pass 516 / fail 0`).

The browser harness used for the Phase 18 evidence lives in
`.preflight/tools/` (ignored by git, because it is a working tool, not a shipped
artifact): `p18-player.mjs` drives the whole player journey, `p18-audit.mjs` runs
the accessibility and call-cost audit, `p18-perf.mjs` measures the server path.
