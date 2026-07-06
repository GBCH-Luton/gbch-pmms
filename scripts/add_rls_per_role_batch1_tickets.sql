-- Per-role RLS, batch 1 of 3: tickets, comments, work_sessions, audit_events.
-- Replaces the earlier "any logged-in user has full access" policies on
-- these 4 tables with real least-privilege rules. Requires
-- add_rls_role_helper_functions.sql to already be applied.
--
-- Rules (confirmed against real BuilderDashboard.jsx usage before writing
-- this -- see conversation for the research this is based on):
--   Admin/Manager: full access to all 4 tables, unchanged.
--   Builder, tickets: can see any ticket that isn't Completed/Archived/
--     Cancelled (keeps the "duplicate ticket at this property" check
--     working, which needs to see other builders' open jobs), or their own
--     ticket regardless of status. Can only insert a ticket they raised
--     themselves, and only update a ticket assigned to or raised by them.
--   Builder, comments: only on tickets assigned to or raised by them --
--     stricter than the tickets table itself, since the app never actually
--     reads/writes comments on someone else's job (this is a deliberate
--     tightening beyond what the "any open ticket" carve-out allows).
--   Builder, work_sessions: only their own sessions (builder_id = them).
--   Builder, audit_events: insert-only, can log their own actions but can
--     never read the audit trail.

-- ── tickets ──────────────────────────────────────────────────────────────
drop policy if exists "authenticated full access" on pmms.tickets;

create policy "admin_manager_full_access" on pmms.tickets
  for all to authenticated
  using (pmms.is_admin_or_manager())
  with check (pmms.is_admin_or_manager());

create policy "builder_select_open_or_own" on pmms.tickets
  for select to authenticated
  using (
    pmms.current_access_level() = 'builder' and (
      status not in ('Completed', 'Archived', 'Cancelled')
      or assigned_builder_id = pmms.current_staff_id()
      or raised_by = pmms.current_staff_id()
    )
  );

create policy "builder_insert_own" on pmms.tickets
  for insert to authenticated
  with check (
    pmms.current_access_level() = 'builder' and raised_by = pmms.current_staff_id()
  );

create policy "builder_update_own" on pmms.tickets
  for update to authenticated
  using (
    pmms.current_access_level() = 'builder' and (
      assigned_builder_id = pmms.current_staff_id() or raised_by = pmms.current_staff_id()
    )
  )
  with check (
    pmms.current_access_level() = 'builder' and (
      assigned_builder_id = pmms.current_staff_id() or raised_by = pmms.current_staff_id()
    )
  );

-- ── comments ─────────────────────────────────────────────────────────────
drop policy if exists "authenticated full access" on pmms.comments;

create policy "admin_manager_full_access" on pmms.comments
  for all to authenticated
  using (pmms.is_admin_or_manager())
  with check (pmms.is_admin_or_manager());

create policy "builder_select_own_ticket_comments" on pmms.comments
  for select to authenticated
  using (
    pmms.current_access_level() = 'builder' and exists (
      select 1 from pmms.tickets t
      where t.id = comments.ticket_id
        and (t.assigned_builder_id = pmms.current_staff_id() or t.raised_by = pmms.current_staff_id())
    )
  );

create policy "builder_insert_own_ticket_comments" on pmms.comments
  for insert to authenticated
  with check (
    pmms.current_access_level() = 'builder'
    and author_id = pmms.current_staff_id()
    and exists (
      select 1 from pmms.tickets t
      where t.id = comments.ticket_id
        and (t.assigned_builder_id = pmms.current_staff_id() or t.raised_by = pmms.current_staff_id())
    )
  );

-- ── work_sessions ────────────────────────────────────────────────────────
drop policy if exists "authenticated full access" on pmms.work_sessions;

create policy "admin_manager_full_access" on pmms.work_sessions
  for all to authenticated
  using (pmms.is_admin_or_manager())
  with check (pmms.is_admin_or_manager());

create policy "builder_own_sessions_select" on pmms.work_sessions
  for select to authenticated
  using (pmms.current_access_level() = 'builder' and builder_id = pmms.current_staff_id());

create policy "builder_own_sessions_insert" on pmms.work_sessions
  for insert to authenticated
  with check (pmms.current_access_level() = 'builder' and builder_id = pmms.current_staff_id());

create policy "builder_own_sessions_update" on pmms.work_sessions
  for update to authenticated
  using (pmms.current_access_level() = 'builder' and builder_id = pmms.current_staff_id())
  with check (pmms.current_access_level() = 'builder' and builder_id = pmms.current_staff_id());

-- ── audit_events ─────────────────────────────────────────────────────────
drop policy if exists "authenticated full access" on pmms.audit_events;

create policy "admin_manager_full_access" on pmms.audit_events
  for all to authenticated
  using (pmms.is_admin_or_manager())
  with check (pmms.is_admin_or_manager());

create policy "builder_insert_own_events" on pmms.audit_events
  for insert to authenticated
  with check (pmms.current_access_level() = 'builder' and actor_id = pmms.current_staff_id());
-- Deliberately no builder SELECT policy -- builders can log audit events
-- but can never read the audit trail.
