-- Day-level clock-in/out, separate from pmms.work_sessions (which stays
-- exactly as-is, per-ticket). This is the "shift" wrapper the directors
-- asked for: a builder clocks in once to start their working day (gates
-- BuilderDashboard.jsx entirely until they do), then clocks out once at
-- the end of it. Per-ticket clocking still happens underneath, same as
-- before.
--
-- "Open" shift == the most recent row for a staff_id with clock_out_at
-- still null -- same convention as work_sessions' ended_at, rather than a
-- unique(staff_id, work_date) constraint, so a mistaken early clock-out
-- can be corrected by clocking in again the same day without a DB
-- conflict.
create table pmms.daily_attendance (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id),
  work_date date not null,
  clock_in_at timestamptz not null,
  clock_in_lat double precision,
  clock_in_lng double precision,
  late_flag boolean not null default false,
  clock_out_at timestamptz,
  clock_out_lat double precision,
  clock_out_lng double precision,
  clock_out_reminder_sent_at timestamptz,
  manual_override boolean not null default false,
  override_note text,
  override_by uuid references public.staff(id),
  created_at timestamptz not null default now()
);

create index idx_daily_attendance_staff_date on pmms.daily_attendance(staff_id, work_date);

alter table pmms.daily_attendance enable row level security;

create policy admin_full_access on pmms.daily_attendance for all to authenticated
  using (pmms.current_access_level() = 'admin')
  with check (pmms.current_access_level() = 'admin');

create policy manager_division_scoped_access on pmms.daily_attendance for all to authenticated
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

create policy manager_unscoped_full_access on pmms.daily_attendance for all to authenticated
  using (pmms.current_access_level() = 'manager' and pmms.current_division() is null)
  with check (pmms.current_access_level() = 'manager' and pmms.current_division() is null);

create policy builder_own_attendance_select on pmms.daily_attendance for select to authenticated
  using (pmms.current_access_level() = 'builder' and staff_id = pmms.current_staff_id());

create policy builder_own_attendance_insert on pmms.daily_attendance for insert to authenticated
  with check (pmms.current_access_level() = 'builder' and staff_id = pmms.current_staff_id());

create policy builder_own_attendance_update on pmms.daily_attendance for update to authenticated
  using (pmms.current_access_level() = 'builder' and staff_id = pmms.current_staff_id())
  with check (pmms.current_access_level() = 'builder' and staff_id = pmms.current_staff_id());
