-- Symmetric with late_flag on the way in -- clocking out before the
-- configured end-of-day time (daily_clock_out_reminder_time, same
-- setting the clock-out reminder cron already uses) requires the
-- builder to give a reason, captured here. Null on a normal/late-side
-- clock-out.
alter table pmms.daily_attendance add column if not exists early_leave_reason text;
