-- Date-window aggregate reports grouped by persisted room/session ownership.
-- Keep these ordered first by the date predicates used for bounded reports.
CREATE INDEX rooms_reporting_instance_created_idx
  ON rooms(game_instance_id, created_at);
CREATE INDEX games_reporting_started_room_idx
  ON games(started_at, room_code) WHERE started_at IS NOT NULL;
CREATE INDEX room_members_reporting_joined_idx
  ON room_members(joined_at, room_code, player_id);
CREATE INDEX tickets_reporting_assigned_idx
  ON tickets(assigned_at, room_code) WHERE assigned_at IS NOT NULL;
CREATE INDEX claims_reporting_decided_idx
  ON claims(decided_at, room_code, status) WHERE decided_at IS NOT NULL;
CREATE INDEX awards_reporting_awarded_idx
  ON awards(awarded_at, room_code) WHERE awarded_at IS NOT NULL;
CREATE INDEX reservations_reporting_created_idx
  ON ticket_reservations(created_at, session_id, status);
