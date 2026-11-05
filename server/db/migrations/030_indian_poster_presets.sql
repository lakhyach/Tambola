-- Three original, reviewed poster compositions inspired by the supplied
-- Indian Tambola flyer references. Event copy remains SVG text, separate from
-- optional generated background artwork.
INSERT INTO poster_templates(template_id,name,description,category,status,created_by,approved_by,approved_at) VALUES
  ('bollywood-masala','Bollywood Masala','A dramatic Tambola night with marquee energy, glowing ticket motifs and a black, saffron and green palette.','bumper','approved','system','system',now()),
  ('royal-festive','Royal Festive','A polished blue and gold celebration with refined borders, festive light and clear event typography.','festive','approved','system','system',now()),
  ('desi-street-food','Desi Street Food','A vivid bazaar night with warm food-stall color, playful Tambola motifs and bold, readable event details.','celebration','approved','system','system',now());

INSERT INTO poster_template_versions(template_version_id,template_id,version,layout,palette,review_status,created_by,approved_by,approved_at) VALUES
  ('bollywood-masala-v1','bollywood-masala',1,'spotlight','{"background":"#070907","panel":"#153321","accent":"#f6da37","ink":"#f5ffed","detail":"#2fc178"}','approved','system','system',now()),
  ('royal-festive-v1','royal-festive',1,'festival','{"background":"#071e65","panel":"#102d88","accent":"#f1c83c","ink":"#fff8df","detail":"#80cdfd"}','approved','system','system',now()),
  ('desi-street-food-v1','desi-street-food',1,'spotlight','{"background":"#42004f","panel":"#6a076b","accent":"#ffdf32","ink":"#fff4dc","detail":"#ff5686"}','approved','system','system',now());

INSERT INTO poster_template_publications(template_version_id,source,actor) VALUES
  ('bollywood-masala-v1','seed','system'),
  ('royal-festive-v1','seed','system'),
  ('desi-street-food-v1','seed','system');
