-- Divisions RLS, the one behavior-changing step in the Divisions feature.
-- Requires add_divisions_helper_functions.sql to already be applied.
--
-- Splits the single blanket "admin_manager_full_access" policy (which has
-- always treated every admin and every manager identically, full access to
-- everything) into three, on the 3 tables a manager actually touches when
-- handling a ticket:
--
--   admin_full_access             -- real Admins, unrestricted, unchanged.
--   manager_unscoped_full_access  -- managers with no division tag on their
--                                    role (pmms.current_division() is null)
--                                    -- unrestricted, IDENTICAL to today's
--                                    behavior. Every manager role that
--                                    exists right now has no division tag,
--                                    so this is a no-regression guarantee,
--                                    not a new restriction.
--   manager_division_scoped_access -- managers whose role IS tagged with a
--                                    division -- restricted to tickets
--                                    (and their comments/audit trail) whose
--                                    category belongs to that same division.
--
-- pmms.properties and all staff/settings tables are deliberately untouched
-- -- a division manager still sees Properties/Staff/Clocking exactly like
-- any manager, only the ticket Pipeline and its reassignment are scoped.

-- ── tickets ──────────────────────────────────────────────────────────────
drop policy if exists "admin_manager_full_access" on pmms.tickets;

create policy "admin_full_access" on pmms.tickets
  for all to authenticated
  using (pmms.current_access_level() = 'admin')
  with check (pmms.current_access_level() = 'admin');

create policy "manager_unscoped_full_access" on pmms.tickets
  for all to authenticated
  using (pmms.current_access_level() = 'manager' and pmms.current_division() is null)
  with check (pmms.current_access_level() = 'manager' and pmms.current_division() is null);

create policy "manager_division_scoped_access" on pmms.tickets
  for all to authenticated
  using (
    pmms.current_access_level() = 'manager'
    and pmms.current_division() is not null
    and pmms.category_division(category) = pmms.current_division()
  )
  with check (
    pmms.current_access_level() = 'manager'
    and pmms.current_division() is not null
    and pmms.category_division(category) = pmms.current_division()
  );

-- ── comments ─────────────────────────────────────────────────────────────
drop policy if exists "admin_manager_full_access" on pmms.comments;

create policy "admin_full_access" on pmms.comments
  for all to authenticated
  using (pmms.current_access_level() = 'admin')
  with check (pmms.current_access_level() = 'admin');

create policy "manager_unscoped_full_access" on pmms.comments
  for all to authenticated
  using (pmms.current_access_level() = 'manager' and pmms.current_division() is null)
  with check (pmms.current_access_level() = 'manager' and pmms.current_division() is null);

create policy "manager_division_scoped_access" on pmms.comments
  for all to authenticated
  using (
    pmms.current_access_level() = 'manager'
    and pmms.current_division() is not null
    and exists (
      select 1 from pmms.tickets t
      where t.id = comments.ticket_id
        and pmms.category_division(t.category) = pmms.current_division()
    )
  )
  with check (
    pmms.current_access_level() = 'manager'
    and pmms.current_division() is not null
    and exists (
      select 1 from pmms.tickets t
      where t.id = comments.ticket_id
        and pmms.category_division(t.category) = pmms.current_division()
    )
  );

-- ── audit_events ─────────────────────────────────────────────────────────
drop policy if exists "admin_manager_full_access" on pmms.audit_events;

create policy "admin_full_access" on pmms.audit_events
  for all to authenticated
  using (pmms.current_access_level() = 'admin')
  with check (pmms.current_access_level() = 'admin');

create policy "manager_unscoped_full_access" on pmms.audit_events
  for all to authenticated
  using (pmms.current_access_level() = 'manager' and pmms.current_division() is null)
  with check (pmms.current_access_level() = 'manager' and pmms.current_division() is null);

create policy "manager_division_scoped_access" on pmms.audit_events
  for all to authenticated
  using (
    pmms.current_access_level() = 'manager'
    and pmms.current_division() is not null
    and exists (
      select 1 from pmms.tickets t
      where t.id = audit_events.ticket_id
        and pmms.category_division(t.category) = pmms.current_division()
    )
  )
  with check (
    pmms.current_access_level() = 'manager'
    and pmms.current_division() is not null
    and exists (
      select 1 from pmms.tickets t
      where t.id = audit_events.ticket_id
        and pmms.category_division(t.category) = pmms.current_division()
    )
  );
