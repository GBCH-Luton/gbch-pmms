-- The 3-question submitter sign-off form, agreed with directors weeks ago
-- but left unbuilt at the user's request until now: "Was the issue
-- resolved?" / "Was the work done to a good standard?" / "Was the
-- property left clean?" -- all Yes archives the ticket exactly as before;
-- any No blocks archiving and notifies the ticket's division manager(s)
-- instead (confirmed behaviour, 2026-08-17).

alter table pmms.tickets add column if not exists signoff_resolved boolean;
alter table pmms.tickets add column if not exists signoff_good_standard boolean;
alter table pmms.tickets add column if not exists signoff_clean boolean;
alter table pmms.tickets add column if not exists signoff_note text;
alter table pmms.tickets add column if not exists signoff_flagged boolean not null default false;
alter table pmms.tickets add column if not exists signoff_submitted_at timestamptz;

-- submitter_archive_own (add_raiser_only_signoff.sql) only allows a write
-- that ALSO sets status='Archived' -- a "flag it, don't archive" update
-- (status stays 'Completed', only the signoff_* columns change) needs its
-- own policy or it's silently rejected.
create policy "submitter_flag_signoff_own" on pmms.tickets
  for update to authenticated
  using (pmms.current_access_level() = 'submitter' and raised_by = pmms.current_staff_id() and status = 'Completed')
  with check (pmms.current_access_level() = 'submitter' and raised_by = pmms.current_staff_id() and status = 'Completed');

-- Parameterised sibling of pmms.current_access_level() -- that one only
-- ever resolves the CALLER's own level (via auth.jwt() email). Needed here
-- so the notification-insert policy below can verify who a submitter is
-- actually notifying is a real admin/manager, not trust an arbitrary
-- staff_id -- same spirit as submitter_notify_assigned_builder checking
-- the recipient really is the ticket's assigned builder.
create or replace function pmms.access_level_for_staff(target_staff_id uuid)
returns text
language sql
security definer
stable
set search_path = public, pmms
as $$
  with my_role as (
    select sr.role from pmms.staff_roles sr
    where sr.staff_id = target_staff_id
    order by sr.role
    limit 1
  ),
  custom_roles as (
    select
      case jsonb_typeof(elem) when 'string' then elem #>> '{}' else elem ->> 'name' end as name,
      case jsonb_typeof(elem) when 'string' then 'none' else coalesce(elem ->> 'accessLevel', 'none') end as access_level
    from pmms.settings s,
      lateral jsonb_array_elements(coalesce(s.setting_value, '[]'::jsonb)) elem
    where s.setting_key = 'custom_roles'
  ),
  target as (
    select active from public.staff where id = target_staff_id
  )
  select
    case
      when target.active = false then null
      when my_role.role = 'Admin' then 'admin'
      when my_role.role = 'Builder' then 'builder'
      when my_role.role in ('Cleaner', 'Support Worker') then null
      when cr.access_level = 'manager' then 'manager'
      when cr.access_level = 'builder' then 'builder'
      else null
    end
  from target
  left join my_role on true
  left join custom_roles cr on cr.name = my_role.role
$$;

create policy "submitter_notify_manager_on_signoff_flag" on pmms.notifications
  for insert to authenticated
  with check (
    pmms.current_access_level() = 'submitter'
    and pmms.access_level_for_staff(notifications.staff_id) in ('admin', 'manager')
    and exists (
      select 1 from pmms.tickets t
      where t.id = notifications.ticket_id and t.raised_by = pmms.current_staff_id()
    )
  );

notify pgrst, 'reload schema';
