-- Preserve the event's declared local timezone so announcements and posters
-- can display the scheduled wall time without guessing from the host machine.
ALTER TABLE game_sessions
  ADD COLUMN time_zone text NOT NULL DEFAULT 'UTC'
    CHECK (length(trim(time_zone)) BETWEEN 1 AND 80);
