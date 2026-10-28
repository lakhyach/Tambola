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
        `SELECT player_id, game_number, assigned_at FROM tickets WHERE room_code = $1 ORDER BY game_number, assigned_at`,
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
      tickets: tickets.rows.map((t) => ({ playerId: t.player_id, gameNumber: t.game_number, assignedAt: t.assigned_at })),
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

  return { totals, roomsByStatus, openRooms, recentlyCompleted, recentWinners, recentClaims, listRooms, roomDetail, listPlayers, playerDetail, history, health };
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
