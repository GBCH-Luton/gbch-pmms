-- public.staff already has `active boolean default true` (see
-- new_project_schema.sql) so no migration is needed for that column --
-- the Staff Management page's Deactivate/Activate toggle already works
-- against it.
--
-- This just adds `phone`, needed by the new Staff Management "Add/Edit
-- Staff Member" modal, which does not exist on public.staff yet (there is
-- a `phone` column on pmms.staff, but that's a separate, unused table --
-- everything in this app reads/writes public.staff).

alter table public.staff add column if not exists phone text;
