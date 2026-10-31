# Unresolved game-rule decisions — client approval required

Phase 16 · prepared 31 October 2026 · build `2063f0b` · updated in Phase 16B (base `0a4de55`)

Purpose: list every rule this build deliberately does **not** implement or defaults silently, state
what the ambiguity is, and give the client a recommended default to approve or overrule. Nothing here
changes the engine. The five deferred patterns sit unbuilt in `server/game/patterns.js`
(`DEFERRED_PATTERNS`) with a test that keeps them out of the claim path; the rest are configuration
values the operator can set today.

**What Phase 16B added, and what it did not:** Early Seven now has an exact definition, a test suite
and a completion-ordinal contract in `server/game/proposed-patterns.js` — a module the live registry
does not import, so no room can award it (proven by `tests/proposed-patterns.test.js`). The other four
remain unimplemented because no source defines them precisely enough to be worth a prize. No line of
`server/game/patterns.js` changed.

Evidence classes are the same as `docs/MARKET-BENCHMARK.md`: **O** observed in this product,
**D** documented by a competitor, **I** inferred.

---

## 1. The five deferred winning patterns

These were offered by an older version of this app and were **removed rather than guessed at**,
because the old checks compared *counts of marked cells* — not the traditional rule — and the
traditional rule itself differs between sources. Each entry states what the pattern means, what the
market does, what the engine does today, how a future build should validate it, and what it costs in
tie-breaking and game completion.

### 1.1 Early Seven (`earlySeven`)

| | |
| --- | --- |
| **Means** | Seven of the ticket's fifteen numbers called. The mirror of Early Five at 7 instead of 5. |
| **Common?** | **Yes.** nLife names "Early 7" (D, S3) and ships it among its dividend list (D, S2); Tambola Board lists "Early Seven" as a built-in achievement (D, S4). Two of three competitors ship it. |
| **Engine today** | Not in `PATTERNS`. No claim id, so a client sending `claim { pattern: "earlySeven" }` gets "unknown or disabled pattern". Pinned by `tests/engine.test.js` / `edge-cases.test.js` refusal paths. The exact rule now exists in `server/game/proposed-patterns.js`, unregistered. |
| **Ambiguity** | Is it "the seventh hit" (like Early Five at 5), or "seven hits within the first N calls"? No source defines a window, and Early Five in this build has an optional window (`earlyFiveMaxCalls`, default off). |
| **How it was validated** | The definition was written down, implemented as an unregistered predicate, and pinned by six tests (§1.1a). The remaining step is a prize weight and an approval — not a rule. |
| **Tie-break / completion** | Exclusive by default: first valid claim closes it, so it never affects who wins Full House. It *does* add a points row — 20 points at the same weight as Early Five was the old behaviour; the client should set the value. |
| **Recommendation** | Add, defined as "the seventh of the ticket's numbers to be called", exclusive, window off. Points: 25 proposed below, 20 is equally defensible — it is a product decision. |

#### 1.1a The proposed rule, exactly as implemented

> *Seven of the fifteen numbers on the player's own ticket have been called. Position on the ticket
> never matters — it is the seventh of that ticket's numbers to be called. Completing it cannot be
> undone by an eighth call, so the prize stays claimable within the room's claim window.*

Why this reading and no other: S3 defines the sibling dividend **Jaldi 5** as *any five* called
numbers, and S2/S4 both name an **Early 7** milestone. No source publishes a call window for either,
and none makes the milestone positional. "Seven of your fifteen have been called" is the only reading
consistent with every published sibling, and it needs no cell layout — which is exactly what makes it
testable.

| Property | Value | Why it matters |
| --- | --- | --- |
| Claim id | `earlySeven` (not registered) | A claim today is refused with "unknown or disabled pattern" |
| Validity | ≥ 7 of **that ticket's own** numbers called | Another player's numbers are irrelevant (test: `foreign.length >= 7` still refuses) |
| Completion ordinal | the call ordinal of the **7th** hit | The same contract every live pattern answers with, so `claimWindowCalls` works unchanged |
| Later calls | never move the ordinal | A 12th or 15th call leaves `completedOnCall` where it was |
| Exclusivity | exclusive, like Early Five | First valid claim closes it; it never delays Full House |
| Window | `claimWindowCalls` (room setting, default 0) | With a window of 2, claiming after two further calls is valid and after three it is late |
| Points | proposed **25** (Early Five is 20, Full House 30) | A product decision — the rule does not depend on it |

Fixtures (`tests/proposed-patterns.test.js`, against the shared 3×9 tickets in `tests/helpers.js`):

| Case | Expectation |
| --- | --- |
| 6 of the ticket's numbers called | refused, `needed: 1` |
| 7 called | valid, `completedOnCall === 7` |
| the call order shuffled | still `completedOnCall === 7` — only the set matters |
| 12 or 15 called | `completedOnCall` unchanged |
| 7 numbers, none of them this ticket's | refused, `needed: 7` |
| a room config naming `earlySeven` | still refused: **registration is the gate, not configuration** |

**Why it is not switched on.** The admin console builds its pattern toggles from the client's
metadata map and defaults a new room to every pattern it knows, so *registering* the pattern — even
`enabledByDefault: false` — would put it one checkbox away from paying points in a game whose owner
never asked for it. Enabling it is therefore a deliberate client decision with two halves: the
**points value**, and **whether it is on by default**. Both are on the sign-off page.

**To enable it once approved** (a two-line change plus tests, all of which exist):

1. Move the `earlySeven` entry into `PATTERNS` in `server/game/patterns.js` with the approved
   `points`, keeping `check()` as written.
2. Add the id to `PATTERN_META` in `client/src/brand.js` so the tile appears, filtered by the room's
   `enabledPatterns` exactly as the other six are.
3. Change `tests/proposed-patterns.test.js` from "the registry cannot award it" to "the registry
   awards it", and keep the ordinal/window assertions verbatim.
4. Re-run `npm run verify` and the durable e2e. No persistence change is needed: awards are already
   generic rows keyed by pattern id.

### 1.2 Star (`star`)

| | |
| --- | --- |
| **Means** | Conventionally the centre cell of the middle row plus the four corners — a star shape. |
| **Common?** | **Yes, as a name.** nLife lists "Star" among its 80+ variations (D, S2) but publishes no definition. S3 defines a *related* pattern — **Laddu** — as "middle number of second line", i.e. a *value* in the middle row, not the centre cell (D, S3). |
| **Engine today** | Not in `PATTERNS`. The old implementation used `line2[Math.floor(len/2)]` — the middle **value** of a sorted row — which is Laddu, not Star. |
| **Ambiguity** | A 3×9 ticket does not guarantee a number in column 5 of the middle row. If that cell is blank, "centre cell" has no number, so the rule needs a fallback (nearest filled centre cell? skip the star? ticket-level disqualification?). |
| **How to validate** | Definition first, then fixtures for the three shapes: centre present, centre blank with numbers either side, centre blank with an even split. Assert the same ticket can never be both claimable and unclaimable depending on tap order. |
| **Tie-break / completion** | Exclusive; independent of Full House completion. If implemented with a "nearest cell" fallback it is position-based, so it is deterministic and needs no new arbitration code. |
| **Recommendation** | **Do not add** until the client supplies a definition. If they want a centre-based prize, ship **Laddu** (middle number of the second line) instead — it is unambiguous on every legal ticket. |

### 1.3 Middle Number (`middleNumber`)

| | |
| --- | --- |
| **Means** | The middle value of a row (the old reading), or the centre cell (the newer reading). |
| **Common?** | **Partly.** Not named in S2/S4; closely related to S3's Laddu (D). |
| **Engine today** | Not in `PATTERNS`. |
| **Ambiguity** | Same value-versus-cell question as Star, and the same "centre cell may not exist" problem. |
| **How to validate** | One definition, one fixture set, one test — identical method to Star. The two patterns must not be specified independently, or the codebase ends up with two contradictory readings of the same cell. |
| **Tie-break / completion** | Exclusive; no interaction with completion. |
| **Recommendation** | Fold into the Star decision. If the client wants both, define Middle Number as "the middle number of the second line" (Laddu's definition) and Star as "corners + that number". |

### 1.4 143 / "1-2-3" (`oneFourThree`)

| | |
| --- | --- |
| **Means** | Ticket columns filled in a 1-4-3 or 1-2-3 distribution across the three rows; the name comes from the row counts. |
| **Common?** | **Named, not defined.** nLife lists "143" in its variation list (D, S2) with no published definition; Indian party play uses it loosely. |
| **Engine today** | Not in `PATTERNS`. The old check was `l1>=1 && l2>=4 && l3>=3` on *marked counts*, which is not a 1-4-3 arrangement at all. |
| **Ambiguity** | Three separate questions: is it row **counts** (1,4,3) or **specific cells**; does it apply per line or to the whole ticket; and does 1-2-3 mean the same prize under another name? |
| **How to validate** | A written definition with a worked example, then fixtures covering every legal distribution and one near-miss; assert the pattern answers "when did I complete" with a call ordinal like every other pattern. |
| **Tie-break / completion** | Exclusive. Note that a 1-4-3 distribution is often reached *before* Full House, so it can award points in the last few calls of a round — the client should expect a visible award near the end. |
| **Recommendation** | **Do not guess.** Ship nothing until the client writes the definition; this is the pattern most likely to be implemented "wrong but plausible". |

### 1.5 Pyramid (`pyramid`)

| | |
| --- | --- |
| **Means** | A pyramid of called cells, e.g. 1-2-3 across the rows read downward, or a triangular block. |
| **Common?** | **Occasionally.** Not in S2's named list; common in offline kitty-party charts (I). |
| **Engine today** | Not in `PATTERNS`; the old check compared marked counts only. |
| **Ambiguity** | Pyramid needs an explicit set of cell positions per row, which no source publishes. Two hosts will draw two different pyramids. |
| **How to validate** | An ASCII diagram in this file, approved by the client, becomes the fixture. Any implementation without that diagram is a guess. |
| **Tie-break / completion** | Exclusive; no interaction with completion. |
| **Recommendation** | **Do not add** in the current release. If a client insists, the approval must include the diagram. |

### 1.6 Summary of the five

| Pattern | Market presence | Cost to add once defined | Recommendation |
| --- | --- | --- | --- |
| Early Seven | 2 of 3 competitors (D) | **Done** — rule + fixtures exist, unregistered | **Approve the points value** |
| Star | Named only (D) | Medium — fallback rule needed | Defer, or ship Laddu |
| Middle Number | Named only (D) | Small once defined | Fold into Star |
| 143 | Named only (D) | Medium — definition needed | Defer |
| Pyramid | Not named (D) | Medium — diagram needed | Defer |

Each addition must arrive with tests in the same commit (the repo rule: every rule is pinned by a
test), and none of them may change `claimWindowCalls`, exclusivity, or the completion-ordinal contract.
Early Seven already satisfies that bar; the other four cannot until a definition exists.

---

## 2. Configuration values the client must confirm

These already work. They are decisions, not work items; the shipping default is in the third column.

| Setting | Question for the client | Current default | Recommended |
| --- | --- | --- | --- |
| `claimWindowCalls` | May a player claim a line they completed N calls ago? | `0` (before the next call) | 0 for prize games, 1 for family |
| `multipleWinnersPerPattern` | Can two players both win Top Line in one round? | `false` (first claim closes it) | false ≤10 seats, true above |
| `maxTicketsPerPlayer` | How many tickets may one seat hold? | `4` (cap 12) | 3 |
| `earlyFiveMaxCalls` | Must Early Five be claimed within the first N calls? | `0` (no window) | 0 |
| Claim-dialog countdown | If the window is above 0, the claim dialog needs a visible countdown — unbuilt UI work | none | Only build this if the window > 0 |
| Bogey | Should a wrong claim cancel the ticket? | Not implemented — claim refused, ticket alive | Keep off; it is a support cost |
| Late join | Spectator for the current round, ticketed from the next round? | Yes, with on-screen explanation | Keep, confirm the wording |
| Prize points | What is each pattern worth? | Early Five 20, each line 10, Corners 20, Full House 30 | Client supplies the real values |
| Room size | Maximum players per room? | 100 | 100 |
| Calling interval | Default seconds between calls? | 8 s | 8 s |

---

## 3. What this document does not do

- It does not add, rename, or re-weight any pattern. `server/game/patterns.js` is unchanged by Phase 16
  and by Phase 16B: the Early Seven proposal lives in a separate module that the claim path never
  imports, and a test asserts the live registry still refuses it.
- It does not promise that a competitor's implementation is correct; it records only what the vendor
  published (see `docs/MARKET-BENCHMARK.md` §1 evidence classes).
- It does not resolve the Star/Middle-Number value-versus-cell question. That is the client's call,
  and it is the single highest-risk ambiguity in the deferred set.

**Sign-off block** — to be completed by the client, not by engineering:

```
Approved patterns: ____________________________
Early Seven: [ ] add   [ ] skip        Claim window: ____ calls
Star / Middle Number: [ ] defer   [ ] define as: ____________________
143: [ ] defer   [ ] define as: ____________________
Pyramid: [ ] defer   [ ] diagram attached
Multiple winners per pattern: [ ] off   [ ] on above ____ seats
Signed: ____________________   Date: ____________
```
