-- =====================================================================
-- Private owner control centre, migration 002.
--
-- Scope
--   A permanent owner identity that is SEPARATE from the game host. A host
--   session (migration 001 `sessions`) authorises one seat in one room and
--   grants nothing here. Nothing in this migration references or reuses that
--   table, so a room host can never become an operator by manipulating a
--   request: the roles live in different tables with different credentials.
--
-- Authority rules
--   1. There is exactly the owner accounts an operator bootstraps on purpose.
--      No public registration exists; opening /admin does not mint an owner.
--   2. No plaintext secret is stored. `password_hash` is a self-describing
--      scrypt digest (salt + params + hash); owner sessions store only the
--      SHA-256 of a server-issued token, mirroring the game session design.
--   3. `admin_audit` is the durable record of administrative actions. It never
--      holds a password, a raw token, or a session id. `room_code` is a plain
--      informational column (no foreign key) so global events such as a sign-in
--      can be recorded against a room that has already been purged.
--   4. History is durable: closing a room or removing a player never deletes a
--      game, a claim or an audit row.
--
-- This file is versioned and checksummed like 001 and must never be edited
-- after it has been applied (the runner refuses MIGRATION_DRIFT).
-- =====================================================================

-- --------------------------------------------------------- owner accounts
CREATE TABLE owner_accounts (
    owner_id           text PRIMARY KEY,
    -- normalised to lower case by the application; uniqueness is global
    username           text NOT NULL UNIQUE CHECK (char_length(username) BETWEEN 3 AND 40),
    -- "scrypt$N$r$p$<saltHex>$<hashHex>" - the algorithm is recorded so params
    -- can be rotated without a schema change
    password_hash      text NOT NULL CHECK (char_length(password_hash) BETWEEN 16 AND 512),
    password_algo      text NOT NULL DEFAULT 'scrypt',
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    password_updated_at timestamptz NOT NULL DEFAULT now(),
    last_login_at      timestamptz
);

-- --------------------------------------------------------- owner sessions
-- The browser holds a random token; this table holds only its SHA-256 hash.
-- A login always mints a brand-new session id (never a pre-login credential),
-- which is the session-fixation protection; logging out revokes the row so the
-- token stops working.
CREATE TABLE owner_sessions (
    session_id          text PRIMARY KEY,
    token_hash          char(64) NOT NULL UNIQUE,
    owner_id            text NOT NULL REFERENCES owner_accounts (owner_id) ON DELETE CASCADE,
    issued_at           timestamptz NOT NULL DEFAULT now(),
    last_used_at        timestamptz,
    -- sliding idle deadline, pushed forward on each successful use
    expires_at          timestamptz NOT NULL,
    -- hard ceiling that sliding use can never extend
    absolute_expires_at timestamptz NOT NULL,
    revoked_at          timestamptz,
    revoke_reason       text,
    -- non-secret context for the audit trail; a hash, never the raw value
    ip_hash             char(64)
);

CREATE INDEX owner_sessions_active_idx ON owner_sessions (owner_id) WHERE revoked_at IS NULL;
CREATE INDEX owner_sessions_expiry_idx ON owner_sessions (expires_at) WHERE revoked_at IS NULL;

-- ----------------------------------------------------------- admin audit
-- Actor / action / target / timestamp / safe metadata for every administrative
-- mutation and sign-in decision. Secrets are never written here.
CREATE TABLE admin_audit (
    event_id    bigserial PRIMARY KEY,
    actor       text,
    action      text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 60),
    target_type text,
    target_id   text,
    room_code   text,
    metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admin_audit_recent_idx ON admin_audit (event_id DESC);
CREATE INDEX admin_audit_room_idx ON admin_audit (room_code, event_id DESC);

CREATE TRIGGER owner_accounts_touch BEFORE UPDATE ON owner_accounts
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
