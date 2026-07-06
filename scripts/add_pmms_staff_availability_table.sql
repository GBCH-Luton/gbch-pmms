-- Adds pmms.staff_availability, a PMMS-only per-staff availability status
-- (Available / On Leave / Sick), separate from public.staff.active.
--
-- Why: staff.active is an employment on/off switch controlled by IT admins
-- on the Admin page (account created/deactivated). It says nothing about
-- whether an active, employed builder happens to be off sick or on leave
-- this week. Without this, a builder on leave still shows up identically
-- to anyone else in the Reassign and Log a Ticket "assign to builder"
-- pickers, with no warning to the manager. This table lets a manager flag
-- someone as temporarily unavailable (with an optional short note, e.g.
-- "back Monday") from the Staff page, without touching their account
-- status at all.
--
-- staff_id has ON DELETE CASCADE, so deleting a public.staff row (if that
-- ever happens from elsewhere) cleans up its PMMS availability row too.
--
-- RLS is explicitly disabled, matching every other pmms table (see
-- disable_rls_new_project.sql) -- new tables in this project default to
-- RLS ON, which silently blocks reads and hard-fails writes until this is
-- run.

create table if not exists pmms.staff_availability (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  status text not null default 'Available',
  note text,
  updated_at timestamptz default now(),
  unique (staff_id)
);

alter table pmms.staff_availability disable row level security;
