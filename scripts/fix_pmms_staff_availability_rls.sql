-- pmms.staff_availability was created with RLS still enabled (same
-- recurring issue as every other new pmms table in this project -- see
-- disable_rls_new_project.sql) -- reads work via service role but the app's
-- normal writes get silently blocked with "new row violates row-level
-- security policy for table \"staff_availability\"". Run this to fix.

alter table pmms.staff_availability disable row level security;
