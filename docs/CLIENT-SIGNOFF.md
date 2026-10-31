# Client sign-off — the only decisions that need you

Phase 16B · 31 October 2026 · base build `0a4de55`

Eighteen decisions: fourteen about the product (C1–C14) and four legal (L1–L4).
Everything else in `docs/CLIENT-REQUIREMENTS.md` has a working
default and a documented consequence, so silence is survivable there. These are the
ones where silence means the product ships as our example rather than as yours, or
where the choice changes what the engine may award.

**How to answer:** write the answer in the third column, or strike the proposed
default and write "no". Tick the last block, add a date. One page back is enough;
this file is the whole ask.

---

## 1. Identity — blocks client acceptance, not the build

| # | Decision | Proposed default (already in the build) | Your answer |
| --- | --- | --- | --- |
| C1 | Product name, exactly as spelled (`Tambola`, `Housie`, `Bingo`, another word) | "Tambola" — a generic word, not a brand | |
| C2 | Logo / wordmark, and a 192 px + 512 px icon | A generated "T" mark on the Obsidian Hall palette | |
| C3 | Brand colours: primary/accent, background, text-on-accent | Champagne gold `#cfab63` on near-black | |
| C4 | Tagline for link previews (WhatsApp, Slack) | "A free-to-play game night, live, on every phone" | |

Consequence of silence: the site is publicly usable and unmistakably a placeholder
brand. We will not invent a company name, a logo, or a legal entity.

## 2. Address — blocks public deployment

| # | Decision | Proposed default | Your answer |
| --- | --- | --- | --- |
| C5 | The production domain, and who owns the DNS record | None. Today the URL is a temporary `*.trycloudflare.com` that changes every restart | |
| C6 | Who owns the hosting account and pays the monthly bill | Nobody. The only $0 path is a machine we control; the reliable paid path starts at ~$3.69/mo (Fly.io 512 MB + Supabase Free) | |

Why these block: cookies, CORS, invite links, QR codes and TLS all derive from the
address. A link that changes on restart cannot be printed on a poster.

## 3. Rules — blocks the game, not the software

| # | Decision | Proposed default | Your answer |
| --- | --- | --- | --- |
| C7 | Tickets per player | 4 (range 1–12, a setting) | |
| C8 | **Points per pattern** — Early Five, each line, Corners, Full House | 20 / 10 / 10 / 10 / 20 / 30 | |
| C9 | **Early Seven** — add it? | Not live. A complete, tested rule exists and is deliberately unregistered; see `docs/RULES-DECISIONS.md` §1.1. To switch it on: your approval plus the point value | |
| C10 | Star, Middle Number, 143, Pyramid | Not live, and we will not guess. Each needs a written definition from you | |
| C11 | Claim window (may a player claim N calls late?) and multiple winners per pattern | 0 calls; one winner per pattern, first valid claim | |
| C12 | Late joiners | Watch the round in play, ticketed from the next round | |

Consequence of C9/C10 silence: nothing is awarded for those patterns. That is
deliberate — a prize decided by an ambiguous rule is worse than a missing prize.

## 4. Operation — blocks a public launch

| # | Decision | Proposed default | Your answer |
| --- | --- | --- | --- |
| C13 | Peak scale: rooms and players at the busiest hour | 50 rooms / 250 players — measured at p95 85 ms per call ack with the default pool, zero duplicate calls | |
| C14 | Who is on call at 9 pm, and the support contact players see | Nobody; no contact is shown in the app | |

Peak scale chooses the hosting size. On-call decides whether alerts are an email
or a phone.

## 5. Legal and money — blocks a public launch

| # | Decision | Proposed default | Your answer |
| --- | --- | --- | --- |
| L1 | Written confirmation: free to play, no entry fee, no cash prize, ever? | Free to play. Nothing in the build processes a payment | |
| L2 | Privacy policy, terms of use, and a data-retention statement, as text plus URLs | None. The footer links are hidden when unset | |
| L3 | May minors play? | Unstated. The market rates comparable apps 3+/4+ | |
| L4 | Owner administrator identity (name + email) for the control centre | None exists. Created on the server with `npm run owner:create`, MFA enrolled at first sign-in | |

If L1 is "no, we want paid entry", stop: that is a regulated product (licences,
KYC, age gates) and a different project. Nothing in this build should be pointed at
it.

---

## 6. What we do once this page comes back

| Answer | Work |
| --- | --- |
| C1–C4 | Client-side branding change; existing tests unchanged. Half a day |
| C5, C6 | Deployment; no code change. Once the URL exists: DNS, TLS, `PUBLIC_ORIGIN`, the uptime probe |
| C7, C8, C11, C12 | Configuration values; no code change |
| C9 | Register the existing rule, set the point value, ship with the tests already written |
| C10 | Test-first build, per pattern, only after the definition is written down |
| C13 | Choose the hosting size in `docs/FREE-INFRASTRUCTURE-RESEARCH.md` §5 |
| C14, L2, L4 | Accounts, static legal pages, the on-call rota |
| L3 | Wording only |

## 7. Sign-off

```
C1  Name: ...................................................
C2  Logo/icon supplied: [ ] yes  [ ] use the default mark
C3  Colours: ....................  (or "keep the default")
C4  Tagline: ................................................
C5  Domain: ....................  owner of DNS: ..............
C6  Hosting account owner: ....................  budget: ....
C7  Tickets per player: ......   C8  Points: .................
C9  Early Seven: [ ] add at .... pts   [ ] do not add
C10 Star/Middle/143/Pyramid: [ ] defer all  [ ] definitions attached
C11 Claim window: .... calls   Multiple winners: [ ] off  [ ] on above .... seats
C12 Late join: [ ] as proposed  [ ] other: ...................
C13 Peak: ...... rooms  ...... players
C14 On call: ....................  Support contact: ..........
L1  Free to play, no cash prizes: [ ] confirmed
L2  Privacy/Terms/Retention: [ ] supplied  [ ] we will supply later
L3  Minors: [ ] allowed  [ ] not allowed  [ ] unstated
L4  Owner admin: ....................  <....................>

Signed: ................................  Date: ..............
```

Nothing above changes a line of game logic except C9 and C10, and neither can award
a prize until it is written down, tested and signed here.
