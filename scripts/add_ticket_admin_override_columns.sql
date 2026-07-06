-- Adds the columns needed for the Admin Dashboard's pipeline table actions:
-- manual priority override and ticket cancellation.

alter table pmms.tickets
  add column if not exists priority_override text,
  add column if not exists cancel_type text,
  add column if not exists cancel_reason text,
  add column if not exists cancel_duplicate_ref text;
