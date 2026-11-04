-- Durable platform boundary. Existing rooms are mapped to a named legacy
-- instance because their original product identity cannot be proven.
CREATE TABLE game_instances (
  instance_id text PRIMARY KEY,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND length(slug) <= 48),
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 80),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
  public_visible boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  branding jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(branding) = 'object'),
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER game_instances_touch BEFORE UPDATE ON game_instances
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

INSERT INTO game_instances (instance_id, slug, display_name, description, status, public_visible)
VALUES
 ('legacy', 'legacy', 'Legacy rooms', 'Historical rooms created before instance ownership was available.', 'archived', false),
 ('regular', 'regular', 'Regular Tambola', 'Free to play Tambola.', 'active', true),
 ('bumper', 'bumper', 'Bumper Tambola', 'Free to play Bumper Tambola.', 'active', true)
ON CONFLICT (instance_id) DO NOTHING;

ALTER TABLE rooms ADD COLUMN game_instance_id text;
UPDATE rooms SET game_instance_id = 'legacy' WHERE game_instance_id IS NULL;
ALTER TABLE rooms ALTER COLUMN game_instance_id SET NOT NULL;
ALTER TABLE rooms ADD CONSTRAINT rooms_game_instance_fk
  FOREIGN KEY (game_instance_id) REFERENCES game_instances(instance_id) ON DELETE RESTRICT;
CREATE INDEX rooms_instance_status_idx ON rooms (game_instance_id, status, updated_at DESC);

CREATE TABLE moderator_accounts (
  moderator_id text PRIMARY KEY,
  username text NOT NULL UNIQUE CHECK (username = lower(username) AND length(username) BETWEEN 3 AND 40),
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  totp_secret_enc text,
  totp_confirmed_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (totp_confirmed_at IS NULL OR totp_secret_enc IS NOT NULL)
);
CREATE TRIGGER moderator_accounts_touch BEFORE UPDATE ON moderator_accounts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE moderator_instance_grants (
  moderator_id text NOT NULL REFERENCES moderator_accounts(moderator_id) ON DELETE RESTRICT,
  instance_id text NOT NULL REFERENCES game_instances(instance_id) ON DELETE RESTRICT,
  permissions text[] NOT NULL DEFAULT '{}',
  granted_by text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by text,
  PRIMARY KEY (moderator_id, instance_id),
  CHECK (permissions <@ ARRAY['instance.read','instance.settings.update','room.create','room.read','room.start','room.pause','room.end','room.reset','players.read','players.manage','history.read','tickets.manage','reports.read']::text[])
);
CREATE INDEX moderator_grants_instance_idx ON moderator_instance_grants(instance_id) WHERE revoked_at IS NULL;

CREATE TABLE platform_audit (
  event_id bigserial PRIMARY KEY,
  actor text NOT NULL,
  actor_role text NOT NULL CHECK (actor_role IN ('super_admin','moderator','system')),
  instance_id text REFERENCES game_instances(instance_id) ON DELETE RESTRICT,
  room_code text REFERENCES rooms(room_code) ON DELETE RESTRICT,
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
  result text NOT NULL CHECK (result IN ('success','failure')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  request_id text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_audit_recent_idx ON platform_audit(occurred_at DESC, event_id DESC);
CREATE INDEX platform_audit_instance_idx ON platform_audit(instance_id, occurred_at DESC);
CREATE FUNCTION reject_platform_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'platform_audit is append-only'; END; $$;
CREATE TRIGGER platform_audit_immutable BEFORE UPDATE OR DELETE ON platform_audit
  FOR EACH ROW EXECUTE FUNCTION reject_platform_audit_mutation();

CREATE TABLE platform_settings (
  setting_key text PRIMARY KEY CHECK (setting_key IN ('branding')),
  value jsonb NOT NULL CHECK (jsonb_typeof(value) = 'object'),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
