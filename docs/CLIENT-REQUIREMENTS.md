# Client requirements — inputs needed for the final release

Phase 16 · prepared 31 October 2026 · build `2063f0b`

This is an input checklist, not a design. Every value below is **blank on purpose**: the build must
not ship fictional branding, a guessed language default, or an invented domain. Each row names where
the answer plugs into the code or configuration, so a one-line reply is enough to start.

Legend: **E** = essential, the release cannot be accepted without it · **O** = optional, a
configuration choice with a safe default already in place.

---

## 1. Brand and identity

| # | Input | Class | Why it is needed | Where it plugs in |
| --- | --- | --- | --- | --- |
| 1 | Product name (exact spelling, including "Tambola" vs "Housie" vs "Bingo") | **E** | Appears in the header, page title, invite text and share sheet. The build ships a built-in identity ("Tambola" / "Obsidian Hall") that must be replaced | `VITE_APP_NAME` in the build env; default in `client/src/config.js` |
| 2 | Logo / wordmark (SVG preferred, PNG ≥ 512 px acceptable) | **E** | The header currently uses the built-in mark and a generated icon set | `VITE_APP_LOGO`; files in `client/public/` |
| 3 | Favicon / app icon (192 px and 512 px) | **E** | Browser tab and phone home-screen icon | `client/public/` |
| 4 | Brand colours — primary, accent, surface/background, and a text-on-primary colour | **E** | The shipped accent is Champagne gold (`#cfab63`) on the "Obsidian Hall" palette — a placeholder identity, not a client choice | `VITE_BRAND_COLOR` plus the custom properties in `client/src/components.css` |
| 5 | Fonts (or "use system fonts") | O | Only if the client has licensed webfonts | `client/src/components.css` |
| 6 | Tagline / one-line description for share previews | O | Shown when an invite link is previewed in WhatsApp | `client/index.html` meta tags |
| 7 | Celebration style — restrained or festive (confetti, sound) | O | The overlay exists; intensity is a taste call | `client/src/lib/celebration.js` |

## 2. Domain and language

| # | Input | Class | Why it is needed | Where it plugs in |
| --- | --- | --- | --- | --- |
| 8 | Production domain (and whether the client owns it) | **E** | Cookies, CORS, invite links and TLS all derive from it | `PUBLIC_ORIGIN` env, deploy docs |
| 9 | Default language for the interface and the voice | **E** | English and Hindi are the only shipped sets; the default decides what a new player hears | `client/src/i18n/messages.js`, `client/src/lib/number-words.js` |
| 10 | Additional languages required at launch | O | Each extra language is a word list plus UI strings; not a translation promise | same two files |
| 11 | Whether Hindi digits/words should be used for calls even when the UI is English | O | Voice language is per device today | `client/src/lib/announce.js` |

## 3. Game rules and room behaviour

| # | Input | Class | Default if unanswered | Where it plugs in |
| --- | --- | --- | --- | --- |
| 12 | Tickets per player | **E** | 4 (cap 12) | `maxTicketsPerPlayer` |
| 13 | Supported winning patterns | **E** | Early Five, three lines, Corners, Full House | `config.patterns`; see `docs/RULES-DECISIONS.md` |
| 14 | Prize values / points per pattern | **E** | 20 / 10 / 10 / 10 / 20 / 30 | pattern definitions |
| 15 | Late-joining policy | **E** | Spectator for the round in play, ticketed next round | engine join path |
| 16 | Multiple-winner policy per pattern | **E** | Exclusive (first valid claim wins) | `multipleWinnersPerPattern` |
| 17 | Late-claim window (calls of grace) | **E** | 0 — claim before the next call | `claimWindowCalls` |
| 18 | Default calling interval | O | 8 s (range 0.5–120 s) | `callIntervalMs` |
| 19 | Whether the host may also hold tickets | O | Yes | host seat |
| 20 | Maximum players per room | O | 100 | `maxPlayers` |
| 21 | Admission control (open code vs host approval) | O* | Open by code — **approval is not built**; see the gap report | n/a |

\* Classified O only because the built behaviour is open admission. If the client needs approval,
that flips to a build item, not a setting.

## 4. Scale expectations

These numbers decide the hosting size in `docs/HOSTING-OPTIONS.md`. They are estimates, not promises.

| # | Input | Class | Why it changes the answer |
| --- | --- | --- | --- |
| 22 | Expected maximum concurrent rooms | **E** | Rooms are cheap; each holds a scheduler tick and an in-memory projection |
| 23 | Expected maximum concurrent players | **E** | Load evidence: 400 joins, call-to-screen p95 53 ms, 0 failures (Phase F); 800 sequential room lifecycles, 0 errors |
| 24 | Peak window (e.g. Saturday 7–10 pm) | O | Sizing is for the peak, not the average |
| 25 | Whether rooms are public or invite-only | O | Affects moderation and abuse handling, not capacity |

## 5. Operations and ownership

| # | Input | Class | Why it is needed |
| --- | --- | --- | --- |
| 26 | Who owns the hosting account and pays the monthly bill | **E** | The account owner controls backups and the domain; it cannot be engineering |
| 27 | Client administrator identity (name + email) for the owner console | **E** | The console needs a real operator, created via `node scripts/owner.js create`; MFA is enrolled on first sign-in |
| 28 | Who is on call when a room fails at 9 pm | **E** | Determines whether monitoring is email-only or paging |
| 29 | Acceptable monthly infrastructure budget | **E** | Chooses between the ~$7 and ~$30 tiers in `docs/HOSTING-OPTIONS.md` |
| 30 | Backup retention (days) and whether off-provider copies are required | O | Provider daily backup is the baseline; retention is a policy |
| 31 | Whether staging is required before production | O | A second instance doubles the app cost; the DB can be shared read-only for review |

## 6. Support, privacy and legal

| # | Input | Class | Why it is needed |
| --- | --- | --- | --- |
| 32 | Support contact shown to players (email or WhatsApp) | **E** | There is no in-app way to reach a human today |
| 33 | Privacy policy text and URL | **E** | The game collects display names, seat credentials and chat; a policy is required before a public launch |
| 34 | Terms of use | **E** | Especially the "no cash prizes, no wagering" statement |
| 35 | Data retention / deletion policy (chat is not persisted; names and history are) | **E** | Must match what the code actually does |
| 36 | Whether minors may play | O | Affects wording; the market rates these apps 3+/4+ |
| 37 | Cookie/consent notice | O | Only session cookies are used; no analytics are installed |

## 7. Money — the one answer that must be explicit

| # | Input | Class | Note |
| --- | --- | --- | --- |
| 38 | Is this free-to-play, or will entry fees / cash prizes ever exist? | **E** | **Free-to-play today: nothing in the build processes payments.** Paid entry turns this into a regulated product (skill-gaming licences, KYC, age gates) and is out of scope until the client says otherwise in writing. |

---

## 8. What engineering will do once the answers arrive

1. Brand, logo, colours, favicon — a small client-side change with the existing tests unchanged.
2. Domain + `PUBLIC_ORIGIN` + TLS — deployment work, no code change.
3. Language default — one `VITE_*` value plus the voice mapping.
4. Rules answers — configuration; any "add pattern" answer opens a separate, test-first build.
5. Scale answers — choose the hosting tier in `docs/HOSTING-OPTIONS.md`.
6. Legal text — static pages, linked from the footer.

Nothing in this list requires touching the game engine except an approved new pattern.

---

## 9. Minimum answers to unblock the release

If the client sends only six things, these are the six: **product name + logo, brand colours,
domain, default language, tickets/patterns/prize values, and scale expectations (rooms + players).**
Everything else has a documented default and can follow.
