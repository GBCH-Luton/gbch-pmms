-- Adds Due Date / Follow-Up Date to Property Notes -- the two fields the
-- Follow-Ups mockup needed so a note can be chased instead of just sitting
-- there. Only these two columns; everything else about property_notes
-- (categories, flag mechanic) stays as-is.
alter table pmms.property_notes
  add column if not exists due_date date,
  add column if not exists follow_up_date date;

notify pgrst, 'reload schema';
