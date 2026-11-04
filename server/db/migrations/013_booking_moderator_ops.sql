-- Booking moderation is opt-in by explicit instance grant. Closing a bound room
-- also closes its booking session and releases all unassigned capacity.
ALTER TABLE ticket_reservation_audit DROP CONSTRAINT ticket_reservation_audit_actor_type_check;
ALTER TABLE ticket_reservation_audit ADD CONSTRAINT ticket_reservation_audit_actor_type_check
  CHECK (actor_type IN ('super_admin','moderator','player','system'));

ALTER TABLE moderator_instance_grants DROP CONSTRAINT moderator_instance_grants_permissions_check;
ALTER TABLE moderator_instance_grants ADD CONSTRAINT moderator_instance_grants_permissions_check
  CHECK (permissions <@ ARRAY['instance.read','instance.settings.update','room.create','room.read','room.start','room.pause','room.end','room.reset',
    'players.read','players.manage','history.read','tickets.manage','bookings.read','bookings.manage','reports.read']::text[]);

CREATE FUNCTION close_booking_session_with_room_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  reservation_row record;
  close_reason text;
BEGIN
  IF NEW.status = 'WAITING' AND NEW.game_number = 0 AND NEW.closed_at IS NULL THEN RETURN NEW; END IF;
  IF NOT (OLD.status = 'WAITING' AND OLD.game_number = 0 AND OLD.closed_at IS NULL) THEN RETURN NEW; END IF;
  close_reason := CASE WHEN NEW.game_number > 0 OR NEW.status IN ('RUNNING','PAUSED') THEN 'room-started' ELSE 'room-closed' END;

  FOR reservation_row IN
    UPDATE ticket_reservations SET status='expired'
     WHERE session_id IN (SELECT session_id FROM game_sessions WHERE room_code=NEW.room_code)
       AND player_id IS NULL AND status='held' AND expires_at<=now()
     RETURNING reservation_id,session_id,ticket_count
  LOOP
    INSERT INTO ticket_reservation_audit(session_id,reservation_id,action,actor_type,actor_label,metadata)
      VALUES(reservation_row.session_id,reservation_row.reservation_id,'hold.expire','system','system',jsonb_build_object('ticketCount',reservation_row.ticket_count,'reason',close_reason));
  END LOOP;

  FOR reservation_row IN
    UPDATE ticket_reservations SET status='cancelled',cancelled_at=now()
     WHERE session_id IN (SELECT session_id FROM game_sessions WHERE room_code=NEW.room_code)
       AND player_id IS NULL AND (status='confirmed' OR (status='held' AND expires_at>now()))
     RETURNING reservation_id,session_id,ticket_count
  LOOP
    INSERT INTO ticket_reservation_audit(session_id,reservation_id,action,actor_type,actor_label,metadata)
      VALUES(reservation_row.session_id,reservation_row.reservation_id,'hold.cancel','system','system',jsonb_build_object('ticketCount',reservation_row.ticket_count,'reason',close_reason));
  END LOOP;

  FOR reservation_row IN
    UPDATE game_sessions SET status='completed',updated_by='system'
     WHERE room_code=NEW.room_code AND status IN ('draft','open','paused')
     RETURNING session_id
  LOOP
    INSERT INTO ticket_reservation_audit(session_id,action,actor_type,actor_label,metadata)
      VALUES(reservation_row.session_id,'session.complete','system','system',jsonb_build_object('reason',close_reason));
  END LOOP;
  RETURN NEW;
END; $$;
CREATE TRIGGER room_lifecycle_closes_booking
  AFTER UPDATE OF status,game_number,closed_at ON rooms
  FOR EACH ROW EXECUTE FUNCTION close_booking_session_with_room_lifecycle();
