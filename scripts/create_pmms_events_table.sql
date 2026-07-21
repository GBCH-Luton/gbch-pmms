-- Events: a lightweight entity that groups several related tickets
-- together (e.g. a landlord inspection spawning a cleaning ticket, a
-- repair ticket, and a reminder), so Compliance/Landlord Liaison can
-- coordinate and watch a multi-ticket situation through to completion
-- without being able to directly assign a ticket to a builder
-- themselves -- that authority stays wherever it already sits today.
--
-- No status/completion column here deliberately -- an Event's
-- Open/Complete state is always computed client-side from whether
-- every linked ticket has reached a terminal status, so it can never
-- drift out of sync with the tickets it's tracking.
create table if not exists pmms.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  property_id uuid references pmms.properties(id),
  event_date timestamptz,
  created_by uuid references public.staff(id),
  created_at timestamptz not null default now()
);

alter table pmms.tickets add column if not exists event_id uuid references pmms.events(id);

alter table pmms.events enable row level security;

-- Mirrors pmms.current_division()'s exact JSON-parsing shape, reading
-- a new 'canCreateEvents' field on the same custom_roles setting row
-- (see client/src/lib/roles.js's normalizeCustomRoles -- this is the
-- SQL-side mirror of that same resolver, same pattern as
-- current_access_level()/current_division()).
create or replace function pmms.current_can_create_events()
returns boolean
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
      case jsonb_typeof(elem) when 'string' then false else coalesce((elem ->> 'canCreateEvents')::boolean, false) end as can_create_events
    from pmms.settings s,
      lateral jsonb_array_elements(coalesce(s.setting_value, '[]'::jsonb)) elem
    where s.setting_key = 'custom_roles'
  )
  select
    case
      when me.active = false then false
      else coalesce(cr.can_create_events, false)
    end
  from me
  left join my_role on true
  left join custom_roles cr on cr.name = my_role.role
$$;

-- Any manager (regardless of division) can view events and link
-- tickets to them -- follows the same "admin_manager_full_access"
-- shape already used for Properties/Staff/Settings (NOT the
-- tickets-specific 3-way division split, which doesn't apply here).
create policy "admin_full_access" on pmms.events
  for all to authenticated
  using (pmms.current_access_level() = 'admin')
  with check (pmms.current_access_level() = 'admin');

create policy "manager_read_and_link" on pmms.events
  for select to authenticated
  using (pmms.is_admin_or_manager());

create policy "manager_update_any" on pmms.events
  for update to authenticated
  using (pmms.is_admin_or_manager())
  with check (pmms.is_admin_or_manager());

-- Creating a brand-new Event is gated to whichever roles have been
-- explicitly given the canCreateEvents permission (plus Admin) --
-- separate from the broader "any manager can view/link" access above.
create policy "manager_create_gated" on pmms.events
  for insert to authenticated
  with check (
    pmms.current_access_level() = 'admin'
    or (pmms.current_access_level() = 'manager' and pmms.current_can_create_events())
  );
