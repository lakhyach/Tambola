-- Host-authorized, single-use owner MFA replacement. Only token hashes and
-- encrypted pending TOTP material are stored; old factor remains on owner row
-- until confirmation succeeds.
CREATE TABLE owner_mfa_recovery_authorizations (
  authorization_id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES owner_accounts(owner_id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owner_mfa_recovery_authorization_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$')
);
CREATE INDEX owner_mfa_recovery_authorization_expiry_idx
  ON owner_mfa_recovery_authorizations(expires_at);
CREATE UNIQUE INDEX owner_mfa_recovery_one_authorization_idx
  ON owner_mfa_recovery_authorizations(owner_id) WHERE consumed_at IS NULL;

CREATE TABLE owner_mfa_recovery_flows (
  flow_id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES owner_accounts(owner_id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  pending_secret_enc text,
  qr_revealed_at timestamptz,
  attempts int NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owner_mfa_recovery_flow_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT owner_mfa_recovery_pending_secret_bounds CHECK (pending_secret_enc IS NULL OR char_length(pending_secret_enc) BETWEEN 40 AND 512)
);
CREATE INDEX owner_mfa_recovery_flow_expiry_idx
  ON owner_mfa_recovery_flows(expires_at);
CREATE UNIQUE INDEX owner_mfa_recovery_one_flow_idx
  ON owner_mfa_recovery_flows(owner_id);

CREATE TABLE owner_mfa_recovery_codes (
  owner_id text NOT NULL REFERENCES owner_accounts(owner_id) ON DELETE CASCADE,
  code_hash char(64) NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz,
  PRIMARY KEY(owner_id, code_hash)
);
CREATE INDEX owner_mfa_recovery_codes_live_idx
  ON owner_mfa_recovery_codes(owner_id) WHERE used_at IS NULL;

-- Recovery tables contain authentication material. Keep Data API roles out and
-- enable deny-by-default RLS as defense in depth; the app reads them only from
-- its owning backend role, never through PostgREST.
ALTER TABLE owner_mfa_recovery_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_mfa_recovery_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE owner_mfa_recovery_authorizations, owner_mfa_recovery_flows, owner_mfa_recovery_codes FROM PUBLIC;

DO $$
DECLARE
  api_role text;
BEGIN
  -- service_role commonly bypasses RLS in Supabase; it must not inherit access
  -- to owner-recovery material either. The app connects directly as postgres.
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE owner_mfa_recovery_authorizations, owner_mfa_recovery_flows, owner_mfa_recovery_codes FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
