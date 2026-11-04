# Frontend reconstruction plan and design contract

Date: 2026-11-03. Scope: presentation in `client/` and frontend documentation only. Existing dirty worktree changes, including server changes, predate this task and must be preserved. No commit, push, deployment, dependency purchase, database or production-data change is authorized.

## Boundary and preserved contracts

The application uses React 18, React Router, Vite, Socket.IO Client and react-icons. There is no Three.js, React Three Fiber or animation dependency. A shaded CSS number sphere over original raster art provides the reference's depth without adding WebGL cost. The illustrated stage is decorative; it never depicts official called numbers.

`client/src/net.js` owns the Socket.IO transport, tab-scoped seat/session storage, acknowledgement timeout and resume. `client/src/GameScreen.jsx` owns subscriptions and server snapshot projection. `GameShell`, shared components and `caller/CallerConsole` render the resulting `view`; they do not generate tickets/numbers, score claims or transition game state locally. `server/`, root dependency manifests, environment files, deployment files and migrations are outside this change boundary.

All request acknowledgements remain `{ ok: true, ... }` or `{ ok: false, code, error }`.

| Existing event | Existing payload | Presentation use |
| --- | --- | --- |
| `room:create` | `{ name, instanceSlug? }` | Existing host entry |
| `room:join` | `{ roomId, name, instanceSlug? }` | Existing player entry |
| `session:resume` | `{ roomId, sessionToken }` | Reconnect and authoritative role/snapshot |
| `room:state` | omitted | Refresh the sole authoritative snapshot |
| `tickets:select` | `{ count }` | Waiting-state ticket picker only |
| `game:start`, `game:call-next`, `game:pause`, `game:resume`, `game:end`, `game:reset` | omitted | Existing server-authorized host actions |
| `game:set-autocall` | `{ enabled?, intervalMs? }` | Existing host auto-call and speed |
| `claim:submit` | `{ pattern, ticketNo? }` | Existing server claim verification; never submit marks or points |
| `room:remove-player` | `{ playerId }` | Existing waiting-state moderation |
| `chat:send` | `{ text }` | Real room chat |
| `chat:history` | omitted | Real short chat history |

Subscriptions remain `connect`, `disconnect`, `number:called`, `game:state`, `room:updated`, `host:changed`, `game:completed`, `claim:result`, `ticket:assigned`, `room:closed`, `app:error`; chat separately consumes `chat:message`. Every listener is removed on unmount. Resume seeds announcements to prevent replaying old numbers. Host authority stays server-enforced.

Snapshot fields used by the live surfaces: `roomId`, `state`, `calledCount`, `remaining`, `lastCall`, `autoCall`, `callIntervalMs`, `elapsedMs`, `gameNumber`, `calledNumbers`, `enabledPatterns`, `patternViews`, `patternExample`, `claimStates`, `awards`, `leaderboard`, `players`, `tickets`, `ticketCount`, `maxTickets`, `playerId`, `name`, `points`, `maxPlayers`. Ticket entries retain `{ no, grid }`, including textual serials. Number order follows the existing ascending chronological called-history contract; presentation may reverse a copy for newest-first strips.

The valid state machine remains WAITING → RUNNING → PAUSED/RUNNING → COMPLETED → WAITING. No frontend-only undo exists in the documented contract. Next number remains unknown until the server calls it. Do not add an operational Undo control, reveal a fabricated future number, invent event dates or infer festival/game titles absent from the snapshot. Music is not supplied by the existing announcement layer and must not appear as a working music mixer. Speech voice/rate/volume and fullscreen can operate locally using their existing callbacks/browser capabilities.

A SHA-256 inventory of every existing server file was recorded before editing at `.tmp/frontend-reconstruction/backend-baseline.json`. Integration must compare against this baseline, rather than claim that all server files are git-clean (they were already dirty).

## Reference analysis

The supplied PNGs are 1672 × 941. Image 1 is the live caller console, image 2 the product showcase, image 3 the player page. The primary targets are image 1 and image 3; image 2 supplies consistent branding, ticket/ball materials and adjacent product styling.

### Player page composition (image 3)

- Header: approximately 76 px high, horizontal logo about 360 px wide at left, five primary navigation destinations, language and seat controls at right. Deep plum with thin warm-gold bottom edge.
- Left rail: approximately 340 px / 21% of width. Event summary above chat; chat has real avatars/initials, scroll history, compose and quick messages.
- Center: approximately 845 px / 50% of width. A dominant illustrated caller stage about 400 px tall; number sphere at the center/right, speech bubble above; horizontal history beneath and cream tickets below.
- Right rail: approximately 455 px / 27% of width. Ten-column 1–90 board, game-progress card and current-pattern card.
- Bottom dock: approximately 73 px high, full-width plum strip; rounded outlined controls with gold highlights.
- Narrow layouts: stack stage first, tickets, board/pattern and secondary rails without shrinking a desktop screenshot. The board remains ten columns; tickets remain genuine 3×9 grids.

### Caller page composition (image 1)

- Header: approximately 64 px high. Brand left, live game title center, room/player/status controls right.
- Main caller scene/controls: left 30% of width and most main height; illustrated host, live sphere, previous/current/unknown next/remaining statistics; actual call/pause/end controls.
- Master board: center about 32% of width, nine rows of ten numbered cells. Right of it history, game info and current pattern, with players at far right.
- Lower center/right: tickets and claims. Chat/status footer across the bottom.
- At tablet, use two columns; at phone, one ordered column with call controls always reachable.

### Correctness overrides within the visual target

The raster reference's board has repeated/missing numbers and its stylized sample tickets show only five visible columns. Those image errors must not be copied. The implemented board must contain each integer 1–90 exactly once in ascending order and ten columns. Real issued tickets retain all nine columns and blanks; each issued row contains the server's five numbers. The reference's player names, count, date, room code, scores and numbers are visual examples, never production data.

## Design system

Use central tokens and preserve tenant accent overrides. Palette recommendations: deep background `#18051f`, plum panel `#30072f`, royal-purple surface `#49104e`, festival magenta `#df0788`, neon accent `#ff48b8`, rich gold `#ffd34d`, gold edge `#c77b20`, orange `#ff9b28`, ticket cream `#fff0c5`, ivory `#fff5e5`, muted lilac `#cbb6d7`. Gold gradients move from pale `#fff5ad` through `#ffd34d` to `#dc7b18`.

Use Georgia/Palatino italic for display titles/wordmark, system UI Segoe UI/Arial for controls and bold tabular system numbers for boards/tickets. Do not load Google Fonts. Typical radii: panels 18–24 px, controls full pill, board cells 7–10 px, tickets 15–20 px. Borders: fine gold with restrained inner pink edge; shadow: plum-black depth plus localized gold/magenta halo. Gaps approximately 12–16 px desktop and 10–12 px mobile. Avoid low contrast gold text on cream tickets; use dark plum digits.

Shared `NumberBoard`, `CurrentNumberReveal`, `CallHistory`, `TambolaTicket`, `TicketCell`, `PatternDiagram`, `Panel`, `Button` and game header carry the same system into both roles. Existing accessible labels, keyboard behavior, read-only board semantics and server-state announcements remain. New entrances should animate transform/opacity only; reduced-motion eliminates nonessential movement. No perpetual WebGL render loop is necessary.

## Asset catalog and brand integration

Existing decorative environments: `client/public/brand/festival-*-environment-v1.webp`; courtyard and caller stage v1 are original project artwork, but stage v1 is photoreal and diverges from the illustrated references. Existing transparent `festival-host-illustration-v1.png` is a cartoon woman holding a blank ticket; use only where appropriate, not as an additional host over a complete caller scene.

New `festival-caller-stage-v2.webp` is an original built-in Image Gen illustration, 1672×941, optimized with Pillow WebP quality 88/method 6. It contains a smiling original moustached gold-kurta announcer left, brass cage of completely unnumbered balls right, dark central space, empty pedestal, fireworks, lanterns, diyas and flowers. A real DOM number sphere overlays the center at about x=50%, y=60%; its number remains readable, selectable by assistive technology, and server-driven. This is decorative illustration, not interactive 3D. Source PNG remains in Codex generated-images storage at `C:/Users/Lakhya/.codex/generated_images/01a1a060-7303-7881-9d58-eadb09069854/exec-71e95376-d414-4564-b0cf-02da4d01cd2c.png`.

Final generation prompt: “Use case: stylized-concept. Asset type: decorative hero artwork for a live Indian festival Tambola game; not a screenshot or UI. Create a premium colorful polished 3D cartoon illustration, landscape 16:9. A cheerful ORIGINAL Indian male announcer with curled moustache, wavy black hair, golden embroidered kurta and purple stole, holding a microphone, occupies the left third, gesturing toward center. On far right is a shiny brass and purple bingo cage containing small completely unnumbered colored balls. Rich purple/magenta Diwali palace garden at night, golden hanging lanterns, fireworks above, glowing diyas, marigold and pink flowers along bottom edge. Leave CENTER THIRD open and dark plum with a small glowing empty gold pedestal at bottom center, for a real HTML number ball overlay. All balls in image must be completely blank with no text or numbers. Strong warm gold rims, saturated festival pink lighting, inviting joyful cartoon aesthetic matching a premium family game. No words, numbers, letters, logos, watermarks, controls, panels or speech bubbles. Original artwork, do not reproduce a known character.”

The brand is reconstructed as an original crown-and-ticket emblem, an italic gold horizontal lockup, compact emblem/favicon and social card. Existing filenames `tambola-house-mark.svg`, `tambola-house-lockup.svg`, `tambola-house-icon.svg`, `tambola-house-social-card.svg` are retained to preserve the platform's asset allowlist and tenant mechanism. None depicts a fake live number. Existing `DEFAULT_BRAND`, configurable VITE paths, `usePlatformBranding`, instance branding events and the server manifest URL remain in place. Browser favicon and runtime social metadata automatically use the revised assets. Static manifest and HTML theme colors use plum. Older brand assets remain available to existing explicit tenant selections; default references point to Tambola House.

## Integration and QA gate

1. Rebuild both role compositions with the shared existing data boundary.
2. Verify board 1–90 integrity, textual ticket IDs, ticket marking/claim eligibility and current call/history consistency.
3. Lint and production build using existing client commands, without dependency churn.
4. Run relevant frontend contract/unit tests and actual game flows against an isolated local server when possible. Never change production data.
5. Capture both roles at 1920×1080, 1440×900, 1366×768, 1024×768, 768×1024, 430×932, 390×844 and 360×800. Check overflow, clipping, contrast/readability, focus, reduced motion and control availability.
6. Compare actual captures with the references. Record screenshot locations, supported/unsupported controls and remaining differences explicitly. Build success alone is not visual verification.
7. Compare backend hashes with baseline. No backend file changes may be attributable to this reconstruction.

### Narrow caller illustration

`client/public/brand/festival-caller-portrait-v2.webp` is a second original built-in Image Gen asset for the narrow caller scene: 1176×1337, 404,480 bytes (WebP quality 88/method 6). The announcer occupies the left 45%, cage upper right, and lower-right dark space ends in an empty pedestal. Recommended live DOM ball center is around x=70%, y=67%. Source: `C:/Users/Lakhya/.codex/generated_images/01a1a060-7303-7881-9d58-eadb09069854/exec-713a7e7f-0074-4c88-bb01-68648ae00542.png`.

Final portrait prompt: “Use case: stylized-concept. Asset type: PORTRAIT 4:5 decorative caller-stage illustration for Indian festival Tambola. Create an original premium polished cheerful 3D cartoon illustration. Composition is tightly designed for a narrow 440px-wide by 500px-tall web hero: smiling original Indian male announcer with curled moustache and wavy black hair, gold embroidered kurta and royal purple stole, holds microphone on LEFT 45% and gestures to right. A small shiny brass bingo cage containing completely unnumbered magenta/gold/purple balls sits in UPPER RIGHT. Keep LOWER RIGHT clear dark plum negative space with an empty glowing gold pedestal at bottom right, reserved for a real DOM number ball overlay. No ball on pedestal. A rich Diwali palace garden at night with saturated purple-magenta sky, fireworks, lanterns, warm gold lighting, diyas, pink and marigold flowers near corners. Focus composition on readable host face at top left, cage top right, open pedestal lower right. Same premium joyful family game illustration style. No words, numbers, letters, logo, UI, speech bubbles or watermark; all tiny cage balls blank. Do not copy an existing character.”

Brand-specific checks: `node --test tests/branding-metadata.test.js tests/platform-branding.test.js` passed 8/8 on 2026-11-03. Intermediate backend baseline comparison: all 81 server files unchanged (0 hash differences). Integration must repeat this comparison at final QA.
