-- "7 clocking locations flagged for review" only ever went up, never down --
-- fetchFlaggedClockingCount() (shared.jsx) scans every Completed/Archived
-- ticket ever, all-time, and there was no way for a manager to say "I
-- checked this one, it's fine" anywhere in the app. Two-part fix:
--   1. The count query (shared.jsx) now only looks back
--      clock_flag_lookback_days (default 30, see AdminSettings.jsx) --
--      old flags age out on their own.
--   2. This table lets a manager dismiss one early, from the Clocking
--      page, before it ages out. Keyed by (ticket_id, kind) rather than a
--      specific work_sessions row, since a completed job's flag is judged
--      off its FIRST session's clock-in and LAST session's clock-out (see
--      fetchFlaggedClockingCount's own comment) -- the same two slots a
--      manager reviews on the timesheet, regardless of how many
--      pause/resume sessions sit in between.

begin;

create table if not exists pmms.clocking_flag_dismissals (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references pmms.tickets(id) on delete cascade,
  kind text not null check (kind in ('clock_in', 'clock_out')),
  dismissed_at timestamptz not null default now(),
  dismissed_by uuid references public.staff(id),
  unique (ticket_id, kind)
);

alter table pmms.clocking_flag_dismissals enable row level security;

-- Same "admin or any manager, unscoped" access as the Clocking page itself
-- (no divisions restriction on that nav item) -- this is a review action,
-- not ticket data, so it doesn't need the raiser-only/division-scoped
-- rules pmms.tickets itself carries.
create policy "admin_manager_read_clocking_dismissals" on pmms.clocking_flag_dismissals
  for select to authenticated
  using (pmms.current_access_level() in ('admin', 'manager'));

create policy "admin_manager_insert_clocking_dismissals" on pmms.clocking_flag_dismissals
  for insert to authenticated
  with check (pmms.current_access_level() in ('admin', 'manager') and dismissed_by = pmms.current_staff_id());

-- Lets a manager undo an accidental dismiss.
create policy "admin_manager_delete_clocking_dismissals" on pmms.clocking_flag_dismissals
  for delete to authenticated
  using (pmms.current_access_level() in ('admin', 'manager'));

commit;

notify pgrst, 'reload schema';
