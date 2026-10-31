-- =====================================================================
-- The winning ticket, migration 005.
--
-- Why
--   The engine has always known WHICH ticket completed a pattern - a seat can
--   hold several, and the award names the one that won - but only the live room
--   kept that fact. `awards` stored the player, the pattern and the ordinal, so
--   after a restart the rebuilt room had `ticketNo: null` everywhere. For the
--   shipped rules that was invisible. For "Second Full House" it is not: the
--   rule is that the ticket which took the first Full House may never take the
--   second, and a room that cannot remember which ticket that was would pay the
--   same ticket twice. Award attribution to a specific ticket is also what the
--   player-facing results and the audit trail promise, so it must survive.
--
-- Additive and non-destructive
--   * ticket_no is nullable. Rows written before this migration keep NULL:
--     their ticket is unknown, not ticket 1, and nothing is invented for them.
--     No existing room can be affected either way - a room only plays Second
--     Full House if its host opted in while it was WAITING, and opting in
--     before this column existed was not possible.
--   * ticket_nos holds the full group for the seat-scoped prize (Half Sheet is
--     won by three tickets at once) so a restart shows the same attribution the
--     award was paid with.
--   * CHECK allows only a real ticket number (>= 1), matching tickets.ticket_no
--     from migration 004.
--
-- Like 001-004 this file is versioned and checksummed and must never be edited
-- after it has been applied (the runner refuses MIGRATION_DRIFT).
-- =====================================================================

ALTER TABLE awards
    ADD COLUMN ticket_no integer NULL CHECK (ticket_no IS NULL OR ticket_no >= 1);

ALTER TABLE awards
    ADD COLUMN ticket_nos integer[] NULL;
