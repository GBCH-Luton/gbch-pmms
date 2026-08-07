-- manual_override was a single row-level flag set true by EITHER the
-- clock-in override path (submitOverride mode 'in', an INSERT) or the
-- clock-out override path (mode 'out', an UPDATE on an existing row) --
-- but every display site attributed it to the clock-in event regardless
-- of which one actually happened, mislabeling a clock-out override (e.g.
-- closing a forgotten shift) as "Clocked in ... (manager override)".
--
-- Splits it into two unambiguous flags. Backfill: the only production row
-- with manual_override = true at the time of writing is the Paulo Da
-- Silva correction made 2026-08-07 (closing his forgotten 06/08 shift),
-- which was a clock-OUT override -- set directly below rather than via a
-- generic heuristic, since it's the one real data point that exists.

alter table pmms.daily_attendance
  add column if not exists clock_in_override boolean not null default false,
  add column if not exists clock_out_override boolean not null default false;

update pmms.daily_attendance
set clock_out_override = true
where manual_override = true;

alter table pmms.daily_attendance drop column manual_override;
