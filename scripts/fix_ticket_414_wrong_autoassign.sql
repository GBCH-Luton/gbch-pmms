-- Corrects ticket #414 (raised by a Ticket Submitter), which was silently
-- auto-assigned by a stale client still running pre-2026-08-20 logic --
-- see scripts/add_auto_assign_on_raise_setting.sql for the underlying fix.
-- Stuart Blease had not started any work on it (no work_sessions row), so
-- resetting it is safe -- nothing real is being taken away from him.

update pmms.tickets
set status = 'Pending',
    assigned_builder_id = null,
    assign_type = 'Manual',
    first_assigned_at = null,
    status_changed_at = now()
where id = 'ee4d081b-4503-45a1-9dcf-cea4e63766fc';

insert into pmms.comments (ticket_id, author_id, author_name, role, body)
values (
  'ee4d081b-4503-45a1-9dcf-cea4e63766fc',
  null,
  'System',
  null,
  'Reset to Pending -- this was auto-assigned by a stale browser tab still running old logic from before silent auto-assign was disabled for Submitter-raised tickets. Needs manual assignment.'
);
