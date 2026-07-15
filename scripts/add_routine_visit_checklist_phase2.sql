-- Cleaners Rota Phase 2: routine visit checklist.
--
-- checklist_responses is a snapshot taken at completion time, not a live
-- reference to the settings template -- so editing the template later
-- doesn't rewrite history for visits already completed. Shape:
-- [{ "label": "...", "checked": true }].

alter table pmms.tickets add column if not exists checklist_responses jsonb;
