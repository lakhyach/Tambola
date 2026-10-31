# The caller console

Phase 17 · 31 October 2026 · what the host uses to run a room, what it refuses to
do, and how each promise is verified. Player screens are unchanged; this paper is
about the other surface.

The one rule behind every sentence below: **the console asks, the server decides.**
No button on this screen picks a number, moves a draw along, or writes a state. The
client sends intents (`game:call-next`, `game:pause`, `game:resume`, `game:end`,
`game:reset`, `game:set-autocall`) and renders the snapshot that comes back.

---

## 1. Where it is

A host who opens `/host/room` and starts a round lands on `/host/game`. That route
now renders the **caller console** and nothing else — the pre-Phase-17 host strip
(`client/src/components/HostControls.jsx`) is deleted, so there is exactly one
place a host operates a room from. Players still see the shared hall.

Composition lives in [`client/src/components/caller/`](../client/src/components/caller/);
the view-model lives in [`client/src/lib/caller.js`](../client/src/lib/caller.js) as
pure functions (no React, no DOM), which is what makes it testable under
`node --test`.

| Piece | File | What it shows |
|---|---|---|
| Hero | `caller/CallerHero.jsx` | the current number, the previous one, the sealed next slot, left-in-the-bag, called count, round number, elapsed clock, voice line, Repeat |
| Draw controls | `caller/CallerControls.jsx` | the one primary transport control, Pause/Auto/End/Reset, the cadence chips |
| Call log | `caller/CallerLog.jsx` | every official call, newest first, with its ordinal and a NOW/PREV tag |
| The hall | `caller/RoomOverview.jsx` | seated/capacity, connected, away, tickets, per-seat state |
| Voice | `caller/VoicePanel.jsx` | this device's speech: on/off, chime, language, voice, rate, volume |
| Board | `components/NumberBoard.jsx` | the unchanged 1–90 board, all called/uncalled states |
| Chat | `components/GameChat.jsx` | the unchanged room chat |
| Shell | `caller/CallerConsole.jsx` | layout, hotkeys, the mobile draw bar |

## 2. What the caller sees

All of it derives from one server snapshot; nothing is tallied locally, so the
console, the board, the call log and every player's screen cannot disagree.

- **Current number** — `lastCall`, the last entry of the server's own
  `calledNumbers`, revealed in the same ball the players see.
- **Previous number** — `calledNumbers[calledNumbers.length - 2]`.
- **Next** — deliberately **sealed**: `lib/caller.js:nextCallPreview()` returns
  `{ sealed: true, remaining, label }` and no numeric field at all. The server has
  not chosen the next number when the console draws this slot, so the console
  cannot show it. A test asserts the shape has exactly those three keys.
- **Left in the bag / called** — `remaining` and `calledCount`, as the server
  reports them.
- **Elapsed** — the round clock, see §5.
- **State** — `WAITING`, `RUNNING`, `PAUSED` or `COMPLETED`, in a chip that pulses
  only while running.
- **Call log** — built from `calledNumbers` alone. No gap-filling, no local
  ordering: ordinal 1 is the round's first call.

## 3. The controls, and what each one may do

`lib/caller.js:callerActions()` decides what is possible in the current state, and
the console shows a sentence instead of a dead button when something is not:

| Control | Sends | Allowed when |
|---|---|---|
| Start the round | `game:start` | `WAITING`, at least one seat, not busy, connected |
| Call next number (`C`) | `game:call-next` | `RUNNING`, no call in flight, numbers left |
| Pause (`P`) | `game:pause` | `RUNNING` |
| Resume (`P`) | `game:resume` | `PAUSED` |
| Auto: On/Off | `game:set-autocall` `{enabled}` | `RUNNING` or `PAUSED` |
| Calling every *Ns* | `game:set-autocall` `{intervalMs}` | not `COMPLETED` |
| End round | `game:end` | `RUNNING` or `PAUSED`, **two clicks** |
| Reset room | `game:reset` | `COMPLETED`, **two clicks** |
| Repeat number (`R`) | nothing — local only | a live voice and a current number |

The server re-checks every one of them, including host authority; the matrix above
only stops the host from sending an intent that is certain to be refused.

**Destructive actions need a second click.** The first click arms the control and
prints "Click again to confirm."; the second fires it; clicking a *different*
destructive control re-arms onto that one; an 8-second lapse, a state change or
Cancel disarms. The rule is one pure function
([`client/src/lib/confirmAction.js`](../client/src/lib/confirmAction.js)) so it is
tested without a DOM, and it replaced `window.confirm()`, which no automated check
could see.

**Duplicates and double starts are refused by the server**, not merely hidden: a
second `game:start` returns `INVALID_STATE`, a call after `COMPLETED` returns
`INVALID_STATE`, a non-host socket gets `NOT_HOST`, and ten simultaneous
`game:call-next` intents produce ten distinct numbers in one order
(`tests/caller-realtime.test.js`).

## 4. The calling interval

The cadence is room state the server owns (`game:set-autocall` with
`{intervalMs}`), validated to **500–120000 ms** and persisted with the room.

- The console offers 3s, 5s, 8s, 10s, 15s, 20s and 30s — all inside that range.
- The payload is `{ intervalMs }` **without** `enabled`, because a pace change must
  not switch auto-calling off. That is why `intervalPayload()` exists.
- **While running**, the server re-arms the next call from *now* at the new pace. A
  call already due is never re-timed, and nothing is drawn twice; the note under
  the chips says exactly that.
- **While paused**, a new pace applies when the host resumes.
- **When completed**, the chips are disabled and the panel says "The round is over".
- An invalid value (`0`, `250`, `4.5`, `"4000"`, `null`, `120001`) is refused with
  `BAD_PAYLOAD` and the room keeps the pace it had.

The scheduler still lives in the database (`room_schedule.next_due_at`) and still
claims each tick exactly once, so a reconnect or a process restart cannot replay a
missed call.

## 5. The round clock

`startedAt`, `elapsedMs` and the frozen `endedAt` are computed in the engine
(`roundElapsedMs()`), carried on every snapshot, and advanced by one hook —
`applyRoundClock(from, to)` — called from the state machine. Consequences:

- pausing stops the clock; resuming continues it (it does not restart at zero);
- `COMPLETED` freezes it; `reset` clears it to zero with `startedAt: null`;
- a restarted process continues from `games.started_at` rather than reporting the
  round as having begun at boot;
- the browser ticks locally from the snapshot's `receivedAt` **only while
  `RUNNING`**, so the display moves between snapshots without a request a second
  and never counts time the server is not counting.

Voice never touches this clock. Speech that is slow, missing or dead changes only
what one browser hears.

## 6. Voice, honestly

Speech is per device: every browser announces for itself, so the host's panel
controls the host's audio and nobody else's. Settings persist in
`localStorage["tambola.announce.v1"]` — `speech`, `chime`, `speechLang`,
`voiceURI`, `rate`, `volume` — and speech still only *starts* after a user gesture,
because the browser's autoplay policy demands one.

- **English and Hindi number words** via the existing `number-words.js`; the
  language chip swaps both the words and the voice family.
- **Voice selection** is offered when the browser lists voices. A saved voice is
  honoured only if the browser still lists it **and** it belongs to the spoken
  language — otherwise the closest match for the language is used, and the panel
  says so ("The voice saved earlier is not on this device…", "This browser lists no
  Hindi voice; it will use its default voice").
- **Rate** 0.75–1.5 (clamped to 0.5–2 server-side of the queue) and **volume** 0–1,
  both clamped in `announce.js` before an utterance is built.
- **Repeat number (`R`)** re-speaks the current number on this device only. It is
  the one path that deliberately speaks a number twice; it cannot overlap the
  utterance in flight, it never touches the server, and it never re-queues older
  numbers (a test asserts the backlog is cleared).
- **No engine**: the panel says "This browser has no speech synthesis…" and the
  board, the chime and every player's own device keep working.
- **Engine death mid-round**: the state becomes "Voice stopped", a Retry chip
  appears, and the queue's watchdog is scaled by the speaking rate so a slow voice
  is not mistaken for a dead one.
- **One at a time, in call order** — the queue (`announce-queue.js`) holds at most
  two numbers, so a device that falls behind skips forward instead of drifting
  further behind. Overlapping speech and duplicate announcements are what the
  high-water mark prevents; `maxOverlapMs` is 0 in the recorded browser runs.

## 7. Reliability, as behaviour

| Situation | What happens |
|---|---|
| Refresh during a live round | the round is restored on the same route with its call sheet; because the host socket dropped, the room paused rather than lose its owner — press Resume (hotkey `P`) and the clock continues |
| Host reconnect / second tab | resuming the host session on another tab moves live control to that tab; the old tab is told `NOT_HOST` and can still read the room, but cannot call |
| Network interruption | the console shows "CONNECTED" or not, disables the intents it cannot honour, and re-anchors on the next snapshot |
| Duplicate socket events | snapshots are rendered idempotently from the server's history; a repeated `game:state` cannot double-count a call |
| Pause/resume | the clock stops and starts on the server; every seat sees the same `PAUSED` |
| Server restart | rooms are rebuilt from PostgreSQL; the clock resumes from the stored start time and no call is replayed |
| Speech interruption | that device's line says stopped, Retry restarts it; the game is untouched |
| Call after completion | refused by the server (`INVALID_STATE`); results and the call sheet stay readable, and Reset is offered |

## 8. Layout, keyboard and contrast

- **Desktop (≥1180px)**: console | board and call log | hall, chat and the footnote.
- **Tablet (820–1179px)**: two columns, with the third spanning underneath.
- **Phone (<760px)**: one scrolling column, and the draw bar is pinned to the
  bottom edge — state, `n/90 · m left`, Pause and the primary control within reach
  of a thumb. Below 430px the hero's four read-outs go two-per-row.
- **Keyboard**: `C` call, `P` pause/resume, `R` repeat. Single keys only, never
  chords, and never while the host is typing in the chat field or a slider.
- **Focus**: the existing global `:focus-visible` ring (2px gold, 2px offset) shows
  on every control; the browser pass tabs through four controls and measures the
  computed outline rather than trusting the stylesheet.
- **Contrast**: the console uses the same `--oh-*` tokens as the rest of OBSIDIAN
  HALL; muted text is used only for secondary read-outs, never for a number.

## 9. Re-verifying it

```bash
npm start                                    # server on :4000, durable
node .preflight/tools/p17-caller.mjs         # headless Chrome over CDP
```

The harness creates a room, seats a phone-sized guest, starts the round and then
records, for each step, what the DOM said and what the layout measured: the
console, 90 board tiles, three manual calls, keyboard focus outlines, the `C`
hotkey, pause (clock equal twice), resume, a cadence change to 5s, the voice panel
(chime, हिंदी, 1.25×, volume 0.6, Voice on, Repeat), tablet 820px, 390×844, 360×740,
a reload during a live round, the player's own screen, and the two-click end of the
round. It writes `.preflight/p17_*.png` and `.preflight/p17-caller.json` and exits
non-zero if the page threw anything.

It is **browser-viewport simulation on a desktop OS**, not a physical tablet or
phone, and nothing in the reports claims otherwise.

## 10. What the console deliberately does not do

- It does not pick, reorder or predict a number. `nextCallPreview()` has no numeric
  field, and no client code holds the round's draw.
- It does not moderate seats. The authorization model has no kick/ban/approve
  event, so no such control is offered; a host who needs a seat gone ends the round
  and resets the room. Adding moderation is a server feature with an audit trail,
  not a button on this panel.
- It does not show a session token, a credential or another seat's ticket. It reads
  only what every player's screen already shows: name, host mark, connection state,
  ticket count, points.
- It does not change a winning rule, and it introduces no payment surface.
