-- Reviewed, versioned theme packages. Theme packages contain design tokens
-- only; clients map a strict allow-list of values to CSS custom properties.
CREATE TABLE theme_catalog (
  theme_id text PRIMARY KEY CHECK (theme_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND length(theme_id) <= 48),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 80),
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 10 AND 500),
  category text NOT NULL CHECK (category IN ('classic','premium','festive','seasonal','celebration','minimal','modern','traditional','special')),
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

CREATE TABLE theme_versions (
  theme_version_id text PRIMARY KEY CHECK (length(theme_version_id) BETWEEN 8 AND 80),
  theme_id text NOT NULL REFERENCES theme_catalog(theme_id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version BETWEEN 1 AND 100000),
  package jsonb NOT NULL CHECK (jsonb_typeof(package) = 'object' AND package->>'schemaVersion' = '1'),
  review_status text NOT NULL DEFAULT 'draft' CHECK (review_status IN ('draft','approved')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by text,
  approved_at timestamptz,
  CHECK ((review_status = 'draft' AND approved_at IS NULL) OR (review_status = 'approved' AND approved_at IS NOT NULL)),
  UNIQUE (theme_id, version),
  UNIQUE (theme_version_id, theme_id)
);
CREATE INDEX theme_versions_theme_idx ON theme_versions(theme_id, version DESC);

CREATE FUNCTION reject_theme_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.theme_version_id IS DISTINCT FROM NEW.theme_version_id
    OR OLD.theme_id IS DISTINCT FROM NEW.theme_id OR OLD.version IS DISTINCT FROM NEW.version
    OR OLD.package IS DISTINCT FROM NEW.package OR OLD.created_by IS DISTINCT FROM NEW.created_by
    OR OLD.created_at IS DISTINCT FROM NEW.created_at OR OLD.review_status <> 'draft'
    OR NEW.review_status <> 'approved' OR NEW.approved_at IS NULL THEN
    RAISE EXCEPTION 'theme versions are immutable; create a new version';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER theme_version_immutable BEFORE UPDATE OR DELETE ON theme_versions
  FOR EACH ROW EXECUTE FUNCTION reject_theme_version_mutation();

CREATE TABLE platform_theme_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  active_version_id text REFERENCES theme_versions(theme_version_id) ON DELETE RESTRICT,
  previous_version_id text REFERENCES theme_versions(theme_version_id) ON DELETE RESTRICT,
  updated_by text NOT NULL DEFAULT 'system',
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform_theme_state(singleton) VALUES(true);

CREATE TABLE theme_publications (
  publication_id bigserial PRIMARY KEY,
  theme_version_id text NOT NULL REFERENCES theme_versions(theme_version_id) ON DELETE RESTRICT,
  source text NOT NULL CHECK (source IN ('seed','manual','daily','rollback')),
  actor text NOT NULL,
  release_date date,
  published_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((source = 'daily') = (release_date IS NOT NULL))
);
CREATE UNIQUE INDEX theme_daily_release_once_idx ON theme_publications(release_date) WHERE source='daily';
CREATE INDEX theme_publications_recent_idx ON theme_publications(published_at DESC, publication_id DESC);
CREATE FUNCTION reject_theme_publication_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'theme publication history is append-only'; END; $$;
CREATE TRIGGER theme_publication_immutable BEFORE UPDATE OR DELETE ON theme_publications
  FOR EACH ROW EXECUTE FUNCTION reject_theme_publication_mutation();

CREATE TABLE theme_release_schedule (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  time_zone text NOT NULL DEFAULT 'UTC' CHECK (length(time_zone) BETWEEN 1 AND 80),
  release_time time NOT NULL DEFAULT '09:00',
  rotation_version_ids text[] NOT NULL DEFAULT '{}',
  updated_by text NOT NULL DEFAULT 'system',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(rotation_version_ids) <= 60)
);
INSERT INTO theme_release_schedule(singleton) VALUES(true);

ALTER TABLE game_instances
  ADD COLUMN theme_mode text NOT NULL DEFAULT 'latest' CHECK (theme_mode IN ('latest','fixed','rotation')),
  ADD COLUMN theme_version_id text REFERENCES theme_versions(theme_version_id) ON DELETE RESTRICT;
ALTER TABLE game_instances ADD CONSTRAINT game_instances_theme_selection_check
  CHECK ((theme_mode = 'fixed') = (theme_version_id IS NOT NULL));

-- Three original, fully tokenised seed themes. They can be retired or extended
-- with immutable versions; release runs only ever select reviewed packages.
INSERT INTO theme_catalog(theme_id,name,description,category,status,created_by,approved_by,approved_at) VALUES
 ('obsidian-hall','Obsidian Hall','Evergreen game-night surfaces with mint controls, warm ivory tickets and clear called-number states.','classic','approved','system','system',now()),
 ('midnight-indigo','Midnight Indigo','A calm, high-contrast night palette with violet accents and crisp number-board contrast.','modern','approved','system','system',now()),
 ('marigold-festival','Marigold Festival','A celebratory saffron-and-plum palette with warm cards and distinct success and warning colors.','festive','approved','system','system',now());

INSERT INTO theme_versions(theme_version_id,theme_id,version,package,created_by) VALUES
 ('obsidian-hall-v1','obsidian-hall',1,'{"schemaVersion":1,"tokens":{"void":"#07110f","obsidian":"#0b1814","graphite":"#10231c","panel":"#153027","panelRaised":"#1b3a2f","inset":"#0c1d17","line":"#25483a","gold":"#42c98a","goldBright":"#9cf0c5","goldDeep":"#178354","coral":"#ff7165","silver":"#c6d8ce","silverDim":"#92aa9d","ivory":"#f3f6ef","text":"#e8f1eb","textMuted":"#b1c4b9","textFaint":"#9ab1a3","ok":"#6ee0a4","warn":"#f2c36b","danger":"#ff8177","info":"#86c6df","ticket":"#f4f0e4","ticketInk":"#19261f","board":"#153027","boardCalled":"#d7a94a","radius":"soft","displayFont":"serif","uiFont":"system","shadow":"deep"}}','system'),
 ('midnight-indigo-v1','midnight-indigo',1,'{"schemaVersion":1,"tokens":{"void":"#090b18","obsidian":"#101328","graphite":"#171c38","panel":"#20284a","panelRaised":"#2b355c","inset":"#111831","line":"#414d78","gold":"#a99bff","goldBright":"#d2caff","goldDeep":"#7566d4","coral":"#ff8b9b","silver":"#d6daf5","silverDim":"#a4acd1","ivory":"#f3f1ff","text":"#f0efff","textMuted":"#c0c3e2","textFaint":"#a8b0d4","ok":"#79e2bb","warn":"#ffd27a","danger":"#ff929e","info":"#8fd8ff","ticket":"#f7f4ff","ticketInk":"#24243c","board":"#1b2344","boardCalled":"#a99bff","radius":"soft","displayFont":"serif","uiFont":"system","shadow":"deep"}}','system'),
 ('marigold-festival-v1','marigold-festival',1,'{"schemaVersion":1,"tokens":{"void":"#17100d","obsidian":"#211714","graphite":"#35221b","panel":"#493027","panelRaised":"#5a3a2d","inset":"#281b16","line":"#765141","gold":"#f0b542","goldBright":"#ffe09a","goldDeep":"#c77d22","coral":"#f17e6b","silver":"#ead9c3","silverDim":"#c7ab8b","ivory":"#fff2da","text":"#fff2e4","textMuted":"#e4cdb5","textFaint":"#d5b99c","ok":"#9ee0a0","warn":"#ffd47d","danger":"#ff9a84","info":"#9bd8e8","ticket":"#fff0cc","ticketInk":"#3a251b","board":"#4b3023","boardCalled":"#f0b542","radius":"rounded","displayFont":"serif","uiFont":"system","shadow":"deep"}}','system');

UPDATE theme_versions SET review_status='approved',approved_by='system',approved_at=now();

INSERT INTO theme_publications(theme_version_id,source,actor) VALUES ('obsidian-hall-v1','seed','system');
UPDATE platform_theme_state SET active_version_id='obsidian-hall-v1',updated_by='system' WHERE singleton=true;
UPDATE theme_release_schedule SET rotation_version_ids=ARRAY['obsidian-hall-v1','midnight-indigo-v1','marigold-festival-v1'] WHERE singleton=true;
UPDATE rooms SET config=jsonb_set(config,'{themeVersionId}','"obsidian-hall-v1"'::jsonb,true)
  WHERE NOT (config ? 'themeVersionId');
