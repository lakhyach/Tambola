-- Store only a keyed, session-scoped digest. Raw phone numbers are never kept.
ALTER TABLE ticket_reservations ADD COLUMN phone_lookup_hash char(64);
CREATE INDEX ticket_reservations_phone_lookup_idx
  ON ticket_reservations(session_id, phone_lookup_hash)
  WHERE phone_lookup_hash IS NOT NULL;
