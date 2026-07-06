-- pmms.tickets.gps_coordinates is dead: no client code, Edge Function, or
-- migration script reads or writes it, and it's null on every existing row.
-- It was superseded by the real GPS work, which lives on
-- pmms.work_sessions (clock_in_lat/lng, clock_out_lat/lng) instead.

alter table pmms.tickets drop column if exists gps_coordinates;
