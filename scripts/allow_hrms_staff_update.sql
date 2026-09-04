-- Follow-up to lock_down_staff_table_rls.sql. That fix gated
-- public.staff UPDATE on PMMS's own pmms.current_access_level() only
-- -- correct for closing the security hole, but it accidentally meant
-- an HRMS-only "HR Manager"/"HR Assistant" (no PMMS role at all)
-- couldn't edit/deactivate staff through HRMS, even though HRMS is
-- meant to become the primary system for that over time.
--
-- hrms.current_access_level() (scripts/0003_helper_functions.sql in
-- the HRMS project) returns an int, not a string: HR Manager = 10,
-- HR Assistant = 5, no role = 0. >= 5 covers both seeded roles --
-- matches PMMS's own policy already allowing both 'admin' and
-- 'manager', not just the top tier.
--
-- PMMS side kept as admin + manager (not narrowed to admin-only) --
-- Manager already needs this for BuilderProfilePage.jsx's Gender
-- field. Applied and verified directly against production, 2026-09-04.

begin;

drop policy "admin or manager update staff" on public.staff;

create policy "admin or manager update staff" on public.staff for update to authenticated
  using (pmms.current_access_level() in ('admin', 'manager') or hrms.current_access_level() >= 5)
  with check (pmms.current_access_level() in ('admin', 'manager') or hrms.current_access_level() >= 5);

commit;
