-- Link each issued game ticket to the exact numbered inventory allocation that
-- supplied its grid. Legacy generated tickets keep all identity columns NULL.
-- The inventory session and reservation are composite-scoped to the ticket.

ALTER TABLE ticket_reservation_items
  ADD CONSTRAINT ticket_reservation_items_session_reservation_ticket_key
    UNIQUE(session_id,reservation_id,ticket_id);

ALTER TABLE tickets
  ADD COLUMN inventory_session_id uuid NULL,
  ADD COLUMN inventory_reservation_id uuid NULL,
  ADD COLUMN inventory_ticket_id uuid NULL,
  ADD CONSTRAINT tickets_inventory_identity_pair_check CHECK (
    (inventory_session_id IS NULL AND inventory_reservation_id IS NULL AND inventory_ticket_id IS NULL)
    OR (inventory_session_id IS NOT NULL AND inventory_reservation_id IS NOT NULL AND inventory_ticket_id IS NOT NULL)
  ),
  ADD CONSTRAINT tickets_inventory_ticket_fk FOREIGN KEY(inventory_session_id,inventory_ticket_id)
    REFERENCES session_tickets(session_id,ticket_id) ON DELETE RESTRICT,
  ADD CONSTRAINT tickets_inventory_allocation_fk FOREIGN KEY(inventory_session_id,inventory_reservation_id,inventory_ticket_id)
    REFERENCES ticket_reservation_items(session_id,reservation_id,ticket_id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX tickets_room_game_inventory_ticket_key
  ON tickets(room_code,game_number,inventory_ticket_id) WHERE inventory_ticket_id IS NOT NULL;

CREATE FUNCTION validate_issued_inventory_ticket() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  session_room text;
  session_state text;
  reservation_status text;
  reservation_player text;
  reservation_room text;
  ticket_grid jsonb;
  released timestamptz;
BEGIN
  IF NEW.inventory_ticket_id IS NULL THEN RETURN NEW; END IF;

  SELECT s.room_code,s.inventory_state,r.status,r.player_id,r.room_code,st.grid,a.released_at
    INTO session_room,session_state,reservation_status,reservation_player,reservation_room,ticket_grid,released
    FROM session_tickets st
    JOIN game_sessions s ON s.session_id=st.session_id
    JOIN ticket_reservation_items a ON a.session_id=st.session_id AND a.ticket_id=st.ticket_id
      AND a.reservation_id=NEW.inventory_reservation_id
    JOIN ticket_reservations r ON r.session_id=a.session_id AND r.reservation_id=a.reservation_id
   WHERE st.session_id=NEW.inventory_session_id AND st.ticket_id=NEW.inventory_ticket_id;

  IF session_state IS DISTINCT FROM 'ready'
     OR session_room IS DISTINCT FROM NEW.room_code
     OR reservation_status IS DISTINCT FROM 'confirmed'
     OR reservation_player IS DISTINCT FROM NEW.player_id
     OR reservation_room IS DISTINCT FROM NEW.room_code
     OR released IS NOT NULL
     OR ticket_grid IS DISTINCT FROM NEW.grid THEN
    RAISE EXCEPTION 'issued game ticket does not match its active numbered inventory assignment';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER tickets_inventory_assignment_guard
  BEFORE INSERT OR UPDATE OF inventory_session_id,inventory_reservation_id,inventory_ticket_id,grid,player_id,room_code
  ON tickets FOR EACH ROW EXECUTE FUNCTION validate_issued_inventory_ticket();
