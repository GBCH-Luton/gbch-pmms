-- Tracks how long a ticket has sat in its current status, so the Pipeline
-- page can highlight/filter "stuck" tickets and a scheduled job can push
-- an alert once per stuck period.

alter table pmms.tickets
  add column if not exists status_changed_at timestamptz,
  add column if not exists stuck_alert_sent_at timestamptz;

-- Backfill so existing open tickets don't look infinitely stuck the
-- moment this ships.
update pmms.tickets set status_changed_at = created_at where status_changed_at is null;

-- Per-status, per-priority-tier thresholds, in flexible hours/days units,
-- editable from Admin Settings. Seeded with placeholder defaults.
insert into pmms.settings (setting_key, setting_value) values
  ('stuck_ticket_thresholds', '{
    "Pending":     { "P1 Critical": {"value":2,"unit":"hours"}, "P2 Urgent": {"value":8,"unit":"hours"}, "P3 Routine": {"value":1,"unit":"days"} },
    "Assigned":    { "P1 Critical": {"value":4,"unit":"hours"}, "P2 Urgent": {"value":1,"unit":"days"},  "P3 Routine": {"value":3,"unit":"days"} },
    "In Progress": { "P1 Critical": {"value":8,"unit":"hours"}, "P2 Urgent": {"value":2,"unit":"days"},  "P3 Routine": {"value":5,"unit":"days"} },
    "On Hold":     { "P1 Critical": {"value":1,"unit":"days"},  "P2 Urgent": {"value":3,"unit":"days"},  "P3 Routine": {"value":7,"unit":"days"} }
  }')
on conflict (setting_key) do nothing;

insert into pmms.settings (setting_key, setting_value) values
  ('stuck_alerts_enabled', 'true')
on conflict (setting_key) do nothing;
