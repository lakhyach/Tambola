-- =====================================================================
-- Production hardening, migration 003.
--
-- Scope
--   1. A second factor for the owner account (TOTP), with the shared
--      secret stored ENCRYPTED under a key that lives in the environment
--      (OWNER_MFA_KEY), never in the database and never in this table.
--   2. A short-lived, single-use "pre-authentication" challenge that a
--      correct password produces when MFA is enrolled. It is NOT a
--      session: it authorises exactly one TOTP check and nothing else.
--   3. A durable, shared attempt counter for the sign-in surface, so a
--      process restart or a second process cannot reset abuse protection.
--
-- Authority rules preserved from 001/002
--   * No plaintext password, TOTP secret, session token or challenge token
--     is stored: the secret is AES-256-GCM ciphertext, the challenge is a
--     SHA-256 hash, and the throttle keeps only a hash of its key.
--   * Nothing here creates an owner. Enrollment is an authenticated action
--     on an existing account; there is still no registration path.
--   * Deleting an owner cascades its challenges, sessions and secret with
--     it, so a removed account cannot leave a usable second factor behind.
--
-- Like 001 and 002 this file is versioned and checksummed: it must never be
-- edited after it has been applied (the runner refuses MIGRATION_DRIFT).
-- =====================================================================

-- ------------------------------------------------------------ second factor
-- totp_secret_enc    AES-256-GCM envelope, see server/admin/mfa.js.
--                    NULL means no enrollment has ever been started.
-- totp_confirmed_at  set only after the owner proves one valid code. While it
--                    is NULL an enrollment is pending and MFA is NOT required,
--                    so an interrupted enrollment can never lock the owner out.
-- totp_last_step     the last RFC 6238 time step accepted, so a code cannot be
--                    replayed inside its 30 s window.
ALTER TABLE owner_accounts ADD COLUMN totp_secret_enc   text;
ALTER TABLE owner_accounts ADD COLUMN totp_confirmed_at timestamptz;
ALTER TABLE owner_accounts ADD COLUMN totp_last_step    bigint;

ALTER TABLE owner_accounts
    ADD CONSTRAINT owner_accounts_totp_pair
    CHECK (totp_confirmed_at IS NULL OR totp_secret_enc IS NOT NULL);

ALTER TABLE owner_accounts
    ADD CONSTRAINT owner_accounts_totp_secret_bounds
    CHECK (totp_secret_enc IS NULL OR char_length(totp_secret_enc) BETWEEN 40 AND 512);

-- ------------------------------------------------------- pre-auth challenges
-- A password-only sign-in on an MFA-protected account returns a challenge
-- token. This row is what the second step trades for a real session. It
-- carries its own attempt budget and a short deadline, and it is consumed
-- exactly once, so a stolen challenge is useless after one failure-laden
-- window (or one success).
CREATE TABLE owner_mfa_challenges (
    challenge_id  text PRIMARY KEY,
    token_hash    char(64) NOT NULL UNIQUE,
    owner_id      text NOT NULL REFERENCES owner_accounts (owner_id) ON DELETE CASCADE,
    created_at    timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,
    consumed_at   timestamptz,
    attempts      int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    -- non-secret context, hashed like owner_sessions.ip_hash
    ip_hash       char(64)
);

CREATE INDEX owner_mfa_challenges_live_idx
    ON owner_mfa_challenges (expires_at) WHERE consumed_at IS NULL;
CREATE INDEX owner_mfa_challenges_owner_idx
    ON owner_mfa_challenges (owner_id) WHERE consumed_at IS NULL;

-- ------------------------------------------------------------ attempt counter
-- One row per (scope, hashed key). `scope` separates the independent budgets
-- (a username+IP pair, a bare IP, an authenticated session, ...). Attempts are
-- incremented inside a row lock, so two concurrent guesses cannot slip past the
-- limit, and the row survives restarts and is shared by any process that can
-- reach this database.
CREATE TABLE auth_throttle (
    scope             text NOT NULL CHECK (char_length(scope) BETWEEN 3 AND 40),
    key_hash          char(32) NOT NULL,
    failures          int NOT NULL DEFAULT 0 CHECK (failures >= 0),
    strikes           int NOT NULL DEFAULT 0 CHECK (strikes >= 0),
    window_started_at timestamptz NOT NULL DEFAULT now(),
    locked_until      timestamptz,
    last_failure_at   timestamptz,
    PRIMARY KEY (scope, key_hash)
);

-- Sweeping expired rows stays a small, indexed delete.
CREATE INDEX auth_throttle_decay_idx ON auth_throttle (window_started_at);

-- ---------------------------------------------------- audit read performance
-- Room audit is read newest-first and limited; 002 already indexed admin_audit
-- by room. Presence events are coalesced in the controller (see
-- STORE_AUDITED_EVENTS / PRESENCE_EVENTS) so this index is not flooded by
-- reconnect churn, but keep the player view cheap as well.
CREATE INDEX IF NOT EXISTS audit_events_player_idx
    ON audit_events (room_code, player_id, event_id DESC);
