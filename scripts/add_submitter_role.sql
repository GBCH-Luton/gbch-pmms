-- Adds a 4th PMMS access level, 'submitter' -- alongside admin/manager/
-- builder. Built as an internal stand-in for the future standalone Support
-- system: until that exists (not started, expected to take a long time), a
-- real PMMS staff member is given a "Ticket Submitter"-labelled custom role
-- so they can raise tickets and see only their own submissions' status/
-- comments, without the full Manager-level access that would otherwise be
-- the only way to reach "Log a Ticket". Expected to be in real use for
-- as long as Phase 1 testing runs (weeks, not a one-off), so it's built as
-- a real least-privilege role, not a trust-based workaround.
--
-- Purely additive: no existing admin/manager/builder policy is touched.

-- ── current_access_level(): recognise the new tier ────────────────────────
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
      when cr.access_level = 'submitter' then 'submitter'
      else null
    end
  from me
  left join my_role on true
  left join custom_roles cr on cr.name = my_role.role
$$;

-- ── staff_roles: a submitter needs to read their own role row ─────────────
-- (App.jsx's fetchProfile queries this to resolve accessLevel -- without
-- this, current_access_level() would compute 'submitter' correctly, but the
-- client-side lookup that discovers *which* role name to feed into
-- accessLevelForRole() would come back empty, and login would silently
-- fall through to no access.)
drop policy if exists "submitter_read_own_role" on pmms.staff_roles;
create policy "submitter_read_own_role" on pmms.staff_roles
  for select to authenticated
  using (pmms.current_access_level() = 'submitter' and staff_id = pmms.current_staff_id());

-- ── tickets: submit + view own only ────────────────────────────────────────
drop policy if exists "submitter_insert_own" on pmms.tickets;
create policy "submitter_insert_own" on pmms.tickets
  for insert to authenticated
  with check (
    pmms.current_access_level() = 'submitter' and raised_by = pmms.current_staff_id()
  );

drop policy if exists "submitter_select_own" on pmms.tickets;
create policy "submitter_select_own" on pmms.tickets
  for select to authenticated
  using (
    pmms.current_access_level() = 'submitter' and raised_by = pmms.current_staff_id()
  );
-- No update/delete policy -- a submitter can raise and watch, never edit,
-- reassign, or change status. Matches the "view history and process" ask
-- (read-only), not a "process" ask (that's still a manager/admin action).

-- ── comments: read-only, own tickets only ──────────────────────────────────
drop policy if exists "submitter_select_own_ticket_comments" on pmms.comments;
create policy "submitter_select_own_ticket_comments" on pmms.comments
  for select to authenticated
  using (
    pmms.current_access_level() = 'submitter' and exists (
      select 1 from pmms.tickets t
      where t.id = comments.ticket_id and t.raised_by = pmms.current_staff_id()
    )
  );
-- Deliberately no insert policy -- a submitter can read replies/updates
-- left on their ticket, not post their own comments (v1 scope; easy to add
-- later if two-way commenting turns out to be wanted).

-- ── builder_properties(): let a submitter search the property list too ────
-- Already the narrow, safe-column-only property lookup builders use to
-- avoid direct row-level access to pmms.properties (see
-- fix_builder_property_column_exposure.sql) -- same needs, same function,
-- just widening the internal role check by one value. Still returns only
-- id/address/high_vulnerability/layout_type/safeguards/electrical_shutoff/
-- gas_shutoff, nothing sensitive (rent, landlord contact, wifi, etc.).
create or replace function pmms.builder_properties(property_ids uuid[] default null)
returns table (
  id uuid,
  address text,
  high_vulnerability boolean,
  layout_type text,
  safeguards text,
  electrical_shutoff text,
  gas_shutoff text
)
language sql
security definer
stable
set search_path = public, pmms
as $$
  select p.id, p.address, p.high_vulnerability, p.layout_type, p.safeguards, p.electrical_shutoff, p.gas_shutoff
  from pmms.properties p
  where pmms.current_access_level() in ('builder', 'submitter')
    and (property_ids is null or p.id = any(property_ids))
$$;
