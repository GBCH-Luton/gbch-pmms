-- Distinguishes two different things that were previously conflated under
-- one clock_out_override flag:
--   1. A LIVE same-day assist -- builder calls mid-shift, "my phone just
--      died, can you clock me out", manager does it there and then. Not
--      their fault, shouldn't count against them.
--   2. A genuinely forgotten clock-out -- the shift sat open into a LATER
--      day before anyone noticed and a manager had to correct it after
--      the fact (e.g. the Paulo Da Silva 06/08 shift, corrected 07/08).
--      This should count against the builder and persist in their record
--      even after the correction closes it out -- fixing the record isn't
--      the same as it never having happened.
--
-- missed_clock_out is set at the moment of the correction (comparing the
-- shift's work_date to the real "today" right then), not re-derived later
-- from work_date alone -- by the time anyone looks back, EVERY past shift's
-- work_date is "in the past" whether it was a live same-day assist or a
-- genuinely missed one, so that distinction can only be captured when the
-- correction actually happens.

alter table pmms.daily_attendance
  add column if not exists missed_clock_out boolean not null default false;

-- Backfill: the one row this distinction already applies to -- the
-- override_note on this row (see split_daily_attendance_override_flag.sql)
-- confirms it was a next-day correction of a shift never clocked out.
update pmms.daily_attendance
set missed_clock_out = true
where id = 'b2622509-a8b6-4fa4-b902-f423e1dae10f';
