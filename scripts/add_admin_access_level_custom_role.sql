-- Director asked for an "Admin Assistant" role -- same access as Admin,
-- minus a few UI panels (Recent Login Activity, Error & Crash Log, Staff
-- Roles) hidden client-side only. Custom roles could already grant
-- 'manager'/'builder'/'submitter' access levels (see custom_roles setting +
-- lib/roles.js accessLevelForRole) but never 'admin' -- only the single
-- built-in "Admin" role name reached that tier. This adds the missing
-- branch so a custom role configured with accessLevel 'admin' resolves to
-- real, full admin-equivalent RLS access, matching accessLevelForRole()'s
-- client-side counterpart (see lib/roles.js -- both must stay in sync, per
-- the comment there).
create or replace function pmms.current_access_level()
returns text
language sql
security definer
stable
set search_path = public, pmms
as $$
  with me as (
    select id, active from public.staff
    where email = auth.jwt() ->> 'email'
    order by id
    limit 1
  ),
  my_role as (
    select sr.role from pmms.staff_roles sr, me
    where sr.staff_id = me.id
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
  )
  select
    case
      when me.active = false then null
      when my_role.role = 'Admin' then 'admin'
      when my_role.role = 'Builder' then 'builder'
      when my_role.role in ('Cleaner', 'Support Worker') then null
      when cr.access_level = 'admin' then 'admin'
      when cr.access_level = 'manager' then 'manager'
      when cr.access_level = 'builder' then 'builder'
      when cr.access_level = 'submitter' then 'submitter'
      else null
    end
  from me
  left join my_role on true
  left join custom_roles cr on cr.name = my_role.role
$$;

notify pgrst, 'reload schema';
