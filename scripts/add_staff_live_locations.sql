-- Near-live staff tracking, Option 1 (2026-09-03): one row per staff_id,
-- upserted by useLiveLocationPing.js every ~75s while someone's clocked in
-- with the app open in the foreground. Freshness is judged client-side
-- from updated_at (pages/admin/AdminDashboard.jsx, StaffLocationsMapModal.jsx)
-- -- a row just goes stale, nothing here expires/deletes it.
--
-- RLS mirrors add_daily_attendance.sql exactly: admin full access, manager
-- division-scoped/unscoped access, builder self-upsert. A manager's own
-- self-ping is already covered by manager_division_scoped_access (their
-- own staff_id is in their own division) or manager_unscoped_full_access,
-- so no separate manager self-policy is needed -- only builders need one.
create table pmms.staff_live_locations (
  staff_id uuid primary key references public.staff(id),
  lat double precision not null,
  lng double precision not null,
  updated_at timestamptz not null default now()
);

alter table pmms.staff_live_locations enable row level security;

create policy admin_full_access on pmms.staff_live_locations for all to authenticated
  using (pmms.current_access_level() = 'admin')
  with check (pmms.current_access_level() = 'admin');

create policy manager_division_scoped_access on pmms.staff_live_locations for all to authenticated
  using (
    pmms.current_access_level() = 'manager'
    and pmms.current_division() is not null
    and pmms.staff_division(staff_id) = pmms.current_division()
  )
  with check (
    pmms.current_access_level() = 'manager'
    and pmms.current_division() is not null
    and pmms.staff_division(staff_id) = pmms.current_division()
  );

create policy manager_unscoped_full_access on pmms.staff_live_locations for all to authenticated
  using (pmms.current_access_level() = 'manager' and pmms.current_division() is null)
  with check (pmms.current_access_level() = 'manager' and pmms.current_division() is null);

create policy builder_own_location_insert on pmms.staff_live_locations for insert to authenticated
  with check (pmms.current_access_level() = 'builder' and staff_id = pmms.current_staff_id());

create policy builder_own_location_update on pmms.staff_live_locations for update to authenticated
  using (pmms.current_access_level() = 'builder' and staff_id = pmms.current_staff_id())
  with check (pmms.current_access_level() = 'builder' and staff_id = pmms.current_staff_id());
