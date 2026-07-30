-- Team Chat read receipts: one row per (division, staff member)
-- holding a read watermark, not a per-message junction table --
-- cheaper, and sufficient for "seen by" semantics (if your watermark
-- is at/after a message's created_at, you've seen it and everything
-- before it). Client renders a "Seen by ..." line under only the
-- most recent message in a channel, not per-message ticks.
--
-- Same RLS shape as pmms.chat_messages (add_pmms_chat_messages_table.sql):
-- USING governs read access (division match only); WITH CHECK adds
-- staff_id = current_staff_id() so nobody can mark another person's
-- messages as read.

begin;

create table pmms.chat_channel_reads (
  division      text not null,
  staff_id      uuid not null references public.staff (id),
  last_read_at  timestamptz not null default now(),
  primary key (division, staff_id)
);

alter table pmms.chat_channel_reads enable row level security;

create policy "admin_full_access" on pmms.chat_channel_reads
  for all to authenticated
  using (pmms.current_access_level() = 'admin')
  with check (pmms.current_access_level() = 'admin');

create policy "manager_unscoped_access" on pmms.chat_channel_reads
  for all to authenticated
  using (pmms.current_access_level() = 'manager' and pmms.current_division() is null)
  with check (pmms.current_access_level() = 'manager' and pmms.current_division() is null and staff_id = pmms.current_staff_id());

create policy "manager_division_scoped_access" on pmms.chat_channel_reads
  for all to authenticated
  using (pmms.current_access_level() = 'manager' and pmms.current_division() = division)
  with check (pmms.current_access_level() = 'manager' and pmms.current_division() = division and staff_id = pmms.current_staff_id());

create policy "builder_division_access" on pmms.chat_channel_reads
  for all to authenticated
  using (pmms.current_access_level() = 'builder' and coalesce(pmms.current_division(), 'Maintenance') = division)
  with check (pmms.current_access_level() = 'builder' and coalesce(pmms.current_division(), 'Maintenance') = division and staff_id = pmms.current_staff_id());

grant all on pmms.chat_channel_reads to anon, authenticated, service_role;

alter publication supabase_realtime add table pmms.chat_channel_reads;

commit;

notify pgrst, 'reload schema';
