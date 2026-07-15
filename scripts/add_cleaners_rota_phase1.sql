-- Cleaners Rota Phase 1: schema foundation.
--
-- One cleaner per property (assigned_cleaner_id), with a baseline
-- timestamp (cleaner_assigned_since) the routine-visit cadence counts
-- from for a newly-assigned pairing -- so a property doesn't instantly
-- read as overdue the moment a cleaner is assigned.
--
-- staff.gender is general-purpose (not Housekeeping-specific), matching
-- how staff_gender_restriction on properties already reads "support
-- worker" rather than "cleaner" -- it powers automated matching against
-- that existing restriction field for any staff-to-property assignment,
-- not just cleaners.

alter table pmms.properties add column if not exists assigned_cleaner_id uuid references public.staff(id);
alter table pmms.properties add column if not exists cleaner_assigned_since timestamptz;

alter table public.staff add column if not exists gender text;
