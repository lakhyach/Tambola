-- Per-player selection is bounded by real session capacity and the
-- application-level tested grid envelope. Historical <=12 checks were an
-- arbitrary per-player ceiling, so retain only the required positive count.
ALTER TABLE room_members
  DROP CONSTRAINT IF EXISTS room_members_ticket_count_check;
ALTER TABLE room_members
  ADD CONSTRAINT room_members_ticket_count_check CHECK (ticket_count >= 1);

ALTER TABLE ticket_reservations
  DROP CONSTRAINT IF EXISTS ticket_reservations_ticket_count_check;
ALTER TABLE ticket_reservations
  ADD CONSTRAINT ticket_reservations_ticket_count_check CHECK (ticket_count >= 1);
