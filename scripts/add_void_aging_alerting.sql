-- Tracks whether a push has already fired for a room's current void
-- period, so the daily cron doesn't re-alert every day while a room
-- sits void past threshold. Reset to null whenever a room (re)enters
-- Void with a new void_since (see PropertyRoomsTab.jsx), so a later
-- void re-arms alerting.
alter table pmms.property_rooms
  add column if not exists void_alert_sent_at timestamptz;

-- Single global "days void before flagged Overdue" threshold. No prior
-- hardcoded behaviour to preserve (void aging math doesn't exist
-- today) -- seeded as a placeholder, editable in Admin Settings.
insert into pmms.settings (setting_key, setting_value) values
  ('void_aging_threshold_days', '45')
on conflict (setting_key) do nothing;

insert into pmms.settings (setting_key, setting_value) values
  ('void_alerts_enabled', 'true')
on conflict (setting_key) do nothing;
