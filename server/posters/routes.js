import express from "express";

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function sendResult(res, result, status = 200) {
  if (result?.error) {
    const code = result.error;
    const httpStatus = code.endsWith("NOT_FOUND") || code === "INSTANCE_NOT_FOUND" ? 404
      : code === "POSTER_GENERATION_COOLDOWN" ? 429
        : code === "POSTER_SESSION_CLOSED" || code === "POSTER_ARTWORK_UNAVAILABLE" ? 409
          : code.startsWith("POSTER_PROVIDER_") ? 503
        : code.includes("UNAPPROVED") || code.includes("ROLLBACK") || code.includes("ALREADY_CURRENT") || code === "POSTER_LOCKED" || code.includes("NOT_DRAFT") ? 409 : 400;
    const messages = {
      POSTER_DATA_INVALID: "poster text, colors, theme, or size is invalid",
      POSTER_THEME_UNAVAILABLE: "choose an approved theme",
      POSTER_TEMPLATE_UNAPPROVED: "only an approved poster template version can be used",
      POSTER_TEMPLATE_INVALID: "template metadata, layout, or palette is invalid",
      POSTER_TEMPLATE_EXISTS: "that template identifier already exists",
      POSTER_TEMPLATE_NOT_DRAFT: "only a draft template can be approved",
      POSTER_TEMPLATE_VERSION_NOT_DRAFT: "only an unreviewed template version can be approved",
      POSTER_TEMPLATE_NOT_FOUND: "poster template was not found",
      POSTER_TEMPLATE_NOT_APPROVED: "only an approved template can receive another version",
      POSTER_TEMPLATE_ROLLBACK_UNAVAILABLE: "choose a previously published version of this template to restore",
      POSTER_TEMPLATE_VERSION_ALREADY_CURRENT: "that version is already the current published design",
      POSTER_NOT_FOUND: "poster was not found",
      POSTER_LOCKED: "published posters cannot be edited; duplicate it to make a new draft",
      INSTANCE_NOT_FOUND: "active instance was not found",
      POSTER_SOURCE_INVALID: "template publication source is invalid",
      POSTER_SCHEDULE_INVALID: "schedule requires a valid timezone, time, and unique approved templates",
      POSTER_SCHEDULE_UNAPPROVED: "every scheduled template version must be approved",
      POSTER_PROMPT_REQUIRED: "write a visual direction for the poster background",
      POSTER_PROMPT_INVALID: "the poster prompt must be 12 to 1,200 characters",
      POSTER_PROVIDER_UNCONFIGURED: "image generation is not configured on this server; no artwork was created",
      POSTER_PROVIDER_TIMEOUT: "image generation timed out; retry when the provider is available",
      POSTER_PROVIDER_UNAVAILABLE: "the image provider could not be reached; no artwork was created",
      POSTER_PROVIDER_RATE_LIMITED: "the image provider is rate limited; wait before retrying",
      POSTER_PROVIDER_CONFIGURATION: "the server image-provider credentials or access are invalid",
      POSTER_PROVIDER_FAILED: "image generation failed; no artwork was saved",
      POSTER_PROVIDER_INVALID_RESPONSE: "the image provider returned no usable artwork",
      POSTER_PROVIDER_INVALID_IMAGE: "the image provider returned an invalid image; no artwork was saved",
      POSTER_ARTWORK_UNAVAILABLE: "generated artwork is unavailable for this instance",
      POSTER_SESSION_NOT_FOUND: "choose a session in this active instance",
      POSTER_IMAGE_SIZE_INVALID: "choose a supported poster image layout",
      POSTER_SESSION_CLOSED: "posters can only be generated for an upcoming session",
      POSTER_GENERATION_COOLDOWN: "please wait 30 seconds before generating another background",
    };
    return res.status(httpStatus).json({ ok: false, code, error: messages[code] || "poster request could not be completed" });
  }
  return res.status(status).json({ ok: true, ...result });
}

export function createAdminPosterRouter({ service, spendMutationBudget } = {}) {
  if (!service) throw new Error("createAdminPosterRouter needs a poster service");
  const router = express.Router();
  const mutate = (handler) => wrap(async (req, res) => {
    if (spendMutationBudget && !(await spendMutationBudget(req, res))) return;
    return handler(req, res);
  });
  router.get("/provider", (_req, res) => res.json({ ok: true, provider: service.providerStatus() }));
  router.get("/sessions", wrap(async (req, res) => {
    if (typeof req.query.instanceId !== "string" || req.query.instanceId.length > 80) return res.status(400).json({ ok: false, code: "INSTANCE_REQUIRED", error: "choose an instance" });
    return sendResult(res, { sessions: await service.listEventSessions(req.query.instanceId) });
  }));
  router.get("/sessions/:sessionId/context", wrap(async (req, res) => {
    const context = await service.getEventContext({ instanceId: req.query.instanceId, sessionId: req.params.sessionId });
    if (!context) return res.status(404).json({ ok: false, code: "POSTER_SESSION_NOT_FOUND", error: "choose a session in this active instance" });
    return sendResult(res, { context });
  }));
  router.post("/generate", mutate(async (req, res) => {
    const result = await service.generateArtwork({ instanceId: req.body?.instanceId, sessionId: req.body?.sessionId, prompt: req.body?.prompt, actor: req.owner.username, size: req.body?.size });
    return sendResult(res, result.error ? result : { artwork: result }, result.error ? 200 : 201);
  }));
  router.get("/artworks/:assetId", wrap(async (req, res) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.assetId)) return res.status(404).json({ ok: false, code: "POSTER_ARTWORK_UNAVAILABLE", error: "generated artwork is unavailable" });
    const asset = await service.getArtwork({ assetId: req.params.assetId, actor: req.owner.username });
    if (!asset) return res.status(404).json({ ok: false, code: "POSTER_ARTWORK_UNAVAILABLE", error: "generated artwork is unavailable" });
    res.setHeader("Cache-Control", "private, no-store"); res.setHeader("X-Content-Type-Options", "nosniff");
    return res.type(asset.content_type).send(asset.image_bytes);
  }));
  router.get("/templates", wrap(async (_req, res) => sendResult(res, { templates: await service.listTemplates({ admin: true }) })));
  router.get("/templates/schedule", wrap(async (_req, res) => sendResult(res, { schedule: await service.getSchedule() })));
  router.get("/", wrap(async (_req, res) => sendResult(res, { posters: await service.listPosters() })));
  router.post("/templates/drafts", mutate(async (req, res) => sendResult(res, await service.createTemplateDraft({ ...req.body, actor: req.owner.username }), 201)));
  router.post("/templates/:templateId/versions", mutate(async (req, res) => sendResult(res, await service.createTemplateVersion({ templateId: req.params.templateId, layout: req.body?.layout, palette: req.body?.palette, actor: req.owner.username }), 201)));
  router.post("/templates/:templateId/approve", mutate(async (req, res) => sendResult(res, await service.approveTemplate({ templateId: req.params.templateId, actor: req.owner.username }))));
  router.post("/templates/:templateId/versions/:templateVersionId/approve", mutate(async (req, res) => sendResult(res, await service.approveTemplateVersion({ templateId: req.params.templateId, templateVersionId: req.params.templateVersionId, actor: req.owner.username }))));
  router.post("/templates/:templateId/rollback", mutate(async (req, res) => sendResult(res, await service.rollbackTemplate({ templateId: req.params.templateId, templateVersionId: req.body?.templateVersionId, actor: req.owner.username }))));
  router.post("/templates/publish", mutate(async (req, res) => sendResult(res, await service.publishTemplate({ templateVersionId: req.body?.templateVersionId, actor: req.owner.username }))));
  router.put("/templates/schedule", mutate(async (req, res) => sendResult(res, await service.updateSchedule({ ...req.body, actor: req.owner.username }))));
  router.post("/drafts", mutate(async (req, res) => sendResult(res, await service.createPoster({ ...req.body, actor: req.owner.username }), 201)));
  router.put("/:posterId", mutate(async (req, res) => sendResult(res, await service.savePoster({ posterId: req.params.posterId, ...req.body, actor: req.owner.username }))));
  router.post("/:posterId/duplicate", mutate(async (req, res) => sendResult(res, await service.duplicatePoster({ posterId: req.params.posterId, actor: req.owner.username }), 201)));
  router.post("/:posterId/publish", mutate(async (req, res) => sendResult(res, await service.publishPoster({ posterId: req.params.posterId, actor: req.owner.username }))));
  return router;
}

export function createPublicPosterRouter({ service } = {}) {
  if (!service) throw new Error("createPublicPosterRouter needs a poster service");
  const router = express.Router();
  router.get("/poster-templates", wrap(async (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
    res.json({ ok: true, templates: await service.listTemplates() });
  }));
  router.get("/posters/:posterId", wrap(async (req, res) => {
    const poster = await service.getPublicPoster(req.params.posterId);
    if (!poster) return res.status(404).json({ ok: false, code: "POSTER_NOT_FOUND", error: "published poster was not found" });
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
    return res.json({ ok: true, poster });
  }));
  router.get("/posters/:posterId/artwork", wrap(async (req, res) => {
    const asset = await service.getArtwork({ posterId: req.params.posterId, published: true });
    if (!asset) return res.status(404).json({ ok: false, code: "POSTER_ARTWORK_UNAVAILABLE", error: "published poster artwork was not found" });
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=600"); res.setHeader("X-Content-Type-Options", "nosniff");
    return res.type(asset.content_type).send(asset.image_bytes);
  }));
  return router;
}
