# Prompt-driven Poster Studio

Updated 3 November 2026. The prompt-first implementation is present, but this milestone remains **incomplete** until a real provider is configured and the authenticated browser workflow is visually reviewed.

## Implemented

- The Admin Poster Studio leads with a natural-language visual prompt and actual scheduled session selection. Existing reviewed templates remain optional composition systems.
- Generation is server-side through the OpenAI Images API adapter in `server/posters/image-provider.js`. API credentials are read only from `OPENAI_API_KEY`; `POSTER_IMAGE_MODEL` may override the default `gpt-image-2.5-flare`. No key was present in the local environment, so provider calls are disabled and no generated asset was created in this milestone.
- The provider validates prompt and requested dimensions, sends background-art-only instructions, uses a timeout, retries a transient network/5xx/rate-limit response once, maps errors, limits response size, and validates PNG signature and requested IHDR dimensions. The UI shows an explicit unavailable state and never fabricates an image.
- Generated PNG bytes and provenance (instance, session, creator, provider, model, prompt and SHA-256) are stored in PostgreSQL. Draft assets are retrieved through the owner-authenticated Admin API; public image retrieval is only available through an explicit poster publication. A per-actor generation cooldown is stored in the database.
- Event facts come from the selected instance's actual `game_sessions`, public availability/holds, assigned room, and enabled server pattern registry. Patterns are described as free game points; the application has no monetary prizes. `time_zone` is stored on each scheduled session (migration 026), and poster dates render in that IANA timezone. Session-backed title, schedule and pattern text are re-derived when saving and publishing; the image model only creates background artwork.
- Event title, detail, schedule, join path, room, pattern points, and CTA are typeset in the existing SVG composition system. Responsive preview and export supports SVG plus PNG dimensions: square 1080×1080, portrait 1080×1350, landscape 1350×1080, story 1080×1920.
- Draft save/reopen, duplicate, immutable publication, saved revisions, export, public poster page, public artwork endpoint, live session availability lookup, copy-link/announcement, native-share, WhatsApp, Telegram and Facebook share URLs are implemented. External share dialogs are not represented as completed publication.
- Published server-rendered `/poster/:posterId` HTML includes event-specific title, description, canonical URL and Open Graph/Twitter image metadata. The public API omits private instance IDs and does not expose player/moderator data. The join link uses the public session route; current booking availability is fetched when the public page loads.
- No image asset was generated for this feature, and no provider credentials were added to the browser or repository.

## Verification performed

- Provider and poster tests: `node --test tests/poster-image-provider.test.js tests/posters.test.js` against a new disposable PostgreSQL 17 container on port 55439: **9 passed, 0 failed, 0 skipped**. The integration test used a deliberately injected synthetic provider and a synthetic isolated session; it verifies database storage, instance isolation, real pattern points/availability/timezone binding, revisions, explicit publication and public artwork access. This is not a real OpenAI generation test.
- `npm run lint --prefix client`: passed.
- `npm run build --prefix client`: passed with Vite 6.4.5 (184 modules).
- `tests/bookings.test.js` was also attempted during timezone integration review. Two functional booking tests passed; its backup/restore case failed because its fixture invokes `docker exec tambola-pg`, a configured container that is not running. This failure is unrelated to the poster tests; no booking change is claimed verified by that case.
- The disposable database container was stopped and removed; no production database or the separate booking test container was modified.
- No authenticated browser screenshots or real provider output were produced in this turn. The local PostgreSQL 55432 service was unavailable, no owner browser fixture was authorized/available for this milestone, and the provider key is absent. The real provider workflow, visual artwork quality, exports in browser, social crawler rendering, and session expiry behavior remain unverified.

## Remaining acceptance work

1. Configure a valid server-side OpenAI API key and model access without purchasing credits or changing secrets in this task; obtain separate owner authorization before any billable image-generation request.
2. In a disposable authenticated browser fixture, verify prompt submission, provider result, generated preview, revise/regenerate, save/reopen/revision, export dimensions, publish, public page, social metadata, share actions and correct session join. Capture desktop and mobile screenshots and inspect the generated image.
3. Verify expired/cancelled session behavior and public URL lifecycle. The page currently retains the published poster as an announcement and changes its join CTA according to the live public booking endpoint; formal retention/expiration policy remains unset.
4. Continue accessibility, low-end performance, provider size-limit and public crawler checks. Current automated tests validate a PNG header and dimensions but do not establish full decoded-image integrity or visual quality.

The provider is documented according to the official [OpenAI image generation guide](https://developers.openai.com/api/docs/guides/image-generation) and [Image API reference](https://developers.openai.com/api/reference/resources/images/methods/generate?site_locale=en). No provider call was made.

## Current-turn implementation status (3 November 2026)

- Existing prompt-first studio, server-side provider adapter, artwork provenance and publishing workflow remain unchanged. Local configuration inspection found no configured provider key/model; no external image generation was attempted. An injected test provider is not real generated artwork.
- The current focused run included provider/poster, metadata/branding, theme runtime, caller, ticket view/integrity and inventory-engine tests: 86 total, 84 passed, 0 failed, 2 database-backed poster integration cases skipped because no disposable DB fixture was available for this run.
- Current-turn browser visual flow, real provider output, image composition/export appearance, public OG/social crawl and complete authenticated publication screenshots are unverified. Prior saved screenshots are not being relabeled as current-turn evidence.

## Live milestone provider status (3 November 2026)

Authenticated local review confirmed the editor/template entry point, but the running server explicitly reports image generation is not configured. No provider key/model was present, so no real image request or generated artwork was attempted. A task-owned synthetic owner fixture and local poster draft/catalog interaction were confined to disposable DB 55439 and removed after the check. The fuller prior synthetic-provider integration coverage remains documented above; it is not evidence of external provider operation. Current-turn poster capture: `.preflight/live-runtime/poster-studio-empty.png`. Real provider output and a complete browser save/revision/publish/rollback lifecycle remain pending.
