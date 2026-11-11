-- Durable, explicit automatic starts for published scheduled sessions.
-- Existing sessions remain host controlled because the new flag defaults off.

ALTER TABLE game_sessions
  ADD COLUMN auto_start_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN auto_start_state text NOT NULL DEFAULT 'disabled'
    CHECK (auto_start_state IN ('disabled','scheduled','starting','waiting','started','failed','completed','cancelled')),
  ADD COLUMN auto_start_claim_token uuid,
  ADD COLUMN auto_start_claimed_until timestamptz,
  ADD COLUMN auto_start_retry_at timestamptz,
  ADD COLUMN auto_start_attempts integer NOT NULL DEFAULT 0 CHECK (auto_start_attempts >= 0),
  ADD COLUMN auto_start_error text,
  ADD COLUMN auto_started_at timestamptz,
  ADD CONSTRAINT game_sessions_auto_start_claim_pair
    CHECK ((auto_start_claim_token IS NULL) = (auto_start_claimed_until IS NULL)),
  ADD CONSTRAINT game_sessions_auto_start_state_consistency
    CHECK (auto_start_enabled OR auto_start_state = 'disabled');

CREATE INDEX game_sessions_auto_start_due_idx
  ON game_sessions (starts_at, session_id)
  WHERE auto_start_enabled AND status = 'open'
    AND auto_start_state IN ('scheduled','starting','waiting');

ALTER TABLE games
  ADD COLUMN start_source text NOT NULL DEFAULT 'host'
    CHECK (start_source IN ('host','scheduled')),
  ADD COLUMN scheduled_for timestamptz,
  ADD CONSTRAINT games_scheduled_start_source_pair
    CHECK ((start_source = 'scheduled') = (scheduled_for IS NOT NULL));

-- Keep scheduled starts visible in the same append-only room audit as other
-- authoritative lifecycle transitions. started_at remains the actual time.
