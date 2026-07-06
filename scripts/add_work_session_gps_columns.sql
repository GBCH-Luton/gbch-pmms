-- Adds GPS capture columns to pmms.work_sessions -- captured client-side via
-- the browser's Geolocation API at the moment of clock-in and clock-out, so
-- a manager can verify a builder was actually at the property (or see how
-- far off they were) instead of just trusting the timestamp.
--
-- Nullable throughout: if a builder denies the location permission, the
-- browser doesn't support it, or it times out, clocking in/out must still
-- proceed -- these columns are best-effort, never a hard requirement.

alter table pmms.work_sessions add column if not exists clock_in_lat double precision;
alter table pmms.work_sessions add column if not exists clock_in_lng double precision;
alter table pmms.work_sessions add column if not exists clock_out_lat double precision;
alter table pmms.work_sessions add column if not exists clock_out_lng double precision;
