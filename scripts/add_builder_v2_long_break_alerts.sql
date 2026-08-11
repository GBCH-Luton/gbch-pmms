-- Follow-up to add_builder_v2_workflow.sql, after director sign-off on
-- tightening two gaps found in review:
--   1. "Unable to Do the Job" requiring a note is a client-only change
--      (BuilderDashboard.jsx's Stop sheet), nothing to migrate for that.
--   2. A short-trip break (Going to the Office / Lunch Break / Getting
--      materials myself) had no alert if it ran long -- this adds the
--      column + setting the new check-long-breaks Edge Function needs.

alter table pmms.tickets
  add column if not exists long_break_alert_sent_at timestamptz;

insert into pmms.settings (setting_key, setting_value)
values ('long_break_alert_minutes', '45')
on conflict (setting_key) do nothing;
