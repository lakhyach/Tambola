-- Prompt-generated poster art remains private to the instance/owner until the
-- poster is explicitly published. Draft revisions preserve factual snapshots.
CREATE TABLE poster_artwork_assets (
  asset_id uuid PRIMARY KEY,
  instance_id text NOT NULL REFERENCES game_instances(instance_id) ON DELETE RESTRICT,
  session_id uuid NOT NULL REFERENCES game_sessions(session_id) ON DELETE RESTRICT,
  created_by text NOT NULL,
  provider text NOT NULL CHECK (provider='openai-images'),
  model text NOT NULL CHECK (length(model) BETWEEN 1 AND 100),
  prompt text NOT NULL CHECK (length(prompt) BETWEEN 12 AND 1200),
  content_type text NOT NULL CHECK (content_type='image/png'),
  image_bytes bytea NOT NULL CHECK (octet_length(image_bytes) BETWEEN 8 AND 10485760),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX poster_artwork_instance_recent_idx ON poster_artwork_assets(instance_id,created_at DESC);

CREATE TABLE poster_generation_limits (
  actor text PRIMARY KEY,
  next_allowed_at timestamptz NOT NULL
);

CREATE TABLE poster_revisions (
  poster_id text NOT NULL REFERENCES posters(poster_id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision BETWEEN 1 AND 100000),
  instance_id text NOT NULL REFERENCES game_instances(instance_id) ON DELETE RESTRICT,
  template_version_id text NOT NULL REFERENCES poster_template_versions(template_version_id) ON DELETE RESTRICT,
  data jsonb NOT NULL CHECK (jsonb_typeof(data)='object'),
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(poster_id,revision)
);
