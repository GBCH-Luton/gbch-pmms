-- Tracks whether a push has already fired for a property_compliance row's
-- current expiry_date, so the daily cron doesn't re-alert every day while
-- something sits expired. Reset to null whenever expiry_date changes (see
-- PropertyComplianceTab.jsx's upsertRecord), so a renewal re-arms alerting.
alter table pmms.property_compliance
  add column if not exists aging_alert_sent_at timestamptz;

-- Single global "days before expiry to flag amber" -- replaces the
-- hardcoded 90 in computeRag(). Seeded to match today's hardcoded
-- behaviour exactly, so shipping this changes nothing until an admin
-- edits it.
insert into pmms.settings (setting_key, setting_value) values
  ('compliance_aging_threshold_days', '90')
on conflict (setting_key) do nothing;

insert into pmms.settings (setting_key, setting_value) values
  ('compliance_alerts_enabled', 'true')
on conflict (setting_key) do nothing;
