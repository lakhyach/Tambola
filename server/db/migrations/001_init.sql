-- =====================================================================
-- Tambola persistence schema, migration 001.
--
-- Scope
--   Durable game state for the server-authoritative engine: rooms, their
--   lifecycle, participants, tickets, the private draw plan, the official
--   call history, claims, awards, audit events, sessions and the per-room
--   calling schedule.
--
-- Authority rules (see server/DATABASE.md for the full contract)
--   1. The database is the source of truth. The engine's in-memory room is a
--      projection of these rows and may always be rebuilt from them.
--   2. Authoritative state is stored once. Anything derivable (a player's
--      points, a game's called count, a leaderboard) is computed by query,
--      never copied into a column that could disagree with its source.
--   3. The two columns that intentionally cache live runtime facts are
--      room_members.connected and room_members.last_seen_at. They describe a
--      socket, not a game; the game server is their only writer, they are
--      reset to false at boot, and no game rule reads them.
--   4. Nothing in here holds a plaintext secret. Sessions store a SHA-256
--      hash of a server-issued token; the host's authority is an identity
--      reference (rooms.host_player_id) plus an active host session row.
--   5. History is never destroyed. Leaving a room stamps left_at; closing a
--      room stamps closed_at. Only an explicit room purge cascades away data.
--
-- Migrations are versioned and immutable once applied; the runner in
-- server/db/migrate.js records a checksum and refuses a changed history.
-- =====================================================================

-- ---------------------------------------------------------------- players
-- A stable participant identity. The same person rejoining later, or in
-- another room, is the same player_id; the display name is only a label and
-- is deliberately not unique (uniqueness is enforced per room, per session,
-- in the application layer).
CREATE TABLE players (
    player_id    text PRIMARY KEY,
    display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 40),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------ rooms
CREATE TABLE rooms (
    room_code       text PRIMARY KEY,
    -- mirrors the engine's GameState; the engine enum is the definition
    status          text NOT NULL DEFAULT 'WAITING'
                    CHECK (status IN ('WAITING', 'RUNNING', 'PAUSED', 'COMPLETED')),
    -- the round currently in play. 0 until the first game starts. History of
    -- earlier rounds stays in games/tickets/awards/claims/draw_calls.
    game_number     integer NOT NULL DEFAULT 0 CHECK (game_number >= 0),
    host_player_id  text REFERENCES players (player_id) ON DELETE RESTRICT,
    -- game configuration: callIntervalMs, autoCall, maxPlayers,
    -- disconnectGraceMs, chatIntervalMs, maxChatLength, earlyFiveMaxCalls,
    -- patterns (id -> boolean), multipleWinnersPerPattern.
    config          jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- fail-closed marker. When non-null the room is frozen: the scheduler
    -- does not tick it and every intent is refused with RECOVERY_REQUIRED.
    recovery_error  text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    closed_at       timestamptz
);

CREATE INDEX rooms_open_status_idx ON rooms (status) WHERE closed_at IS NULL;

-- -------------------------------------------------------------- memberships
-- Player-to-room join. Soft removal: a seat that leaves keeps its row so the
-- tickets and awards it earned stay reachable through this foreign key.
CREATE TABLE room_members (
    room_code    text NOT NULL REFERENCES rooms (room_code) ON DELETE CASCADE,
    player_id    text NOT NULL REFERENCES players (player_id) ON DELETE RESTRICT,
    role         text NOT NULL DEFAULT 'player' CHECK (role IN ('host', 'player')),
    connected    boolean NOT NULL DEFAULT false,
    joined_at    timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    left_at      timestamptz,
    PRIMARY KEY (room_code, player_id)
);

CREATE INDEX room_members_active_idx ON room_members (room_code) WHERE left_at IS NULL;

-- ------------------------------------------------------------------ games
-- One row per round played in a room. Resetting a room starts a new game row
-- instead of wiping the previous one, so completed games keep their history.
CREATE TABLE games (
    room_code     text NOT NULL REFERENCES rooms (room_code) ON DELETE CASCADE,
    game_number   integer NOT NULL CHECK (game_number >= 1),
    status        text NOT NULL DEFAULT 'RUNNING'
                  CHECK (status IN ('RUNNING', 'COMPLETED')),
    -- the private plan: a permutation of 1..90 as a JSON array. Server-side
    -- only. It is never part of any client payload; clients receive numbers
    -- from draw_calls, one at a time, as they become official.
    draw_sequence jsonb NOT NULL CHECK (jsonb_typeof(draw_sequence) = 'array'),
    called_at     timestamptz,
    started_at    timestamptz NOT NULL DEFAULT now(),
    completed_at  timestamptz,
    end_reason    text,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (room_code, game_number)
);

CREATE INDEX games_open_idx ON games (room_code, game_number DESC) WHERE status = 'RUNNING';

-- ------------------------------------------------------------------ tickets
-- A ticket belongs to exactly one seat in exactly one round. The unique key
-- is what stops a reconnecting player from ever collecting a second ticket.
CREATE TABLE tickets (
    ticket_id   bigserial PRIMARY KEY,
    room_code   text NOT NULL,
    game_number integer NOT NULL,
    player_id   text NOT NULL,
    -- 3 rows x 9 columns, empty cells are JSON null
    grid        jsonb NOT NULL CHECK (jsonb_typeof(grid) = 'array'),
    assigned_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (room_code, game_number, player_id),
    FOREIGN KEY (room_code, game_number) REFERENCES games (room_code, game_number) ON DELETE CASCADE,
    FOREIGN KEY (room_code, player_id) REFERENCES room_members (room_code, player_id) ON DELETE RESTRICT
);

CREATE INDEX tickets_room_game_idx ON tickets (room_code, game_number);

-- -------------------------------------------------------------- draw_calls
-- The official call log: append-only, ordered, timestamped. call_index is the
-- position in the draw, so a duplicate call for the same tick is impossible
-- by primary key and a duplicate number is impossible by the second unique
-- key - even if two schedulers somehow both decide to act.
CREATE TABLE draw_calls (
    room_code   text NOT NULL,
    game_number integer NOT NULL,
    call_index  integer NOT NULL CHECK (call_index BETWEEN 1 AND 90),
    number      integer NOT NULL CHECK (number BETWEEN 1 AND 90),
    source      text NOT NULL CHECK (source IN ('host', 'scheduler', 'recovery')),
    called_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (room_code, game_number, call_index),
    UNIQUE (room_code, game_number, number),
    FOREIGN KEY (room_code, game_number) REFERENCES games (room_code, game_number) ON DELETE CASCADE
);

CREATE INDEX draw_calls_order_idx ON draw_calls (room_code, game_number, call_index);

-- ----------------------------------------------------------------- claims
-- Every claim decision, accepted or refused. This is the decision log players
-- and hosts dispute; awards is the outcome. Keeping both lets a rejected
-- claim stay auditable without implying anybody won.
CREATE TABLE claims (
    claim_id    bigserial PRIMARY KEY,
    room_code   text NOT NULL,
    game_number integer NOT NULL,
    player_id   text NOT NULL,
    pattern     text NOT NULL CHECK (char_length(pattern) BETWEEN 1 AND 40),
    status      text NOT NULL CHECK (status IN ('AWARDED', 'REJECTED')),
    reason      text,
    call_index  integer NOT NULL CHECK (call_index >= 0),
    decided_at  timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (room_code, game_number) REFERENCES games (room_code, game_number) ON DELETE CASCADE,
    FOREIGN KEY (room_code, player_id) REFERENCES room_members (room_code, player_id) ON DELETE RESTRICT
);

CREATE INDEX claims_room_game_idx ON claims (room_code, game_number, pattern);

-- ----------------------------------------------------------------- awards
-- The winners. winner_ordinal is 1 for the first winner of a pattern; the
-- partial unique index below makes "awarded twice" a database error for the
-- default one-winner-per-pattern rules, while still allowing a future
-- multiple-winners configuration to append ordinal 2, 3, ...
CREATE TABLE awards (
    award_id       bigserial PRIMARY KEY,
    room_code      text NOT NULL,
    game_number    integer NOT NULL,
    player_id      text NOT NULL,
    pattern        text NOT NULL CHECK (char_length(pattern) BETWEEN 1 AND 40),
    points         integer NOT NULL CHECK (points >= 0),
    call_index     integer NOT NULL CHECK (call_index >= 0),
    winner_ordinal integer NOT NULL DEFAULT 1 CHECK (winner_ordinal >= 1),
    awarded_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (room_code, game_number, pattern, player_id),
    FOREIGN KEY (room_code, game_number) REFERENCES games (room_code, game_number) ON DELETE CASCADE,
    FOREIGN KEY (room_code, player_id) REFERENCES room_members (room_code, player_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX awards_exclusive_pattern_idx
    ON awards (room_code, game_number, pattern)
    WHERE winner_ordinal = 1;

CREATE INDEX awards_room_game_idx ON awards (room_code, game_number, awarded_at);

-- ------------------------------------------------------------ audit_events
-- Durable game audit trail (the host's in-memory ring buffer is only a recent
-- view of this table).
CREATE TABLE audit_events (
    event_id    bigserial PRIMARY KEY,
    room_code   text NOT NULL REFERENCES rooms (room_code) ON DELETE CASCADE,
    game_number integer,
    player_id   text REFERENCES players (player_id) ON DELETE SET NULL,
    type        text NOT NULL CHECK (char_length(type) BETWEEN 1 AND 40),
    detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_room_idx ON audit_events (room_code, event_id DESC);

-- ---------------------------------------------------------------- sessions
-- Server-backed reconnection. The browser holds a 32-byte random token; this
-- table holds only its SHA-256 hash, so a database dump cannot be replayed as
-- a session.
CREATE TABLE sessions (
    session_id          text PRIMARY KEY,
    token_hash          char(64) NOT NULL UNIQUE,
    room_code           text NOT NULL REFERENCES rooms (room_code) ON DELETE CASCADE,
    player_id           text NOT NULL REFERENCES players (player_id) ON DELETE CASCADE,
    role                text NOT NULL CHECK (role IN ('host', 'player')),
    issued_at           timestamptz NOT NULL DEFAULT now(),
    last_used_at        timestamptz,
    -- sliding idle deadline, pushed forward on each successful use
    expires_at          timestamptz NOT NULL,
    -- hard ceiling that sliding use can never extend
    absolute_expires_at timestamptz NOT NULL,
    revoked_at          timestamptz,
    revoke_reason       text,
    -- rotation: a rotated session dies and points at its replacement
    rotated_at          timestamptz,
    rotated_to          text REFERENCES sessions (session_id) ON DELETE SET NULL,
    FOREIGN KEY (room_code, player_id) REFERENCES room_members (room_code, player_id) ON DELETE CASCADE
);

CREATE INDEX sessions_active_room_idx ON sessions (room_code) WHERE revoked_at IS NULL AND rotated_at IS NULL;
CREATE INDEX sessions_expiry_idx ON sessions (expires_at) WHERE revoked_at IS NULL;

-- ------------------------------------------------------------ room_schedule
-- One row per room: the durable calling clock. next_due_at lives in the
-- database so a restarted server continues the same cadence instead of
-- inventing a new one, and a tick can only be consumed once.
CREATE TABLE room_schedule (
    room_code   text PRIMARY KEY REFERENCES rooms (room_code) ON DELETE CASCADE,
    game_number integer NOT NULL,
    auto_call   boolean NOT NULL,
    interval_ms integer NOT NULL CHECK (interval_ms BETWEEN 500 AND 120000),
    tick        bigint NOT NULL DEFAULT 0,
    next_due_at timestamptz,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX room_schedule_due_idx ON room_schedule (next_due_at) WHERE auto_call;

-- ------------------------------------------------------------ instance_lease
-- Observability for the single-instance assumption. The real gate is the
-- advisory lock the server takes on boot (server/db/pool.js); this row shows
-- who currently believes it owns the game rooms.
CREATE TABLE instance_lease (
    lease_key    text PRIMARY KEY,
    holder       text NOT NULL,
    acquired_at  timestamptz NOT NULL DEFAULT now(),
    heartbeat_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------- trigger
-- updated_at is maintained by the database, so no application path can forget
-- it.
CREATE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER rooms_touch BEFORE UPDATE ON rooms
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER games_touch BEFORE UPDATE ON games
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER players_touch BEFORE UPDATE ON players
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER room_schedule_touch BEFORE UPDATE ON room_schedule
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
