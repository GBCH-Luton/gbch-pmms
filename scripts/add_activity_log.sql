-- Mid-day presence log: "everywhere a builder is during the day" beyond
-- just clocked-in-for-the-day (pmms.daily_attendance) and on-a-job
-- (pmms.work_sessions) -- a materials run, a lunch break, or anything
-- else that takes them off whatever job they were on. Independent of
-- both those tables: starting/ending an activity never touches a
-- ticket's work_session, since job time already has its own tracking and
-- this is purely a supplementary presence record for manager visibility.
--
-- "Open" activity == most recent row for a staff_id with ended_at still
-- null, same convention as daily_attendance/work_sessions.
create table pmms.activity_log (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id),
  activity_type text not null check (activity_type in ('Travel', 'Break')),
  note text,
  started_at timestamptz not null,
  started_lat double precision,
  started_lng double precision,
  ended_at timestamptz,
  ended_lat double precision,
  ended_lng double precision,
  created_at timestamptz not null default now()
);

create index idx_activity_log_staff on pmms.activity_log(staff_id, started_at);

alter table pmms.activity_log enable row level security;

create policy admin_full_access on pmms.activity_log for all to authenticated
  using (pmms.current_access_level() = 'admin')
  with check (pmms.current_access_level() = 'admin');

create policy manager_division_scoped_access on pmms.activity_log for all to authenticated
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

create policy manager_unscoped_full_access on pmms.activity_log for all to authenticated
  using (pmms.current_access_level() = 'manager' and pmms.current_division() is null)
  with check (pmms.current_access_level() = 'manager' and pmms.current_division() is null);

create policy builder_own_activity_select on pmms.activity_log for select to authenticated
  using (pmms.current_access_level() = 'builder' and staff_id = pmms.current_staff_id());

create policy builder_own_activity_insert on pmms.activity_log for insert to authenticated
  with check (pmms.current_access_level() = 'builder' and staff_id = pmms.current_staff_id());

create policy builder_own_activity_update on pmms.activity_log for update to authenticated
  using (pmms.current_access_level() = 'builder' and staff_id = pmms.current_staff_id())
  with check (pmms.current_access_level() = 'builder' and staff_id = pmms.current_staff_id());
