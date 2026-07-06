-- Adds the two new columns the rebuilt multi-step "Raise New Ticket" form
-- needs: issue_tag (the selected sub-tag text) and raised_by_name (a
-- denormalized copy of the reporter's name, alongside the existing raised_by
-- uuid FK). priority_score (existing numeric column) is reused directly, so
-- no change needed there.
--
-- Note: the previous version of this form added `department` and `priority`
-- (text) columns -- those are no longer written to by the rebuilt form but
-- are left in place rather than dropped without being asked.
--
-- Run this in the SANDBOX project's SQL Editor (and the old project too if
-- you're still using its pmms schema via `npm run dev`).

alter table pmms.tickets
  add column if not exists issue_tag text,
  add column if not exists raised_by_name text;
