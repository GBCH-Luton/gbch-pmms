-- RLS fix for public.staff -- the real, company-wide staff table (64 rows:
-- name, email, phone, job_title, etc). This was deliberately excluded from
-- groups 1-3 since it's shared outside PMMS's ownership; confirmed with the
-- user that nothing else touches it without a logged-in session, so it gets
-- the same fix as everything else.
--
-- Same fix as groups 1-3 (see add_rls_group1_config_tables.sql for the full
-- explanation) -- requires a logged-in session for any access, doesn't yet
-- restrict access by role.

alter table public.staff enable row level security;
drop policy if exists "authenticated full access" on public.staff;
create policy "authenticated full access" on public.staff for all to authenticated using (true) with check (true);
