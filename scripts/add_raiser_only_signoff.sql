-- Directors' request: sign-off (the Completed -> Archived transition) is
-- restricted to whoever raised the ticket -- not "any admin/manager", which
-- is what admin_full_access/manager_*_access allowed until now. Read access
-- (SELECT) is deliberately left untouched -- Pipeline, Dashboard, Reports
-- etc. all need every admin/manager to see every ticket regardless of who
-- raised it; only the specific write that sets status to 'Archived' gets
-- the extra check. Nothing else about an admin/manager's access changes.
--
-- The Ticket Submitter role (see add_submitter_role.sql) had NO update
-- policy at all -- a submitter could raise and watch, never act. Since the
-- rule is "only the raiser signs off" and a submitter's own dashboard has
-- no Sign-Off page, they need a narrow update path added here too, or any
-- ticket they raise would be permanently stuck once completed with nobody
-- able to sign it off. Scoped tightly to their own ticket, only the
-- Completed -> Archived transition -- matches "process your own ticket's
-- sign-off", not a general edit/reassign capability.

begin;

-- ── tickets: admin/manager archive-write now requires raised_by = self ────
drop policy if exists "admin_full_access" on pmms.tickets;
create policy "admin_full_access" on pmms.tickets
  for all to authenticated
  using (pmms.current_access_level() = 'admin')
  with check (
    pmms.current_access_level() = 'admin'
    and (status <> 'Archived' or raised_by = pmms.current_staff_id())
  );

drop policy if exists "manager_division_scoped_access" on pmms.tickets;
create policy "manager_division_scoped_access" on pmms.tickets
  for all to authenticated
  using (pmms.current_access_level() = 'manager' and pmms.current_division() is not null and pmms.category_division(category) = pmms.current_division())
  with check (
    pmms.current_access_level() = 'manager' and pmms.current_division() is not null and pmms.category_division(category) = pmms.current_division()
    and (status <> 'Archived' or raised_by = pmms.current_staff_id())
  );

drop policy if exists "manager_unscoped_full_access" on pmms.tickets;
create policy "manager_unscoped_full_access" on pmms.tickets
  for all to authenticated
  using (pmms.current_access_level() = 'manager' and pmms.current_division() is null)
  with check (
    pmms.current_access_level() = 'manager' and pmms.current_division() is null
    and (status <> 'Archived' or raised_by = pmms.current_staff_id())
  );

-- ── tickets: submitter can now sign off (only) their own completed ticket ─
create policy "submitter_archive_own" on pmms.tickets
  for update to authenticated
  using (pmms.current_access_level() = 'submitter' and raised_by = pmms.current_staff_id() and status = 'Completed')
  with check (pmms.current_access_level() = 'submitter' and raised_by = pmms.current_staff_id() and status = 'Archived');

-- ── comments/audit_events: submitter needs to post the same system
-- comment + audit trail entry the admin Sign-Off flow already posts on
-- every archive, for their own tickets only ───────────────────────────────
create policy "submitter_insert_own_ticket_comments" on pmms.comments
  for insert to authenticated
  with check (
    pmms.current_access_level() = 'submitter'
    and author_id = pmms.current_staff_id()
    and exists (select 1 from pmms.tickets t where t.id = comments.ticket_id and t.raised_by = pmms.current_staff_id())
  );

create policy "submitter_insert_own_events" on pmms.audit_events
  for insert to authenticated
  with check (pmms.current_access_level() = 'submitter' and actor_id = pmms.current_staff_id());

commit;

notify pgrst, 'reload schema';
