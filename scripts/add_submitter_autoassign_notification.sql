-- Submitters can now trigger auto-assignment on tickets they raise (see
-- suggestAutoAssignBuilder in client/src/pages/admin/shared.jsx), and the
-- assigned builder needs a notification like every other assignment path
-- does. There was no INSERT policy at all for 'submitter' on
-- pmms.notifications, so createNotification() would silently no-op under
-- RLS -- scoped the same way submitter_insert_own_ticket_comments already
-- is: only for a ticket the submitter themselves raised, and only
-- notifying whoever that ticket is actually assigned to (not an arbitrary
-- staff_id).
create policy "submitter_notify_assigned_builder" on pmms.notifications
  for insert to authenticated
  with check (
    pmms.current_access_level() = 'submitter'
    and exists (
      select 1 from pmms.tickets t
      where t.id = notifications.ticket_id
        and t.raised_by = pmms.current_staff_id()
        and t.assigned_builder_id = notifications.staff_id
    )
  );
