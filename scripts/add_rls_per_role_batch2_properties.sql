-- Per-role RLS, batch 2 of 3: properties + its 6 child tables. Replaces the
-- earlier "any logged-in user has full access" policies with real
-- least-privilege rules. Requires add_rls_role_helper_functions.sql.
--
-- Rules (confirmed builders never read any of the 6 child tables anywhere
-- in the app, but do need to read every property's basic info to raise a
-- ticket anywhere -- see conversation for the research this is based on):
--   Admin/Manager: full access to all 7 tables, unchanged.
--   Builder, properties: read-only, every row (no restriction -- a builder
--     can raise a ticket at any property, not just ones they have a job at).
--   Builder, the 6 child tables (rooms, room_history, assets, compliance,
--     documents, notes): no access at all.

-- ── properties ───────────────────────────────────────────────────────────
drop policy if exists "authenticated full access" on pmms.properties;

create policy "admin_manager_full_access" on pmms.properties
  for all to authenticated
  using (pmms.is_admin_or_manager())
  with check (pmms.is_admin_or_manager());

create policy "builder_read_only" on pmms.properties
  for select to authenticated
  using (pmms.current_access_level() = 'builder');

-- ── child tables: admin/manager only, no builder policy at all ──────────
drop policy if exists "authenticated full access" on pmms.property_rooms;
create policy "admin_manager_full_access" on pmms.property_rooms
  for all to authenticated
  using (pmms.is_admin_or_manager())
  with check (pmms.is_admin_or_manager());

drop policy if exists "authenticated full access" on pmms.property_room_history;
create policy "admin_manager_full_access" on pmms.property_room_history
  for all to authenticated
  using (pmms.is_admin_or_manager())
  with check (pmms.is_admin_or_manager());

drop policy if exists "authenticated full access" on pmms.property_assets;
create policy "admin_manager_full_access" on pmms.property_assets
  for all to authenticated
  using (pmms.is_admin_or_manager())
  with check (pmms.is_admin_or_manager());

drop policy if exists "authenticated full access" on pmms.property_compliance;
create policy "admin_manager_full_access" on pmms.property_compliance
  for all to authenticated
  using (pmms.is_admin_or_manager())
  with check (pmms.is_admin_or_manager());

drop policy if exists "authenticated full access" on pmms.property_documents;
create policy "admin_manager_full_access" on pmms.property_documents
  for all to authenticated
  using (pmms.is_admin_or_manager())
  with check (pmms.is_admin_or_manager());

drop policy if exists "authenticated full access" on pmms.property_notes;
create policy "admin_manager_full_access" on pmms.property_notes
  for all to authenticated
  using (pmms.is_admin_or_manager())
  with check (pmms.is_admin_or_manager());
