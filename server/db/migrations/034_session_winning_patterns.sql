-- Winning rules belong to a scheduled session. NULL preserves the legacy
-- room-config behavior for sessions that predate this migration.
ALTER TABLE game_sessions
  ADD COLUMN winning_patterns jsonb;

ALTER TABLE game_sessions
  ADD CONSTRAINT game_sessions_winning_patterns_object
  CHECK (winning_patterns IS NULL OR jsonb_typeof(winning_patterns) = 'object');
