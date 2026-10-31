# New Winning Patterns

This document is the single authority for the five additional winning
categories added on top of the six already-approved rules. It exists because
these five names — **Star, Second Full House, Early Seven, Half Sheet, Box** —
are published across Tambola/Housie chart pages but are **not defined the same
way everywhere**. Rather than pick the interpretation that is easiest to code,
each one below states the definition this game actually enforces, the exact
machine-readable ticket cells it checks, the evidence behind it, the competing
readings it deliberately did **not** choose, and its approval state.

Everything here is evaluated **server-side only** (`server/game/patterns.js`,
`server/game/pattern-geometry.js`). The browser is handed the same coordinates
and draws them; it decides nothing. The diagram a player claims from and the
verdict that pays them are read from one source, so they cannot disagree.

---

## 0. The six approved rules are unchanged

Early Five, Top Line, Middle Line, Bottom Line, Corners, and Full House are
exactly as before. None of their predicates, point values, or eligibility was
modified to make room for the five below. This section adds categories; it does
not re-open settled ones.

---

## 1. Ticket geometry used throughout

A Tambola ticket is a **3 × 9** grid: nine decade columns and three rows, each
row holding exactly five numbers and four blanks. Coordinates in this document
and in the code are `[row, column]`, 0-based, row 0-1-2 top to bottom, column
0..8 left to right.

The column ranges are fixed: col 0 = 1-9, col 1 = 10-19, col 2 = 20-29,
col 3 = 30-39, col 4 = 40-49, col 5 = 50-59, col 6 = 60-69, col 7 = 70-79,
col 8 = 80-90.

### The "nth number of a row" rule

When a pattern is described as a row's *nth number*, it counts that row's **five
filled cells from left to right** — never column *n*. This matters: the column
under a row's 3rd number can be blank, but the 3rd number itself always exists,
because every legal row holds exactly five numbers. Published chart pages use
this same wording, and it is what makes patterns like Star well defined on every
ticket. This convention lives in `pattern-geometry.js` (`rowCells`).

### The example ticket

Every diagram in the UI is drawn on one canonical ticket so a player can compare
it cell-for-cell against a printed chart. It is `EXAMPLE_TICKET` in
`pattern-geometry.js`:

```
row 1:   4   .   22   .   41   .   63   .   85
row 2:   .   15   .   34   .   56   .   77   88
row 3:   9   .   27   38    .   59   .    .   90
```

---

## 2. Configuration and approval model

* Each of the five is registered with `optional: true` and `enabledByDefault:
  false`. Registration only means the server *can* evaluate it; being switched
  off means **no room pays for a rule its owner never chose**.
* Effective state per room = `config.patterns[id] ?? enabledByDefault`. With the
  default config the five are off and the room plays the classic six.
* A host turns them on **before the round starts** through the "Extra prizes"
  panel in the waiting room (`room:set-patterns`, host-only, WAITING-only; the
  engine refuses it once the round has started, so a player always sees the full
  prize list before buying in). The approved operator console can tick the same
  five on when creating a room; its default selection is still the classic six.
* `getPattern(id, config)` returns `null` for any pattern that is not enabled,
  and the claim path rejects an unknown/disabled pattern with `UNKNOWN_PATTERN`.
  A client can therefore never win a prize the room never opted into, even by
  sending a raw intent.
* **Ambiguous names stay disabled by default.** Half Sheet in particular has
  more than one published wording; it is switched off until a host explicitly
  approves the one wording this document commits to (§7).

---

## 3. Star

**Points:** 25 · **Kind:** fixed cells · **Default:** off (optional)

### Enforced definition
The four corner cells **plus the centre number of the middle row** — the middle
row's 3rd number, counted over its five filled cells. Five cells, all always
distinct (the corners live in rows 1 and 3, the centre in row 2), so Star always
needs exactly five called numbers and is well defined on every legal ticket.

### Exact coordinates
`starCells = cornerCells + middleRowCentreCell` →
`[[0,0],[0,8],[2,0],[2,8],[1,5]]`, which on the example ticket are
**4, 85, 9, 90, 56**.

### Evidence and what it is NOT
* It is **not the Laddu prize**, which is the middle row's third number alone.
* It is **not** the decorative star some chart pages picture without naming its
  cells — an unnamed shape cannot be a machine rule, so this game uses the
  concrete reading (corners + centre) that the named-cell sources support.
* Corner cells are themselves defined over filled cells, matching the approved
  Corners rule (§ the six), so Star and Corners share the same corner wording.

### Alternatives not chosen
Some publishers draw a Star across a different spread (e.g. centre column plus
corners, or a five-point star that ignores blanks). Those readings are either
ambiguous about which physical cell is meant, or overlap other prizes; the
corners-plus-centre reading is the one that is both named and well defined on
every ticket.

---

## 4. Box

**Points:** 25 · **Kind:** fixed cells · **Default:** off (optional)

### Enforced definition
Every numbered cell inside the **three middle columns** — the 30-39, 40-49 and
50-59 columns, i.e. the central block left after the first three and last three
columns are set aside (`BOX_COLUMNS = [3, 4, 5]`).

### Exact coordinates
`boxCells` = all filled cells of columns 3, 4, 5. On the example ticket that is
`[[1,3],[2,3],[0,4],[1,5],[2,5]]` → **34, 38, 41, 56, 59** (five numbers here;
the count varies with the ticket).

### Why a variable cell count is correct
Three columns × three rows is **at most nine cells**, which is why callers name
it the *Box of 9*. A legal ticket never leaves a column empty (every decade
column holds at least one number) and never puts more than three in a column, so
the Box always holds **between three and nine** numbers. It is deliberately
**not a fixed count of cells** and **not the four corners** — this game already
awards the corners separately as the approved Corners prize.

### Evidence and alternatives
Direct sources describe Box as the central nine-cell block (the "9-box"). The
competing reading — Box = four corners — was rejected because the corners are an
existing, distinct prize, and merging them would double-award. The machine
definition (columns 3-5) is the reading that stays distinct from Corners.

---

## 5. Early Seven

**Points:** 25 · **Kind:** count · **Default:** off (optional)

### Enforced definition
Seven of the fifteen numbers on the player's ticket have been called.
**Position never matters** — it is simply the seventh of that ticket's numbers to
be called.

### Completion is pinned, which is what makes 8/9/10 safe
The completion moment is fixed at the ordinal of the **7th** hit. Once earned,
later calls cannot un-earn it, and an eighth (or ninth…) called number cannot
create a duplicate award for the same ticket — the pattern is exclusive and
closes on the first valid claim. The rule was verified explicitly across the
**6 → 7 → 8 boundary**: six is refused with "needed: 1"; the seventh pays; the
eighth is refused `ALREADY_CLAIMED_BY_YOU` with exactly one award row (see the
Early Seven and durable test suites).

### Evidence and alternatives
This is the direct extension of the approved Early Five (same mechanism, `need:
7`). "Early Seven" sometimes means *the first seven calls of the whole game to
hit one ticket*, but the count-over-one-ticket reading matches how Early Five is
already implemented here and keeps the family consistent.

---

## 6. Second Full House

**Points:** 15 · **Kind:** all 15 · **Default:** off (optional)

### Enforced definition
The next ticket to have all fifteen numbers called **after** the first Full
House has been awarded. It is its own pattern key (`secondFullHouse`), so it
arbitrates independently of `fullHouse`.

Rules the engine actually enforces (`requires`):
* The ticket that won the **first** Full House can never win this one
  (`excludeWinningTicket`), so **no ticket is paid twice for the same position**.
* A **different** ticket of the same player may still take it — it is per-ticket,
  not per-player, exclusion.
* A claim made **before** the first Full House is settled is refused ("there is
  no second place to claim"). The exclusion survives a cold restart because the
  winning ticket is persisted (`ticket_no` on the award row, migration
  `005_award_ticket.sql`) and re-derived on rebuild.

### Genuinely distinct from Full House
The UI shows a distinct label, points (15 vs 30), and its own award row with a
`winner_ordinal`; the first place (Full House, ordinal 1) and second place
(Second Full House) are separate ledger entries. It is not the Full House label
duplicated.

### Completion interaction
Enabling Second Full House **does not change when the round ends**. A round ends
only at all ninety numbers or on a host `end`; no prize auto-settles the rest.
So a game neither terminates prematurely after the first Full House nor runs on
forever because a second place is still open — see §8.

### Evidence and alternatives
"Second Full House" (or "Full House runner-up") is a published side prize. The
alternative reading — pay the second player to *complete*, tie-broken by who
finished first — was not chosen because it can strand a ticket that already won
the first Full House; the ticket-exclusion model above guarantees a ticket is
never paid twice for the same Full House position.

---

## 7. Half Sheet

**Points:** 20 · **Kind:** seat (across three tickets) · **Default:** off (optional, **flagged as ambiguous**)

### Enforced definition
A **seat** holding at least three tickets wins once **two of a ticket's own
numbers have been called on each of three of its tickets** — three partial lines
instead of one finished ticket (`seat: { tickets: 3, perTicket: 2 }`). It is a
seat-level pattern: judged across the tickets one player holds, never on a single
ticket in isolation.

### Exact coordinates for the diagram
The diagram marks the top row's first two numbers of a ticket as an illustrative
pair (`rowCells(ticket, 0, [1, 2])` → cells `[0,0]` and `[0,2]`, i.e. **4 and 22**
on the example ticket) and carries an explicit note: *"Any two cells of a ticket
count; the diagram marks its first two as an example."* The evaluator does not
use those two specific cells — it uses each ticket's own two earliest-called
numbers — the diagram is only showing the *shape* of "two of fifteen."

### Why the seat reading, and the competing wordings
Printed Tambola comes in **sheets of six**, and this prize is traditionally
shared across **half of one sheet**. This game deals **independent** tickets, not
linked sheets, so the rule counts the tickets a seat holds instead of tickets
that physically share a sheet. Other publishers describe the same name as **one
number on each of three tickets**, or as a **complete half of a single ticket**.
Because the name is genuinely not universal, Half Sheet **stays switched off
until a host approves this one wording on purpose** — that approval is the point
of the opt-in gate, not a formality.

### Attribution
When won, the award names the three tickets that qualified (`ticketNos`), so the
winner board reads e.g. "Tickets 1, 2, 3" rather than a single ticket.

---

## 8. Completion semantics (interaction with round end)

* A round transitions RUNNING → COMPLETED only when all ninety numbers have been
  called, or when the host ends it. **No winning pattern auto-completes a
  round**, and **no enabled pattern is ever left unresolved by a premature
  COMPLETED** — completion is not triggered by prizes at all.
* Therefore adding any of the five can neither (a) end a game while an enabled
  required award is still open, nor (b) make a previously-completable game run
  forever. Enabling Second Full House, for instance, simply adds one more claim
  that may or may not be paid before the ninetieth call; it changes no timing.

---

## 9. Claim, tie-break, and durability policy

* **Exclusive:** the first valid claim wins and closes the pattern (same policy
  as the approved six; `multipleWinnersPerPattern` stays off).
* **Late window:** a claim is checked against `config.claimWindowCalls` measured
  from `completedOnCall` — the call that actually completed the pattern — not the
  number of total calls. The award's stored `call_index` is the moment the claim
  was made; `completedOnCall` is kept separately.
* **Atomicity under concurrency:** in-memory awarding happens in the same
  synchronous block as the checks, so two simultaneous claims cannot both
  succeed. With PostgreSQL the claim path is `prepareClaim → recordAward (under
  a `pg_advisory_xact_lock` keyed by room+game+pattern) → commitClaim`, so across
  separate processes exactly one wins and the loser is refused
  `ALREADY_AWARDED`. Ordinals are assigned inside that lock.
* **Durability:** awards, their `winner_ordinal`, `ticket_no`, and `ticket_nos`
  are persisted. Reconnect and crash-recovery preserve the prize ledger; a
  rebuilt room shows the identical diagrams and the identical winner/ticket
  attribution. Refusals are also recorded (a REJECTED claims row plus a
  `claim-rejected` audit entry) so both outcomes are auditable.
* **Multi-ticket:** a seat with several tickets is evaluated across all of them;
  the award names the specific ticket (or tickets, for Half Sheet) it came from.

---

## 10. Client approval requirements (restated)

1. The five are **opt-in per room and off by default**; enabling is a host/operator
   action taken **before** the round starts.
2. The ambiguous names — **Half Sheet** above all — must not be switched on with
   a guessed wording; the wording committed to here (two numbers on each of three
   of a seat's tickets) is what the host accepts when they tick it.
3. Star and Box are shown using the **server's exact coordinates**, never invented
   in the browser. If a host wants a different Star/Box reading, that is a new
   rule decision requiring its own researched definition, not a UI tweak.
