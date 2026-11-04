/**
 * Admin read queries.
 *
 * Every value the control centre shows as a "statistic" comes from here, and
 * every one of them is a real query against the durable tables - nothing is
 * invented and nothing is hard-coded. The queries are read-only: they never
 * write, so they cannot bypass the persistence controller or the room locks.
 *
 * Two rules keep this honest against the dashboard requirements:
 *   - Derived facts (a called-number count, a participant total) are computed
 *     by query and never read from a cache column that could disagree.
 *   - The private draw plan (games.draw_sequence) is NEVER selected. The
 *     official, already-called numbers come from draw_calls instead.
 *
 * A `db` handle is required; without durability the route layer serves live
 * registry state instead, so this module is only ever built in durable mode.
 */

function clampLimit(value, fallback, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function clampOffset(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

export function createAdminQueries({ db } = {}) {
  if (!db) throw new Error("createAdminQueries needs a database handle");

  /** Lifetime totals for the overview header. All from real rows. */
  async function totals() {
    const result = await db.query(
      `SELECT
         (SELECT count(*) FROM rooms)                                  ::int AS total_rooms,
         (SELECT count(*) FROM rooms WHERE closed_at IS NULL)          ::int AS open_rooms,
         (SELECT count(*) FROM games)                                   ::int AS total_games,
         (SELECT count(*) FROM games WHERE status = 'COMPLETED')        ::int AS completed_games,
         (SELECT count(DISTINCT player_id) FROM room_members)           ::int AS participants,
         (SELECT count(*) FROM awards)                                  ::int AS awards,
         (SELECT count(*) FROM claims WHERE status = 'AWARDED')         ::int AS valid_claims,
         (SELECT count(*) FROM claims WHERE status = 'REJECTED')        ::int AS rejected_claims`
    );
    return result.rows[0];
  }

  /** Platform-wide control-plane counts for the owner overview. */
  async function platformCounts() {
    const result = await db.query(`SELECT
      (SELECT count(*) FROM game_instances)::int AS total_instances,
      (SELECT count(*) FROM game_instances WHERE status='active')::int AS active_instances,
      (SELECT count(*) FROM game_instances WHERE status='paused')::int AS paused_instances,
      (SELECT count(*) FROM game_instances WHERE status='archived')::int AS archived_instances,
      (SELECT count(*) FROM moderator_accounts)::int AS total_moderators,
      (SELECT count(*) FROM moderator_accounts WHERE status='active')::int AS active_moderators,
      (SELECT count(*) FROM moderator_accounts WHERE status='invited')::int AS invited_moderators,
      (SELECT count(*) FROM moderator_accounts WHERE status='suspended')::int AS suspended_moderators,
      (SELECT count(*) FROM moderator_instance_grants g JOIN moderator_accounts a USING(moderator_id) WHERE g.revoked_at IS NULL AND a.status='active')::int AS active_moderator_grants,
      (SELECT count(*) FROM moderator_sessions s JOIN moderator_accounts a USING(moderator_id) WHERE s.revoked_at IS NULL AND s.expires_at>now() AND s.absolute_expires_at>now() AND a.status='active')::int AS active_moderator_sessions`);
    return result.rows[0];
  }

  /** Recent owner and moderator actions for the global control-centre feed. */
  async function recentPlatformActivity({ limit = 8 } = {}) {
    const size = clampLimit(limit, 8, 25);
    const result = await db.query(
      `SELECT source, event_id, actor, actor_role, action, result, target_type, target_id,
              instance_id, room_code, occurred_at
         FROM (
           SELECT 'owner'::text AS source, event_id, actor, 'super_admin'::text AS actor_role,
                  action, 'recorded'::text AS result, target_type, target_id,
                  NULL::text AS instance_id, room_code, occurred_at
             FROM admin_audit
           UNION ALL
           SELECT 'platform'::text AS source, event_id, actor, actor_role, action, result,
                  NULL::text AS target_type, NULL::text AS target_id, instance_id, room_code, occurred_at
             FROM platform_audit
         ) activity
        ORDER BY occurred_at DESC, source, event_id DESC
        LIMIT $1`,
      [size]
    );
    return result.rows.map((row) => ({
      source: row.source,
      eventId: row.event_id,
      actor: row.actor,
      actorRole: row.actor_role,
      action: row.action,
      result: row.result,
      targetType: row.target_type,
      targetId: row.target_id,
      instanceId: row.instance_id,
      roomCode: row.room_code,
      occurredAt: row.occurred_at,
    }));
  }

  /** Open rooms grouped by lifecycle status (WAITING / RUNNING / PAUSED). */
  async function roomsByStatus() {
    const result = await db.query(
      `SELECT status, count(*)::int AS n
         FROM rooms WHERE closed_at IS NULL GROUP BY status ORDER BY status`
    );
    const grouped = { WAITING: 0, RUNNING: 0, PAUSED: 0, COMPLETED: 0 };
    for (const row of result.rows) grouped[row.status] = row.n;
    return grouped;
  }

  /**
   * Open rooms with durable facts. Socket-connected presence is a live fact the
   * route layer merges in from the registry; these counts come from the rows.
   */
  async function openRooms({ limit = 30, offset = 0 } = {}) {
    const size = clampLimit(limit, 30, 100);
    const start = clampOffset(offset);
    const result = await db.query(
      `SELECT r.room_code, r.status, r.game_number, r.created_at, r.updated_at,
              r.config, r.recovery_error,
              (SELECT count(*) FROM room_members m WHERE m.room_code = r.room_code AND m.left_at IS NULL)::int AS seated_players,
              (SELECT count(*) FROM room_members m WHERE m.room_code = r.room_code)::int AS total_players,
              (SELECT count(*) FROM draw_calls c WHERE c.room_code = r.room_code AND c.game_number = r.game_number)::int AS calls_this_round
         FROM rooms r
         WHERE r.closed_at IS NULL
         ORDER BY r.updated_at DESC
         LIMIT $1 OFFSET $2`,
      [size, start]
    );
    return result.rows.map(mapRoomSummary);
  }

  async function recentlyCompleted({ limit = 10 } = {}) {
    const size = clampLimit(limit, 10, 50);
    const result = await db.query(
      `SELECT g.room_code, g.game_number, g.status, g.started_at, g.completed_at, g.end_reason
         FROM games g
         WHERE g.status = 'COMPLETED'
         ORDER BY g.completed_at DESC NULLS LAST
         LIMIT $1`,
      [size]
    );
    return result.rows.map((row) => ({
      roomId: row.room_code,
      gameNumber: row.game_number,
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      endReason: row.end_reason,
    }));
  }

  async function recentWinners({ limit = 10 } = {}) {
    const size = clampLimit(limit, 10, 50);
    const result = await db.query(
      `SELECT a.room_code, a.game_number, a.pattern, a.points, a.awarded_at,
              a.player_id, p.display_name
         FROM awards a
         JOIN players p ON p.player_id = a.player_id
         ORDER BY a.awarded_at DESC
         LIMIT $1`,
      [size]
    );
    return result.rows.map((row) => ({
      roomId: row.room_code,
      gameNumber: row.game_number,
      pattern: row.pattern,
      points: row.points,
      playerId: row.player_id,
      displayName: row.display_name,
      awardedAt: row.awarded_at,
    }));
  }

  async function recentClaims({ limit = 10 } = {}) {
    const size = clampLimit(limit, 10, 50);
    const result = await db.query(
      `SELECT c.room_code, c.game_number, c.pattern, c.status, c.reason, c.decided_at, c.player_id, p.display_name
         FROM claims c
         JOIN players p ON p.player_id = c.player_id
         ORDER BY c.claim_id DESC
         LIMIT $1`,
      [size]
    );
    return result.rows.map((row) => ({
      roomId: row.room_code,
      gameNumber: row.game_number,
      pattern: row.pattern,
      status: row.status,
      reason: row.reason,
      playerId: row.player_id,
      displayName: row.display_name,
      decidedAt: row.decided_at,
    }));
  }

  /**
   * Searchable, paginated room list across the whole lifecycle. `state` filters
   * on the open/closed status, `q` matches the room code.
   */
  async function listRooms({ state = null, q = null, limit = 25, offset = 0 } = {}) {
    const size = clampLimit(limit, 25, 100);
    const start = clampOffset(offset);
    const params = [];
    const where = [];
    if (state === "open") where.push("r.closed_at IS NULL");
    else if (state === "closed") where.push("r.closed_at IS NOT NULL");
    else if (state && state !== "all") {
      params.push(String(state).toUpperCase());
      where.push(`r.status = $${params.length}`);
    }
    if (q) {
      params.push(`%${String(q).toLowerCase()}%`);
      where.push(`lower(r.room_code) LIKE $${params.length}`);
    }
    const clause = where.length ? "WHERE " + where.join(" AND ") : "";
    params.push(size, start);
    const result = await db.query(
      `SELECT r.room_code, r.status, r.game_number, r.created_at, r.updated_at, r.closed_at, r.config, r.recovery_error,
              (SELECT count(*) FROM room_members m WHERE m.room_code = r.room_code AND m.left_at IS NULL)::int AS seated_players,
              (SELECT count(*) FROM room_members m WHERE m.room_code = r.room_code)::int AS total_players,
              (SELECT count(*) FROM draw_calls c WHERE c.room_code = r.room_code AND c.game_number = r.game_number)::int AS calls_this_round
         FROM rooms r ${clause}
         ORDER BY r.updated_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const countParams = params.slice(0, params.length - 2);
    const counted = await db.query(`SELECT count(*)::int AS n FROM rooms r ${clause}`, countParams);
    return { rooms: result.rows.map(mapRoomSummary), total: counted.rows[0].n, limit: size, offset: start };
  }

  /** Full detail for one room. Never reads games.draw_sequence. */
  async function roomDetail(roomId) {
    const room = await db.query(
      `SELECT room_code, status, game_number, host_player_id, config, recovery_error, created_at, updated_at, closed_at
         FROM rooms WHERE room_code = $1`,
      [roomId]
    );
    if (!room.rows.length) return null;
    const row = room.rows[0];
    const currentGame = row.game_number || 0;

    const [members, tickets, called, claims, awards, rounds, audit] = await Promise.all([
      db.query(
        `SELECT m.player_id, m.role, m.connected, m.joined_at, m.last_seen_at, m.left_at, p.display_name
           FROM room_members m JOIN players p ON p.player_id = m.player_id
          WHERE m.room_code = $1 ORDER BY m.joined_at`,
        [roomId]
      ),
      db.query(
        `SELECT ticket_id, player_id, game_number, assigned_at FROM tickets WHERE room_code = $1 ORDER BY game_number, assigned_at`,
        [roomId]
      ),
      db.query(
        `SELECT call_index, number, source, called_at FROM draw_calls
          WHERE room_code = $1 AND game_number = $2 ORDER BY call_index`,
        [roomId, currentGame]
      ),
      db.query(
        `SELECT c.claim_id, c.game_number, c.player_id, c.pattern, c.status, c.reason, c.call_index, c.decided_at, p.display_name
           FROM claims c JOIN players p ON p.player_id = c.player_id
          WHERE c.room_code = $1 ORDER BY c.claim_id`,
        [roomId]
      ),
      db.query(
        `SELECT a.game_number, a.player_id, a.pattern, a.points, a.call_index, a.awarded_at, p.display_name
           FROM awards a JOIN players p ON p.player_id = a.player_id
          WHERE a.room_code = $1 ORDER BY a.award_id`,
        [roomId]
      ),
      db.query(
        `SELECT game_number, status, started_at, completed_at, end_reason FROM games WHERE room_code = $1 ORDER BY game_number`,
        [roomId]
      ),
      db.query(
        `SELECT event_id, type, player_id, detail, occurred_at FROM audit_events WHERE room_code = $1 ORDER BY event_id DESC LIMIT 100`,
        [roomId]
      ),
    ]);

    return {
      roomId: row.room_code,
      status: row.status,
      gameNumber: currentGame,
      hostPlayerId: row.host_player_id,
      config: row.config,
      recoveryError: row.recovery_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      closedAt: row.closed_at,
      calledNumbers: called.rows.map((c) => ({ index: c.call_index, number: c.number, source: c.source, at: c.called_at })),
      members: members.rows.map((m) => ({
        playerId: m.player_id,
        role: m.role,
        displayName: m.display_name,
        connected: m.connected,
        joinedAt: m.joined_at,
        lastSeenAt: m.last_seen_at,
        leftAt: m.left_at,
      })),
      tickets: tickets.rows.map((t) => ({ ticketId: t.ticket_id, playerId: t.player_id, gameNumber: t.game_number, assignedAt: t.assigned_at })),
      claims: claims.rows.map((c) => ({
        claimId: c.claim_id,
        gameNumber: c.game_number,
        playerId: c.player_id,
        displayName: c.display_name,
        pattern: c.pattern,
        status: c.status,
        reason: c.reason,
        callIndex: c.call_index,
        decidedAt: c.decided_at,
      })),
      awards: awards.rows.map((a) => ({
        gameNumber: a.game_number,
        playerId: a.player_id,
        displayName: a.display_name,
        pattern: a.pattern,
        points: a.points,
        callIndex: a.call_index,
        awardedAt: a.awarded_at,
      })),
      rounds: rounds.rows.map((g) => ({
        gameNumber: g.game_number,
        status: g.status,
        startedAt: g.started_at,
        completedAt: g.completed_at,
        endReason: g.end_reason,
      })),
      gameAudit: audit.rows.map((e) => ({
        eventId: e.event_id,
        type: e.type,
        playerId: e.player_id,
        detail: e.detail,
        occurredAt: e.occurred_at,
      })),
    };
  }

  /** Searchable, paginated player directory with per-player rollups. */
  async function listPlayers({ q = null, limit = 25, offset = 0 } = {}) {
    const size = clampLimit(limit, 25, 100);
    const start = clampOffset(offset);
    const params = [];
    let clause = "";
    if (q) {
      params.push(`%${String(q).toLowerCase()}%`);
      clause = `WHERE lower(p.display_name) LIKE $1 OR lower(p.player_id) LIKE $1`;
    }
    const result = await db.query(
      `SELECT p.player_id, p.display_name, p.created_at,
              (SELECT count(*) FROM room_members m WHERE m.player_id = p.player_id)::int AS room_count,
              (SELECT count(*) FROM awards a WHERE a.player_id = p.player_id)::int AS awards_won,
              (SELECT count(*) FROM claims c WHERE c.player_id = p.player_id AND c.status = 'REJECTED')::int AS rejected_claims
         FROM players p ${clause}
         ORDER BY p.created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, size, start]
    );
    const counted = await db.query(`SELECT count(*)::int AS n FROM players p ${clause}`, params);
    return {
      players: result.rows.map((row) => ({
        playerId: row.player_id,
        displayName: row.display_name,
        createdAt: row.created_at,
        roomCount: row.room_count,
        awardsWon: row.awards_won,
        rejectedClaims: row.rejected_claims,
      })),
      total: counted.rows[0].n,
      limit: size,
      offset: start,
    };
  }

  async function playerDetail(playerId) {
    const player = await db.query("SELECT player_id, display_name, created_at FROM players WHERE player_id = $1", [playerId]);
    if (!player.rows.length) return null;
    const [memberships, awards] = await Promise.all([
      db.query(
        `SELECT room_code, role, joined_at, left_at FROM room_members WHERE player_id = $1 ORDER BY joined_at DESC`,
        [playerId]
      ),
      db.query(`SELECT room_code, game_number, pattern, points, awarded_at FROM awards WHERE player_id = $1 ORDER BY awarded_at DESC`, [playerId]),
    ]);
    return {
      playerId: player.rows[0].player_id,
      displayName: player.rows[0].display_name,
      createdAt: player.rows[0].created_at,
      memberships: memberships.rows.map((m) => ({ roomId: m.room_code, role: m.role, joinedAt: m.joined_at, leftAt: m.left_at })),
      awards: awards.rows.map((a) => ({ roomId: a.room_code, gameNumber: a.game_number, pattern: a.pattern, points: a.points, awardedAt: a.awarded_at })),
    };
  }

  /**
   * Durable game history. Filters: state (open/closed/completed/...), room code,
   * and a creation date range. Paginated. Closing a room never removes rows, so
   * history stays queryable indefinitely.
   */
  async function history({ state = null, q = null, from = null, to = null, limit = 30, offset = 0 } = {}) {
    const size = clampLimit(limit, 30, 100);
    const start = clampOffset(offset);
    const params = [];
    const where = [];
    if (state === "closed") where.push("r.closed_at IS NOT NULL");
    else if (state === "open") where.push("r.closed_at IS NULL");
    else if (state && state !== "all") {
      params.push(String(state).toUpperCase());
      where.push(`r.status = $${params.length}`);
    }
    if (q) {
      params.push(`%${String(q).toLowerCase()}%`);
      where.push(`lower(r.room_code) LIKE $${params.length}`);
    }
    if (from) {
      params.push(new Date(from));
      where.push(`r.created_at >= $${params.length}`);
    }
    if (to) {
      params.push(new Date(to));
      where.push(`r.created_at <= $${params.length}`);
    }
    const clause = where.length ? "WHERE " + where.join(" AND ") : "";
    params.push(size, start);
    const result = await db.query(
      `SELECT r.room_code, r.status, r.game_number, r.created_at, r.updated_at, r.closed_at, r.config->>'name' AS game_name,
              (SELECT count(*) FROM games g WHERE g.room_code = r.room_code)::int AS rounds_played,
              (SELECT count(*) FROM room_members m WHERE m.room_code = r.room_code)::int AS participants,
              (SELECT count(*) FROM awards a WHERE a.room_code = r.room_code)::int AS awards
         FROM rooms r ${clause}
         ORDER BY r.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const countParams = params.slice(0, params.length - 2);
    const counted = await db.query(`SELECT count(*)::int AS n FROM rooms r ${clause}`, countParams);
    return {
      games: result.rows.map((row) => ({
        roomId: row.room_code,
        status: row.status,
        gameNumber: row.game_number,
        gameName: row.game_name || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        closedAt: row.closed_at,
        roundsPlayed: row.rounds_played,
        participants: row.participants,
        awards: row.awards,
      })),
      total: counted.rows[0].n,
      limit: size,
      offset: start,
    };
  }

  /**
   * A shaped probe, not a bare boolean: every caller (overview, settings,
   * /health) reads `.ok`, so an unshaped `true` would read as "down".
   */
  async function health() {
    const ok = await db.healthCheck();
    return { ok: ok === true, checkedAt: new Date().toISOString() };
  }

  /** Owner-only instance console, with every operational row scoped by persisted ownership. */
  async function instanceOverview(instanceId) {
    const identity = await db.query(`SELECT instance_id,slug,display_name,description,status,public_visible,config,branding,created_at,updated_at
      FROM game_instances WHERE instance_id=$1`, [instanceId]);
    if (!identity.rowCount) return null;
    const [counts, rooms, games, players, moderators, audit, databaseHealth] = await Promise.all([
      db.query(`SELECT
        count(DISTINCT r.room_code)::int AS rooms,
        count(DISTINCT r.room_code) FILTER (WHERE r.closed_at IS NULL)::int AS open_rooms,
        count(DISTINCT r.room_code) FILTER (WHERE r.status='RUNNING' AND r.closed_at IS NULL)::int AS running_rooms,
        count(DISTINCT g.room_code || ':' || g.game_number)::int AS games,
        count(DISTINCT m.player_id)::int AS participants,
        count(DISTINCT c.claim_id)::int AS claims,
        count(DISTINCT a.award_id)::int AS awards
        FROM rooms r LEFT JOIN games g USING(room_code)
        LEFT JOIN room_members m USING(room_code) LEFT JOIN claims c USING(room_code) LEFT JOIN awards a USING(room_code)
        WHERE r.game_instance_id=$1`, [instanceId]),
      db.query(`SELECT r.room_code,r.config->>'name' AS name,r.status,r.game_number,r.created_at,r.updated_at,r.closed_at,
        (SELECT count(*)::int FROM room_members m WHERE m.room_code=r.room_code AND m.left_at IS NULL) AS active_members
        FROM rooms r WHERE r.game_instance_id=$1 ORDER BY r.updated_at DESC LIMIT 20`, [instanceId]),
      db.query(`SELECT g.room_code,g.game_number,g.status,g.started_at,g.completed_at,g.end_reason,r.config->>'name' AS room_name,
        (SELECT count(*)::int FROM room_members m WHERE m.room_code=g.room_code) AS participants,
        (SELECT count(*)::int FROM awards a WHERE a.room_code=g.room_code AND a.game_number=g.game_number) AS awards
        FROM games g JOIN rooms r USING(room_code) WHERE r.game_instance_id=$1
        ORDER BY g.started_at DESC NULLS LAST,g.game_number DESC LIMIT 20`, [instanceId]),
      db.query(`SELECT p.player_id,p.display_name,max(m.joined_at) AS last_joined_at,
        count(DISTINCT r.room_code)::int AS room_count,count(DISTINCT a.award_id)::int AS awards,
        count(DISTINCT c.claim_id)::int AS claims
        FROM room_members m JOIN players p USING(player_id) JOIN rooms r USING(room_code)
        LEFT JOIN awards a ON a.room_code=r.room_code AND a.player_id=p.player_id
        LEFT JOIN claims c ON c.room_code=r.room_code AND c.player_id=p.player_id
        WHERE r.game_instance_id=$1 GROUP BY p.player_id,p.display_name
        ORDER BY max(m.joined_at) DESC,p.player_id LIMIT 20`, [instanceId]),
      db.query(`SELECT a.moderator_id,a.username,a.status,(a.totp_confirmed_at IS NOT NULL) AS mfa_enabled,
        g.permissions,g.granted_at,
        (SELECT count(*)::int FROM moderator_sessions s WHERE s.moderator_id=a.moderator_id AND s.revoked_at IS NULL
          AND s.expires_at>now() AND s.absolute_expires_at>now()) AS active_sessions
        FROM moderator_instance_grants g JOIN moderator_accounts a USING(moderator_id)
        WHERE g.instance_id=$1 AND g.revoked_at IS NULL ORDER BY a.username`, [instanceId]),
      db.query(`WITH scoped_rooms AS (SELECT room_code FROM rooms WHERE game_instance_id=$1), events AS (
        SELECT event_id::text AS event_id,actor,actor_role AS role,action,result,metadata,room_code,occurred_at,'platform'::text AS source
          FROM platform_audit WHERE instance_id=$1 OR room_code IN (SELECT room_code FROM scoped_rooms)
        UNION ALL
        SELECT event_id::text,actor,'super_admin'::text,action,'success'::text,metadata,room_code,occurred_at,'owner'::text
          FROM admin_audit WHERE (target_type='instance' AND target_id=$1) OR room_code IN (SELECT room_code FROM scoped_rooms)
      ) SELECT * FROM events ORDER BY occurred_at DESC,event_id DESC LIMIT 50`, [instanceId]),
      health(),
    ]);
    const row = identity.rows[0];
    return {
      instance: { instanceId: row.instance_id, slug: row.slug, displayName: row.display_name, description: row.description,
        status: row.status, publicVisible: row.public_visible, config: row.config, branding: row.branding, createdAt: row.created_at, updatedAt: row.updated_at },
      counts: counts.rows[0],
      rooms: rooms.rows.map((room) => ({ roomId: room.room_code, name: room.name, status: room.status, gameNumber: room.game_number,
        createdAt: room.created_at, updatedAt: room.updated_at, closedAt: room.closed_at, activeMembers: room.active_members })),
      games: games.rows.map((game) => ({ roomId: game.room_code, roomName: game.room_name, gameNumber: game.game_number, status: game.status,
        startedAt: game.started_at, completedAt: game.completed_at, endReason: game.end_reason, participants: game.participants, awards: game.awards })),
      players: players.rows.map((player) => ({ playerId: player.player_id, displayName: player.display_name, lastJoinedAt: player.last_joined_at,
        roomCount: player.room_count, awards: player.awards, claims: player.claims })),
      moderators: moderators.rows.map((mod) => ({ moderatorId: mod.moderator_id, username: mod.username, status: mod.status,
        mfaEnabled: mod.mfa_enabled, permissions: mod.permissions, grantedAt: mod.granted_at, activeSessions: mod.active_sessions })),
      audit: audit.rows.map((event) => ({ ...event, metadata: event.metadata || {} })),
      health: databaseHealth,
    };
  }

  /** Aggregate-only operational report, always grouped by persisted instance ownership. */
  async function instanceReport({ instanceId = null, from, to } = {}) {
    const params = [instanceId, from, to];
    const summary = await db.query(
      `WITH scope AS (
         SELECT instance_id, display_name FROM game_instances
          WHERE ($1::text IS NULL OR instance_id = $1)
       ), room_stats AS (
         SELECT r.game_instance_id AS instance_id, count(*)::int AS rooms,
                count(*) FILTER (WHERE r.closed_at IS NULL)::int AS open_rooms
           FROM rooms r JOIN scope s ON s.instance_id = r.game_instance_id
          WHERE r.created_at >= $2::date AND r.created_at < ($3::date + interval '1 day')
          GROUP BY r.game_instance_id
       ), game_stats AS (
         SELECT r.game_instance_id AS instance_id, count(*)::int AS rounds,
                count(*) FILTER (WHERE g.status='COMPLETED')::int AS completed_rounds
           FROM games g JOIN rooms r USING(room_code) JOIN scope s ON s.instance_id=r.game_instance_id
          WHERE g.started_at >= $2::date AND g.started_at < ($3::date + interval '1 day')
          GROUP BY r.game_instance_id
       ), player_stats AS (
         SELECT r.game_instance_id AS instance_id, count(DISTINCT m.player_id)::int AS players
           FROM room_members m JOIN rooms r USING(room_code) JOIN scope s ON s.instance_id=r.game_instance_id
          WHERE m.joined_at >= $2::date AND m.joined_at < ($3::date + interval '1 day')
          GROUP BY r.game_instance_id
       ), ticket_stats AS (
         SELECT r.game_instance_id AS instance_id, count(*)::int AS tickets
           FROM tickets t JOIN rooms r USING(room_code) JOIN scope s ON s.instance_id=r.game_instance_id
          WHERE t.assigned_at >= $2::date AND t.assigned_at < ($3::date + interval '1 day')
          GROUP BY r.game_instance_id
       ), claim_stats AS (
         SELECT r.game_instance_id AS instance_id,
                count(*) FILTER (WHERE c.status='AWARDED')::int AS valid_claims,
                count(*) FILTER (WHERE c.status='REJECTED')::int AS rejected_claims
           FROM claims c JOIN rooms r USING(room_code) JOIN scope s ON s.instance_id=r.game_instance_id
          WHERE c.decided_at >= $2::date AND c.decided_at < ($3::date + interval '1 day')
          GROUP BY r.game_instance_id
       ), award_stats AS (
         SELECT r.game_instance_id AS instance_id, count(*)::int AS awards
           FROM awards a JOIN rooms r USING(room_code) JOIN scope s ON s.instance_id=r.game_instance_id
          WHERE a.awarded_at >= $2::date AND a.awarded_at < ($3::date + interval '1 day')
          GROUP BY r.game_instance_id
       ), booking_stats AS (
         SELECT gs.instance_id,
                count(tr.reservation_id)::int AS reservations,
                count(tr.reservation_id) FILTER (WHERE tr.status='held')::int AS held,
                count(tr.reservation_id) FILTER (WHERE tr.status='confirmed')::int AS confirmed,
                count(tr.reservation_id) FILTER (WHERE tr.status='cancelled')::int AS cancelled,
                count(tr.reservation_id) FILTER (WHERE tr.status='expired')::int AS expired,
                COALESCE(sum(tr.ticket_count) FILTER (WHERE tr.status IN ('held','confirmed')),0)::int AS reserved_tickets
           FROM game_sessions gs JOIN scope s ON s.instance_id=gs.instance_id
           LEFT JOIN ticket_reservations tr ON tr.session_id=gs.session_id
             AND tr.created_at >= $2::date AND tr.created_at < ($3::date + interval '1 day')
          GROUP BY gs.instance_id
       )
       SELECT s.instance_id, s.display_name,
              COALESCE(r.rooms,0)::int AS rooms, COALESCE(r.open_rooms,0)::int AS open_rooms,
              COALESCE(g.rounds,0)::int AS rounds, COALESCE(g.completed_rounds,0)::int AS completed_rounds,
              COALESCE(p.players,0)::int AS players, COALESCE(t.tickets,0)::int AS tickets,
              COALESCE(c.valid_claims,0)::int AS valid_claims, COALESCE(c.rejected_claims,0)::int AS rejected_claims,
              COALESCE(a.awards,0)::int AS awards, COALESCE(b.reservations,0)::int AS reservations,
              COALESCE(b.held,0)::int AS held_reservations, COALESCE(b.confirmed,0)::int AS confirmed_reservations,
              COALESCE(b.cancelled,0)::int AS cancelled_reservations, COALESCE(b.expired,0)::int AS expired_reservations,
              COALESCE(b.reserved_tickets,0)::int AS reserved_tickets
         FROM scope s LEFT JOIN room_stats r USING(instance_id) LEFT JOIN game_stats g USING(instance_id)
         LEFT JOIN player_stats p USING(instance_id) LEFT JOIN ticket_stats t USING(instance_id)
         LEFT JOIN claim_stats c USING(instance_id) LEFT JOIN award_stats a USING(instance_id)
         LEFT JOIN booking_stats b USING(instance_id) ORDER BY s.display_name` , params);
    const daily = await db.query(
      `WITH scope AS (SELECT instance_id FROM game_instances WHERE ($1::text IS NULL OR instance_id=$1)), events AS (
         SELECT r.game_instance_id AS instance_id, r.created_at::date AS day, 'rooms'::text AS metric, count(*)::int AS value
           FROM rooms r JOIN scope s ON s.instance_id=r.game_instance_id WHERE r.created_at >= $2::date AND r.created_at < ($3::date+interval '1 day') GROUP BY 1,2
         UNION ALL SELECT r.game_instance_id, g.started_at::date, 'rounds', count(*)::int
           FROM games g JOIN rooms r USING(room_code) JOIN scope s ON s.instance_id=r.game_instance_id WHERE g.started_at >= $2::date AND g.started_at < ($3::date+interval '1 day') GROUP BY 1,2
         UNION ALL SELECT r.game_instance_id, m.joined_at::date, 'players', count(DISTINCT m.player_id)::int
           FROM room_members m JOIN rooms r USING(room_code) JOIN scope s ON s.instance_id=r.game_instance_id WHERE m.joined_at >= $2::date AND m.joined_at < ($3::date+interval '1 day') GROUP BY 1,2
         UNION ALL SELECT r.game_instance_id, a.awarded_at::date, 'awards', count(*)::int
           FROM awards a JOIN rooms r USING(room_code) JOIN scope s ON s.instance_id=r.game_instance_id WHERE a.awarded_at >= $2::date AND a.awarded_at < ($3::date+interval '1 day') GROUP BY 1,2
         UNION ALL SELECT gs.instance_id, tr.created_at::date, 'reservations', count(*)::int
           FROM ticket_reservations tr JOIN game_sessions gs USING(session_id) JOIN scope s ON s.instance_id=gs.instance_id WHERE tr.created_at >= $2::date AND tr.created_at < ($3::date+interval '1 day') GROUP BY 1,2
       ) SELECT to_char(day,'YYYY-MM-DD') AS day, instance_id, metric, sum(value)::int AS value FROM events GROUP BY day,instance_id,metric ORDER BY day,instance_id,metric`, params);
    return { instances: summary.rows, daily: daily.rows };
  }

  return { totals, platformCounts, recentPlatformActivity, roomsByStatus, openRooms, recentlyCompleted, recentWinners, recentClaims, listRooms, roomDetail, listPlayers, playerDetail, history, instanceReport, instanceOverview, health };
}

function mapRoomSummary(row) {
  return {
    roomId: row.room_code,
    status: row.status,
    gameNumber: row.game_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at || null,
    gameName: (row.config && row.config.name) || null,
    recoveryError: row.recovery_error,
    seatedPlayers: row.seated_players,
    totalPlayers: row.total_players,
    callsThisRound: row.calls_this_round,
  };
}
