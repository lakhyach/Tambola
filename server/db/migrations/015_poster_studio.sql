-- Original, versioned poster templates and instance-bound poster documents.
CREATE TABLE poster_templates (
  template_id text PRIMARY KEY CHECK (template_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND length(template_id) <= 48),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 80),
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 10 AND 500),
  category text NOT NULL CHECK (category IN ('classic','premium','festive','celebration','seasonal','bumper','regular','special','minimal','traditional')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','retired')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by text,
  approved_at timestamptz,
  retired_by text,
  retired_at timestamptz,
  CHECK ((status = 'draft' AND approved_at IS NULL) OR (status <> 'draft' AND approved_at IS NOT NULL)),
  CHECK ((status = 'retired') = (retired_at IS NOT NULL))
);

CREATE TABLE poster_template_versions (
  template_version_id text PRIMARY KEY CHECK (length(template_version_id) BETWEEN 8 AND 100),
  template_id text NOT NULL REFERENCES poster_templates(template_id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version BETWEEN 1 AND 100000),
  layout text NOT NULL CHECK (layout IN ('classic','festival','spotlight','minimal')),
  palette jsonb NOT NULL CHECK (jsonb_typeof(palette)='object'),
  review_status text NOT NULL DEFAULT 'draft' CHECK (review_status IN ('draft','approved')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by text,
  approved_at timestamptz,
  CHECK ((review_status='draft' AND approved_at IS NULL) OR (review_status='approved' AND approved_at IS NOT NULL)),
  UNIQUE(template_id,version)
);

CREATE FUNCTION reject_poster_template_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.template_version_id IS DISTINCT FROM NEW.template_version_id
    OR OLD.template_id IS DISTINCT FROM NEW.template_id OR OLD.version IS DISTINCT FROM NEW.version
    OR OLD.layout IS DISTINCT FROM NEW.layout OR OLD.palette IS DISTINCT FROM NEW.palette
    OR OLD.created_by IS DISTINCT FROM NEW.created_by OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR OLD.review_status <> 'draft' OR NEW.review_status <> 'approved' OR NEW.approved_at IS NULL THEN
    RAISE EXCEPTION 'poster template versions are immutable; create a new version';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER poster_template_version_immutable BEFORE UPDATE OR DELETE ON poster_template_versions
  FOR EACH ROW EXECUTE FUNCTION reject_poster_template_version_mutation();

CREATE TABLE poster_template_publications (
  publication_id bigserial PRIMARY KEY,
  template_version_id text NOT NULL REFERENCES poster_template_versions(template_version_id) ON DELETE RESTRICT,
  source text NOT NULL CHECK (source IN ('seed','manual','daily','rollback')),
  actor text NOT NULL,
  release_date date,
  published_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((source='daily') = (release_date IS NOT NULL))
);
CREATE UNIQUE INDEX poster_template_daily_once ON poster_template_publications(release_date) WHERE source='daily';

CREATE TABLE poster_template_release_schedule (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  time_zone text NOT NULL DEFAULT 'UTC' CHECK (length(time_zone) BETWEEN 1 AND 80),
  release_time time NOT NULL DEFAULT '09:00',
  rotation_version_ids text[] NOT NULL DEFAULT '{}',
  updated_by text NOT NULL DEFAULT 'system',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(rotation_version_ids) <= 60)
);
INSERT INTO poster_template_release_schedule(singleton) VALUES(true);

CREATE TABLE posters (
  poster_id text PRIMARY KEY CHECK (length(poster_id) BETWEEN 16 AND 64),
  instance_id text NOT NULL REFERENCES game_instances(instance_id) ON DELETE RESTRICT,
  template_version_id text NOT NULL REFERENCES poster_template_versions(template_version_id) ON DELETE RESTRICT,
  data jsonb NOT NULL CHECK (jsonb_typeof(data)='object'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX posters_instance_recent_idx ON posters(instance_id, updated_at DESC);

CREATE TABLE poster_publications (
  publication_id bigserial PRIMARY KEY,
  poster_id text NOT NULL REFERENCES posters(poster_id) ON DELETE RESTRICT,
  instance_id text NOT NULL REFERENCES game_instances(instance_id) ON DELETE RESTRICT,
  instance_name text NOT NULL,
  instance_slug text NOT NULL,
  instance_branding jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(instance_branding)='object'),
  template_version_id text NOT NULL REFERENCES poster_template_versions(template_version_id) ON DELETE RESTRICT,
  data jsonb NOT NULL CHECK (jsonb_typeof(data)='object'),
  actor text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX poster_publications_instance_idx ON poster_publications(instance_id,published_at DESC);

INSERT INTO poster_templates(template_id,name,description,category,status,created_by,approved_by,approved_at) VALUES
 ('classic-ticket','Classic Ticket Night','Ticket-inspired layout with an elegant number-grid motif and a clear schedule block.','classic','approved','system','system',now()),
 ('festival-lanterns','Festival Lanterns','Warm festival composition with layered lantern shapes and bright event details.','festive','approved','system','system',now()),
 ('spotlight-bumper','Spotlight Bumper','High-energy spotlight composition built for a featured Bumper event.','bumper','approved','system','system',now()),
 ('quiet-modern','Quiet Modern','Minimal geometric layout with generous spacing for a clean regular game announcement.','minimal','approved','system','system',now());

INSERT INTO poster_template_versions(template_version_id,template_id,version,layout,palette,review_status,created_by,approved_by,approved_at) VALUES
 ('classic-ticket-v1','classic-ticket',1,'classic','{"background":"#07110f","panel":"#153027","accent":"#9cf0c5","ink":"#e8f1eb","detail":"#f3f6ef"}','approved','system','system',now()),
 ('festival-lanterns-v1','festival-lanterns',1,'festival','{"background":"#24100f","panel":"#552c28","accent":"#ffbf69","ink":"#fff4e5","detail":"#ff7185"}','approved','system','system',now()),
 ('spotlight-bumper-v1','spotlight-bumper',1,'spotlight','{"background":"#101126","panel":"#262b59","accent":"#d2caff","ink":"#f0efff","detail":"#ff8b9b"}','approved','system','system',now()),
 ('quiet-modern-v1','quiet-modern',1,'minimal','{"background":"#f4f0e8","panel":"#ffffff","accent":"#176c52","ink":"#18231f","detail":"#d7a94a"}','approved','system','system',now());

INSERT INTO poster_template_publications(template_version_id,source,actor) VALUES
 ('classic-ticket-v1','seed','system'),('festival-lanterns-v1','seed','system'),('spotlight-bumper-v1','seed','system'),('quiet-modern-v1','seed','system');
UPDATE poster_template_release_schedule SET rotation_version_ids=ARRAY['classic-ticket-v1','festival-lanterns-v1','spotlight-bumper-v1','quiet-modern-v1'] WHERE singleton=true;
