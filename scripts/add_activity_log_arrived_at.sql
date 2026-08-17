-- Splits a property visit into two measurable phases within ONE row,
-- rather than two chained rows: started_at -> arrived_at is drive time,
-- arrived_at -> ended_at is time actually on site. mileage_logged is
-- still captured at arrived_at (the drive leg's real distance, known
-- once it's actually driven -- same reasoning as before). Only
-- meaningful for activity_category = 'visit' rows; 'visit_office' and
-- 'visit_other' have no on-site phase, so they still just use
-- started_at/ended_at as a single travel leg, arrived_at left null.
--
-- Lets Reports/Clocking eventually roll up: total travel hours (sum of
-- ended_at-started_at for legs with no arrived_at, or arrived_at-started_at
-- for ones that do), total time on site (ended_at-arrived_at), and visit
-- count (count of activity_category = 'visit' rows with arrived_at set).

alter table pmms.activity_log add column if not exists arrived_at timestamptz;

notify pgrst, 'reload schema';
