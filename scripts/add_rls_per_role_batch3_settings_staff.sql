-- Per-role RLS, batch 3 of 3 (final batch): settings, staff_roles,
-- staff_availability, staff. Replaces the earlier "any logged-in user has
-- full access" policies with real least-privilege rules. Requires
-- add_rls_role_helper_functions.sql.
--
-- Rules:
--   Admin/Manager: full read/write on all 4 tables, unchanged.
--   Builder, settings: read-only -- nothing in here is sensitive, and
--     login itself needs to read custom_roles before a role is even known.
--   Builder, staff_roles: read only their own row (needed for login
--     routing); no write (builders never assign roles).
--   Builder, staff_availability: no access -- matches today's app exactly,
--     there's no builder self-service availability feature.
--   Builder, staff: read only their own row; no write to any row (the
--     password-reset flow already goes through a service-role Edge
--     Function, which bypasses RLS entirely, so this doesn't need a
--     builder write policy).

-- ── settings ─────────────────────────────────────────────────────────────
drop policy if exists "authenticated full access" on pmms.settings;

create policy "admin_manager_full_access" on pmms.settings
  for all to authenticated
  using (pmms.is_admin_or_manager())
  with check (pmms.is_admin_or_manager());

create policy "any_authenticated_read" on pmms.settings
  for select to authenticated
  using (true);

-- ── staff_roles ──────────────────────────────────────────────────────────
drop policy if exists "authenticated full access" on pmms.staff_roles;

create policy "admin_manager_full_access" on pmms.staff_roles
  for all to authenticated
  using (pmms.is_admin_or_manager())
  with check (pmms.is_admin_or_manager());

create policy "builder_read_own_role" on pmms.staff_roles
  for select to authenticated
  using (pmms.current_access_level() = 'builder' and staff_id = pmms.current_staff_id());

-- ── staff_availability: admin/manager only, no builder policy at all ────
drop policy if exists "authenticated full access" on pmms.staff_availability;
create policy "admin_manager_full_access" on pmms.staff_availability
  for all to authenticated
  using (pmms.is_admin_or_manager())
  with check (pmms.is_admin_or_manager());

-- ── staff (public schema) ────────────────────────────────────────────────
drop policy if exists "authenticated full access" on public.staff;

create policy "admin_manager_full_access" on public.staff
  for all to authenticated
  using (pmms.is_admin_or_manager())
  with check (pmms.is_admin_or_manager());

create policy "builder_read_own_row" on public.staff
  for select to authenticated
  using (pmms.current_access_level() = 'builder' and id = pmms.current_staff_id());
