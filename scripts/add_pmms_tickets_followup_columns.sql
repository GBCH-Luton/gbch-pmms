-- "Needs a follow-up" flag on job completion -- was part of the approved
-- Builder v2 simulation design but never made it into the real Complete
-- flow when the Leaving Site rework shipped (2026-08-15). A completed job
-- can be fine to close but still need something picked up later, e.g.
-- "fixed the fridge, but it should really be replaced."

alter table pmms.tickets
  add column if not exists needs_followup boolean not null default false,
  add column if not exists followup_note text;

notify pgrst, 'reload schema';
