-- Closing a "visit" (see add_activity_log_visit_columns.sql) only ever
-- recorded WHEN it ended, not WHERE she ended up -- Where's the Team and
-- Clocking history both flip straight to a bare "Available"/"back from
-- the visit" with nothing distinguishing "back at the office, working"
-- from "gone home, done for the day". end_note captures that declaration
-- at close time, shown alongside the existing backVerb text the same way
-- `note` already is for the start event. Generic on the table (not
-- visit-specific) in case another category ever wants it, but only the
-- Log a Visit flow writes it today.

alter table pmms.activity_log add column if not exists end_note text;

notify pgrst, 'reload schema';
