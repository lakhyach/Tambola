-- Preserve both reservation assignment audit actions. Migration 020 adds the
-- moderator session-to-room event while retaining the established player
-- reservation-to-seat event introduced in migration 012.
ALTER TABLE ticket_reservation_audit DROP CONSTRAINT ticket_reservation_audit_action_check;
ALTER TABLE ticket_reservation_audit ADD CONSTRAINT ticket_reservation_audit_action_check
  CHECK (action IN ('session.create','session.update','session.open','session.pause','session.cancel','session.complete','session.assign_room',
    'hold.create','hold.confirm','hold.cancel','hold.expire','hold.assign'));
