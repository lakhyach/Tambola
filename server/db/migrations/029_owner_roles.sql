-- Explicitly separate non-elevated Owner accounts from platform Super Admins.
-- Existing accounts default to Owner; no existing identity is promoted.
ALTER TABLE owner_accounts
  ADD COLUMN role text NOT NULL DEFAULT 'owner'
    CHECK (role IN ('owner','super_admin'));

CREATE INDEX owner_accounts_role_idx ON owner_accounts(role, created_at);
