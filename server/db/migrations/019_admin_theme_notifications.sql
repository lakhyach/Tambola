-- Deliver daily theme releases to every owner account through the authenticated
-- control centre. Notification creation is part of the publication transaction.
CREATE TABLE owner_notifications (
  notification_id bigserial PRIMARY KEY,
  owner_id text NOT NULL REFERENCES owner_accounts(owner_id) ON DELETE CASCADE,
  event_key text NOT NULL CHECK (length(event_key) BETWEEN 1 AND 100),
  kind text NOT NULL CHECK (kind = 'theme.daily_release'),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 140),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 300),
  destination text NOT NULL DEFAULT '/admin/themes' CHECK (destination = '/admin/themes'),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  UNIQUE(owner_id, event_key)
);
CREATE INDEX owner_notifications_unread_idx ON owner_notifications(owner_id, created_at DESC) WHERE read_at IS NULL;

CREATE FUNCTION guard_owner_notification_read() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.notification_id IS DISTINCT FROM NEW.notification_id
    OR OLD.owner_id IS DISTINCT FROM NEW.owner_id
    OR OLD.event_key IS DISTINCT FROM NEW.event_key
    OR OLD.kind IS DISTINCT FROM NEW.kind
    OR OLD.title IS DISTINCT FROM NEW.title
    OR OLD.body IS DISTINCT FROM NEW.body
    OR OLD.destination IS DISTINCT FROM NEW.destination
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR OLD.read_at IS NOT NULL
    OR NEW.read_at IS NULL THEN
    RAISE EXCEPTION 'owner notifications are immutable except for first acknowledgement';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER owner_notification_read_once BEFORE UPDATE ON owner_notifications
  FOR EACH ROW EXECUTE FUNCTION guard_owner_notification_read();
