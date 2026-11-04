-- Instance-owned scheduled sessions and non-monetary ticket-count bookings.
-- Holds are short, hashed-token reservations; only generated ticket COUNT is
-- reserved here. The live game remains the source of all official ticket grids.

CREATE TABLE game_sessions (
  session_id uuid PRIMARY KEY,
  instance_id text NOT NULL REFERENCES game_instances(instance_id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 100),
  starts_at timestamptz NOT NULL,
  booking_opens_at timestamptz NOT NULL,
  booking_closes_at timestamptz NOT NULL,
  ticket_capacity integer NOT NULL CHECK (ticket_capacity BETWEEN 1 AND 10000),
  reservation_ttl_seconds integer NOT NULL DEFAULT 600 CHECK (reservation_ttl_seconds BETWEEN 60 AND 900),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','paused','cancelled','completed')),
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (booking_opens_at < booking_closes_at),
  CHECK (booking_closes_at <= starts_at)
);
CREATE INDEX game_sessions_public_idx ON game_sessions(instance_id, starts_at)
  WHERE status = 'open';
CREATE TRIGGER game_sessions_touch BEFORE UPDATE ON game_sessions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE ticket_reservations (
  reservation_id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES game_sessions(session_id) ON DELETE RESTRICT,
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 40),
  ticket_count integer NOT NULL CHECK (ticket_count BETWEEN 1 AND 12),
  booking_token_hash char(64) NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('held','confirmed','cancelled','expired')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  CHECK (expires_at <= created_at + interval '15 minutes'),
  CHECK (status <> 'confirmed' OR confirmed_at IS NOT NULL),
  CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL)
);
CREATE INDEX ticket_reservations_live_idx ON ticket_reservations(session_id, expires_at)
  WHERE status IN ('held','confirmed');
CREATE INDEX ticket_reservations_session_idx ON ticket_reservations(session_id, created_at DESC);

CREATE TABLE ticket_reservation_audit (
  event_id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES game_sessions(session_id) ON DELETE RESTRICT,
  reservation_id uuid REFERENCES ticket_reservations(reservation_id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('session.create','session.update','session.open','session.pause','session.cancel','session.complete','hold.create','hold.confirm','hold.cancel','hold.expire')),
  actor_type text NOT NULL CHECK (actor_type IN ('super_admin','player','system')),
  actor_label text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ticket_reservation_audit_session_idx ON ticket_reservation_audit(session_id,event_id DESC);
CREATE FUNCTION reject_ticket_reservation_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ticket reservation audit is append-only'; END; $$;
CREATE TRIGGER ticket_reservation_audit_immutable BEFORE UPDATE OR DELETE ON ticket_reservation_audit
  FOR EACH ROW EXECUTE FUNCTION reject_ticket_reservation_audit_mutation();
