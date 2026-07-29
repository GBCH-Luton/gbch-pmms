-- Team Chat: one channel per division (Maintenance, Housekeeping,
-- Compliance, etc.), plus @mentions tracked structurally (not parsed
-- from text) so a push notification can target exactly who was
-- mentioned, no more no less.
--
-- current_division() returns NULL for BOTH an unscoped manager AND the
-- plain built-in 'Builder' role (confirmed by reading its body -- no
-- accessLevel branching there, unlike current_access_level()). This
-- mirrors the existing client-side convention (AdminBuilders.jsx's
-- roleDivision() / shared.jsx's fetchAssignableStaffForDivision()):
-- built-in Builder is implicitly 'Maintenance'. USING governs read
-- access (division match only); WITH CHECK adds sender_id =
-- current_staff_id() so nobody can post pretending to be someone else.

begin;

create table pmms.chat_messages (
  id                  uuid primary key default gen_random_uuid(),
  division            text not null,
  sender_id           uuid not null references public.staff (id),
  sender_name         text not null,
  body                text not null,
  mentioned_staff_ids uuid[] not null default '{}',
  created_at          timestamptz not null default now()
);

alter table pmms.chat_messages enable row level security;

create policy "admin_full_access" on pmms.chat_messages
  for all to authenticated
  using (pmms.current_access_level() = 'admin')
  with check (pmms.current_access_level() = 'admin');

create policy "manager_unscoped_access" on pmms.chat_messages
  for all to authenticated
  using (pmms.current_access_level() = 'manager' and pmms.current_division() is null)
  with check (pmms.current_access_level() = 'manager' and pmms.current_division() is null and sender_id = pmms.current_staff_id());

create policy "manager_division_scoped_access" on pmms.chat_messages
  for all to authenticated
  using (pmms.current_access_level() = 'manager' and pmms.current_division() = division)
  with check (pmms.current_access_level() = 'manager' and pmms.current_division() = division and sender_id = pmms.current_staff_id());

create policy "builder_division_access" on pmms.chat_messages
  for all to authenticated
  using (pmms.current_access_level() = 'builder' and coalesce(pmms.current_division(), 'Maintenance') = division)
  with check (pmms.current_access_level() = 'builder' and coalesce(pmms.current_division(), 'Maintenance') = division and sender_id = pmms.current_staff_id());

grant all on pmms.chat_messages to anon, authenticated, service_role;

-- First use of Supabase Realtime anywhere in this app -- everything
-- else "live" today is setInterval polling. RLS applies to Realtime
-- subscriptions the same as any normal query, so this doesn't widen
-- access beyond what the policies above already allow.
alter publication supabase_realtime add table pmms.chat_messages;

commit;

notify pgrst, 'reload schema';
