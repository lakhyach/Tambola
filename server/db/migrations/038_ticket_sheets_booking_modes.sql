-- Persist six-ticket sheet membership and the selected booking bundle mode.
CREATE TABLE session_ticket_sheets (
  sheet_id uuid PRIMARY KEY,
  session_id uuid NOT NULL,
  generation_batch_id uuid NOT NULL,
  sheet_ordinal integer NOT NULL CHECK (sheet_ordinal BETWEEN 1 AND 1666),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id,sheet_id),
  UNIQUE(session_id,generation_batch_id,sheet_id),
  UNIQUE(session_id,generation_batch_id,sheet_ordinal),
  FOREIGN KEY(session_id,generation_batch_id)
    REFERENCES ticket_inventory_batches(session_id,generation_batch_id) ON DELETE RESTRICT
);

ALTER TABLE session_tickets
  ADD COLUMN sheet_id uuid,
  ADD COLUMN sheet_position smallint,
  ADD CONSTRAINT session_tickets_sheet_pair_check CHECK (
    (sheet_id IS NULL AND sheet_position IS NULL)
    OR (sheet_id IS NOT NULL AND sheet_position BETWEEN 1 AND 6)
  ),
  ADD CONSTRAINT session_tickets_sheet_group_fk
    FOREIGN KEY(session_id,generation_batch_id,sheet_id)
    REFERENCES session_ticket_sheets(session_id,generation_batch_id,sheet_id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX session_tickets_sheet_position_key
  ON session_tickets(session_id,sheet_id,sheet_position)
  WHERE sheet_id IS NOT NULL;

ALTER TABLE ticket_reservations
  ADD COLUMN booking_mode text NOT NULL DEFAULT 'random'
    CHECK (booking_mode IN ('random','half','full'));
