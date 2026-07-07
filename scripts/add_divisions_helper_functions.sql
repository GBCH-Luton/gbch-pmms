-- Foundation for the Divisions feature. Two helper functions, mirroring the
-- exact structure of pmms.current_access_level() (add_rls_role_helper_functions.sql)
-- so the two stay easy to keep in sync if that logic ever changes.
--
-- "Division" is deliberately NOT a new table -- it's stored the same way
-- custom_roles/maintenance_categories already are, as plain JSON in
-- pmms.settings:
--   - pmms.settings['custom_roles'][n].division  (string or absent/null)
--   - pmms.settings['maintenance_categories'][categoryName].division (string or absent)
-- A role/category with no division tag is "unscoped" -- current_division()
-- returns null for every role that exists today, and category_division()
-- defaults to 'Maintenance', so this is purely additive: nothing that
-- exists today changes behavior until someone actually tags a role or
-- category with a division via the Roles/Settings UI.

-- Resolves the calling user's division from their PMMS role's `division`
-- field. Null means "unscoped" (full access, exactly like every manager
-- today) -- see manager_unscoped_full_access in add_rls_division_scoping.sql.
create or replace function pmms.current_division()
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
      case jsonb_typeof(elem) when 'string' then null else elem ->> 'division' end as division
    from pmms.settings s,
      lateral jsonb_array_elements(coalesce(s.setting_value, '[]'::jsonb)) elem
    where s.setting_key = 'custom_roles'
  )
  select
    case
      when me.active = false then null
      else cr.division
    end
  from me
  left join my_role on true
  left join custom_roles cr on cr.name = my_role.role
$$;

-- Resolves which division a given ticket category belongs to, defaulting
-- to 'Maintenance' for any category that hasn't been explicitly tagged
-- (i.e. every category that exists today, until someone tags it in
-- Settings), so this is safe to use in RLS immediately.
create or replace function pmms.category_division(cat text)
returns text
language sql
security definer
stable
set search_path = public, pmms
as $$
  select coalesce(
    (select s.setting_value -> cat ->> 'division' from pmms.settings s where s.setting_key = 'maintenance_categories'),
    'Maintenance'
  )
$$;
