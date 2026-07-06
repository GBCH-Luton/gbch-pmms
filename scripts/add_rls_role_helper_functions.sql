-- Foundation for per-role Row-Level Security. Two helper functions every
-- later policy builds on.
--
-- Critical fact this all depends on: public.staff.id does NOT match the
-- Supabase Auth user's id (confirmed by checking all 3 real logins -- every
-- one has a completely different UUID between their staff row and their
-- auth account). The only reliable link between "who's logged in" and
-- "which staff row is theirs" is email, the same fragile join already
-- patched around in App.jsx/authorizeAdmin.ts (see those files' own
-- comments on the duplicate-email history). Both functions below use the
-- same defensive pattern: order by id, take the first match, never error
-- on a duplicate.

-- Resolves the calling user's own staff.id from their verified JWT email.
create or replace function pmms.current_staff_id()
returns uuid
language sql
security definer
stable
set search_path = public, pmms
as $$
  select id from public.staff
  where email = auth.jwt() ->> 'email'
  order by id
  limit 1
$$;

-- Resolves the calling user's access level: 'admin' | 'manager' | 'builder'
-- | null. Mirrors accessLevelForRole() + the active-override in
-- client/src/lib/roles.js and client/src/App.jsx exactly -- if that JS
-- logic ever changes, this function must be updated to match, or the app's
-- UI and the database's actual enforcement will quietly drift apart.
--
-- Deliberately does NOT replicate roleFromJobTitle() (the job-title-based
-- access path) -- every real login today already has an explicit PMMS role
-- assigned, and the "Add Staff" flow requires picking one for every new
-- person going forward, so a role-only check matches real-world usage
-- without the complexity/fragility of also matching job-title text in SQL.
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
      when cr.access_level = 'manager' then 'manager'
      when cr.access_level = 'builder' then 'builder'
      else null
    end
  from me
  left join my_role on true
  left join custom_roles cr on cr.name = my_role.role
$$;

-- Convenience wrapper used throughout the upcoming table policies.
create or replace function pmms.is_admin_or_manager()
returns boolean
language sql
security definer
stable
set search_path = public, pmms
as $$
  select pmms.current_access_level() in ('admin', 'manager')
$$;
