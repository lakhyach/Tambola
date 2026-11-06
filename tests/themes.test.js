import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { HAS_DB, openDurableSchema } from "./pattern-harness.js";
import { contrastRatio, createThemeService, localClockParts, validateThemePackage, validTimeZone } from "../server/themes/service.js";
import { createAdmin } from "../server/admin/index.js";
import { createPublicThemeRouter } from "../server/themes/routes.js";

test("theme package schema rejects unsafe values and checks design contrast", { skip: !HAS_DB }, async () => {
  const env = await openDurableSchema({ prefix: "theme_schema" });
  try {
    const service = createThemeService({ db: env.db });
    const themes = await service.listStore();
    assert.equal(themes.length, 9);
    for (const theme of themes) assert.ok(validateThemePackage(theme.package).package, theme.name);
    assert.deepEqual(new Set(themes.map((theme) => theme.category)), new Set(["classic", "premium", "festive", "seasonal", "celebration", "minimal", "modern", "traditional", "special"]));
    assert.equal(new Set(themes.map((theme) => JSON.stringify(theme.package))).size, 9, "every reviewed seed theme has a distinct complete token package");
    assert.deepEqual((await service.getGlobalTheme()).themeVersionId, "obsidian-hall-v1", "expanding the library does not publish or replace the active theme");
    const namedDrafts = await service.listAdminThemes();
    const festivalDrafts = namedDrafts.filter((theme) => theme.status === "draft" && theme.themeVersionId?.endsWith("-v1"));
    assert.equal(festivalDrafts.length, 13, "named festival catalog expansions remain drafts for owner review");
    for (const theme of festivalDrafts) assert.ok(validateThemePackage(theme.package).package, theme.name);
    assert.ok(festivalDrafts.every((theme) => !themes.some((published) => published.themeId === theme.themeId)), "draft packages do not leak into the public store");
    const source = themes[0].package;
    assert.equal(validateThemePackage({ ...source, tokens: { ...source.tokens, void: "url(javascript:alert(1))" } }).error, "THEME_COLOR_INVALID");
    assert.equal(validateThemePackage({ ...source, tokens: { ...source.tokens, customCss: "body{display:none}" } }).error, "THEME_TOKENS_INVALID");
    assert.ok(contrastRatio("#ffffff", "#000000") > 20);
    assert.equal(validTimeZone("Asia/Kolkata"), true);
    assert.equal(validTimeZone("Not/A_Real_Zone"), false);
    assert.deepEqual(localClockParts(new Date("2026-11-01T03:30:00.000Z"), "Asia/Kolkata"), { date: "2026-11-01", hour: 9, minute: 0 });
  } finally { await env.close(); }
});

test("public theme delivery exposes only the selected theme, never the gallery", async (t) => {
  const app = express();
  app.use("/api/public", createPublicThemeRouter({ service: {
    async listStore() { throw new Error("public theme catalog must not be queried"); },
    async getGlobalTheme() { return { themeVersionId: "selected" }; },
  } }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const gallery = await fetch(`${origin}/api/public/themes`);
  assert.equal(gallery.status, 404);
  assert.equal((await gallery.json()).code, "THEME_CATALOG_DISABLED");
  const active = await fetch(`${origin}/api/public/themes/active`);
  assert.equal(active.status, 200);
  assert.equal((await active.json()).theme.themeVersionId, "selected");
});

test("reviewed themes publish on an idempotent local schedule and roll back", { skip: !HAS_DB }, async () => {
  const env = await openDurableSchema({ prefix: "theme_release" });
  const service = createThemeService({ db: env.db });
  let process = null;
  try {
    await env.db.query(`INSERT INTO owner_accounts(owner_id,username,password_hash)
      VALUES('theme-owner-one','theme-owner-one','scrypt$test$hash'),('theme-owner-two','theme-owner-two','scrypt$test$hash')`);
    const seeds = await service.listStore();
    const indigo = seeds.find((theme) => theme.themeId === "midnight-indigo");
    const marigold = seeds.find((theme) => theme.themeId === "marigold-festival");
    const initial = await service.getGlobalTheme();
    assert.equal(initial.themeVersionId, "obsidian-hall-v1");

    const nextMarigold = await service.createVersion({ themeId: marigold.themeId, package: marigold.package, actor: "owner-test" });
    assert.equal(nextMarigold.status, "draft");
    assert.equal((await service.publish({ themeVersionId: nextMarigold.themeVersionId, actor: "owner-test" })).error, "THEME_NOT_APPROVED");
    assert.equal((await service.updateSchedule({ enabled: true, timeZone: "Asia/Kolkata", releaseTime: "09:00", rotationVersionIds: [nextMarigold.themeVersionId], actor: "owner-test" })).error, "THEME_ROTATION_UNAPPROVED");
    assert.equal((await service.approveThemeVersion({ themeId: marigold.themeId, themeVersionId: nextMarigold.themeVersionId, actor: "owner-test" })).status, "approved");

    const draft = await service.createDraft({
      themeId: "bluebell-evening", name: "Bluebell Evening", description: "An original violet game-night theme with a readable ticket and 90-number board.",
      category: "seasonal", package: indigo.package, actor: "owner-test",
    });
    assert.equal(draft.status, "draft");
    assert.equal((await service.publish({ themeVersionId: draft.themeVersionId, actor: "owner-test" })).error, "THEME_NOT_APPROVED");
    assert.deepEqual(await service.approveTheme({ themeId: draft.themeId, actor: "owner-test" }), { themeId: draft.themeId, status: "approved" });

    const schedule = await service.updateSchedule({ enabled: true, timeZone: "Asia/Kolkata", releaseTime: "09:00", rotationVersionIds: [indigo.themeVersionId, nextMarigold.themeVersionId], actor: "owner-test" });
    assert.equal(schedule.enabled, true);
    assert.equal(schedule.rotationVersionIds.length, 2);
    assert.equal((await service.runScheduledRelease(new Date("2026-11-01T03:29:00.000Z"))).skipped, "NOT_DUE");
    const due = await service.runScheduledRelease(new Date("2026-11-01T03:30:00.000Z"));
    assert.equal(due.source, "daily");
    assert.equal((await service.runScheduledRelease(new Date("2026-11-01T03:31:00.000Z"))).alreadyPublished, true);
    const dailyRows = await env.db.query("SELECT count(*)::int AS n FROM theme_publications WHERE source='daily' AND release_date='2026-11-01'");
    assert.equal(dailyRows.rows[0].n, 1);
    const noticesOne = await service.listNotifications("theme-owner-one");
    const noticesTwo = await service.listNotifications("theme-owner-two");
    assert.equal(noticesOne.unreadCount, 1);
    assert.equal(noticesTwo.unreadCount, 1, "every active owner account receives the daily release notification");
    assert.match(noticesOne.notifications[0].title, /Daily theme released:/);
    assert.match(noticesOne.notifications[0].body, /2026-11-01/);
    assert.equal(noticesOne.notifications[0].destination, "/admin/themes");
    assert.equal((await service.runScheduledRelease(new Date("2026-11-01T03:32:00.000Z"))).alreadyPublished, true);
    assert.equal((await service.listNotifications("theme-owner-one")).unreadCount, 1, "a retry does not create another notification");
    const notificationId = noticesOne.notifications[0].notificationId;
    assert.deepEqual(await service.markNotificationRead({ ownerId: "theme-owner-one", notificationId, actor: "theme-owner-one" }), { notificationId, read: true });
    assert.equal((await service.listNotifications("theme-owner-one")).unreadCount, 0);
    assert.equal((await service.listNotifications("theme-owner-two")).unreadCount, 1, "acknowledging a notice is scoped to that owner");
    await assert.rejects(env.db.query("UPDATE owner_notifications SET title='forged' WHERE notification_id=$1", [notificationId]), /immutable/);
    assert.equal((await service.getGlobalTheme()).themeVersionId, due.themeVersionId);

    const rolledBack = await service.rollback({ actor: "owner-test" });
    assert.equal(rolledBack.source, "rollback");
    assert.equal((await service.getGlobalTheme()).themeVersionId, "obsidian-hall-v1");
    assert.equal((await service.listReleases()).length, 3, "seed, daily release and rollback are retained");

    const fixed = await service.setInstanceSelection({ instanceId: "bumper", mode: "fixed", themeVersionId: indigo.themeVersionId, actor: "owner-test" });
    assert.equal(fixed.mode, "fixed");
    process = env.newProcess();
    const room = await process.controller.createManagedRoom({ hostName: "Theme Snapshot", instanceId: "bumper" });
    assert.equal(room.ok, true, JSON.stringify(room));
    const snapshot = await env.db.query("SELECT config->>'themeVersionId' AS theme_version_id FROM rooms WHERE room_code=$1", [room.roomId]);
    assert.equal(snapshot.rows[0].theme_version_id, indigo.themeVersionId);
    await service.setInstanceSelection({ instanceId: "bumper", mode: "fixed", themeVersionId: marigold.themeVersionId, actor: "owner-test" });
    const roomTheme = await service.getThemeForInstance({ slug: "bumper", roomId: room.roomId });
    assert.equal(roomTheme.themeVersionId, indigo.themeVersionId, "room snapshot does not change when instance branding changes");

    await assert.rejects(env.db.query("UPDATE theme_versions SET package=package WHERE theme_version_id=$1", [indigo.themeVersionId]), /immutable/);
    const audit = await env.db.query("SELECT count(*)::int AS n FROM platform_audit WHERE action LIKE 'theme.%'");
    assert.ok(audit.rows[0].n >= 6);
  } finally {
    if (process) for (const roomId of process.registry.rooms.keys()) process.registry.close(roomId, "test teardown");
    await env.close();
  }
});

test("public theme delivery resolves active instance themes while owner library stays protected", { skip: !HAS_DB }, async () => {
  const env = await openDurableSchema({ prefix: "theme_routes" });
  const process = env.newProcess();
  const admin = createAdmin({ db: env.db, durable: true, registry: process.registry, controller: process.controller, mfaKey: { configured: false, key: null } });
  const app = express();
  app.use(express.json());
  app.use("/api/public", createPublicThemeRouter({ service: admin.themeService }));
  app.use("/api/admin", admin.router);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const libraryResponse = await fetch(`${origin}/api/public/themes`);
    assert.equal(libraryResponse.status, 404, "theme library is not a public-facing catalog");

    const activeResponse = await fetch(`${origin}/api/public/themes/active?instance=regular`);
    assert.equal(activeResponse.status, 200);
    const regularTheme = (await activeResponse.json()).theme;
    assert.equal(regularTheme.instanceSlug, "regular");
    assert.equal(regularTheme.instanceBranding.logo, "regular-mark.svg");
    const bumperTheme = await fetch(`${origin}/api/public/themes/active?instance=bumper`).then((response) => response.json());
    assert.equal(bumperTheme.theme.instanceBranding.logo, "bumper-mark.svg");
    assert.notEqual(regularTheme.instanceBranding.accent, bumperTheme.theme.instanceBranding.accent);

    const privateResponse = await fetch(`${origin}/api/admin/themes/store`);
    assert.equal(privateResponse.status, 401);
    const privateNotifications = await fetch(`${origin}/api/admin/themes/notifications`);
    assert.equal(privateNotifications.status, 401, "notification delivery remains behind owner authentication");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const roomId of process.registry.rooms.keys()) process.registry.close(roomId, "test teardown");
    await env.close();
  }
});
