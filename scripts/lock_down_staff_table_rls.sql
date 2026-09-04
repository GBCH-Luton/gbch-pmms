-- URGENT security fix, found via the new HRMS project's own security
-- review, 2026-09-04. public.staff (the identity table shared by PMMS,
-- SIMS, and now HRMS) currently has:
--   - "public insert staff": INSERT, role public, with_check: true
--   - "public update staff": UPDATE, role public, qual: true
--   - anon also has table-level INSERT/UPDATE/DELETE/TRUNCATE grants
-- Anyone holding the public anon key (shipped in every client bundle,
-- not a secret) can currently, with NO login at all:
--   - Rewrite any staff row's user_id to hijack any identity -- Admin
--     included, since every pmms.current_access_level()-style RLS
--     check across the whole app resolves off this exact table.
--   - Insert fake staff rows.
--   - TRUNCATE (empty) the entire table outright -- Postgres RLS does
--     NOT filter TRUNCATE at all, regardless of policies, so this was
--     exploitable even before considering the policies above.
--
-- Traced every real write path against this table before touching
-- anything:
--   - INSERT: the real "Add Staff Member" flow goes through a secure
--     Edge Function (create-staff-account, service-role, bypasses RLS
--     the correct way) -- never needed this open policy. The only
--     client-side insert is AdminAccess.jsx's rarely-used "Staff
--     Record Editor" fallback form, which is Admin-only in the UI.
--     -> INSERT locked to Admin only.
--   - UPDATE: AdminAccess.jsx's same fallback form (Admin-only) is one
--     caller, but BuilderProfilePage.jsx's Gender field
--     (staff.gender, used for gender-matching restrictions) is another
--     -- and the "Staff" nav page it lives on is open to any Manager,
--     not just Admin. That code also never checks whether the update
--     actually succeeded, so a too-tight policy here would have
--     silently broken Gender-editing for every manager (UI shows
--     "saved", DB row unchanged) -- caught this before running it.
--     -> UPDATE allows Admin OR Manager.
--
-- Leaves the SELECT policies (public read staff / Staff can read own
-- record) untouched -- flagged separately as "already known," not part
-- of this fix.

begin;

revoke insert, update, delete, truncate on public.staff from anon;

drop policy "public insert staff" on public.staff;
drop policy "public update staff" on public.staff;

create policy "admin insert staff" on public.staff for insert to authenticated
  with check (pmms.current_access_level() = 'admin');

create policy "admin or manager update staff" on public.staff for update to authenticated
  using (pmms.current_access_level() in ('admin', 'manager'))
  with check (pmms.current_access_level() in ('admin', 'manager'));

commit;
