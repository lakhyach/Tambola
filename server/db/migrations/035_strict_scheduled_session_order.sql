-- New sessions must have a strictly ordered booking window and game start.
-- Preserve the historical rule for rows that already existed when this
-- migration ran; no legacy timestamps are rewritten.
ALTER TABLE game_sessions
  ADD COLUMN schedule_order_legacy boolean NOT NULL DEFAULT true;

ALTER TABLE game_sessions
  ADD CONSTRAINT game_sessions_strict_schedule_order
  CHECK (
    schedule_order_legacy
    OR (booking_opens_at < booking_closes_at AND booking_closes_at < starts_at)
  );

ALTER TABLE game_sessions
  ALTER COLUMN schedule_order_legacy SET DEFAULT false;
