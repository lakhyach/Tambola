import express from "express";

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function fail(res, error) {
  const status = error === "THEME_NOT_FOUND" || error === "THEME_VERSION_NOT_FOUND" || error === "INSTANCE_NOT_FOUND" || error === "NOTIFICATION_NOT_FOUND" ? 404
    : error === "THEME_NOT_APPROVED" || error === "THEME_NOT_DRAFT" || error === "THEME_VERSION_NOT_DRAFT" || error === "THEME_IN_USE" || error === "THEME_RETIRED" || error === "THEME_ROLLBACK_UNAVAILABLE" || error === "THEME_ROTATION_UNAPPROVED" ? 409 : 400;
  const messages = {
    THEME_PACKAGE_INVALID: "theme package must use the supported schema",
    THEME_TOKENS_INVALID: "theme package contains missing or unsupported design tokens",
    THEME_COLOR_INVALID: "theme colors must be six-digit hexadecimal values",
    THEME_CONTRAST_INSUFFICIENT: "theme text and game-state colors must meet the minimum contrast requirement",
    THEME_RADIUS_INVALID: "theme radius is unsupported",
    THEME_FONT_INVALID: "theme font selection is unsupported",
    THEME_SHADOW_INVALID: "theme shadow selection is unsupported",
    THEME_METADATA_INVALID: "theme name, description, category, or slug is invalid",
    THEME_ID_EXISTS: "that theme identifier already exists",
    THEME_NOT_FOUND: "theme was not found",
    THEME_VERSION_NOT_FOUND: "theme version was not found",
    THEME_NOT_APPROVED: "only an approved theme can be selected or published",
    THEME_NOT_DRAFT: "only a draft theme can be approved",
    THEME_VERSION_NOT_DRAFT: "only an unreviewed version can be approved",
    THEME_RETIRED: "a retired theme cannot receive new versions",
    THEME_IN_USE: "remove this theme from active, scheduled, and fixed instance selections before retiring it",
    THEME_ROLLBACK_UNAVAILABLE: "there is no previous theme to restore",
    THEME_SCHEDULE_INVALID: "schedule requires a valid time zone, time, and one to sixty approved themes",
    THEME_ROTATION_DUPLICATE: "a rotation cannot contain duplicate versions",
    THEME_ROTATION_UNAPPROVED: "every scheduled version must be approved",
    THEME_SELECTION_INVALID: "choose latest, rotation, or a fixed approved version",
    INSTANCE_NOT_FOUND: "instance was not found",
    THEME_NOT_FOUND_OR_NOT_APPROVED: "approved theme was not found",
    INVALID_PUBLICATION_SOURCE: "publication source is invalid",
    NOTIFICATION_NOT_FOUND: "notification was not found",
  };
  res.status(status).json({ ok: false, code: error, error: messages[error] || "theme request could not be completed" });
}

function sendResult(res, result, status = 200) {
  if (result?.error) return fail(res, result.error);
  res.status(status).json({ ok: true, ...result });
}

export function createAdminThemeRouter({ service, spendMutationBudget } = {}) {
  if (!service) throw new Error("createAdminThemeRouter needs a theme service");
  const router = express.Router();
  const mutate = (handler) => wrap(async (req, res) => {
    if (spendMutationBudget && !(await spendMutationBudget(req, res))) return;
    return handler(req, res);
  });

  router.get("/store", wrap(async (_req, res) => sendResult(res, { themes: await service.listAdminThemes() })));
  router.get("/active", wrap(async (_req, res) => sendResult(res, { theme: await service.getGlobalTheme() })));
  router.get("/schedule", wrap(async (_req, res) => sendResult(res, { schedule: await service.getSchedule() })));
  router.get("/releases", wrap(async (req, res) => sendResult(res, { releases: await service.listReleases({ limit: req.query.limit }) })));
  router.get("/notifications", wrap(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    sendResult(res, await service.listNotifications(req.owner.ownerId));
  }));
  router.post("/notifications/:notificationId/read", mutate(async (req, res) => {
    if (!/^\d{1,16}$/.test(req.params.notificationId)) return fail(res, "NOTIFICATION_NOT_FOUND");
    sendResult(res, await service.markNotificationRead({
      ownerId: req.owner.ownerId, notificationId: Number(req.params.notificationId), actor: req.owner.username,
    }));
  }));
  router.post("/drafts", mutate(async (req, res) => sendResult(res, await service.createDraft({ ...req.body, actor: req.owner.username }), 201)));
  router.post("/:themeId/versions", mutate(async (req, res) => sendResult(res, await service.createVersion({ themeId: req.params.themeId, package: req.body?.package, actor: req.owner.username }), 201)));
  router.post("/:themeId/approve", mutate(async (req, res) => sendResult(res, await service.approveTheme({ themeId: req.params.themeId, actor: req.owner.username }))));
  router.post("/:themeId/versions/:themeVersionId/approve", mutate(async (req, res) => sendResult(res, await service.approveThemeVersion({ themeId: req.params.themeId, themeVersionId: req.params.themeVersionId, actor: req.owner.username }))));
  router.post("/:themeId/retire", mutate(async (req, res) => sendResult(res, await service.retireTheme({ themeId: req.params.themeId, actor: req.owner.username }))));
  router.post("/publish", mutate(async (req, res) => sendResult(res, await service.publish({ themeVersionId: req.body?.themeVersionId, actor: req.owner.username }))));
  router.post("/rollback", mutate(async (req, res) => sendResult(res, await service.rollback({ actor: req.owner.username }))));
  router.put("/schedule", mutate(async (req, res) => {
    const schedule = await service.updateSchedule({ ...req.body, actor: req.owner.username });
    return schedule?.error ? fail(res, schedule.error) : res.json({ ok: true, schedule });
  }));
  router.put("/instances/:instanceId/selection", mutate(async (req, res) => sendResult(res, await service.setInstanceSelection({ instanceId: req.params.instanceId, mode: req.body?.mode, themeVersionId: req.body?.themeVersionId ?? null, actor: req.owner.username }))));
  return router;
}

export function createPublicThemeRouter({ service } = {}) {
  if (!service) throw new Error("createPublicThemeRouter needs a theme service");
  const router = express.Router();
  router.get("/themes", wrap(async (_req, res) => {
    const themes = await service.listStore();
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
    res.json({ ok: true, themes });
  }));
  router.get("/themes/active", wrap(async (req, res) => {
    const slug = typeof req.query.instance === "string" ? req.query.instance : null;
    const roomId = typeof req.query.room === "string" ? req.query.room : null;
    const theme = slug ? await service.getThemeForInstance({ slug, roomId }) : await service.getGlobalTheme();
    if (!theme) return res.status(404).json({ ok: false, code: "THEME_NOT_FOUND", error: "theme not found" });
    res.setHeader("Cache-Control", "public, max-age=20, stale-while-revalidate=40");
    res.json({ ok: true, theme });
  }));
  return router;
}
