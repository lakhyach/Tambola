-- Compatibility for direct historical/admin SQL inserts that predate the
-- instance-aware room creation path. Application routes set the selected ID.
ALTER TABLE rooms ALTER COLUMN game_instance_id SET DEFAULT 'legacy';
