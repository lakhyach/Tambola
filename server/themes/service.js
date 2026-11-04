import { randomUUID } from "node:crypto";
import { publicInstanceBranding } from "../instances/branding.js";

const COLOR_KEYS = [
  "void", "obsidian", "graphite", "panel", "panelRaised", "inset", "line",
  "gold", "goldBright", "goldDeep", "coral", "silver", "silverDim", "ivory",
  "text", "textMuted", "textFaint", "ok", "warn", "danger", "info",
  "ticket", "ticketInk", "board", "boardCalled",
];
const TOKEN_KEYS = [...COLOR_KEYS, "radius", "displayFont", "uiFont", "shadow"];
const CATEGORIES = new Set(["classic", "premium", "festive", "seasonal", "celebration", "minimal", "modern", "traditional", "special"]);
const MODES = new Set(["latest", "fixed", "rotation"]);
const HEX = /^#[0-9a-f]{6}$/i;

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((part) => Number.parseInt(part, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrastRatio(first, second) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

export function validateThemePackage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== 1 || !value.tokens || typeof value.tokens !== "object" || Array.isArray(value.tokens)) {
    return { error: "THEME_PACKAGE_INVALID" };
  }
  const keys = Object.keys(value.tokens).sort();
  const expected = [...TOKEN_KEYS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return { error: "THEME_TOKENS_INVALID" };
  for (const key of COLOR_KEYS) if (typeof value.tokens[key] !== "string" || !HEX.test(value.tokens[key])) return { error: "THEME_COLOR_INVALID" };
  const contrastPairs = [
    ["text", "void"], ["text", "obsidian"], ["text", "graphite"], ["text", "panel"], ["text", "panelRaised"], ["text", "inset"],
    ["textMuted", "void"], ["textMuted", "obsidian"], ["textMuted", "panel"], ["textMuted", "panelRaised"],
    ["textFaint", "void"], ["textFaint", "obsidian"], ["textFaint", "panel"], ["textFaint", "panelRaised"],
    ["goldBright", "obsidian"], ["goldBright", "panel"], ["ticketInk", "ticket"], ["ticketInk", "boardCalled"],
  ];
  if (contrastPairs.some(([foreground, background]) => contrastRatio(value.tokens[foreground], value.tokens[background]) < 4.5)) return { error: "THEME_CONTRAST_INSUFFICIENT" };
  if (!new Set(["soft", "rounded", "square"]).has(value.tokens.radius)) return { error: "THEME_RADIUS_INVALID" };
  if (!new Set(["serif", "system"]).has(value.tokens.displayFont) || value.tokens.uiFont !== "system") return { error: "THEME_FONT_INVALID" };
  if (!new Set(["subtle", "deep"]).has(value.tokens.shadow)) return { error: "THEME_SHADOW_INVALID" };
  return { package: { schemaVersion: 1, tokens: Object.fromEntries(TOKEN_KEYS.map((key) => [key, value.tokens[key]])) } };
}

export function localClockParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, hour: Number(values.hour), minute: Number(values.minute) };
}

export function validTimeZone(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 80) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}

export function createThemeService({ db, now = () => new Date() } = {}) {
  if (!db) throw new Error("createThemeService needs a database handle");

  async function audit(client, { actor, action, themeId = null, versionId = null, metadata = {}, actorRole = "super_admin" }) {
    await client.query(
      `INSERT INTO platform_audit(actor,actor_role,action,result,metadata)
       VALUES($1,$2,$3,'success',$4)`,
      [actor, actorRole, action, JSON.stringify({ themeId, themeVersionId: versionId, ...metadata })]
    );
  }

  function mapTheme(row) {
    const validated = validateThemePackage(row.package);
    if (!validated.package) throw new Error("stored theme package failed its schema check");
    return {
      themeId: row.theme_id,
      themeVersionId: row.theme_version_id,
      version: Number(row.version),
      name: row.name,
      description: row.description,
      category: row.category,
      status: row.status === "retired" ? "retired" : row.review_status,
      catalogStatus: row.status,
      package: validated.package,
      publishedAt: row.published_at || null,
      isActive: Boolean(row.is_active),
    };
  }

  async function listStore() {
    const result = await db.query(`SELECT c.theme_id,v.theme_version_id,v.version,c.name,c.description,c.category,c.status,v.package,
      latest.published_at,coalesce(state.active_version_id=v.theme_version_id,false) AS is_active,v.review_status
      FROM theme_catalog c JOIN theme_versions v USING(theme_id)
      LEFT JOIN LATERAL (SELECT published_at FROM theme_publications p WHERE p.theme_version_id=v.theme_version_id ORDER BY publication_id DESC LIMIT 1) latest ON true
      CROSS JOIN platform_theme_state state
      WHERE c.status IN ('approved','retired') AND v.review_status='approved'
      ORDER BY CASE WHEN c.status='approved' THEN 0 ELSE 1 END,c.category,c.name,v.version DESC`);
    const rows = result.rows;
    const latestVersions = new Set();
    for (const row of rows) if (row.published_at || row.is_active) latestVersions.add(row.theme_id);
    return rows.filter((row) => row.status === "approved" || latestVersions.has(row.theme_id)).map(mapTheme);
  }

  async function listAdminThemes() {
    const result = await db.query(`SELECT c.theme_id,v.theme_version_id,v.version,c.name,c.description,c.category,c.status,v.package,
      latest.published_at,coalesce(state.active_version_id=v.theme_version_id,false) AS is_active,v.review_status
      FROM theme_catalog c JOIN theme_versions v USING(theme_id)
      LEFT JOIN LATERAL (SELECT published_at FROM theme_publications p WHERE p.theme_version_id=v.theme_version_id ORDER BY publication_id DESC LIMIT 1) latest ON true
      CROSS JOIN platform_theme_state state ORDER BY c.created_at DESC,c.theme_id,v.version DESC`);
    return result.rows.map(mapTheme);
  }

  async function getGlobalTheme() {
    const result = await db.query(`SELECT c.theme_id,v.theme_version_id,v.version,c.name,c.description,c.category,c.status,v.package,p.published_at,true AS is_active,v.review_status
      FROM platform_theme_state s JOIN theme_versions v ON v.theme_version_id=s.active_version_id
      JOIN theme_catalog c USING(theme_id)
      LEFT JOIN LATERAL (SELECT published_at FROM theme_publications WHERE theme_version_id=v.theme_version_id ORDER BY publication_id DESC LIMIT 1) p ON true
      WHERE s.singleton=true`);
    return result.rowCount ? mapTheme(result.rows[0]) : null;
  }

  async function getThemeForInstance({ slug, roomId = null } = {}) {
    if (roomId) {
      const snapshot = await db.query(`SELECT i.slug,i.display_name,i.branding,v.theme_id,v.theme_version_id,v.version,c.name,c.description,c.category,c.status,v.package,
        NULL::timestamptz AS published_at,false AS is_active,v.review_status
        FROM rooms r JOIN game_instances i ON i.instance_id=r.game_instance_id
        JOIN theme_versions v ON v.theme_version_id=r.config->>'themeVersionId'
        JOIN theme_catalog c USING(theme_id)
        WHERE r.room_code=$1 AND ($2::text IS NULL OR i.slug=$2)`, [roomId, slug || null]);
      if (snapshot.rowCount) return { ...mapTheme(snapshot.rows[0]), source: "room-snapshot", instanceSlug: snapshot.rows[0].slug, instanceName: snapshot.rows[0].display_name, instanceBranding: publicInstanceBranding(snapshot.rows[0].branding) };
    }
    if (!slug) return getGlobalTheme();
    const selected = await db.query(`SELECT i.slug,i.display_name,i.branding,i.theme_mode,i.theme_version_id FROM game_instances i WHERE i.slug=$1 AND i.status='active'`, [slug]);
    if (!selected.rowCount) return null;
    const instance = selected.rows[0];
    let versionId = instance.theme_version_id;
    if (instance.theme_mode !== "fixed") {
      const result = instance.theme_mode === "latest"
        ? await db.query(`SELECT p.theme_version_id FROM theme_publications p JOIN theme_versions v USING(theme_version_id) JOIN theme_catalog c USING(theme_id) WHERE c.status='approved' AND v.review_status='approved' ORDER BY p.published_at DESC,p.publication_id DESC LIMIT 1`)
        : await db.query("SELECT active_version_id AS theme_version_id FROM platform_theme_state WHERE singleton=true");
      versionId = result.rows[0]?.theme_version_id || null;
    }
    const instanceBrand = { instanceSlug: instance.slug, instanceName: instance.display_name, instanceBranding: publicInstanceBranding(instance.branding) };
    if (!versionId) return { ...(await getGlobalTheme()), ...instanceBrand };
    const theme = await db.query(`SELECT c.theme_id,v.theme_version_id,v.version,c.name,c.description,c.category,c.status,v.package,
      (SELECT max(published_at) FROM theme_publications WHERE theme_version_id=v.theme_version_id) AS published_at,
      coalesce(s.active_version_id=v.theme_version_id,false) AS is_active,v.review_status
      FROM theme_versions v JOIN theme_catalog c USING(theme_id) CROSS JOIN platform_theme_state s
      WHERE v.theme_version_id=$1`, [versionId]);
    return theme.rowCount ? { ...mapTheme(theme.rows[0]), source: instance.theme_mode, ...instanceBrand } : { ...(await getGlobalTheme()), ...instanceBrand };
  }

  async function getSchedule() {
    const result = await db.query("SELECT enabled,time_zone,release_time::text,rotation_version_ids,updated_by,updated_at FROM theme_release_schedule WHERE singleton=true");
    const row = result.rows[0];
    return { enabled: row.enabled, timeZone: row.time_zone, releaseTime: row.release_time.slice(0, 5), rotationVersionIds: row.rotation_version_ids, updatedBy: row.updated_by, updatedAt: row.updated_at };
  }

  async function listReleases({ limit = 50 } = {}) {
    const result = await db.query(`SELECT p.publication_id,p.source,p.actor,p.release_date,p.published_at,v.theme_id,v.theme_version_id,v.version,c.name
      FROM theme_publications p JOIN theme_versions v USING(theme_version_id) JOIN theme_catalog c USING(theme_id)
      ORDER BY p.publication_id DESC LIMIT $1`, [Math.min(Math.max(Number(limit) || 50, 1), 200)]);
    return result.rows.map((row) => ({ publicationId: Number(row.publication_id), source: row.source, actor: row.actor, releaseDate: row.release_date, publishedAt: row.published_at, themeId: row.theme_id, themeVersionId: row.theme_version_id, version: Number(row.version), name: row.name }));
  }

  async function listNotifications(ownerId) {
    const [items, count] = await Promise.all([
      db.query(`SELECT notification_id,title,body,destination,created_at
        FROM owner_notifications WHERE owner_id=$1 AND read_at IS NULL
        ORDER BY created_at DESC,notification_id DESC LIMIT 10`, [ownerId]),
      db.query("SELECT count(*)::int AS n FROM owner_notifications WHERE owner_id=$1 AND read_at IS NULL", [ownerId]),
    ]);
    return {
      unreadCount: count.rows[0].n,
      notifications: items.rows.map((row) => ({
        notificationId: Number(row.notification_id), title: row.title, body: row.body,
        destination: row.destination, createdAt: row.created_at,
      })),
    };
  }

  async function markNotificationRead({ ownerId, notificationId, actor }) {
    if (!Number.isSafeInteger(notificationId) || notificationId < 1) return { error: "NOTIFICATION_NOT_FOUND" };
    return db.withTransaction(async (client) => {
      const updated = await client.query(`UPDATE owner_notifications SET read_at=now()
        WHERE notification_id=$1 AND owner_id=$2 AND read_at IS NULL
        RETURNING notification_id`, [notificationId, ownerId]);
      if (updated.rowCount) {
        await audit(client, { actor, action: "theme.notification.read", metadata: { notificationId } });
        return { notificationId, read: true };
      }
      const existing = await client.query("SELECT read_at FROM owner_notifications WHERE notification_id=$1 AND owner_id=$2", [notificationId, ownerId]);
      if (!existing.rowCount) return { error: "NOTIFICATION_NOT_FOUND" };
      return { notificationId, read: true, alreadyRead: true };
    });
  }

  async function createDraft({ themeId, name, description, category, package: themePackage, actor }) {
    if (typeof themeId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(themeId) || themeId.length > 48 || typeof name !== "string" || name.trim().length < 2 || name.trim().length > 80 || typeof description !== "string" || description.trim().length < 10 || description.trim().length > 500 || !CATEGORIES.has(category)) return { error: "THEME_METADATA_INVALID" };
    const checked = validateThemePackage(themePackage);
    if (!checked.package) return { error: checked.error };
    try {
      return await db.withTransaction(async (client) => {
        const versionId = `${themeId}-v1-${randomUUID()}`;
        await client.query("INSERT INTO theme_catalog(theme_id,name,description,category,status,created_by) VALUES($1,$2,$3,$4,'draft',$5)", [themeId, name.trim(), description.trim(), category, actor]);
        await client.query("INSERT INTO theme_versions(theme_version_id,theme_id,version,package,created_by) VALUES($1,$2,1,$3,$4)", [versionId, themeId, JSON.stringify(checked.package), actor]);
        await audit(client, { actor, action: "theme.draft.create", themeId, versionId });
        return { themeId, themeVersionId: versionId, version: 1, status: "draft" };
      });
    } catch (error) {
      if (error.code === "23505") return { error: "THEME_ID_EXISTS" };
      throw error;
    }
  }

  async function createVersion({ themeId, package: themePackage, actor }) {
    const checked = validateThemePackage(themePackage);
    if (!checked.package) return { error: checked.error };
    return db.withTransaction(async (client) => {
      const selected = await client.query("SELECT status,coalesce((SELECT max(version) FROM theme_versions WHERE theme_id=c.theme_id),0)::int AS max_version FROM theme_catalog c WHERE theme_id=$1 FOR UPDATE", [themeId]);
      if (!selected.rowCount) return { error: "THEME_NOT_FOUND" };
      if (selected.rows[0].status === "retired") return { error: "THEME_RETIRED" };
      const version = selected.rows[0].max_version + 1;
      const versionId = `${themeId}-v${version}-${randomUUID()}`;
      await client.query("INSERT INTO theme_versions(theme_version_id,theme_id,version,package,created_by) VALUES($1,$2,$3,$4,$5)", [versionId, themeId, version, JSON.stringify(checked.package), actor]);
      await audit(client, { actor, action: "theme.version.create", themeId, versionId, metadata: { version } });
      return { themeId, themeVersionId: versionId, version, status: "draft", catalogStatus: selected.rows[0].status };
    });
  }

  async function approveTheme({ themeId, actor }) {
    return db.withTransaction(async (client) => {
      const result = await client.query("UPDATE theme_catalog SET status='approved',approved_by=$2,approved_at=now() WHERE theme_id=$1 AND status='draft' RETURNING theme_id", [themeId, actor]);
      if (!result.rowCount) {
        const exists = await client.query("SELECT status FROM theme_catalog WHERE theme_id=$1", [themeId]);
        return { error: !exists.rowCount ? "THEME_NOT_FOUND" : "THEME_NOT_DRAFT" };
      }
      await client.query("UPDATE theme_versions SET review_status='approved',approved_by=$2,approved_at=now() WHERE theme_id=$1 AND review_status='draft'", [themeId, actor]);
      await audit(client, { actor, action: "theme.approve", themeId });
      return { themeId, status: "approved" };
    });
  }

  async function approveThemeVersion({ themeId, themeVersionId, actor }) {
    return db.withTransaction(async (client) => {
      const result = await client.query(`UPDATE theme_versions v SET review_status='approved',approved_by=$3,approved_at=now()
        FROM theme_catalog c WHERE v.theme_id=$1 AND v.theme_version_id=$2 AND c.theme_id=v.theme_id
          AND c.status='approved' AND v.review_status='draft' RETURNING v.theme_id,v.theme_version_id,v.version`, [themeId, themeVersionId, actor]);
      if (!result.rowCount) {
        const exists = await client.query("SELECT c.status,v.review_status FROM theme_catalog c LEFT JOIN theme_versions v ON v.theme_id=c.theme_id AND v.theme_version_id=$2 WHERE c.theme_id=$1", [themeId, themeVersionId]);
        return { error: !exists.rowCount || !exists.rows[0].review_status ? "THEME_VERSION_NOT_FOUND" : exists.rows[0].status !== "approved" ? "THEME_NOT_APPROVED" : "THEME_VERSION_NOT_DRAFT" };
      }
      await audit(client, { actor, action: "theme.version.approve", themeId, versionId: themeVersionId, metadata: { version: Number(result.rows[0].version) } });
      return { themeId, themeVersionId, version: Number(result.rows[0].version), status: "approved" };
    });
  }

  async function retireTheme({ themeId, actor }) {
    return db.withTransaction(async (client) => {
      const refs = await client.query(`SELECT s.active_version_id,s.previous_version_id,
        EXISTS(SELECT 1 FROM game_instances i WHERE i.theme_version_id IN (SELECT theme_version_id FROM theme_versions WHERE theme_id=$1)) AS instance_ref,
        EXISTS(SELECT 1 FROM theme_release_schedule r WHERE r.rotation_version_ids && ARRAY(SELECT theme_version_id FROM theme_versions WHERE theme_id=$1)) AS scheduled_ref
        FROM platform_theme_state s WHERE s.singleton=true FOR UPDATE`, [themeId]);
      if (refs.rows[0]?.instance_ref || refs.rows[0]?.scheduled_ref || refs.rows[0]?.active_version_id && refs.rows[0].active_version_id.startsWith(`${themeId}-`) || refs.rows[0]?.previous_version_id && refs.rows[0].previous_version_id.startsWith(`${themeId}-`)) return { error: "THEME_IN_USE" };
      const updated = await client.query("UPDATE theme_catalog SET status='retired',retired_by=$2,retired_at=now() WHERE theme_id=$1 AND status='approved' RETURNING theme_id", [themeId, actor]);
      if (!updated.rowCount) return { error: "THEME_NOT_FOUND_OR_NOT_APPROVED" };
      await audit(client, { actor, action: "theme.retire", themeId });
      return { themeId, status: "retired" };
    });
  }

  async function publishWithClient(client, { themeVersionId, actor, source, releaseDate = null }) {
    const selected = await client.query(`SELECT v.theme_id,v.theme_version_id,v.version,c.name,c.status,v.review_status FROM theme_versions v JOIN theme_catalog c USING(theme_id) WHERE v.theme_version_id=$1 FOR SHARE OF c` , [themeVersionId]);
    if (!selected.rowCount) return { error: "THEME_VERSION_NOT_FOUND" };
    if (selected.rows[0].status !== "approved" || selected.rows[0].review_status !== "approved") return { error: "THEME_NOT_APPROVED" };
    if (source === "daily") {
      const exists = await client.query("SELECT publication_id FROM theme_publications WHERE source='daily' AND release_date=$1", [releaseDate]);
      if (exists.rowCount) return { alreadyPublished: true, publicationId: Number(exists.rows[0].publication_id) };
    }
    const state = await client.query("SELECT active_version_id,previous_version_id FROM platform_theme_state WHERE singleton=true FOR UPDATE");
    const current = state.rows[0]?.active_version_id || null;
    await client.query(`UPDATE platform_theme_state SET previous_version_id=CASE WHEN active_version_id IS DISTINCT FROM $1 THEN active_version_id ELSE previous_version_id END,
      active_version_id=$1,updated_by=$2,updated_at=now() WHERE singleton=true`, [themeVersionId, actor]);
    const published = await client.query("INSERT INTO theme_publications(theme_version_id,source,actor,release_date) VALUES($1,$2,$3,$4) RETURNING publication_id,published_at", [themeVersionId, source, actor, releaseDate]);
    await audit(client, { actor, action: source === "daily" ? "theme.publish.daily" : source === "rollback" ? "theme.publish.rollback" : "theme.publish.manual", themeId: selected.rows[0].theme_id, versionId: themeVersionId, actorRole: source === "daily" ? "system" : "super_admin", metadata: { source, releaseDate } });
    if (source === "daily") {
      const { name, version } = selected.rows[0];
      await client.query(`INSERT INTO owner_notifications(owner_id,event_key,kind,title,body,destination)
        SELECT owner_id,$1,'theme.daily_release',$2,$3,'/admin/themes' FROM owner_accounts
        ON CONFLICT(owner_id,event_key) DO NOTHING`, [
        `theme.daily:${releaseDate}`,
        `Daily theme released: ${name}`,
        `${name} version ${version} is now the active platform theme for ${releaseDate}.`,
      ]);
    }
    return { themeVersionId, previousVersionId: current, publicationId: Number(published.rows[0].publication_id), publishedAt: published.rows[0].published_at, source };
  }

  async function publish({ themeVersionId, actor, source = "manual" }) {
    if (source !== "manual") return { error: "INVALID_PUBLICATION_SOURCE" };
    return db.withTransaction((client) => publishWithClient(client, { themeVersionId, actor, source }));
  }

  async function rollback({ actor }) {
    return db.withTransaction(async (client) => {
      const state = await client.query("SELECT previous_version_id FROM platform_theme_state WHERE singleton=true FOR UPDATE");
      const versionId = state.rows[0]?.previous_version_id;
      if (!versionId) return { error: "THEME_ROLLBACK_UNAVAILABLE" };
      return publishWithClient(client, { themeVersionId: versionId, actor, source: "rollback" });
    });
  }

  async function updateSchedule({ enabled, timeZone, releaseTime, rotationVersionIds, actor }) {
    if (typeof enabled !== "boolean" || !validTimeZone(timeZone) || typeof releaseTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(releaseTime) || !Array.isArray(rotationVersionIds) || rotationVersionIds.length < 1 || rotationVersionIds.length > 60 || rotationVersionIds.some((id) => typeof id !== "string")) return { error: "THEME_SCHEDULE_INVALID" };
    const ids = [...new Set(rotationVersionIds)];
    if (ids.length !== rotationVersionIds.length) return { error: "THEME_ROTATION_DUPLICATE" };
    return db.withTransaction(async (client) => {
      const approved = await client.query("SELECT count(*)::int AS n FROM theme_versions v JOIN theme_catalog c USING(theme_id) WHERE v.theme_version_id=ANY($1::text[]) AND c.status='approved' AND v.review_status='approved'", [ids]);
      if (approved.rows[0].n !== ids.length) return { error: "THEME_ROTATION_UNAPPROVED" };
      const saved = await client.query("UPDATE theme_release_schedule SET enabled=$1,time_zone=$2,release_time=$3::time,rotation_version_ids=$4,updated_by=$5,updated_at=now() WHERE singleton=true RETURNING enabled,time_zone,release_time::text,rotation_version_ids,updated_by,updated_at", [enabled, timeZone, `${releaseTime}:00`, ids, actor]);
      await audit(client, { actor, action: "theme.schedule.update", metadata: { enabled, timeZone, releaseTime, rotationCount: ids.length } });
      const row = saved.rows[0];
      return { enabled: row.enabled, timeZone: row.time_zone, releaseTime: row.release_time.slice(0, 5), rotationVersionIds: row.rotation_version_ids, updatedBy: row.updated_by, updatedAt: row.updated_at };
    });
  }

  async function runScheduledRelease(at = now()) {
    const current = at instanceof Date ? at : new Date(at);
    if (!Number.isFinite(current.getTime())) return { skipped: "INVALID_TIME" };
    return db.withTransaction(async (client) => {
      const result = await client.query("SELECT enabled,time_zone,release_time::text,rotation_version_ids FROM theme_release_schedule WHERE singleton=true FOR UPDATE");
      const schedule = result.rows[0];
      if (!schedule?.enabled || !schedule.rotation_version_ids.length) return { skipped: "DISABLED" };
      const local = localClockParts(current, schedule.time_zone);
      const [hour, minute] = schedule.release_time.slice(0, 5).split(":").map(Number);
      if (local.hour * 60 + local.minute < hour * 60 + minute) return { skipped: "NOT_DUE", localDate: local.date };
      const day = Math.floor(Date.parse(`${local.date}T00:00:00Z`) / 86_400_000);
      const versionId = schedule.rotation_version_ids[((day % schedule.rotation_version_ids.length) + schedule.rotation_version_ids.length) % schedule.rotation_version_ids.length];
      return publishWithClient(client, { themeVersionId: versionId, actor: "theme-scheduler", source: "daily", releaseDate: local.date });
    });
  }

  async function setInstanceSelection({ instanceId, mode, themeVersionId = null, actor }) {
    if (!MODES.has(mode) || (mode === "fixed") !== Boolean(themeVersionId)) return { error: "THEME_SELECTION_INVALID" };
    return db.withTransaction(async (client) => {
      const instance = await client.query("SELECT instance_id FROM game_instances WHERE instance_id=$1 FOR UPDATE", [instanceId]);
      if (!instance.rowCount) return { error: "INSTANCE_NOT_FOUND" };
      if (mode === "fixed") {
        const valid = await client.query("SELECT 1 FROM theme_versions v JOIN theme_catalog c USING(theme_id) WHERE v.theme_version_id=$1 AND c.status='approved' AND v.review_status='approved'", [themeVersionId]);
        if (!valid.rowCount) return { error: "THEME_NOT_APPROVED" };
      }
      await client.query("UPDATE game_instances SET theme_mode=$2,theme_version_id=$3,updated_by=$4 WHERE instance_id=$1", [instanceId, mode, themeVersionId, actor]);
      await audit(client, { actor, action: "theme.instance.selection", themeId: null, versionId: themeVersionId, metadata: { instanceId, mode } });
      return { instanceId, mode, themeVersionId };
    });
  }

  return { listStore, listAdminThemes, getGlobalTheme, getThemeForInstance, getSchedule, listReleases, listNotifications, markNotificationRead, createDraft, createVersion, approveTheme, approveThemeVersion, retireTheme, publish, rollback, updateSchedule, runScheduledRelease, setInstanceSelection };
}
