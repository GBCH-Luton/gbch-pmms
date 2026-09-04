-- Follow-up to lock_down_staff_table_rls.sql, found by the HRMS
-- project's own review of that fix, 2026-09-04: "public read staff"
-- (SELECT, role public, qual: true) was left untouched by the first
-- pass -- meaning anyone with the anon key, no login at all, could
-- still read every staff record (phone, home address/coordinates,
-- email). Checked PMMS's own code first: every read of public.staff
-- happens inside pages that only render after login (7 files, all
-- under the authenticated admin/manager app shell) -- nothing in
-- Login.jsx, SetPassword.jsx, or any public-facing form (e.g. the
-- Garden Survey) touches this table pre-auth. No legitimate
-- unauthenticated read need found, so this closes it.
--
-- Deliberately NOT narrowed further than "authenticated" here --
-- every logged-in role (including a builder) can still read any staff
-- member's phone/home address, which may be worth tightening
-- separately, but that's a role-based judgement call flagged for a
-- later pass, not folded into this fix.
--
-- Applied and verified directly against production, 2026-09-04.

begin;

drop policy "public read staff" on public.staff;

create policy "authenticated read staff" on public.staff for select to authenticated
  using (true);

commit;
