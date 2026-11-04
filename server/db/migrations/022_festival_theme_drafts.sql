-- Original named festival themes are introduced as review drafts only.
-- They do not enter the public library, daily schedule or active theme until
-- a platform owner reviews and approves both catalog and version records.
WITH additions(theme_id, name, description, category, source_theme, accent, deep_accent, coral) AS (
  VALUES
    ('diwali-celebration','Diwali Celebration','A diya-lit plum and saffron game night with warm paper tickets and bright called marks.','festive','marigold-festival','#f5a52f','#c96520','#f07861'),
    ('holi-colours','Holi Colours','A joyful colour-carnival package with vivid accents and clear ticket and number contrast.','celebration','cobalt-arcade','#ed58a2','#aa2778','#ff8b70'),
    ('durga-puja','Durga Puja','A vermilion and royal-gold celebration package with a calm, readable game board.','traditional','kesar-royale','#e96b48','#aa3f38','#f17e71'),
    ('navratri-garba','Navratri Garba','A mirrorwork-inspired jewel package with dandiya geometry and high-contrast called cells.','celebration','kesar-royale','#ed6284','#ae3155','#f18b79'),
    ('ganesh-chaturthi','Ganesh Chaturthi','A saffron-clay festival package with warm paper tickets and a clear 90-number board.','traditional','terracotta-house','#ed9d3b','#b85a24','#ec7667'),
    ('onam-pookalam','Onam Pookalam','A floral harvest palette with layered petal accents and readable ticket markings.','seasonal','monsoon-garden','#e7b94f','#b17c28','#f08a72'),
    ('pongal-harvest','Pongal Harvest','A sunlit harvest package with sugarcane motifs, warm gold and clear number states.','seasonal','terracotta-house','#eeb948','#ba7825','#ee855f'),
    ('eid-moonlight','Eid Moonlight','A tranquil moonlit package with jade and gold accents over a midnight game-night canvas.','celebration','midnight-indigo','#72c9b2','#328f85','#e987a0'),
    ('christmas-winter','Christmas Winter','An evergreen and candlelight package with crisp paper tickets and bright called marks.','seasonal','snowlight-minimal','#61bd83','#2c855f','#ec887b'),
    ('halloween-night','Halloween Night','A playful pumpkin-and-violet theme with readable boards and restrained spooky decoration.','seasonal','cobalt-arcade','#b287ef','#6850ae','#f18461'),
    ('new-year-celebration','New Year Celebration','A midnight fireworks package with luminous gold and cool jewel-blue highlights.','celebration','midnight-indigo','#6fb9ee','#407cae','#ed6f91'),
    ('wedding-celebration','Wedding Celebration','A rose-gold mandap package with refined plum surfaces and warm paper tickets.','special','paper-lantern','#e38ca5','#a95378','#f1848d'),
    ('indian-textile-heritage','Indian Textile Heritage','A woven-border package with indigo and saffron accents inspired by Indian textile geometry.','traditional','midnight-indigo','#e1a94b','#a7722c','#e87976')
), inserted_catalog AS (
  INSERT INTO theme_catalog(theme_id,name,description,category,status,created_by)
  SELECT theme_id,name,description,category,'draft','system' FROM additions
  RETURNING theme_id
)
INSERT INTO theme_versions(theme_version_id,theme_id,version,package,review_status,created_by)
SELECT additions.theme_id || '-v1', additions.theme_id, 1,
  jsonb_set(
    jsonb_set(
      jsonb_set(source.package, '{tokens,gold}', to_jsonb(additions.accent), true),
      '{tokens,goldDeep}', to_jsonb(additions.deep_accent), true
    ),
    '{tokens,coral}', to_jsonb(additions.coral), true
  ), 'draft', 'system'
FROM additions
JOIN inserted_catalog USING(theme_id)
JOIN theme_versions source ON source.theme_version_id=(additions.source_theme || '-v1');
