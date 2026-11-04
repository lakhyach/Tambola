-- A room's product ownership cannot move after the first game has started.
CREATE FUNCTION protect_room_instance_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.game_instance_id IS DISTINCT FROM OLD.game_instance_id AND
     (OLD.status <> 'WAITING' OR EXISTS (SELECT 1 FROM games g WHERE g.room_code = OLD.room_code)) THEN
    RAISE EXCEPTION 'a room with game activity cannot change instance';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER rooms_instance_owner_immutable BEFORE UPDATE OF game_instance_id ON rooms
  FOR EACH ROW EXECUTE FUNCTION protect_room_instance_owner();
