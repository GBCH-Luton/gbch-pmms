-- Fixes a real bug found 2026-08-12: a Ticket Submitter's only UPDATE
-- policy on pmms.tickets is submitter_archive_own (Completed -> Archived,
-- for sign-off). NewReportForm's second step -- setting tickets.photo_url
-- right after the initial insert -- was silently blocked by RLS the whole
-- time (0 rows matched, no error), even though the photo itself uploaded
-- fine and its row in pmms.ticket_attachments is intact. Narrow
-- SECURITY DEFINER RPC, same pattern as complete_garden_ticket_property_update,
-- rather than widening the submitter's raw UPDATE access to their own
-- Pending ticket (which would let them edit any column, not just this one).
create or replace function pmms.set_ticket_report_photo(p_ticket_id uuid, p_photo_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update pmms.tickets
  set photo_url = p_photo_url
  where id = p_ticket_id
    and raised_by = pmms.current_staff_id()
    and pmms.current_access_level() = 'submitter'
    and status = 'Pending';
end;
$$;

grant execute on function pmms.set_ticket_report_photo(uuid, text) to authenticated;

-- One-time repair for tickets already affected -- every row in
-- ticket_attachments is unambiguously a "reported" photo (completion
-- photos are stored directly on completion_photo_url, never through this
-- table), so backfilling the earliest attachment per ticket is safe.
update pmms.tickets t
set photo_url = a.url
from (
  select distinct on (ticket_id) ticket_id, url
  from pmms.ticket_attachments
  order by ticket_id, created_at asc
) a
where t.id = a.ticket_id
  and t.photo_url is null;
