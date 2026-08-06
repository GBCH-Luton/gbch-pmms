-- Home postcode + cached geocoded coordinates for each staff member, used
-- by AdminClocking.jsx to estimate expected mileage for a job (straight
-- line from home, or from their previous job that day, to the property --
-- see ensureStaffHomeCoords in lib/geo.js). Nullable and opt-in, same
-- pattern as pmms.properties.latitude/longitude -- geocoded lazily on
-- first use via postcodes.io, not backfilled here.
--
-- public.staff is the shared table across all company systems (not just
-- PMMS) -- these columns are additive/nullable so they don't affect any
-- other system reading this table.
alter table public.staff add column if not exists home_postcode text;
alter table public.staff add column if not exists home_latitude double precision;
alter table public.staff add column if not exists home_longitude double precision;
