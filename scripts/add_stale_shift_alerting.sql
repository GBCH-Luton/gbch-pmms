-- Director-approved fix for the "forgotten clock-out rolls into the next
-- day" gap: a daily_attendance shift that's still open, from a PREVIOUS
-- calendar day, and past the configurable stale_shift_hours threshold now
-- (a) blocks the builder's whole app until a manager closes it out via the
-- existing "Clock Out For Them" override, and (b) pushes every admin/manager
-- once per shift (stale_alert_sent_at is the one-shot guard, same pattern as
-- clock_out_reminder_sent_at). No auto clock-out -- guessing an end time
-- could short-change or overpay someone.

alter table pmms.daily_attendance add column if not exists stale_alert_sent_at timestamptz;

insert into pmms.settings (setting_key, setting_value, updated_at)
values ('stale_shift_hours', '16', now())
on conflict (setting_key) do nothing;
