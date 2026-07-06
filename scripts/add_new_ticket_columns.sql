-- Adds the columns the "Raise New Ticket" form needs on pmms.tickets:
-- department (free text), priority (free text, distinct from the existing
-- numeric priority_score used for sorting/urgency tiles), and raised_by
-- (who submitted the ticket -- references public.staff like the other
-- person-reference columns on this schema).
--
-- Run this in the SANDBOX project's SQL Editor. If you still use the old
-- project's pmms schema via `npm run dev` (rather than having dropped it),
-- run it there too so both stay in sync.

alter table pmms.tickets
  add column if not exists department text,
  add column if not exists priority text default 'Normal',
  add column if not exists raised_by uuid references public.staff (id);
