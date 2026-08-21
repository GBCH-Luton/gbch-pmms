-- Found live 2026-08-21: Landlord Liaison raising a Property Onboarding
-- ticket (flagging a Pass, or "something missed") got the ticket created
-- fine, but the automatic system comment and audit event describing it
-- silently failed with "new row violates row-level security policy" --
-- postSystemComment/postAuditEvent (shared.jsx) are fire-and-forget, so
-- nothing surfaced to her, just a missing audit trail.
--
-- Root cause: manager_division_scoped_access on pmms.comments/audit_events
-- requires the TICKET's category-division to match the manager's OWN
-- division -- fine for a normal division manager writing about their own
-- division's tickets, but wrong for Landlord Liaison, who (since
-- add_landlord_liaison_ticket_insert.sql, 2026-08-19) can raise a ticket in
-- ANY category/division, not just her own. Property Onboarding tickets are
-- tagged division 'Maintenance', so her own comments/audit events about a
-- ticket she just raised there got blocked. This gap predates Property
-- Onboarding -- that feature was just the first thing to actually exercise
-- a division-scoped manager raising a ticket outside their division and
-- then immediately writing about it.
--
-- Fix mirrors the existing builder_insert_own_ticket_comments /
-- submitter_insert_own_ticket_comments shape exactly: any manager can
-- insert a comment/audit event on a ticket they themselves raised,
-- regardless of category-division match. No SELECT policy needed --
-- postSystemComment/postAuditEvent are plain inserts, no .select() chained.
create policy "manager_insert_own_ticket_comments" on pmms.comments
  for insert to authenticated
  with check (
    pmms.current_access_level() = 'manager'
    and author_id = pmms.current_staff_id()
    and exists (select 1 from pmms.tickets t where t.id = comments.ticket_id and t.raised_by = pmms.current_staff_id())
  );

create policy "manager_insert_own_events" on pmms.audit_events
  for insert to authenticated
  with check (
    pmms.current_access_level() = 'manager'
    and actor_id = pmms.current_staff_id()
    and exists (select 1 from pmms.tickets t where t.id = audit_events.ticket_id and t.raised_by = pmms.current_staff_id())
  );

notify pgrst, 'reload schema';
