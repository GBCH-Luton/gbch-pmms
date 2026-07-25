-- pmms.notifications, pmms.staff_availability, pmms.work_sessions,
-- pmms.login_events, pmms.error_logs, and pmms.push_subscriptions all
-- gated manager access with plain is_admin_or_manager() -- unlike
-- pmms.tickets (and comments/audit_events), which correctly scope a
-- division-limited manager to only their own division. Net effect: a
-- division-scoped manager (e.g. Compliance Manager) could read or, for
-- notifications/availability/work_sessions, fully edit/delete data
-- belonging to staff in OTHER divisions -- mark another division's
-- notifications read/unread or delete them, edit another division's
-- builder's availability or clock records, or read company-wide
-- login/error logs and push-subscription keys.
--
-- pmms.staff_division(target_staff_id) mirrors current_division()'s
-- exact logic, parameterized for an arbitrary staff member instead of
-- the calling session -- lets a policy ask "what division is the ROW'S
-- staff member in", not just "what division is the caller in".

create or replace function pmms.staff_division(target_staff_id uuid)
returns text
language sql
security definer
stable
set search_path = public, pmms
as $$
  with target as (
    select id, active from public.staff where id = target_staff_id
  ),
  target_role as (
    select sr.role from pmms.staff_roles sr, target
    where sr.staff_id = target.id
    order by sr.role
    limit 1
  ),
  custom_roles as (
    select
      case jsonb_typeof(elem) when 'string' then elem #>> '{}' else elem ->> 'name' end as name,
      case jsonb_typeof(elem) when 'string' then null else elem ->> 'division' end as division
    from pmms.settings s,
      lateral jsonb_array_elements(coalesce(s.setting_value, '[]'::jsonb)) elem
    where s.setting_key = 'custom_roles'
  )
  select
    case
      when target.active = false then null
      else cr.division
    end
  from target
  left join target_role on true
  left join custom_roles cr on cr.name = target_role.role
$$;

-- notifications (ALL, staff_id)
drop policy if exists "admin_manager_full_access" on pmms.notifications;
create policy "admin_full_access" on pmms.notifications
  for all to authenticated
  using (pmms.current_access_level() = 'admin')
  with check (pmms.current_access_level() = 'admin');
create policy "manager_division_scoped_access" on pmms.notifications
  for all to authenticated
  using (pmms.current_access_level() = 'manager' and (pmms.current_division() is null or pmms.staff_division(staff_id) = pmms.current_division()))
  with check (pmms.current_access_level() = 'manager' and (pmms.current_division() is null or pmms.staff_division(staff_id) = pmms.current_division()));

-- staff_availability (ALL, staff_id)
drop policy if exists "admin_manager_full_access" on pmms.staff_availability;
create policy "admin_full_access" on pmms.staff_availability
  for all to authenticated
  using (pmms.current_access_level() = 'admin')
  with check (pmms.current_access_level() = 'admin');
create policy "manager_division_scoped_access" on pmms.staff_availability
  for all to authenticated
  using (pmms.current_access_level() = 'manager' and (pmms.current_division() is null or pmms.staff_division(staff_id) = pmms.current_division()))
  with check (pmms.current_access_level() = 'manager' and (pmms.current_division() is null or pmms.staff_division(staff_id) = pmms.current_division()));

-- work_sessions (ALL, builder_id)
drop policy if exists "admin_manager_full_access" on pmms.work_sessions;
create policy "admin_full_access" on pmms.work_sessions
  for all to authenticated
  using (pmms.current_access_level() = 'admin')
  with check (pmms.current_access_level() = 'admin');
create policy "manager_division_scoped_access" on pmms.work_sessions
  for all to authenticated
  using (pmms.current_access_level() = 'manager' and (pmms.current_division() is null or pmms.staff_division(builder_id) = pmms.current_division()))
  with check (pmms.current_access_level() = 'manager' and (pmms.current_division() is null or pmms.staff_division(builder_id) = pmms.current_division()));

-- login_events (SELECT only, staff_id)
drop policy if exists "admin_manager_read" on pmms.login_events;
create policy "admin_read" on pmms.login_events
  for select to authenticated
  using (pmms.current_access_level() = 'admin');
create policy "manager_division_scoped_read" on pmms.login_events
  for select to authenticated
  using (pmms.current_access_level() = 'manager' and (pmms.current_division() is null or pmms.staff_division(staff_id) = pmms.current_division()));

-- error_logs (SELECT only, staff_id)
drop policy if exists "admin_manager_read" on pmms.error_logs;
create policy "admin_read" on pmms.error_logs
  for select to authenticated
  using (pmms.current_access_level() = 'admin');
create policy "manager_division_scoped_read" on pmms.error_logs
  for select to authenticated
  using (pmms.current_access_level() = 'manager' and (pmms.current_division() is null or pmms.staff_division(staff_id) = pmms.current_division()));

-- push_subscriptions (SELECT only, staff_id) -- self_manage (own row, ALL) untouched
drop policy if exists "admin_manager_read" on pmms.push_subscriptions;
create policy "admin_read" on pmms.push_subscriptions
  for select to authenticated
  using (pmms.current_access_level() = 'admin');
create policy "manager_division_scoped_read" on pmms.push_subscriptions
  for select to authenticated
  using (pmms.current_access_level() = 'manager' and (pmms.current_division() is null or pmms.staff_division(staff_id) = pmms.current_division()));
