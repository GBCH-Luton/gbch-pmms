-- Builders can only SELECT their own row in public.staff
-- (builder_read_own_row), so Team Chat's @mention picker returned nobody
-- for a builder caller. Same situation pmms.builder_properties() already
-- solves elsewhere in this app: a narrow SECURITY DEFINER function that
-- exposes just id/name for anyone with a PMMS role, rather than loosening
-- public.staff's RLS itself (deliberately left alone since the 2026-07-22
-- security audit).
--
-- Scoped to the channel being viewed (target_division) -- an earlier
-- version returned every staff member with any PMMS role regardless of
-- division, which let a Maintenance builder @mention someone in
-- Housekeeping who could never actually see/respond in that channel
-- (found live, reported directly).

-- Mirrors pmms.current_access_level()'s exact branching, but for an
-- arbitrary target_staff_id -- the same relationship pmms.staff_division()
-- already has to pmms.current_division(). Needed here because knowing
-- "is this OTHER person an Admin/unscoped-manager" (who can see every
-- channel) requires more than just their division.
create or replace function pmms.staff_access_level(target_staff_id uuid)
 returns text
 language sql
 stable security definer
 set search_path to 'public', 'pmms'
as $function$
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
      case jsonb_typeof(elem) when 'string' then 'none' else coalesce(elem ->> 'accessLevel', 'none') end as access_level
    from pmms.settings s,
      lateral jsonb_array_elements(coalesce(s.setting_value, '[]'::jsonb)) elem
    where s.setting_key = 'custom_roles'
  )
  select
    case
      when target.active = false then null
      when target_role.role = 'Admin' then 'admin'
      when target_role.role = 'Builder' then 'builder'
      when target_role.role in ('Cleaner', 'Support Worker') then null
      when cr.access_level = 'manager' then 'manager'
      when cr.access_level = 'builder' then 'builder'
      else null
    end
  from target
  left join target_role on true
  left join custom_roles cr on cr.name = target_role.role
$function$;

create or replace function pmms.chat_channel_members(target_division text)
 returns table(id uuid, name text)
 language sql
 stable security definer
 set search_path to 'public', 'pmms'
as $function$
  select s.id, s.name
  from public.staff s
  join pmms.staff_roles sr on sr.staff_id = s.id
  where s.active = true
    and (
      -- Admins and unscoped managers can see/post in every channel, so
      -- they're legitimately mentionable from any of them.
      pmms.staff_access_level(s.id) = 'admin'
      or (pmms.staff_access_level(s.id) = 'manager' and pmms.staff_division(s.id) is null)
      -- Everyone else only if their own resolved division (defaulting
      -- built-in Builder to 'Maintenance', same convention used
      -- everywhere else in this app) matches THIS channel specifically.
      or coalesce(pmms.staff_division(s.id), 'Maintenance') = target_division
    )
$function$;

notify pgrst, 'reload schema';
