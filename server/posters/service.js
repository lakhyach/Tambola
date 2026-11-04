import { createHash, randomUUID } from "node:crypto";
import { localClockParts, validTimeZone } from "../themes/service.js";
import { publicInstanceBranding } from "../instances/branding.js";
import { PATTERNS } from "../game/patterns.js";
import { createOpenAiImageProvider, validPngImage, validateArtPrompt } from "./image-provider.js";

const CATEGORIES = new Set(["classic", "premium", "festive", "celebration", "seasonal", "bumper", "regular", "special", "minimal", "traditional"]);
const LAYOUTS = new Set(["classic", "festival", "spotlight", "minimal"]);
const HEX = /^#[0-9a-f]{6}$/i;
const validPalette = (palette) => Boolean(palette && typeof palette === "object" && !Array.isArray(palette)
  && Object.keys(palette).sort().join(",") === "accent,background,detail,ink,panel"
  && Object.values(palette).every((color) => typeof color === "string" && HEX.test(color)));

export function validatePosterData(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "POSTER_DATA_INVALID" };
  const { title, schedule, details, patterns, themeVersionId, accent, layoutSize } = input;
  if (typeof title !== "string" || title.trim().length < 2 || title.trim().length > 90
    || typeof schedule !== "string" || schedule.trim().length < 2 || schedule.trim().length > 120
    || typeof details !== "string" || details.trim().length > 240
    || typeof patterns !== "string" || patterns.trim().length > 1200
    || !(themeVersionId === null || typeof themeVersionId === "string" && themeVersionId.length <= 100)
    || !(accent === null || typeof accent === "string" && HEX.test(accent))
    || !new Set(["square", "portrait", "landscape", "story"]).has(layoutSize)
    || input.sessionId != null && (typeof input.sessionId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.sessionId))
    || input.artworkAssetId != null && (typeof input.artworkAssetId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.artworkAssetId))
    || input.prompt != null && (typeof input.prompt !== "string" || input.prompt.trim().length < 12 || input.prompt.trim().length > 1200)
    || input.cta != null && (typeof input.cta !== "string" || input.cta.trim().length < 2 || input.cta.trim().length > 48)
    || input.eventDetails != null && (typeof input.eventDetails !== "string" || input.eventDetails.trim().length > 500)) return { error: "POSTER_DATA_INVALID" };
  return { data: { title: title.trim(), schedule: schedule.trim(), details: details.trim(), patterns: patterns.trim(), themeVersionId, accent, layoutSize,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}), ...(input.artworkAssetId ? { artworkAssetId: input.artworkAssetId } : {}),
    ...(input.prompt ? { prompt: input.prompt.trim() } : {}), ...(input.cta ? { cta: input.cta.trim() } : {}), ...(input.eventDetails ? { eventDetails: input.eventDetails.trim() } : {}) } };
}

export function createPosterService({ db, imageProvider = createOpenAiImageProvider() } = {}) {
  if (!db) throw new Error("createPosterService needs a database handle");

  async function audit(client, actor, action, metadata) {
    await client.query("INSERT INTO platform_audit(actor,actor_role,action,result,metadata) VALUES($1,'super_admin',$2,'success',$3)", [actor, action, JSON.stringify(metadata)]);
  }

  function mapTemplate(row) {
    return { templateId: row.template_id, templateVersionId: row.template_version_id, version: Number(row.version), name: row.name, description: row.description, category: row.category, status: row.status === "retired" ? "retired" : row.review_status, catalogStatus: row.status, layout: row.layout, palette: row.palette, publishedAt: row.published_at || null, isCurrent: Boolean(row.is_current) };
  }

  async function listTemplates({ admin = false } = {}) {
    const result = await db.query(`SELECT t.template_id,v.template_version_id,v.version,t.name,t.description,t.category,t.status,
      v.review_status,v.layout,v.palette,p.published_at,coalesce(current_release.template_version_id=v.template_version_id,false) AS is_current FROM poster_templates t JOIN poster_template_versions v USING(template_id)
      LEFT JOIN LATERAL (SELECT published_at FROM poster_template_publications WHERE template_version_id=v.template_version_id ORDER BY publication_id DESC LIMIT 1) p ON true
      LEFT JOIN LATERAL (SELECT pub.template_version_id FROM poster_template_publications pub JOIN poster_template_versions current_version USING(template_version_id) WHERE current_version.template_id=t.template_id ORDER BY pub.publication_id DESC LIMIT 1) current_release ON true
      WHERE ($1::boolean OR (t.status IN ('approved','retired') AND v.review_status='approved' AND p.published_at IS NOT NULL))
      ORDER BY CASE WHEN t.status='approved' THEN 0 ELSE 1 END,t.category,t.name,v.version DESC`, [admin]);
    return result.rows.map(mapTemplate);
  }

  async function approvedTemplate(client, versionId) {
    const result = await client.query(`SELECT 1 FROM poster_template_versions v JOIN poster_templates t USING(template_id)
      WHERE v.template_version_id=$1 AND v.review_status='approved' AND t.status='approved'`, [versionId]);
    return result.rowCount > 0;
  }

  async function validateData(client, input, actor, instanceId) {
    const checked = validatePosterData(input);
    if (checked.error) return checked;
    if (checked.data.themeVersionId) {
      const theme = await client.query(`SELECT 1 FROM theme_versions v JOIN theme_catalog c USING(theme_id)
        WHERE v.theme_version_id=$1 AND v.review_status='approved' AND c.status='approved'`, [checked.data.themeVersionId]);
      if (!theme.rowCount) return { error: "POSTER_THEME_UNAVAILABLE" };
    }
    const data = checked.data;
    if (data.sessionId !== undefined && data.sessionId !== null && (typeof data.sessionId !== "string" || !/^[0-9a-f-]{36}$/i.test(data.sessionId))) return { error: "POSTER_DATA_INVALID" };
    if (data.artworkAssetId !== undefined && data.artworkAssetId !== null) {
      if (typeof data.artworkAssetId !== "string" || !/^[0-9a-f-]{36}$/i.test(data.artworkAssetId)) return { error: "POSTER_DATA_INVALID" };
      const asset = await client.query("SELECT 1 FROM poster_artwork_assets WHERE asset_id=$1 AND instance_id=$2", [data.artworkAssetId, instanceId]);
      if (!asset.rowCount) return { error: "POSTER_ARTWORK_UNAVAILABLE" };
      data.artworkAssetId = input.artworkAssetId;
    }
    if (data.prompt !== undefined && !validateArtPrompt(data.prompt).prompt) return { error: "POSTER_PROMPT_INVALID" };
    if (data.sessionId) {
      const context = await getEventContext({ instanceId, sessionId: data.sessionId });
      if (!context) return { error: "POSTER_SESSION_NOT_FOUND" };
      data.title = context.title;
      data.eventFacts = context;
      data.schedule = context.schedule;
      data.details = data.eventDetails || `${context.gameType} · ${context.ticketAvailability}`;
      data.patterns = context.prizesDescription || context.missingFields.join(" ");
    }
    return { data };
  }

  async function listEventSessions(instanceId) {
    const result = await db.query(`SELECT s.session_id,s.title,s.starts_at,s.booking_closes_at,s.ticket_capacity,s.status,s.room_code,s.time_zone,
      s.inventory_mode,s.inventory_state,i.slug,i.display_name,
      COALESCE(sum(r.ticket_count) FILTER(WHERE r.status='held' AND r.expires_at>now()),0)::int AS held,
      COALESCE(sum(r.ticket_count) FILTER(WHERE r.status='confirmed'),0)::int AS confirmed,
      bound_room.config AS room_config
      FROM game_sessions s JOIN game_instances i USING(instance_id)
      LEFT JOIN rooms bound_room ON bound_room.room_code=s.room_code
      LEFT JOIN ticket_reservations r ON r.session_id=s.session_id
      WHERE s.instance_id=$1 AND i.status='active' AND i.public_visible GROUP BY s.session_id,i.slug,i.display_name,bound_room.config
      ORDER BY s.starts_at DESC LIMIT 200`, [instanceId]);
    return result.rows.map((row) => ({ sessionId: row.session_id, instanceId, instanceSlug: row.slug, instanceName: row.display_name,
      title: row.title, startsAt: row.starts_at, bookingClosesAt: row.booking_closes_at, timeZone: row.time_zone || "UTC", status: row.status,
      gameType: row.slug === "bumper" ? "Bumper Tambola" : "Regular Tambola", roomCode: row.room_code || null,
      capacity: Number(row.ticket_capacity), available: Math.max(0, Number(row.ticket_capacity) - Number(row.held) - Number(row.confirmed)),
      winningPatterns: row.room_code ? Object.entries(PATTERNS).filter(([id, pattern]) => (row.room_config?.patterns?.[id] ?? pattern.enabledByDefault) === true).map(([id, pattern]) => ({ id, label: pattern.label, points: pattern.points })) : [],
      configurationState: row.room_code ? "complete" : "room-and-patterns-required" }));
  }

  async function getEventContext({ instanceId, sessionId }) {
    const sessions = await listEventSessions(instanceId);
    const session = sessions.find((item) => item.sessionId === sessionId);
    if (!session) return null;
    return { ...session, schedule: new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: session.timeZone }).format(new Date(session.startsAt)) + ` (${session.timeZone})`,
      publicJoinUrl: `/sessions/${encodeURIComponent(session.sessionId)}?instance=${encodeURIComponent(session.instanceSlug)}`,
      ticketAvailability: `${session.available} of ${session.capacity} free tickets available`,
      prizesDescription: session.winningPatterns.map((item) => `${item.label}: ${item.points} game points`).join(" · ") || null,
      missingFields: [...(!session.roomCode ? ["Assign a room to this session before including a room code."] : []), ...(!session.winningPatterns.length ? ["Room pattern/reward configuration is not available yet."] : [])] };
  }

  async function generateArtwork({ instanceId, sessionId, prompt, actor, size = "1024x1536" }) {
    const checked = validateArtPrompt(prompt);
    if (checked.error) return checked;
    const context = await getEventContext({ instanceId, sessionId });
    if (!context) return { error: "POSTER_SESSION_NOT_FOUND" };
    if (!["draft", "open", "paused"].includes(context.status) || new Date(context.startsAt).getTime() <= Date.now()) return { error: "POSTER_SESSION_CLOSED" };
    if (!imageProvider?.configured) return { error: "POSTER_PROVIDER_UNCONFIGURED" };
    const limit = await db.query(`INSERT INTO poster_generation_limits(actor,next_allowed_at) VALUES($1,now()+interval '30 seconds')
      ON CONFLICT(actor) DO UPDATE SET next_allowed_at=now()+interval '30 seconds'
      WHERE poster_generation_limits.next_allowed_at<=now() RETURNING actor`, [actor]);
    if (!limit.rowCount) return { error: "POSTER_GENERATION_COOLDOWN" };
    const generated = await imageProvider.generate({ prompt: checked.prompt, size, actor });
    if (generated.error) return generated;
    if (!validPngImage(generated.image, size) || generated.provider !== "openai-images"
      || typeof generated.model !== "string" || generated.model.length > 100) return { error: "POSTER_PROVIDER_INVALID_IMAGE" };
    const assetId = randomUUID();
    const sha256 = createHash("sha256").update(generated.image).digest("hex");
    await db.withTransaction(async (client) => {
      const belongs = await client.query("SELECT 1 FROM game_sessions WHERE session_id=$1 AND instance_id=$2 AND status IN ('draft','open','paused')", [sessionId, instanceId]);
      if (!belongs.rowCount) throw Object.assign(new Error("poster session is no longer available"), { code: "POSTER_SESSION_NOT_FOUND" });
      await client.query(`INSERT INTO poster_artwork_assets(asset_id,instance_id,session_id,created_by,provider,model,prompt,content_type,image_bytes,sha256)
        VALUES($1,$2,$3,$4,$5,$6,$7,'image/png',$8,$9)`, [assetId, instanceId, sessionId, actor, generated.provider, generated.model, checked.prompt, generated.image, sha256]);
      await audit(client, actor, "poster.artwork.generate", { assetId, instanceId, sessionId, provider: generated.provider, model: generated.model, sha256 });
    });
    return { assetId, provider: generated.provider, model: generated.model, sha256, imageUrl: `/api/admin/posters/artworks/${assetId}`, context };
  }

  async function getArtwork({ assetId, actor = null, posterId = null, published = false }) {
    if (published && posterId) {
      const result = await db.query(`SELECT a.content_type,a.image_bytes FROM poster_publications p JOIN poster_artwork_assets a ON a.asset_id=CASE WHEN p.data->>'artworkAssetId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN (p.data->>'artworkAssetId')::uuid ELSE NULL END
        WHERE p.poster_id=$1 ORDER BY p.publication_id DESC LIMIT 1`, [posterId]);
      return result.rows[0] || null;
    }
    const result = await db.query("SELECT content_type,image_bytes FROM poster_artwork_assets WHERE asset_id=$1", [assetId]);
    return result.rows[0] || null;
  }

  async function createTemplateDraft({ templateId, name, description, category, layout, palette, actor }) {
    if (typeof templateId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(templateId) || templateId.length > 48
      || typeof name !== "string" || name.trim().length < 2 || name.trim().length > 80
      || typeof description !== "string" || description.trim().length < 10 || description.trim().length > 500
      || !CATEGORIES.has(category) || !LAYOUTS.has(layout) || !validPalette(palette)) return { error: "POSTER_TEMPLATE_INVALID" };
    try {
      return await db.withTransaction(async (client) => {
        const templateVersionId = `${templateId}-v1-${randomUUID()}`;
        await client.query("INSERT INTO poster_templates(template_id,name,description,category,status,created_by) VALUES($1,$2,$3,$4,'draft',$5)", [templateId, name.trim(), description.trim(), category, actor]);
        await client.query("INSERT INTO poster_template_versions(template_version_id,template_id,version,layout,palette,created_by) VALUES($1,$2,1,$3,$4,$5)", [templateVersionId, templateId, layout, JSON.stringify(palette), actor]);
        await audit(client, actor, "poster.template.draft", { templateId, templateVersionId });
        return { templateId, templateVersionId, version: 1, status: "draft" };
      });
    } catch (error) {
      if (error.code === "23505") return { error: "POSTER_TEMPLATE_EXISTS" };
      throw error;
    }
  }

  async function approveTemplate({ templateId, actor }) {
    return db.withTransaction(async (client) => {
      const changed = await client.query("UPDATE poster_templates SET status='approved',approved_by=$2,approved_at=now() WHERE template_id=$1 AND status='draft' RETURNING template_id", [templateId, actor]);
      if (!changed.rowCount) return { error: "POSTER_TEMPLATE_NOT_DRAFT" };
      await client.query("UPDATE poster_template_versions SET review_status='approved',approved_by=$2,approved_at=now() WHERE template_id=$1 AND review_status='draft'", [templateId, actor]);
      await audit(client, actor, "poster.template.approve", { templateId });
      return { templateId, status: "approved" };
    });
  }

  async function createTemplateVersion({ templateId, layout, palette, actor }) {
    if (!LAYOUTS.has(layout) || !validPalette(palette)) return { error: "POSTER_TEMPLATE_INVALID" };
    return db.withTransaction(async (client) => {
      const selected = await client.query("SELECT status,coalesce((SELECT max(version) FROM poster_template_versions WHERE template_id=t.template_id),0)::int AS max_version FROM poster_templates t WHERE template_id=$1 FOR UPDATE", [templateId]);
      if (!selected.rowCount) return { error: "POSTER_TEMPLATE_NOT_FOUND" };
      if (selected.rows[0].status !== "approved") return { error: "POSTER_TEMPLATE_NOT_APPROVED" };
      const version = selected.rows[0].max_version + 1;
      const templateVersionId = `${templateId}-v${version}-${randomUUID()}`;
      await client.query("INSERT INTO poster_template_versions(template_version_id,template_id,version,layout,palette,created_by) VALUES($1,$2,$3,$4,$5,$6)", [templateVersionId, templateId, version, layout, JSON.stringify(palette), actor]);
      await audit(client, actor, "poster.template.version.create", { templateId, templateVersionId, version });
      return { templateId, templateVersionId, version, status: "draft" };
    });
  }

  async function approveTemplateVersion({ templateId, templateVersionId, actor }) {
    return db.withTransaction(async (client) => {
      const result = await client.query(`UPDATE poster_template_versions v SET review_status='approved',approved_by=$3,approved_at=now()
        FROM poster_templates t WHERE v.template_id=$1 AND v.template_version_id=$2 AND t.template_id=v.template_id
          AND t.status='approved' AND v.review_status='draft' RETURNING v.version`, [templateId, templateVersionId, actor]);
      if (!result.rowCount) return { error: "POSTER_TEMPLATE_VERSION_NOT_DRAFT" };
      await audit(client, actor, "poster.template.version.approve", { templateId, templateVersionId, version: Number(result.rows[0].version) });
      return { templateId, templateVersionId, version: Number(result.rows[0].version), status: "approved" };
    });
  }

  async function publishTemplate({ templateVersionId, actor, source = "manual", releaseDate = null }, client = null) {
    if (!new Set(["manual", "daily", "rollback"]).has(source)) return { error: "POSTER_SOURCE_INVALID" };
    const publish = async (connection) => {
      const selected = await connection.query(`SELECT 1 FROM poster_template_versions v JOIN poster_templates t USING(template_id)
        WHERE v.template_version_id=$1 AND v.review_status='approved' AND t.status='approved' FOR UPDATE OF t`, [templateVersionId]);
      if (!selected.rowCount) return { error: "POSTER_TEMPLATE_UNAPPROVED" };
      if (source === "daily") {
        const already = await connection.query("SELECT publication_id FROM poster_template_publications WHERE source='daily' AND release_date=$1", [releaseDate]);
        if (already.rowCount) return { alreadyPublished: true, publicationId: Number(already.rows[0].publication_id) };
      }
      const inserted = await connection.query("INSERT INTO poster_template_publications(template_version_id,source,actor,release_date) VALUES($1,$2,$3,$4) RETURNING publication_id,published_at", [templateVersionId, source, actor, releaseDate]);
      await audit(connection, actor, "poster.template.publish", { templateVersionId, source, releaseDate });
      return { templateVersionId, publicationId: Number(inserted.rows[0].publication_id), publishedAt: inserted.rows[0].published_at, source };
    };
    return client ? publish(client) : db.withTransaction(publish);
  }

  async function rollbackTemplate({ templateId, templateVersionId, actor }) {
    return db.withTransaction(async (client) => {
      const template = await client.query(`SELECT status,coalesce((SELECT max(version) FROM poster_template_versions WHERE template_id=t.template_id),0)::int AS max_version
        FROM poster_templates t WHERE template_id=$1 FOR UPDATE`, [templateId]);
      if (!template.rowCount) return { error: "POSTER_TEMPLATE_NOT_FOUND" };
      if (template.rows[0].status !== "approved") return { error: "POSTER_TEMPLATE_NOT_APPROVED" };
      const target = await client.query(`SELECT v.layout,v.palette FROM poster_template_versions v
        WHERE v.template_id=$1 AND v.template_version_id=$2 AND v.review_status='approved'
          AND EXISTS(SELECT 1 FROM poster_template_publications p WHERE p.template_version_id=v.template_version_id)`, [templateId, templateVersionId]);
      if (!target.rowCount) return { error: "POSTER_TEMPLATE_ROLLBACK_UNAVAILABLE" };
      const active = await client.query(`SELECT pub.template_version_id FROM poster_template_publications pub
        JOIN poster_template_versions v USING(template_version_id) WHERE v.template_id=$1
        ORDER BY pub.publication_id DESC LIMIT 1`, [templateId]);
      if (active.rows[0]?.template_version_id === templateVersionId) return { error: "POSTER_TEMPLATE_VERSION_ALREADY_CURRENT" };

      const version = template.rows[0].max_version + 1;
      const restoredVersionId = `${templateId}-v${version}-${randomUUID()}`;
      await client.query(`INSERT INTO poster_template_versions(template_version_id,template_id,version,layout,palette,review_status,created_by,approved_by,approved_at)
        VALUES($1,$2,$3,$4,$5,'approved',$6,$6,now())`, [restoredVersionId, templateId, version, target.rows[0].layout, target.rows[0].palette, actor]);
      const published = await publishTemplate({ templateVersionId: restoredVersionId, actor, source: "rollback" }, client);
      if (published.error) return published;
      await audit(client, actor, "poster.template.version.rollback", { templateId, restoredFromVersionId: templateVersionId, restoredVersionId, version });
      return { ...published, templateId, restoredFromVersionId: templateVersionId, version };
    });
  }

  async function getSchedule() {
    const result = await db.query("SELECT enabled,time_zone,release_time::text,rotation_version_ids,updated_by,updated_at FROM poster_template_release_schedule WHERE singleton=true");
    const row = result.rows[0];
    return { enabled: row.enabled, timeZone: row.time_zone, releaseTime: row.release_time.slice(0, 5), rotationVersionIds: row.rotation_version_ids, updatedBy: row.updated_by, updatedAt: row.updated_at };
  }

  async function updateSchedule({ enabled, timeZone, releaseTime, rotationVersionIds, actor }) {
    if (typeof enabled !== "boolean" || !validTimeZone(timeZone) || typeof releaseTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(releaseTime)
      || !Array.isArray(rotationVersionIds) || rotationVersionIds.length < 1 || rotationVersionIds.length > 60 || rotationVersionIds.some((id) => typeof id !== "string")
      || new Set(rotationVersionIds).size !== rotationVersionIds.length) return { error: "POSTER_SCHEDULE_INVALID" };
    return db.withTransaction(async (client) => {
      const valid = await client.query("SELECT count(*)::int AS n FROM poster_template_versions v JOIN poster_templates t USING(template_id) WHERE v.template_version_id=ANY($1::text[]) AND t.status='approved' AND v.review_status='approved'", [rotationVersionIds]);
      if (valid.rows[0].n !== rotationVersionIds.length) return { error: "POSTER_SCHEDULE_UNAPPROVED" };
      const saved = await client.query("UPDATE poster_template_release_schedule SET enabled=$1,time_zone=$2,release_time=$3::time,rotation_version_ids=$4,updated_by=$5,updated_at=now() WHERE singleton=true RETURNING enabled,time_zone,release_time::text,rotation_version_ids,updated_by,updated_at", [enabled, timeZone, `${releaseTime}:00`, rotationVersionIds, actor]);
      await audit(client, actor, "poster.schedule.update", { enabled, timeZone, releaseTime, rotationCount: rotationVersionIds.length });
      const row = saved.rows[0];
      return { enabled: row.enabled, timeZone: row.time_zone, releaseTime: row.release_time.slice(0, 5), rotationVersionIds: row.rotation_version_ids, updatedBy: row.updated_by, updatedAt: row.updated_at };
    });
  }

  async function runScheduledRelease(at = new Date()) {
    const current = at instanceof Date ? at : new Date(at);
    if (!Number.isFinite(current.getTime())) return { skipped: "INVALID_TIME" };
    return db.withTransaction(async (client) => {
      const selected = await client.query("SELECT enabled,time_zone,release_time::text,rotation_version_ids FROM poster_template_release_schedule WHERE singleton=true FOR UPDATE");
      const schedule = selected.rows[0];
      if (!schedule?.enabled || !schedule.rotation_version_ids.length) return { skipped: "DISABLED" };
      const local = localClockParts(current, schedule.time_zone);
      const [hour, minute] = schedule.release_time.slice(0, 5).split(":").map(Number);
      if (local.hour * 60 + local.minute < hour * 60 + minute) return { skipped: "NOT_DUE", localDate: local.date };
      const day = Math.floor(Date.parse(`${local.date}T00:00:00Z`) / 86_400_000);
      const versionId = schedule.rotation_version_ids[((day % schedule.rotation_version_ids.length) + schedule.rotation_version_ids.length) % schedule.rotation_version_ids.length];
      return publishTemplate({ templateVersionId: versionId, actor: "poster-scheduler", source: "daily", releaseDate: local.date }, client);
    });
  }

  async function listPosters() {
    const result = await db.query(`SELECT p.poster_id,p.instance_id,i.slug,i.display_name,p.template_version_id,v.template_id,t.name AS template_name,
      p.data,p.status,p.created_by,p.updated_by,p.created_at,p.updated_at
      FROM posters p JOIN game_instances i USING(instance_id) JOIN poster_template_versions v USING(template_version_id)
      JOIN poster_templates t USING(template_id) ORDER BY p.updated_at DESC LIMIT 200`);
    return result.rows.map(mapPoster);
  }

  function mapPoster(row) {
    return { posterId: row.poster_id, instanceId: row.instance_id, instanceSlug: row.slug, instanceName: row.display_name, templateVersionId: row.template_version_id, templateId: row.template_id, templateName: row.template_name, data: row.data, status: row.status, createdBy: row.created_by, updatedBy: row.updated_by, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  async function createPoster({ instanceId, templateVersionId, data, actor, duplicateFrom = null }) {
    const validated = await validateData(db, data, actor, instanceId);
    if (!validated.data) return validated;
    return db.withTransaction(async (client) => {
      if (!(await approvedTemplate(client, templateVersionId))) return { error: "POSTER_TEMPLATE_UNAPPROVED" };
      const instance = await client.query("SELECT 1 FROM game_instances WHERE instance_id=$1 AND status='active'", [instanceId]);
      if (!instance.rowCount) return { error: "INSTANCE_NOT_FOUND" };
      const posterId = randomUUID();
      await client.query("INSERT INTO posters(poster_id,instance_id,template_version_id,data,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$5)", [posterId, instanceId, templateVersionId, JSON.stringify(validated.data), actor]);
      await audit(client, actor, "poster.draft.create", { posterId, instanceId, templateVersionId, duplicateFrom });
      return { posterId, status: "draft" };
    });
  }

  async function savePoster({ posterId, templateVersionId, data, actor }) {
    const currentInstance = await db.query("SELECT instance_id FROM posters WHERE poster_id=$1", [posterId]);
    if (!currentInstance.rowCount) return { error: "POSTER_NOT_FOUND" };
    const validated = await validateData(db, data, actor, currentInstance.rows[0].instance_id);
    if (!validated.data) return validated;
    return db.withTransaction(async (client) => {
      const current = await client.query("SELECT instance_id,status,template_version_id,data FROM posters WHERE poster_id=$1 FOR UPDATE", [posterId]);
      if (!current.rowCount) return { error: "POSTER_NOT_FOUND" };
      if (current.rows[0].status !== "draft") return { error: "POSTER_LOCKED" };
      if (!(await approvedTemplate(client, templateVersionId))) return { error: "POSTER_TEMPLATE_UNAPPROVED" };
      const revision = await client.query("SELECT COALESCE(max(revision),0)::int+1 AS revision FROM poster_revisions WHERE poster_id=$1", [posterId]);
      await client.query("INSERT INTO poster_revisions(poster_id,revision,instance_id,template_version_id,data,actor) VALUES($1,$2,$3,$4,$5,$6)", [posterId, revision.rows[0].revision, current.rows[0].instance_id, current.rows[0].template_version_id, current.rows[0].data || {}, actor]);
      await client.query("UPDATE posters SET template_version_id=$2,data=$3,updated_by=$4,updated_at=now() WHERE poster_id=$1", [posterId, templateVersionId, JSON.stringify(validated.data), actor]);
      await audit(client, actor, "poster.draft.update", { posterId, instanceId: current.rows[0].instance_id, templateVersionId });
      return { posterId, status: "draft" };
    });
  }

  async function duplicatePoster({ posterId, actor }) {
    const existing = await db.query("SELECT instance_id,template_version_id,data FROM posters WHERE poster_id=$1", [posterId]);
    if (!existing.rowCount) return { error: "POSTER_NOT_FOUND" };
    const created = await createPoster({ ...existing.rows[0], instanceId: existing.rows[0].instance_id, templateVersionId: existing.rows[0].template_version_id, actor, duplicateFrom: posterId });
    if (created.error) return created;
    const duplicate = await db.query(`SELECT p.poster_id,p.instance_id,i.slug,i.display_name,p.template_version_id,v.template_id,t.name AS template_name,
      p.data,p.status,p.created_by,p.updated_by,p.created_at,p.updated_at FROM posters p JOIN game_instances i USING(instance_id)
      JOIN poster_template_versions v USING(template_version_id) JOIN poster_templates t USING(template_id) WHERE p.poster_id=$1`, [created.posterId]);
    return { ...created, poster: mapPoster(duplicate.rows[0]) };
  }

  async function publishPoster({ posterId, actor }) {
    return db.withTransaction(async (client) => {
      const result = await client.query(`SELECT p.*,i.slug,i.display_name,i.branding,v.template_id,t.name AS template_name
        FROM posters p JOIN game_instances i USING(instance_id) JOIN poster_template_versions v USING(template_version_id)
        JOIN poster_templates t USING(template_id) WHERE p.poster_id=$1 FOR UPDATE OF p`, [posterId]);
      if (!result.rowCount) return { error: "POSTER_NOT_FOUND" };
      const poster = result.rows[0];
      if (!(await approvedTemplate(client, poster.template_version_id))) return { error: "POSTER_TEMPLATE_UNAPPROVED" };
      let data = poster.data;
      if (data.sessionId) {
        const context = await getEventContext({ instanceId: poster.instance_id, sessionId: data.sessionId });
        if (!context || !["draft", "open", "paused"].includes(context.status) || new Date(context.startsAt).getTime() <= Date.now()) return { error: "POSTER_SESSION_CLOSED" };
        data = { ...data, title: context.title, schedule: context.schedule, details: data.eventDetails || `${context.gameType} · ${context.ticketAvailability}`,
          patterns: context.prizesDescription || context.missingFields.join(" "), eventFacts: context };
      }
      const inserted = await client.query(`INSERT INTO poster_publications(poster_id,instance_id,instance_name,instance_slug,instance_branding,template_version_id,data,actor)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING publication_id,published_at`, [posterId, poster.instance_id, poster.display_name, poster.slug, JSON.stringify(publicInstanceBranding(poster.branding)), poster.template_version_id, data, actor]);
      await client.query("UPDATE posters SET status='published',data=$3,updated_by=$2,updated_at=now() WHERE poster_id=$1", [posterId, actor, JSON.stringify(data)]);
      await audit(client, actor, "poster.publish", { posterId, publicationId: Number(inserted.rows[0].publication_id), instanceId: poster.instance_id, templateVersionId: poster.template_version_id });
      return { posterId, status: "published", publicationId: Number(inserted.rows[0].publication_id), publishedAt: inserted.rows[0].published_at };
    });
  }

  async function getPublicPoster(posterId) {
    const result = await db.query(`SELECT p.poster_id,p.instance_id,p.instance_slug AS slug,p.instance_name AS display_name,p.instance_branding AS branding,p.template_version_id,v.template_id,t.name AS template_name,p.data,p.published_at,p.publication_id
      FROM poster_publications p JOIN poster_template_versions v USING(template_version_id)
      JOIN poster_templates t USING(template_id) WHERE p.poster_id=$1 ORDER BY p.publication_id DESC LIMIT 1`, [posterId]);
    if (!result.rowCount) return null;
    const mapped = mapPoster({ ...result.rows[0], status: "published" });
    return { posterId: mapped.posterId, instanceSlug: mapped.instanceSlug, instanceName: mapped.instanceName, branding: publicInstanceBranding(result.rows[0].branding),
      templateVersionId: mapped.templateVersionId, templateId: mapped.templateId, templateName: mapped.templateName,
      data: mapped.data, status: mapped.status, publishedAt: result.rows[0].published_at, publicationId: Number(result.rows[0].publication_id) };
  }

  return { listTemplates, createTemplateDraft, createTemplateVersion, approveTemplate, approveTemplateVersion, publishTemplate, rollbackTemplate, getSchedule, updateSchedule, runScheduledRelease, listPosters, createPoster, savePoster, duplicatePoster, publishPoster, getPublicPoster, listEventSessions, getEventContext, generateArtwork, getArtwork, providerStatus: () => ({ configured: Boolean(imageProvider?.configured), provider: imageProvider?.provider || "openai-images", model: imageProvider?.model || null }) };
}
