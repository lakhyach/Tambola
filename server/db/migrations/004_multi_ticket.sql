-- =====================================================================
-- Multiple tickets per player, migration 004.
--
-- Why
--   Phase 13 lets a player hold more than one ticket in a game. The 001
--   schema keyed tickets as UNIQUE (room_code, game_number, player_id) - one
--   grid per seat per round - so a second ticket for the same player collided.
--   This migration makes a seat able to own several distinct, numbered tickets
--   without touching any existing row.
--
-- Additive and non-destructive
--   * ticket_no is added with a default of 1, so every already-stored single
--     ticket keeps its identity as seat ticket #1. No grid is rewritten.
--   * The old one-ticket-per-seat uniqueness is replaced by one-per-number:
--     UNIQUE (room_code, game_number, player_id, ticket_no). Existing rows all
--     have ticket_no = 1, so the previous guarantee (a reconnect cannot mint a
--     duplicate #1) is preserved exactly.
--   * room_members.ticket_count records the seat's chosen ticket count while
--     the room is WAITING, so a player's selection survives a refresh or a
--     server restart before the round begins. Default 1 = today's behaviour.
--
-- Like 001/002/003 this file is versioned and checksummed and must never be
-- edited after it has been applied (the runner refuses MIGRATION_DRIFT).
-- =====================================================================

-- ---------------------------------------------------------------- tickets
ALTER TABLE tickets
    ADD COLUMN ticket_no integer NOT NULL DEFAULT 1 CHECK (ticket_no >= 1);

-- Replace UNIQUE (room_code, game_number, player_id) with the per-number key.
-- Drop by name if present; the DO block keeps this safe to re-run in an
-- environment where the constraint was auto-named differently. The scan is
-- pinned to the exact table `ALTER TABLE tickets` will resolve to (via
-- to_regclass on the current search_path) because pg_constraint is global -
-- without this, a same-named constraint on a tickets table in ANY other schema
-- would appear in the loop and the second DROP would fail with 42704.
DO $$
DECLARE
    drop_rec RECORD;
BEGIN
    FOR drop_rec IN
        SELECT c.conname::text AS name
          FROM pg_constraint c
         WHERE c.conrelid = to_regclass('tickets')
           AND c.contype = 'u'
    LOOP
        EXECUTE format('ALTER TABLE tickets DROP CONSTRAINT %I', drop_rec.name);
    END LOOP;
END $$;

ALTER TABLE tickets
    ADD CONSTRAINT tickets_room_game_player_no_key
    UNIQUE (room_code, game_number, player_id, ticket_no);

-- The UNIQUE constraint above already provides the (room, game, player, no)
-- lookup index, so no extra index is added here.

-- ------------------------------------------------------------ seat choice
-- The number of tickets a seat wants for the next round, chosen while the room
-- is WAITING. Clamped to the same bounds the engine enforces server-side.
ALTER TABLE room_members
    ADD COLUMN ticket_count integer NOT NULL DEFAULT 1
        CHECK (ticket_count BETWEEN 1 AND 12);
