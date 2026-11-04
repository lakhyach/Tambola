-- Distinguish authenticated platform Owners from Super Admins in new audit
-- records. Historical rows are preserved; they are not rewritten.
ALTER TABLE platform_audit DROP CONSTRAINT platform_audit_actor_role_check;
ALTER TABLE platform_audit ADD CONSTRAINT platform_audit_actor_role_check
  CHECK (actor_role IN ('owner','super_admin','moderator','system'));

ALTER TABLE ticket_reservation_audit DROP CONSTRAINT ticket_reservation_audit_actor_type_check;
ALTER TABLE ticket_reservation_audit ADD CONSTRAINT ticket_reservation_audit_actor_type_check
  CHECK (actor_type IN ('owner','super_admin','moderator','player','system'));

ALTER TABLE session_ticket_events DROP CONSTRAINT session_ticket_events_actor_type_check;
ALTER TABLE session_ticket_events ADD CONSTRAINT session_ticket_events_actor_type_check
  CHECK (actor_type IN ('owner','admin','super_admin','host','player','moderator','system'));
