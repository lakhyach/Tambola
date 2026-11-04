-- Give the two launch instances distinctive original marks while preserving any
-- branding an owner has already configured.
UPDATE game_instances
SET branding = jsonb_build_object(
  'logo','regular-mark.svg','icon','regular-mark.svg','tagline','The classic game-night hall',
  'accent','#42c98a','accentBright','#9cf0c5','accentDeep','#178354','coral','#ff7165'
) || branding
WHERE instance_id='regular';

UPDATE game_instances
SET branding = jsonb_build_object(
  'logo','bumper-mark.svg','icon','bumper-mark.svg','tagline','The big-match Tambola hall',
  'accent','#a99bff','accentBright','#d2caff','accentDeep','#7566d4','coral','#ff8b9b'
) || branding
WHERE instance_id='bumper';
