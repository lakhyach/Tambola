# Frontend reconstruction delivery report - 3 November 2026

## Outcome

Reconstructed the live player and caller pages around the supplied references, retaining the existing server-driven application. The result is a reference-inspired original implementation, not a pixel-identical reproduction. Existing public booking, theme, poster, host-entry and owner workflows remain in place and receive the revised default brand assets; those routes were not replaced with static mock screens.

## Components and assets

- Player: three-column information/chat, illustrated caller stage, speech bubble, spherical current ball, horizontal official history, shared tickets, board, progress, configured pattern browser, claims/results, audio settings dialog, help and fullscreen control. Mobile uses an ordered single-column experience and compact dock.
- Caller: illustrated draw desk with previous/current/sealed-next/remaining values; shared master board; official history; game information; configured pattern browser; real roster; issued tickets; compact claims with expandable rules; existing call/pause/resume/end/reset/autocall/interval/voice/chat controls.
- Shared: festival surfaces/tokens, local/system typography, original SVG crown-and-ticket logo/lockup/favicon/social card, branded route loading, cream-and-gold 3x9 tickets, desktop ticket gallery with existing mobile keyboard tabs, current/called number states, chat initials derived from actual sender names, focus and reduced-motion rules.
- Correctness: nonnumeric ticket identifiers preserved in ticket tabs, award attribution, results and celebration. Caller claims use room/ticket/identity eligibility plus the server verdict. Lazy game header initializes from active tenant branding and still listens for branding updates.
- New original artwork: `client/public/brand/festival-caller-stage-v2.webp` (359,056 bytes) and `festival-caller-portrait-v2.webp` (404,480 bytes). No static called numbers are painted into these images.
- Revised assets: `tambola-house-mark.svg`, `tambola-house-lockup.svg`, `tambola-house-icon.svg`, `tambola-house-social-card.svg`, `site.webmanifest`; HTML metadata uses the existing brand mechanism.

## Files changed in this execution

Shared frontend:
- client/index.html
- client/src/main.jsx
- client/src/components/GameHeader.jsx
- client/src/components/NumberBoard.jsx
- client/src/components/CallHistory.jsx
- client/src/components/TicketRail.jsx
- client/src/components/GameChat.jsx
- client/src/components/WinningPatterns.jsx
- client/src/components/YourResult.jsx
- client/src/components/CelebrationOverlay.jsx
- client/src/components/festival-system.css (new)

Player:
- client/src/components/GameShell.jsx
- client/src/components/PlayerGameExtras.jsx (new)
- client/src/gameplay-festival.css

Caller:
- client/src/components/caller/CallerConsole.jsx
- client/src/components/caller/CallerHero.jsx
- client/src/components/caller/CallerControls.jsx
- client/src/components/caller/CallerLog.jsx
- client/src/components/caller/RoomOverview.jsx
- client/src/components/caller/caller-console.css
- client/src/components/caller/CallerGameInfo.jsx (new)
- client/src/components/caller/CallerPattern.jsx (new)
- client/src/components/caller/CallerClaims.jsx (new)

Assets and documentation are listed above and in FRONTEND-RECONSTRUCTION-PLAN.md and FRONTEND-INTEGRATION-AUDIT.md. Existing dirty worktree changes were retained; the repository was already extensively modified before this execution. No dependency installation, commit, push or deployment was performed.

## Backend protection

`GameScreen.jsx`, `net.js`, backend routes, payloads, state transitions, generation, validation and scoring remain unchanged by this execution. A SHA-256 baseline of all 81 server files was captured before implementation. The final comparison found **0 changed files out of 81**. No database migration or production-data operation was performed. The QA server imports the existing `createApp` with `memoryOnly:true`, without loading the project .env, and runs on localhost:4000. Vite runs on localhost:5173. The temporary launcher is .tmp/frontend-reconstruction/preview-server.mjs.

## Validation

- Final ESLint: PASS, no warnings. Log: .tmp/frontend-reconstruction/lint.log.
- Final production Vite build: PASS, 193 modules. Log: .tmp/frontend-reconstruction/build.log.
- Targeted frontend/integration suite: **133 passed, 0 failed**. Covers tickets/player views/caller controls/realtime/voice/chat/announcements/branding/celebrations/runtime themes. Log: .tmp/frontend-reconstruction/frontend-tests.log.
- Existing real-engine end-to-end script: PASS through COMPLETED, six server-verified awards, invalid and duplicate claim rejection and engine-integrity assertion. Log: .tmp/frontend-reconstruction/e2e.log.
- Browser: created real room, joined independent player, selected two actual tickets, started, called successive official numbers, checked both boards/history/ticket marks, refreshed to resume the same seat, sent real chat, navigated configured patterns, opened/closed settings and help, paused/resumed, confirmed end/reset, and restarted. An actually eligible Early Five was submitted and awarded **20 points to QA Player, Ticket 1**. Both clients displayed the authoritative award.
- Fullscreen control was exercised and its pressed state changed; the in-app browser's native fullscreen presentation was not independently certified across browser implementations.
- A fresh player-page load had **no console warnings or errors**. During implementation, Vite transiently logged stylesheet reload and duplicate-root warnings after entry-module hot updates; a full reload cleared those development-session artifacts.
- The complete backend/database test suite was not run: this was a frontend-only change and the targeted suite plus memory-only real-engine flow were used instead.

## Responsive evidence

Both roles were measured at 1920x1080, 1440x900, 1366x768, 1024x768, 768x1024, 430x932, 390x844 and 360x800. Each rendered exactly 90 board cells. No horizontal page overflow or main control extending outside the viewport was detected. Reports: .tmp/frontend-reconstruction/responsive-player.json and responsive-caller.json. Mobile pages deliberately scroll vertically; desktop panels reflow on tablets. Desktop caller claims can scroll internally as real awards/details expand.

Screenshots are in **.tmp/frontend-reconstruction/screenshots/**:
- player-final-1672x941.jpg and caller-final-1672x941.jpg
- player-reference-comparison.jpg and caller-reference-comparison.jpg
- player-WIDTHxHEIGHT.jpg and caller-WIDTHxHEIGHT.jpg for the eight viewports above
- player-mobile-full.jpg, player-full-page.jpg, caller-full-page.jpg
- player-verified-claim.jpg, caller-paused.jpg, caller-completed.jpg, caller-waiting.jpg

The final reference-size images are top-of-page crops of actual full-page browser captures; source captures are retained. Requested CSS size was 1672x941 (the browser reported height 942 after rounding); native image content was 1656x932 after browser frame/scrollbar exclusion. Comparisons normalize this to 1672x941. The references use different participants, ticket values, calls and prize settings, which were not copied into runtime state. Some breakpoint captures also exclude native scrollbars/frame pixels; the JSON records actual CSS viewport measurements.

## Visual comparison and iteration

Sources: the attachment's image-1.png, image-2.png and image-3.png. Player/C screenshots and caller/A screenshots were opened together in combined comparison images. Reference B informed the common brand and festival language.

Resolved issues during visual review:
1. P1: generic panel style hid player stage artwork. Added a scoped hero rule; recapture shows complete original caller/cage/pedestal scene.
2. P1: inherited cream ticket frame made header text unreadable. Restored a dark frame with light title and cream number grid.
3. P2: desktop ticket headers/stats pushed numbers beneath the dock. Compacted headers, removed duplicate visual labels, retained row statistics for assistive technology, and showed two issued tickets side by side.
4. P1: caller history's intrinsic width forced game information under the roster. Used minmax(0,1fr), constrained children and internal history scrolling; final card/column widths match.
5. P2: tall caller stage hid draw transport controls. Reduced bounded stage height and exposed secondary help through native disclosures, preserving all controls.
6. P2: long caller claims obscured the intended composition. Compact expandable rows preserve server diagrams, eligibility, dependencies and winners.
7. P2: oversized mobile header delayed the actual current number. Compacted redundant header controls; their full audio settings remain accessible in the docks.
8. Integration audit: corrected paused/completed caller claim gating, alphanumeric award labels and lazy tenant-logo initialization.

No unresolved P0/P1 functional or layout finding was found in the inspected live states. Remaining visual differences are documented below; this is not a claim of pixel identity.

## Remaining differences and limitations

- Original announcer, court, cage, flowers and logo differ in exact drawing, crop and ornamentation from the reference. Ticket frames and number-ball embellishment are simpler; this is residual visual fidelity work, not a copied raster interface.
- Real tickets are three rows by nine columns with five numbers per row. The reference's compressed/incorrect sample ticket and missing/duplicate master-board numbers were intentionally not reproduced.
- Early Five uses the server's count explanation; fixed-position diagrams are shown only for configured patterns with server-provided cells. Actual point values and available prizes are preserved.
- Unsupported Undo and music controls are omitted. No fake schedule, notification, avatar photo, event title or player count is invented. Real sender initials stand in for absent avatar photos. Game-specific date/type metadata is not available in the current live view.
- Booking and Events navigation both lead to the existing public game/session catalogue because there is no separate user booking dashboard/event-list contract in this live UI.
- The backend's existing claim windows remain authoritative. A ticket with enough marked cells can still be outside its allowed claim window; the frontend follows the server verdict rather than inferring eligibility locally.
- Keyboard semantics/focus, live announcements, native modal focus containment, mobile tab navigation and reduced-motion CSS were inspected. No independent screen-reader audit, color-contrast certification, OS-level reduced-motion session or GPU/performance trace was performed.
- No Three.js dependency exists or was added. Artwork plus CSS number-ball shading avoids a continuous render loop and works without WebGL. No new frontend dependencies or external font requests were introduced.
- Build observation: game route JavaScript is approximately 134 kB / 42 kB gzip; wide and portrait artwork together are about 764 kB, with only the relevant hero mounted per role. These are build observations, not measured Core Web Vitals.

## Review

Open http://localhost:5173/ in the running local preview. The player and caller QA tabs were retained in the in-app browser. Review the original source alongside the combined screenshots for further art-direction changes. No production deployment has been performed.

final result: passed

## Ninety Club scope expansion review — 3 November 2026

### Completed in this review

- Landing page and Admin room creation now share one frontend catalog for all 11 patterns in `server/game/patterns.js`, with a canonical 3×9 ticket, descriptions, points, fixed-cell diagrams, and notes for count/seat-scoped rules. Newly created Admin rooms include all 11 IDs in the existing `enabledPatterns` request. Direct Host creation enables the five additional patterns through the existing `room:set-patterns` event before opening the waiting room; a failure leaves a review notice. No server rule or request contract changed.
- Public booking uses “Book Ticket” in English and Hindi.
- Theme cards no longer layer generated SVG motifs or the large CSS oval over the existing festival artwork.
- Player routes no longer expose Themes navigation. The public theme library is read-only; Admin theme preview/management remains separate.
- Published public poster pages retain view and sharing actions but no longer expose PNG/SVG export. Poster creation, editing, publishing and export remain in the existing Admin Poster Studio routes.
- Platform branding normalizes the legacy platform label to Ninety Club while preserving tenant-specific names. The social-card wordmark was updated in place; logo and favicon files were left unchanged as requested, so those protected SVGs retain the embedded “Tambola House” wordmark.

### Verification and limits

- Client ESLint passed with zero warnings; Vite production build passed (195 modules).
- Focused existing client/game tests passed: **272/272**, including booking localization, theme art/runtime, ticket/player/caller behavior, pattern geometry and all five additional pattern evaluators.
- SHA-256 comparison of 81 server files against the baseline captured for this scope found no changes. Existing backend edits were already present in the shared dirty worktree; this review made no backend edits. No commit, push, deployment, purchase, environment edit or production-data change was performed.
- A genuine downloaded numbered 3D model could not be sourced under the task constraints. The free [Sketchfab Bingo Balls model](https://sketchfab.com/3d-models/bingo-balls-gltf-c6acce9e49804314aeb48ca829903986) is unnumbered and its download endpoint required account authorization; the numbered alternatives found were paid or print-only. No Three.js/R3F/Drei dependency or fabricated sphere was added. See Sketchfab's [license guide](https://www.sketchfab.com/blogs/community/refine-downloadable-model-searches-with-new-license-filters/).
- Current-turn browser screenshots and interactive route checks are blocked: the in-app CUA bridge failed before returning browser state (`failed to write kernel assets: The system cannot find the path specified`), as did the desktop browser bridge. The prior-turn screenshots above predate these changes and are not presented as current evidence. Admin/Moderator/Super Admin sessions and responsive screenshot matrices were not reverified in this turn.
- The visual brand-name conflict remains only in the protected logo lockup/icon artwork, which still contains the embedded “Tambola House” wordmark. Product text, metadata and social-card text use Ninety Club; the current logo and favicon assets remain unchanged per the explicit preservation rule.

**Current scope review: final result: blocked.** Code checks pass, but the requested genuine local 3D ball and current browser-based visual verification remain incomplete.
