-- Individually identified, durable ticket catalogs for newly opted-in sessions.
-- Existing count-only sessions are explicitly preserved in legacy mode.

ALTER TABLE game_sessions
  ADD COLUMN inventory_mode text NOT NULL DEFAULT 'legacy'
    CHECK (inventory_mode IN ('legacy','numbered')),
  ADD COLUMN inventory_state text NOT NULL DEFAULT 'legacy'
    CHECK (inventory_state IN ('legacy','not_generated','ready')),
  ADD COLUMN inventory_request_key text NULL,
  ADD CONSTRAINT game_sessions_instance_session_key UNIQUE(instance_id,session_id),
  ADD CONSTRAINT game_sessions_inventory_state_consistency CHECK (
    (inventory_mode='legacy' AND inventory_state='legacy' AND inventory_request_key IS NULL)
    OR (inventory_mode='numbered' AND inventory_state='not_generated' AND inventory_request_key IS NULL)
    OR (inventory_mode='numbered' AND inventory_state='ready' AND inventory_request_key IS NOT NULL)
  );

CREATE FUNCTION protect_ready_session_inventory() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.inventory_mode='numbered' AND NEW.inventory_mode IS DISTINCT FROM OLD.inventory_mode THEN
    RAISE EXCEPTION 'numbered inventory identity cannot be changed';
  END IF;
  IF OLD.inventory_state='ready' AND (NEW.inventory_state IS DISTINCT FROM OLD.inventory_state
      OR NEW.inventory_request_key IS DISTINCT FROM OLD.inventory_request_key) THEN
    RAISE EXCEPTION 'ready ticket inventory cannot be reset';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER game_sessions_inventory_guard BEFORE UPDATE OF inventory_mode,inventory_state,inventory_request_key ON game_sessions
  FOR EACH ROW EXECUTE FUNCTION protect_ready_session_inventory();

ALTER TABLE ticket_reservations
  ADD CONSTRAINT ticket_reservations_session_reservation_key UNIQUE(session_id,reservation_id);

CREATE TABLE ticket_inventory_batches (
  generation_batch_id uuid PRIMARY KEY,
  session_id uuid NOT NULL UNIQUE REFERENCES game_sessions(session_id) ON DELETE RESTRICT,
  instance_id text NOT NULL REFERENCES game_instances(instance_id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  requested_count integer NOT NULL CHECK (requested_count BETWEEN 1 AND 10000),
  generated_count integer NOT NULL CHECK (generated_count BETWEEN 0 AND requested_count),
  status text NOT NULL CHECK (status IN ('generating','ready')),
  generated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(session_id,idempotency_key),
  UNIQUE(instance_id,idempotency_key),
  UNIQUE(session_id,generation_batch_id),
  UNIQUE(instance_id,session_id,generation_batch_id),
  FOREIGN KEY(instance_id,session_id) REFERENCES game_sessions(instance_id,session_id) ON DELETE RESTRICT,
  CHECK ((status='ready' AND generated_count=requested_count AND completed_at IS NOT NULL)
      OR (status='generating' AND completed_at IS NULL))
);

CREATE TABLE session_tickets (
  ticket_id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES game_sessions(session_id) ON DELETE RESTRICT,
  generation_batch_id uuid NOT NULL REFERENCES ticket_inventory_batches(generation_batch_id) ON DELETE RESTRICT,
  serial_ordinal integer NOT NULL CHECK (serial_ordinal BETWEEN 1 AND 10000),
  serial text NOT NULL CHECK (length(serial) BETWEEN 1 AND 32),
  fingerprint text NOT NULL CHECK (length(fingerprint) BETWEEN 15 AND 225),
  grid jsonb NOT NULL CHECK (jsonb_typeof(grid)='array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id,ticket_id),
  UNIQUE(session_id,serial_ordinal),
  UNIQUE(session_id,serial),
  UNIQUE(session_id,fingerprint)
);
ALTER TABLE session_tickets
  ADD CONSTRAINT session_tickets_batch_session_fk FOREIGN KEY(session_id,generation_batch_id)
    REFERENCES ticket_inventory_batches(session_id,generation_batch_id) ON DELETE RESTRICT;
CREATE INDEX session_tickets_catalog_idx ON session_tickets(session_id,serial_ordinal);

CREATE FUNCTION guard_session_ticket_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  batch_status text;
  batch_count integer;
BEGIN
  SELECT status,requested_count INTO batch_status,batch_count FROM ticket_inventory_batches
   WHERE session_id=NEW.session_id AND generation_batch_id=NEW.generation_batch_id;
  IF batch_status IS DISTINCT FROM 'generating' OR NEW.serial_ordinal > batch_count THEN
    RAISE EXCEPTION 'ticket rows may only be inserted into an active generation batch';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER session_tickets_batch_guard BEFORE INSERT ON session_tickets
  FOR EACH ROW EXECUTE FUNCTION guard_session_ticket_insert();
CREATE FUNCTION reject_session_ticket_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'generated ticket identity and grid are immutable'; END; $$;
CREATE TRIGGER session_tickets_immutable BEFORE UPDATE OR DELETE ON session_tickets
  FOR EACH ROW EXECUTE FUNCTION reject_session_ticket_mutation();

CREATE TABLE ticket_reservation_items (
  allocation_id uuid PRIMARY KEY,
  session_id uuid NOT NULL,
  reservation_id uuid NOT NULL,
  ticket_id uuid NOT NULL,
  allocated_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  release_reason text CHECK (release_reason IS NULL OR release_reason IN ('cancelled','expired')),
  CHECK ((released_at IS NULL AND release_reason IS NULL) OR (released_at IS NOT NULL AND release_reason IS NOT NULL)),
  FOREIGN KEY(session_id,reservation_id) REFERENCES ticket_reservations(session_id,reservation_id) ON DELETE RESTRICT,
  FOREIGN KEY(session_id,ticket_id) REFERENCES session_tickets(session_id,ticket_id) ON DELETE RESTRICT,
  UNIQUE(reservation_id,ticket_id)
);
CREATE UNIQUE INDEX ticket_reservation_items_active_ticket_key
  ON ticket_reservation_items(ticket_id) WHERE released_at IS NULL;
CREATE INDEX ticket_reservation_items_reservation_idx ON ticket_reservation_items(reservation_id,allocated_at);

CREATE TABLE session_ticket_events (
  event_id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES game_sessions(session_id) ON DELETE RESTRICT,
  ticket_id uuid NULL,
  generation_batch_id uuid NULL,
  reservation_id uuid NULL,
  action text NOT NULL CHECK (action IN ('generated','reserved','confirmed','released','assigned','issued')),
  actor_type text NOT NULL CHECK (actor_type IN ('admin','super_admin','host','player','moderator','system')),
  actor_label text NOT NULL CHECK (length(actor_label) BETWEEN 1 AND 80),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE session_ticket_events
  ADD CONSTRAINT session_ticket_events_ticket_fk FOREIGN KEY(session_id,ticket_id)
    REFERENCES session_tickets(session_id,ticket_id) ON DELETE RESTRICT,
  ADD CONSTRAINT session_ticket_events_batch_fk FOREIGN KEY(session_id,generation_batch_id)
    REFERENCES ticket_inventory_batches(session_id,generation_batch_id) ON DELETE RESTRICT,
  ADD CONSTRAINT session_ticket_events_reservation_fk FOREIGN KEY(session_id,reservation_id)
    REFERENCES ticket_reservations(session_id,reservation_id) ON DELETE RESTRICT;
CREATE INDEX session_ticket_events_session_idx ON session_ticket_events(session_id,event_id);
CREATE FUNCTION reject_session_ticket_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'session ticket events are append-only'; END; $$;
CREATE TRIGGER session_ticket_events_immutable BEFORE UPDATE OR DELETE ON session_ticket_events
  FOR EACH ROW EXECUTE FUNCTION reject_session_ticket_event_mutation();

CREATE FUNCTION protect_ticket_reservation_item_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ticket reservation item history cannot be deleted'; END IF;
  IF NEW.allocation_id IS DISTINCT FROM OLD.allocation_id
     OR NEW.session_id IS DISTINCT FROM OLD.session_id
     OR NEW.reservation_id IS DISTINCT FROM OLD.reservation_id
     OR NEW.ticket_id IS DISTINCT FROM OLD.ticket_id
     OR NEW.allocated_at IS DISTINCT FROM OLD.allocated_at THEN
    RAISE EXCEPTION 'ticket reservation item identity is immutable';
  END IF;
  IF OLD.released_at IS NOT NULL OR NEW.released_at IS NULL OR NEW.release_reason IS NULL THEN
    RAISE EXCEPTION 'an allocation can only receive one release marker';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER ticket_reservation_items_history_guard BEFORE UPDATE OR DELETE ON ticket_reservation_items
  FOR EACH ROW EXECUTE FUNCTION protect_ticket_reservation_item_history();

CREATE FUNCTION reject_ticket_inventory_batch_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ticket inventory batch history cannot be deleted'; END IF;
  IF NEW.generation_batch_id IS DISTINCT FROM OLD.generation_batch_id OR NEW.session_id IS DISTINCT FROM OLD.session_id
     OR NEW.instance_id IS DISTINCT FROM OLD.instance_id OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.requested_count IS DISTINCT FROM OLD.requested_count
     OR NEW.generated_by IS DISTINCT FROM OLD.generated_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'ticket inventory batch identity is immutable';
  END IF;
  IF OLD.status='ready' OR NEW.status<>'ready' OR NEW.generated_count<>NEW.requested_count OR NEW.completed_at IS NULL THEN
    RAISE EXCEPTION 'a batch can only transition once from generating to ready';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER ticket_inventory_batches_history_guard BEFORE UPDATE OR DELETE ON ticket_inventory_batches
  FOR EACH ROW EXECUTE FUNCTION reject_ticket_inventory_batch_mutation();

CREATE FUNCTION guard_ticket_reservation_item_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  reservation_status text;
  reservation_expires timestamptz;
  inventory_status text;
BEGIN
  SELECT r.status,r.expires_at,s.inventory_state INTO reservation_status,reservation_expires,inventory_status
    FROM ticket_reservations r JOIN game_sessions s USING(session_id)
   WHERE r.session_id=NEW.session_id AND r.reservation_id=NEW.reservation_id;
  IF reservation_status IS DISTINCT FROM 'held' OR reservation_expires<=now() OR inventory_status IS DISTINCT FROM 'ready' THEN
    RAISE EXCEPTION 'ticket allocations require an active hold and ready inventory';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER ticket_reservation_items_insert_guard BEFORE INSERT ON ticket_reservation_items
  FOR EACH ROW EXECUTE FUNCTION guard_ticket_reservation_item_insert();

CREATE FUNCTION sync_ticket_reservation_inventory_events() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  reason text;
  change_action text;
BEGIN
  IF NEW.status IN ('cancelled','expired') AND NEW.status IS DISTINCT FROM OLD.status THEN
    reason := NEW.status;
    WITH released AS (
      UPDATE ticket_reservation_items SET released_at=now(),release_reason=reason
       WHERE session_id=NEW.session_id AND reservation_id=NEW.reservation_id AND released_at IS NULL
       RETURNING session_id,ticket_id,reservation_id
    )
    INSERT INTO session_ticket_events(session_id,ticket_id,reservation_id,action,actor_type,actor_label,metadata)
      SELECT session_id,ticket_id,reservation_id,'released','system','system',jsonb_build_object('reason',reason)
        FROM released;
  ELSIF NEW.status='confirmed' AND NEW.status IS DISTINCT FROM OLD.status THEN
    change_action := 'confirmed';
  ELSIF NEW.player_id IS NOT NULL AND OLD.player_id IS NULL AND NEW.status='confirmed' THEN
    change_action := 'assigned';
  END IF;
  IF change_action IS NOT NULL THEN
    INSERT INTO session_ticket_events(session_id,ticket_id,reservation_id,action,actor_type,actor_label)
      SELECT session_id,ticket_id,reservation_id,change_action,'system','system'
        FROM ticket_reservation_items WHERE session_id=NEW.session_id AND reservation_id=NEW.reservation_id AND released_at IS NULL;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER ticket_reservations_inventory_events AFTER UPDATE OF status,player_id ON ticket_reservations
  FOR EACH ROW EXECUTE FUNCTION sync_ticket_reservation_inventory_events();
