-- Fixes a real bug reported 2026-08-12 by a Housekeeper (tickets #135,
-- #163): completing a job only ever accepted ONE photo, via a plain
-- <input type="file"> that predates the multi-file/video
-- TicketMediaPicker + pmms.ticket_attachments already used for raising a
-- ticket. Reusing that same pipeline for completion means the same
-- ticket_attachments table now needs to tell "what he reported" and "what
-- he did to fix it" apart -- every existing display site
-- (TicketAttachmentGallery fallbackUrl={photo_url}) expects only
-- report-time photos, and would otherwise show completion evidence mixed
-- into that same gallery the moment completion started using the table too.
alter table pmms.ticket_attachments
  add column if not exists stage text not null default 'reported';

alter table pmms.ticket_attachments
  drop constraint if exists ticket_attachments_stage_check;
alter table pmms.ticket_attachments
  add constraint ticket_attachments_stage_check check (stage in ('reported', 'completed'));

-- Second bug, found while fixing the first: a builder could only attach
-- (report-stage) photos to a ticket they themselves raised, never one
-- assigned to them -- fine for "raise a ticket" (always self-raised) but
-- wrong the moment the same insert path is used for completing a job,
-- which is almost always someone else's ticket, just assigned to them.
drop policy if exists builder_insert_own_ticket_attachments on pmms.ticket_attachments;
create policy builder_insert_own_ticket_attachments
on pmms.ticket_attachments
for insert
with check (
  pmms.current_access_level() = 'builder'
  and exists (
    select 1 from pmms.tickets t
    where t.id = ticket_attachments.ticket_id
      and (t.assigned_builder_id = pmms.current_staff_id() or t.raised_by = pmms.current_staff_id())
  )
);
