-- Directors approved 2026-08-12: a manager alert when a builder sits idle
-- (no job in progress, no break, no away-activity) despite already having
-- an Assigned job waiting -- mirrors check-long-breaks' existing pattern.
-- idle_alert_sent_at lives on daily_attendance (not tickets) since "idle"
-- isn't tied to any one ticket; cleared by handleComplete/handlePause in
-- BuilderDashboard.jsx every time a fresh idle stretch begins, so a repeat
-- idle period during the same shift gets its own alert window instead of
-- being silently covered by a guard left over from earlier in the day.
insert into pmms.settings (setting_key, setting_value)
values ('idle_alert_minutes', '30')
on conflict (setting_key) do nothing;

alter table pmms.daily_attendance
  add column if not exists idle_alert_sent_at timestamptz;
