-- Directors approved 2026-08-12, two related fixes to Builder v2's
-- end-of-day auto-clockout:
--
-- 1. Auto-clockout (check-clock-out-reminders, Stage 3) now also pauses
--    whatever job the builder still had open at that moment -- previously
--    it only closed daily_attendance, leaving an In Progress (or locked
--    short-trip On Hold) ticket running unbounded, sometimes into the next
--    day, where Focus Mode would silently re-lock the builder onto it.
--
-- 2. New within-day alert (check-long-running-jobs, new function) for a
--    single job left "In Progress" too long, mirroring check-long-breaks'
--    existing pattern but for the job itself rather than a short trip away
--    from it.
insert into pmms.settings (setting_key, setting_value)
values ('long_running_job_alert_hours', '6')
on conflict (setting_key) do nothing;

alter table pmms.tickets
  add column if not exists long_running_job_alert_sent_at timestamptz;
