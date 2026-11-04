-- Owner-mediated moderator recovery. Tokens are hashed and single-use.
CREATE TABLE moderator_recovery_tokens (
  recovery_id uuid PRIMARY KEY,
  moderator_id text NOT NULL REFERENCES moderator_accounts(moderator_id) ON DELETE RESTRICT,
  token_hash char(64) NOT NULL UNIQUE,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  CHECK (expires_at <= created_at + interval '1 hour')
);
CREATE INDEX moderator_recovery_live_idx ON moderator_recovery_tokens(moderator_id, expires_at)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;
