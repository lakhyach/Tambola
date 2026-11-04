-- Session-to-room attachment is a separate, explicit moderator capability.
-- It does not grant booking cancellation or player/ticket mutation.
ALTER TABLE moderator_instance_grants DROP CONSTRAINT moderator_instance_grants_permissions_check;
ALTER TABLE moderator_instance_grants ADD CONSTRAINT moderator_instance_grants_permissions_check
  CHECK (permissions <@ ARRAY['instance.read','instance.settings.update','room.create','room.read','room.start','room.pause','room.end','room.reset',
    'players.read','players.manage','history.read','tickets.manage','bookings.read','bookings.manage','bookings.assign','reports.read']::text[]);

ALTER TABLE ticket_reservation_audit DROP CONSTRAINT ticket_reservation_audit_action_check;
ALTER TABLE ticket_reservation_audit ADD CONSTRAINT ticket_reservation_audit_action_check
  CHECK (action IN ('session.create','session.update','session.open','session.pause','session.cancel','session.complete','session.assign_room',
    'hold.create','hold.confirm','hold.cancel','hold.expire'));
