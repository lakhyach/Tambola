# Next major milestone: Festival-inspired Tambola redesign

**Status:** active implementation, authorized 2 November 2026. The owner has directed that long release-test cycles pause while frontend redesign proceeds. See the current evidence in `MASTER-BUILD-IMPLEMENTATION-TRACKER.md` and `FESTIVAL-ASSET-REGISTER.md`.

This is a full product transformation, not a surface refresh. The remaining functional/security/recovery checks remain required release gates; they no longer block this authorized presentation-layer work. Existing game, booking, tenancy, moderator, and infrastructure contracts remain the baseline and must not be weakened.

## Product outcome

Create one colourful, joyful, premium Indian festival and game-show experience with a coherent design system across player, host, Admin, moderator, and Super Admin routes. Support mobile, tablet, desktop, and large displays. Keep every number, control, ticket, claim, result, and operational status immediately readable. Decoration, 3D, animation, and audio are progressive enhancements; the game remains fully usable without WebGL, sound, or motion.

## Reference-led visual style

The user's supplied collage is the primary visual and interaction direction across the whole product. It shows a festive night game house: richly illustrated landing/host scenes; a dark plum and aubergine canvas; luminous gold borders and diya-like highlights; jewel pink, saffron, teal and emerald accents; cream paper tickets; glossy numbered balls; and compact, warm, high-energy controls. The page canvas and major experience bands run full bleed to the viewport edges; artwork must never be trapped in a rounded hero card or outer shell. Content may use readable max-width grids inside those bands. Reserve rounded panels for actual controls, tickets, small cards and dialogs. The image is a style reference only. Its sample names, numbers, counts, schedules, prices, charts, and room data are not product data and must never be copied into a live interface.

### Visual tokens and usage

| Role | Target | Use |
|---|---|---|
| Night canvas | `#14091F` to `#1D0D2B` | Full-viewport/page background with theme-specific edge-to-edge radial lighting, subtle festival texture and full-width color bands |
| Deep plum panel | `#291239` | Main cards, navigation trays, game modules |
| Raised plum | `#39164A` | Dialogs, selected controls, nested action areas |
| Festival gold | `#FFD15C` | Keyline, focus-adjacent emphasis, selected state and primary actions |
| Saffron orange | `#FF842E` | Join/call actions and warm highlights |
| Gulal magenta | `#E63F9C` | Secondary action and festival variation |
| Peacock teal | `#3CCBC0` | Information, connection and selected-theme variation |
| Emerald | `#28B77C` | Successful state and a seasonal theme accent |
| Ticket paper | `#FFF1D5` | Ticket surface; never use low-contrast dark paper text |
| Ticket ink | `#38243D` | Ticket numbers and text |

Use refined serif or italic display lettering for brand/title moments, system Latin and Devanagari stacks for instructions, and tabular sans numerals for every number. Keep headings expressive but short. Buttons are tactile, pill or softly rounded shapes with a clear verb and pressed/disabled/focus states. Cards use layered plum, fine gold keylines, and one focused glow; reserve ornate double borders and filigree for hero, poster, ticket, and winning moments. Do not put a glow, texture, illustration, or gradient under small operational text when it harms contrast.

### Illustration, motion, and composition

- Commission or generate original, culturally respectful host art and festival motifs. Keep character art on marketing, welcome, empty, and celebration surfaces; do not place it behind ticket numbers, room codes, booking controls, tables, or moderator decisions.
- Use festive strings of light, rangoli geometry, fireworks, diyas, textile borders, crescent, harvest, color-powder, winter, and lantern motifs as subtle framing. Each theme gets its own art package rather than a background hue alone.
- The current call is a glossy, shaded ball with a crisp paper/ink number medallion. Use a fast entry/reveal and themed rim/mark. Keep the text number and call history as authoritative DOM; no animation may delay or change a server call. Use CSS/SVG 2D by default with reduced-motion support. Add WebGL only after a measured improvement and retain a no-WebGL path.
- Tickets are paper-like, square-cell, high-contrast objects with gold theme-specific trim and legible called/current/winning marks. Theme marks may decorate only the official cells supplied by game state.
- At 320–430 px, stack hero art below the key action, keep primary action visible, collapse dashboards into labeled cards, and prevent horizontal scrolling. At desktop, use a denser multi-column game room while preserving a clear reading order.

## Rebuild milestones

The milestones overlap only where integration dependencies require it. Mark each complete only after its scope is implemented and its stated evidence exists; a passing build or screenshot of one route is not a product-wide completion claim.

| Milestone | Scope and exit evidence | State |
|---|---|---|
| 0. Reference, contracts, and creative direction | Reconcile the supplied collage, route inventory, API/data authority, security boundaries, image/audio rights and non-negotiable release limits. | **Complete**; updated with the supplied collage on 2 November 2026 |
| 1. Shared brand and design foundation | Final tokens, typography, navigation, buttons, forms, cards, dialog, decorative rules, responsive foundations and original core artwork. Verify public shell and core controls at 320/390/1440 px. | **In progress**; the landing system and original host/courtyard illustrations are integrated; full-surface token and accessibility review remains |
| 2. Public and booking journey | Landing, theme/hall discovery, instance pages, sessions, reservation states, entry, waiting room and player account/profile surfaces that exist. Use real APIs and representative read-only fixtures for browser evidence. | **In progress**; expanded landing and public discovery, booking, entry and waiting-room styles are integrated; remaining journey and real-data review remains |
| 3. Live player game and tickets | Ticket, call history, 1–90 board, pattern, claims, result, award and reconnect states use reviewed theme artwork without changing rules. | **In progress**; ticket/theme identity slice integrated, broad route review remains |
| 4. Host and caller operations | Setup, waiting room, operations, number reveal, history, participants, claims, patterns, results, caller settings and safe preview. Verify English/Hindi labels and no overlapping speech. | **In progress**; first caller redesign and sample-voice interaction implemented, targeted verification underway |
| 5. Admin, Super Admin, moderator/agent | Overview, instance operations, booking/reporting, permissions, branding, theme review, poster studio, backups and settings retain role/tenant rules. | **In progress**; shared management and moderator styling exists, poster/art direction and responsive route review remain |
| 6. Reviewed theme and poster library | Named festival and classic packages, unique artwork for board/ticket/ball/pattern/poster, preview, approval, versioning, scheduling and rollback. New art stays draft/unpublished until the existing review path approves it. | **In progress**; 9 current IDs plus 13 named visual/catalog drafts and 22 distinct motifs. Eleven original environment scenes (Diwali, Holi, Navratri, Durga Puja, Ganesh Chaturthi, Onam, Pongal, Eid, Halloween, Christmas, New Year) now apply to the landing, atmosphere, or theme preview. Public library remains the existing 9 until review; other theme-specific scenes and full package coverage remain |
| 7. Audio, accessibility and performance | Optional English/Hindi speech, sample preview, callout coverage/review, optional effects, reduced-motion, contrast, keyboard/screen reader, narrow viewport and bundle checks. | **Partial**; caller preview and reduced-motion handling are implemented; landing and shared atmosphere honor reduced motion, but Hindi copy/editor, broader AT/contrast and performance review remain |
| 8. Consolidated release verification | One bounded full regression/security/recovery/browser/performance pass after redesign stabilizes; review failed soak and interrupted follow-up separately. | **Queued**; long cycles remain paused and the two-hour soak failure is unresolved |

## Immediate implementation order

1. Finish the reference-led landing, public discovery, theme library, booking, room entry and waiting-room visual passes.
2. Integrate and visually inspect original host artwork and theme-specific art in actual game tickets, pattern markers and number balls.
3. Bring poster studio, public poster, owner overview/detail, moderator tables and settings onto the same exact tokens and border/glow restraint.
4. Validate voice preview interruption, live-call priority, callout English/Hindi coverage, voice-list behavior, mute, reduced motion and narrow layouts with focused fixtures only.
5. Record each surface and screenshot in the tracker. Do not start the consolidated release gate until all earlier milestones stabilize.

## Research and design evidence

The initial research and design direction are recorded in `docs/FESTIVAL-DESIGN-RESEARCH.md`. Continue source-grounded research for Indian festival and international seasonal experiences, Tambola/bingo products, calling interfaces, poster design, typography, motion, sound and voice as each workstream reaches that subject. Record exact integrated items and rights in `docs/FESTIVAL-ASSET-REGISTER.md`. Use references for analysis, never copy another product's identity, artwork, complete UI, or proprietary assets. Confirm licensing before any download or integration.

Use original artwork where suitable licensed assets are unavailable. Store critical assets locally, optimize formats and sizes, document every integrated asset's source and terms, and avoid placeholder stock art or emoji used as custom icons. Paid assets, subscriptions, TTS credits, or hosted services need separate approval. Never imitate a real person's voice.

## Complete theme packages

Build theme tokens and reusable components on top of the existing theme store. Preserve theme versioning, approval, scheduling, per-instance selection, preview, and rollback. Themes must only change presentation and must never alter game rules, ticket contents, claims, awards, reservations, or authoritative state.

Initial collection:

- Indian festivals: Diwali, Holi, Navratri, Durga Puja, Ganesh Chaturthi, Onam, Pongal, and Eid.
- Seasonal/international: Halloween, Christmas, New Year, Valentine's Day, Summer Carnival, and Winter Wonderland.
- Everyday: Classic Tambola, Royal Indian Celebration, Colour Carnival, and Modern Game Show.

Each package should address background layers, navigation, decoration, cards/panels, controls, typography, tickets/cells/markings, called-number balls and reveal, winning-pattern diagrams, dialogs/notifications, progress/scoreboards, chat, celebration, sound/voice style, loading and empty states. Preview before selection and validate contrast/readability in both English and Hindi.

## Screen and experience scope

Redesign the existing product journeys rather than replacing their APIs or game authority:

- Player: landing, public instance directory and halls, sessions/details, reservation/confirmation, room entry, waiting room, tickets, live board/history/patterns/claims/chat, awards/completion/results, and preferences/profile surfaces that are actually supported by the product.
- Host: room setup and waiting room, caller console, ball reveal, 1–90 board/history, pattern progress, participants/claims/winners, and sound/voice controls.
- Management: Admin dashboard/rooms/scheduling/players/reservations/reports/theme store/poster studio; moderator workspace; Super Admin instances/moderators/reports/backup status/settings/branding.
- Promotion: original festival and regular-game poster templates, instance identity, session details, social formats, export and share, while preserving review/version/rollback and tenant ownership.

Use shared navigation, cards, tables, dialogs, forms, charts, filters, buttons, notifications, and responsive layouts. Preserve role/permission boundaries, MFA, CSRF, tenant filtering, audit and data-retention policy.

## Number calling, tickets, announcements and audio

Make the current call an engaging illustrated or real 3D Tambola ball reveal. Evaluate Three.js/React Three Fiber only if its cost and accessibility are justified; provide an optimized 2D/CSS path for lower-powered devices and WebGL failure. Theme variants may affect ball materials, decoration, lighting and reveal, but cannot delay, reorder, fabricate or change the server's call event. Previous calls move into history without disrupting play.

Redesign tickets as theme-matched physical-style cards with frames, identifiers, cells, typography, row/column structure, call markers and winning states. Markers must remain legible and exactly reflect official calls. Keep the current ticket generator, validation and pattern rules unchanged. Theme-matched pattern diagrams must continue to describe those same rules.

Create an original English and Hindi callout library for numbers 1–90, with multiple distinct variations and selectable family-safe personalities (playful, game-show, friendly, traditional, dramatic, festival). Always state the correct number clearly. Document the entire library. Provide optional voice previews, language/voice/personality, speech speed, master/voice/effect/ambience volume and mute controls. Research browser/offline and licensed provider options for Hindi and English quality, latency, cost, licence, caching, reliability and fallback. Use a provider abstraction; no paid external API may be mandatory without approval.

Audio is opt-in, respects browser autoplay rules and persisted user choice, and never carries essential information. Use only original or commercially licensed music/effects/voices. Include ball roll/reveal, call, ticket mark, game start/end and win sounds as optional effects. Avoid loud unexpected playback.

## Ordered implementation phases

1. **A — Research and architecture:** internet research, reference analysis, licence ledger, creative direction, design tokens, typography, component/theme architecture and performance budgets.
2. **B — Shared design system:** global tokens, navigation, controls, cards/forms/dialogs, typography, original illustration and responsive foundations.
3. **C — Player experience:** landing/discovery/booking/waiting-room/tickets/live gameplay/results.
4. **D — Number calling:** progressive 2D/3D balls, animation, theme markings, number board, announcement library and optional English/Hindi voices/audio.
5. **E — Host/Admin:** caller console and administration/reporting surfaces.
6. **F — Moderator/Super Admin:** permission-adaptive management and platform control surfaces.
7. **G — Theme library:** all initial packages, preview/switching/scheduling/versioning/rollback.
8. **H — Posters:** original templates, editor, export/social sizes and sharing.
9. **I — Final quality:** actual browser flows, 360/390/430 px and larger viewports, English/Hindi, keyboard/screen-reader, contrast, reduced motion, no-WebGL, audio, performance/bundle, and full regression/security checks.

Complete and verify each phase before moving to the next. Do not leave product routes on an old visual language while claiming a complete redesign. Capture actual browser screenshots and record tested pages, viewports, locale, accessibility, audio/voice behavior, bundle/performance changes, assets/licences, themes completed, and limitations in the tracker.

## Non-negotiable technical and product invariants

- Node/Express/Socket.IO/PostgreSQL and the existing single authoritative game engine remain the source of truth.
- Preserve ticket generation/validation, number-call ordering, all winning-pattern validation, reservation/booking integrity and retention, multi-instance isolation, moderator RBAC, audit, recovery and reconnect behavior.
- Presentation, theme tokens/assets, announcement content, voice providers and game state remain separate layers around stable APIs/events.
- Free-to-play only: no deposits, wagers, paid tickets, cash prizes, withdrawals or payment processing.
- Motion supports reduced-motion and has a no-animation fallback. 3D has a no-WebGL fallback. Audio is optional and user-controlled. Numbers and controls remain accessible by keyboard and screen reader.
- Do not use unlicensed/copyrighted art, proprietary UI, placeholder images as final art, or celebrity/identifiable voice cloning.
- Do not purchase, use a paid mandatory provider, alter production data/secrets, deploy, change DNS, commit, or push without separate authorization.
