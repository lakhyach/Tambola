-- Make owner session creation safe to retry after a lost HTTP response.
-- Null keys preserve compatibility for sessions created through older clients.
ALTER TABLE game_sessions
  ADD COLUMN create_idempotency_key text,
  ADD COLUMN create_request_fingerprint text;

ALTER TABLE game_sessions
  ADD CONSTRAINT game_sessions_create_idempotency_pair_check
  CHECK ((create_idempotency_key IS NULL) = (create_request_fingerprint IS NULL));

CREATE UNIQUE INDEX game_sessions_create_idempotency_unique
  ON game_sessions(instance_id, create_idempotency_key)
  WHERE create_idempotency_key IS NOT NULL;
