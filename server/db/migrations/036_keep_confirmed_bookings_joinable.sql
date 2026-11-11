-- Starting a scheduled room closes ticket sales, but confirmed players who
-- have not opened the room yet must retain their reservation and be allowed
-- to attach their seat to the running game. Unconfirmed holds are released.
CREATE OR REPLACE FUNCTION close_booking_session_with_room_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  reservation_row record;
  session_row record;
  close_reason text;
BEGIN
  IF OLD.status = 'WAITING' AND OLD.game_number = 0 AND OLD.closed_at IS NULL
     AND (NEW.game_number > 0 OR NEW.status IN ('RUNNING','PAUSED')) THEN
    close_reason := 'room-started';

    FOR reservation_row IN
      UPDATE ticket_reservations SET status='expired'
       WHERE session_id IN (SELECT session_id FROM game_sessions WHERE room_code=NEW.room_code)
         AND player_id IS NULL AND status='held' AND expires_at<=now()
       RETURNING reservation_id,session_id,ticket_count
    LOOP
      INSERT INTO ticket_reservation_audit(session_id,reservation_id,action,actor_type,actor_label,metadata)
        VALUES(reservation_row.session_id,reservation_row.reservation_id,'hold.expire','system','system',
          jsonb_build_object('ticketCount',reservation_row.ticket_count,'reason',close_reason));
    END LOOP;

    FOR reservation_row IN
      UPDATE ticket_reservations SET status='cancelled',cancelled_at=now()
       WHERE session_id IN (SELECT session_id FROM game_sessions WHERE room_code=NEW.room_code)
         AND player_id IS NULL AND status='held' AND expires_at>now()
       RETURNING reservation_id,session_id,ticket_count
    LOOP
      INSERT INTO ticket_reservation_audit(session_id,reservation_id,action,actor_type,actor_label,metadata)
        VALUES(reservation_row.session_id,reservation_row.reservation_id,'hold.cancel','system','system',
          jsonb_build_object('ticketCount',reservation_row.ticket_count,'reason',close_reason));
    END LOOP;

    -- Confirmed but unassigned players keep their seats. The public booking
    -- service independently closes sales as soon as the linked room starts.
    RETURN NEW;
  END IF;

  IF NEW.status = 'COMPLETED' OR NEW.closed_at IS NOT NULL THEN
    close_reason := CASE WHEN OLD.game_number > 0 OR OLD.status IN ('RUNNING','PAUSED')
      THEN 'room-completed' ELSE 'room-closed' END;

    FOR reservation_row IN
      UPDATE ticket_reservations SET status='expired'
       WHERE session_id IN (SELECT session_id FROM game_sessions WHERE room_code=NEW.room_code)
         AND player_id IS NULL AND status='held' AND expires_at<=now()
       RETURNING reservation_id,session_id,ticket_count
    LOOP
      INSERT INTO ticket_reservation_audit(session_id,reservation_id,action,actor_type,actor_label,metadata)
        VALUES(reservation_row.session_id,reservation_row.reservation_id,'hold.expire','system','system',
          jsonb_build_object('ticketCount',reservation_row.ticket_count,'reason',close_reason));
    END LOOP;

    FOR reservation_row IN
      UPDATE ticket_reservations SET status='cancelled',cancelled_at=now()
       WHERE session_id IN (SELECT session_id FROM game_sessions WHERE room_code=NEW.room_code)
         AND player_id IS NULL AND status IN ('confirmed','held')
       RETURNING reservation_id,session_id,ticket_count
    LOOP
      INSERT INTO ticket_reservation_audit(session_id,reservation_id,action,actor_type,actor_label,metadata)
        VALUES(reservation_row.session_id,reservation_row.reservation_id,'hold.cancel','system','system',
          jsonb_build_object('ticketCount',reservation_row.ticket_count,'reason',close_reason));
    END LOOP;

    FOR session_row IN
      UPDATE game_sessions SET status='completed',
            auto_start_state=CASE WHEN auto_start_enabled THEN 'completed' ELSE auto_start_state END,
            auto_start_claim_token=NULL,auto_start_claimed_until=NULL
        WHERE room_code=NEW.room_code AND status IN ('draft','open','paused')
        RETURNING session_id
    LOOP
      INSERT INTO ticket_reservation_audit(session_id,action,actor_type,actor_label,metadata)
        VALUES(session_row.session_id,'session.complete','system','system',jsonb_build_object('reason',close_reason));
    END LOOP;
  END IF;
  RETURN NEW;
END; $$;
