-- After bulk-inserting rows with explicit integer ids, the identity sequences
-- backing pmms.properties/tickets/comments/work_sessions/audit_events.id are
-- still at their starting point. This bumps each one past the highest id
-- actually present, so the next INSERT without an explicit id doesn't collide.

select setval(pg_get_serial_sequence('pmms.properties', 'id'), coalesce((select max(id) from pmms.properties), 0) + 1, false);
select setval(pg_get_serial_sequence('pmms.tickets', 'id'), coalesce((select max(id) from pmms.tickets), 0) + 1, false);
select setval(pg_get_serial_sequence('pmms.comments', 'id'), coalesce((select max(id) from pmms.comments), 0) + 1, false);
select setval(pg_get_serial_sequence('pmms.work_sessions', 'id'), coalesce((select max(id) from pmms.work_sessions), 0) + 1, false);
select setval(pg_get_serial_sequence('pmms.audit_events', 'id'), coalesce((select max(id) from pmms.audit_events), 0) + 1, false);
