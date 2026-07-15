-- Cleaners Rota Phase 3: delay-reason approval workflow.
--
-- Deliberately side-channel fields, not a status transition -- a
-- routine-visit ticket's `status` never changes because of this flow,
-- which is what makes "the job simply stays open" true by construction.

alter table pmms.tickets add column if not exists delay_reason text;
alter table pmms.tickets add column if not exists delay_reason_note text;
alter table pmms.tickets add column if not exists delay_reason_status text;
alter table pmms.tickets add column if not exists delay_reason_submitted_at timestamptz;
alter table pmms.tickets add column if not exists delay_reason_reviewed_at timestamptz;
alter table pmms.tickets add column if not exists delay_reason_reviewed_by uuid references public.staff(id);
