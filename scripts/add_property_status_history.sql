-- User deactivated several properties (landlord took them back) and asked
-- where to see a history of activate/deactivate/reactivate for a property
-- -- there was nowhere: properties.status is a plain column, overwritten
-- silently on every save, no trail at all. Mirrors the existing
-- pmms.property_room_history pattern (see add_pmms_property_rooms_tables.sql)
-- but tracks the property's own overall status instead of a room's
-- occupancy, so from_status/to_status (not a fixed action enum) since a
-- property status has several possible values (Occupied/Void/Procured/
-- Live/Internal/Inactive), not just two.
create table if not exists pmms.property_status_history (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references pmms.properties(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid references public.staff(id),
  changed_by_name text,
  created_at timestamptz not null default now()
);

alter table pmms.property_status_history enable row level security;

-- Same single-policy shape as property_room_history -- admin/manager
-- full access, no separate builder/submitter visibility needed since
-- this is a Property Profile management concern, not a job.
create policy "admin_manager_full_access" on pmms.property_status_history
  for all to authenticated
  using (pmms.is_admin_or_manager())
  with check (pmms.is_admin_or_manager());

notify pgrst, 'reload schema';
