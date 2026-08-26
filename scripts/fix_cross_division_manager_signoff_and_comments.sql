-- Found live 2026-08-26: Kathryn Williamson (Landlord Liaison) raised ticket
-- #500 in "Security & Access Systems" -- a Maintenance-division category --
-- using her landlord_liaison_insert_any_division right (see
-- add_landlord_liaison_ticket_insert.sql, 2026-08-19). She could see the
-- ticket itself (landlord_liaison_select_own_raised) and post a comment on
-- it (manager_insert_own_ticket_comments, generic to any manager, added by
-- fix_manager_own_ticket_comments_audit.sql), but:
--   1) could not see ANY comments on the ticket, including her own --
--      pmms.comments had no SELECT policy for "a manager reading a ticket
--      they raised outside their own division", only the admin/builder/
--      submitter equivalents.
--   2) could not sign the ticket off at all -- pmms.tickets had an
--      INSERT and a SELECT policy for her raising outside her division,
--      but no UPDATE policy, so the Completed -> Archived (and reopen,
--      Completed -> Assigned) writes in AdminSignOff.jsx's MySignOffs
--      were rejected by RLS with no matching policy to allow them.
-- Same root cause as fix_manager_own_ticket_comments_audit.sql: division-
-- scoped managers are covered by manager_division_scoped_access for
-- everything (its category-division always matches their own division),
-- but Landlord Liaison and Housekeeping Manager are the two roles that can
-- raise a ticket OUTSIDE their own division, and each capability added for
-- that (insert a ticket, insert a comment, insert an audit event) needs a
-- matching read/write pair added alongside it or the raiser hits a dead
-- end partway through the ticket's lifecycle.

begin;

-- ── comments: any manager can read comments on a ticket they themselves
-- raised, regardless of division -- mirrors manager_insert_own_ticket_comments
-- (already generic to any manager) and the existing builder/submitter
-- select-own-ticket-comments shape.
create policy "manager_select_own_ticket_comments" on pmms.comments
  for select to authenticated
  using (
    pmms.current_access_level() = 'manager'
    and exists (select 1 from pmms.tickets t where t.id = comments.ticket_id and t.raised_by = pmms.current_staff_id())
  );

-- ── audit_events: same gap, same fix -- manager_insert_own_events already
-- lets her write the audit trail entry the sign-off flow posts, but nothing
-- let her read it back.
create policy "manager_select_own_events" on pmms.audit_events
  for select to authenticated
  using (
    pmms.current_access_level() = 'manager'
    and exists (select 1 from pmms.tickets t where t.id = audit_events.ticket_id and t.raised_by = pmms.current_staff_id())
  );

-- ── tickets: Landlord Liaison / Housekeeping Manager can sign off (archive
-- or reopen) a Completed ticket they themselves raised outside their own
-- division -- narrowly scoped to the exact transition AdminSignOff.jsx's
-- MySignOffs performs, matching submitter_archive_own's shape.
create policy "landlord_liaison_signoff_own_raised" on pmms.tickets
  for update to authenticated
  using (
    pmms.current_access_level() = 'manager'
    and pmms.current_division() = 'Landlord Liaison'
    and raised_by = pmms.current_staff_id()
    and status = 'Completed'
  )
  with check (
    pmms.current_access_level() = 'manager'
    and pmms.current_division() = 'Landlord Liaison'
    and raised_by = pmms.current_staff_id()
    and status in ('Archived', 'Assigned')
  );

create policy "housekeeping_manager_signoff_own_raised" on pmms.tickets
  for update to authenticated
  using (
    pmms.current_access_level() = 'manager'
    and pmms.current_division() = 'Housekeeping'
    and raised_by = pmms.current_staff_id()
    and status = 'Completed'
  )
  with check (
    pmms.current_access_level() = 'manager'
    and pmms.current_division() = 'Housekeeping'
    and raised_by = pmms.current_staff_id()
    and status in ('Archived', 'Assigned')
  );

commit;

notify pgrst, 'reload schema';
