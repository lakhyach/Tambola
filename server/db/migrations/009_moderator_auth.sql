-- Moderator authentication is a separate principal and credential namespace.
ALTER TABLE moderator_accounts DROP CONSTRAINT moderator_accounts_status_check;
ALTER TABLE moderator_accounts ADD CONSTRAINT moderator_accounts_status_check CHECK (status IN ('invited','active','suspended'));
ALTER TABLE moderator_accounts ADD COLUMN totp_last_step bigint;

CREATE TABLE moderator_sessions (
  session_id uuid PRIMARY KEY,
  moderator_id text NOT NULL REFERENCES moderator_accounts(moderator_id) ON DELETE RESTRICT,
  token_hash char(64) NOT NULL UNIQUE,
  issued_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoke_reason text,
  CHECK (expires_at <= absolute_expires_at)
);
CREATE INDEX moderator_sessions_active_idx ON moderator_sessions(moderator_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE moderator_invites (
  invite_id uuid PRIMARY KEY,
  moderator_id text NOT NULL REFERENCES moderator_accounts(moderator_id) ON DELETE RESTRICT,
  token_hash char(64) NOT NULL UNIQUE,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX moderator_invites_live_idx ON moderator_invites(expires_at) WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE TABLE moderator_mfa_challenges (
  challenge_id uuid PRIMARY KEY,
  moderator_id text NOT NULL REFERENCES moderator_accounts(moderator_id) ON DELETE RESTRICT,
  token_hash char(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  consumed_at timestamptz,
  ip_hash char(24),
  CHECK (expires_at <= created_at + interval '10 minutes')
);
CREATE TABLE moderator_socket_tickets (
  ticket_id uuid PRIMARY KEY,
  moderator_session_id uuid NOT NULL REFERENCES moderator_sessions(session_id) ON DELETE RESTRICT,
  token_hash char(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at <= created_at + interval '2 minutes')
);
