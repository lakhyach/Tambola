import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { HAS_DB, openDurableSchema } from "./pattern-harness.js";
import { createAdmin } from "../server/admin/index.js";
import { createPublicPosterRouter } from "../server/posters/routes.js";
import { createPosterService, validatePosterData } from "../server/posters/service.js";
import { createBookingService } from "../server/bookings/service.js";

const posterData = (overrides = {}) => ({ title: "Friday Tambola Night", schedule: "Friday · 7:30 PM", details: "A free game night with friends", patterns: "Early Seven · Full House", themeVersionId: "obsidian-hall-v1", accent: "#42c98a", layoutSize: "portrait", ...overrides });

test("poster validation bounds text, colors, themes and supported export sizes", () => {
  assert.ok(validatePosterData(posterData()).data);
  assert.equal(validatePosterData(posterData({ accent: "url(javascript:alert(1))" })).error, "POSTER_DATA_INVALID");
  assert.equal(validatePosterData(posterData({ layoutSize: "giant" })).error, "POSTER_DATA_INVALID");
  assert.equal(validatePosterData(posterData({ title: "x" })).error, "POSTER_DATA_INVALID");
  assert.equal(validatePosterData(posterData({ title: "X".repeat(91) })).error, "POSTER_DATA_INVALID");
});

test("poster templates require review and publication; poster publications retain immutable versions", { skip: !HAS_DB }, async () => {
  const env = await openDurableSchema({ prefix: "poster" });
  const process = env.newProcess();
  const admin = createAdmin({ db: env.db, durable: true, registry: process.registry, controller: process.controller, mfaKey: { configured: false, key: null } });
  const app = express();
  app.use(express.json());
  app.use("/api/public", createPublicPosterRouter({ service: admin.posterService }));
  app.use("/api/admin", admin.router);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const initial = await admin.posterService.listTemplates();
    assert.equal(initial.length, 4);
    const templateDraft = await admin.posterService.createTemplateDraft({
      templateId: "garden-gala", name: "Garden Gala", description: "Layered botanical shapes with crisp time and event details.", category: "seasonal", layout: "festival",
      palette: { background: "#07110f", panel: "#153027", accent: "#9cf0c5", ink: "#e8f1eb", detail: "#f3f6ef" }, actor: "owner-test",
    });
    assert.equal(templateDraft.status, "draft");
    assert.equal((await admin.posterService.listTemplates()).length, 4, "unreviewed templates stay private");
    assert.equal((await admin.posterService.approveTemplate({ templateId: templateDraft.templateId, actor: "owner-test" })).status, "approved");
    assert.equal((await admin.posterService.listTemplates()).length, 4, "approval alone does not publish a template");
    await admin.posterService.publishTemplate({ templateVersionId: templateDraft.templateVersionId, actor: "owner-test" });
    assert.equal((await admin.posterService.listTemplates()).length, 5);
    const templateVersion = await admin.posterService.createTemplateVersion({ templateId: templateDraft.templateId, layout: "spotlight", palette: { background: "#07110f", panel: "#153027", accent: "#9cf0c5", ink: "#e8f1eb", detail: "#f3f6ef" }, actor: "owner-test" });
    assert.equal(templateVersion.status, "draft");
    assert.equal((await admin.posterService.publishTemplate({ templateVersionId: templateVersion.templateVersionId, actor: "owner-test" })).error, "POSTER_TEMPLATE_UNAPPROVED");
    assert.equal((await admin.posterService.updateSchedule({ enabled: true, timeZone: "Asia/Kolkata", releaseTime: "09:00", rotationVersionIds: [templateVersion.templateVersionId], actor: "owner-test" })).error, "POSTER_SCHEDULE_UNAPPROVED");
    assert.equal((await admin.posterService.approveTemplateVersion({ templateId: templateDraft.templateId, templateVersionId: templateVersion.templateVersionId, actor: "owner-test" })).status, "approved");
    await admin.posterService.publishTemplate({ templateVersionId: templateVersion.templateVersionId, actor: "owner-test" });
    assert.equal((await admin.posterService.listTemplates()).length, 6);
    const restored = await admin.posterService.rollbackTemplate({ templateId: templateDraft.templateId, templateVersionId: templateDraft.templateVersionId, actor: "owner-test" });
    assert.equal(restored.source, "rollback");
    assert.equal(restored.restoredFromVersionId, templateDraft.templateVersionId);
    assert.equal(restored.version, 3);
    assert.equal((await admin.posterService.rollbackTemplate({ templateId: templateDraft.templateId, templateVersionId: restored.templateVersionId, actor: "owner-test" })).error, "POSTER_TEMPLATE_VERSION_ALREADY_CURRENT");
    const templateHistory = (await admin.posterService.listTemplates({ admin: true })).filter((item) => item.templateId === templateDraft.templateId);
    assert.equal(templateHistory.find((item) => item.isCurrent).templateVersionId, restored.templateVersionId);
    assert.equal(templateHistory.find((item) => item.templateVersionId === restored.templateVersionId).layout, "festival", "rollback copies the previously approved composition into a new version");
    assert.equal(templateHistory.find((item) => item.templateVersionId === templateVersion.templateVersionId).layout, "spotlight", "rollback does not mutate the prior version");
    await admin.posterService.updateSchedule({ enabled: true, timeZone: "Asia/Kolkata", releaseTime: "09:00", rotationVersionIds: [templateVersion.templateVersionId], actor: "owner-test" });
    assert.equal((await admin.posterService.runScheduledRelease(new Date("2026-11-01T03:29:00.000Z"))).skipped, "NOT_DUE");
    assert.equal((await admin.posterService.runScheduledRelease(new Date("2026-11-01T03:30:00.000Z"))).source, "daily");
    assert.equal((await admin.posterService.runScheduledRelease(new Date("2026-11-01T03:31:00.000Z"))).alreadyPublished, true);
    const scheduledCount = await env.db.query("SELECT count(*)::int AS n FROM poster_template_publications WHERE source='daily' AND release_date='2026-11-01'");
    assert.equal(scheduledCount.rows[0].n, 1);

    const created = await admin.posterService.createPoster({ instanceId: "regular", templateVersionId: initial[0].templateVersionId, data: posterData({ title: "<Friday Friends>" }), actor: "owner-test" });
    assert.ok(created.posterId);
    assert.equal((await admin.posterService.getPublicPoster(created.posterId)), null, "drafts are not public");
    const published = await admin.posterService.publishPoster({ posterId: created.posterId, actor: "owner-test" });
    assert.equal(published.status, "published");
    const retained = await admin.posterService.getPublicPoster(created.posterId);
    assert.equal(retained.data.title, "<Friday Friends>", "poster text remains data for safe SVG text nodes");
    assert.equal(retained.templateVersionId, initial[0].templateVersionId);
    assert.equal(retained.branding.logo, "regular-mark.svg");
    await env.db.query("UPDATE game_instances SET branding=branding || '{\"logo\":\"bumper-mark.svg\"}'::jsonb WHERE instance_id='regular'");
    assert.equal((await admin.posterService.getPublicPoster(created.posterId)).branding.logo, "regular-mark.svg", "published poster keeps the instance mark captured at publish time");
    assert.equal((await admin.posterService.savePoster({ posterId: created.posterId, templateVersionId: initial[1].templateVersionId, data: posterData(), actor: "owner-test" })).error, "POSTER_LOCKED");

    const publicTemplates = await fetch(`${origin}/api/public/poster-templates`).then((response) => response.json());
    assert.equal(publicTemplates.templates.length, 7);
    const publicPosterResponse = await fetch(`${origin}/api/public/posters/${created.posterId}`);
    assert.equal(publicPosterResponse.status, 200);
    const publicPoster = (await publicPosterResponse.json()).poster;
    assert.equal(publicPoster.data.title, "<Friday Friends>");
    assert.equal("instanceId" in publicPoster, false);
    assert.equal((await fetch(`${origin}/api/admin/posters/`)).status, 401);
    assert.equal((await fetch(`${origin}/api/public/posters/not-a-published-id`)).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const roomId of process.registry.rooms.keys()) process.registry.close(roomId, "test teardown");
    await env.close();
  }
});

test("prompt artwork stays instance-scoped and published data uses real session points and availability", { skip: !HAS_DB }, async () => {
  const env = await openDurableSchema({ prefix: "poster_prompt" });
  const live = env.newProcess({ autoCall: false });
  const booking = createBookingService({ db: env.db });
  const generatedPng = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(generatedPng);
  generatedPng.writeUInt32BE(13, 8); generatedPng.write("IHDR", 12, "ascii"); generatedPng.writeUInt32BE(1024, 16); generatedPng.writeUInt32BE(1536, 20);
  let providerCalls = 0;
  const service = createPosterService({ db: env.db, imageProvider: {
    provider: "openai-images", model: "fake-image-test", configured: true,
    async generate({ prompt, size, actor }) { providerCalls += 1; assert.match(prompt, /festival/i); assert.equal(size, "1024x1536"); assert.equal(actor, "synthetic-owner"); return { image: generatedPng, provider: "openai-images", model: "fake-image-test" }; },
  } });
  const future = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();
  try {
    const room = await live.controller.createRoom({ name: "Poster Host", socketId: "poster-host", instanceId: "regular" });
    assert.equal(room.ok, true, JSON.stringify(room));
    const created = await booking.createSession({ instanceId: "regular", actor: "synthetic-owner", title: "Synthetic Festival Night", startsAt: future(60), bookingOpensAt: future(-2), bookingClosesAt: future(55), capacity: 10, timeZone: "Asia/Kolkata", roomCode: room.roomId });
    assert.ok(created.session.sessionId);
    await booking.updateSession({ instanceId: "regular", sessionId: created.session.sessionId, actor: "synthetic-owner", patch: { status: "open" } });

    const context = await service.getEventContext({ instanceId: "regular", sessionId: created.session.sessionId });
    assert.equal(context.title, "Synthetic Festival Night");
    assert.equal(context.gameType, "Regular Tambola");
    assert.equal(context.timeZone, "Asia/Kolkata");
    assert.match(context.schedule, /Asia\/Kolkata/);
    assert.equal(context.available, 10);
    assert.ok(context.winningPatterns.some((item) => item.label === "Early Five" && item.points === 20));
    assert.equal(await service.getEventContext({ instanceId: "bumper", sessionId: created.session.sessionId }), null, "session lookup cannot cross instance ownership");

    const artwork = await service.generateArtwork({ instanceId: "regular", sessionId: created.session.sessionId, prompt: "Premium Diwali festival light and plum gold art", actor: "synthetic-owner" });
    assert.equal(providerCalls, 1);
    assert.equal(artwork.provider, "openai-images");
    assert.ok(artwork.assetId);
    const stored = await service.getArtwork({ assetId: artwork.assetId, actor: "synthetic-owner" });
    assert.deepEqual(stored.image_bytes, generatedPng);

    const draft = await service.createPoster({ instanceId: "regular", templateVersionId: "festival-lanterns-v1", actor: "synthetic-owner", data: posterData({ title: "incorrect client title", sessionId: created.session.sessionId, prompt: "Premium Diwali festival light and plum gold art", artworkAssetId: artwork.assetId, cta: "Join this event", eventDetails: "Bring your family" }) });
    assert.ok(draft.posterId);
    assert.equal((await service.savePoster({ posterId: draft.posterId, templateVersionId: "festival-lanterns-v1", actor: "synthetic-owner", data: posterData({ title: "changed by browser", sessionId: created.session.sessionId, prompt: "Premium Diwali festival light and plum gold art", artworkAssetId: artwork.assetId, cta: "Join this event" }) })).status, "draft");
    const revisions = await env.db.query("SELECT revision,data->>'title' AS title FROM poster_revisions WHERE poster_id=$1", [draft.posterId]);
    assert.equal(revisions.rows.length, 1);
    assert.equal(revisions.rows[0].title, "Synthetic Festival Night");
    assert.equal((await service.createPoster({ instanceId: "bumper", templateVersionId: "festival-lanterns-v1", actor: "synthetic-owner", data: posterData({ sessionId: created.session.sessionId, artworkAssetId: artwork.assetId }) })).error, "POSTER_ARTWORK_UNAVAILABLE");

    assert.equal((await service.publishPoster({ posterId: draft.posterId, actor: "synthetic-owner" })).status, "published");
    const publicPoster = await service.getPublicPoster(draft.posterId);
    assert.equal(publicPoster.data.title, "Synthetic Festival Night");
    assert.equal(publicPoster.data.eventFacts.winningPatterns.find((item) => item.label === "Early Five").points, 20);
    assert.equal((await service.getArtwork({ posterId: draft.posterId, published: true })).content_type, "image/png");
    assert.equal(providerCalls, 1, "saving, revising and publishing do not implicitly regenerate artwork");
  } finally {
    for (const roomId of live.registry.rooms.keys()) live.registry.close(roomId, "poster test cleanup");
    await env.close();
  }
});
