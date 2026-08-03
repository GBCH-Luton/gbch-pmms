-- Direct Messages: a private, one-to-one thread between any two staff
-- members with real PMMS access (admin/manager/builder) -- not
-- division-scoped like pmms.chat_messages, since the whole point is to
-- reach one specific person regardless of division. RLS is the actual
-- privacy boundary: a row is only ever readable by its sender or its
-- recipient, enforced by the database, not just hidden in the UI.
--
-- No separate reads table like chat_channel_reads -- a DM thread only
-- ever has one other participant, so a read_at column directly on the
-- message row is enough for "seen by" semantics (recipient marks their
-- own received, unread rows read when they open the thread).

begin;

create table pmms.dm_messages (
  id            uuid primary key default gen_random_uuid(),
  sender_id     uuid not null references public.staff (id),
  recipient_id  uuid not null references public.staff (id),
  sender_name   text not null,
  body          text,
  photo_url     text,
  created_at    timestamptz not null default now(),
  read_at       timestamptz,
  check (sender_id <> recipient_id)
);

create index dm_messages_thread_idx on pmms.dm_messages (least(sender_id, recipient_id), greatest(sender_id, recipient_id), created_at);

alter table pmms.dm_messages enable row level security;

create policy "participant_select" on pmms.dm_messages
  for select to authenticated
  using (sender_id = pmms.current_staff_id() or recipient_id = pmms.current_staff_id());

-- Both ends of the conversation must actually have a live PMMS role
-- today (not just any public.staff row -- this is a shared table across
-- every company system) -- mirrors dm_contacts()'s own filter, but that
-- function only shapes what the UI offers; this is the real boundary.
create policy "sender_insert" on pmms.dm_messages
  for insert to authenticated
  with check (
    sender_id = pmms.current_staff_id()
    and pmms.staff_access_level(sender_id) is not null
    and pmms.staff_access_level(recipient_id) is not null
  );

-- Only the recipient ever updates a row, to set read_at when they open
-- the thread -- the sender never needs to (no edit/delete feature).
create policy "recipient_update" on pmms.dm_messages
  for update to authenticated
  using (recipient_id = pmms.current_staff_id())
  with check (recipient_id = pmms.current_staff_id());

grant all on pmms.dm_messages to anon, authenticated, service_role;

alter publication supabase_realtime add table pmms.dm_messages;

-- Who's eligible to be DM'd: any other active staff member who actually
-- has a PMMS role today (admin/manager/builder) -- reuses
-- pmms.staff_access_level() from add_pmms_chat_channel_members_function.sql
-- rather than re-deriving the same role logic a second time.
create or replace function pmms.dm_contacts()
 returns table(id uuid, name text)
 language sql
 stable security definer
 set search_path to 'public', 'pmms'
as $function$
  select s.id, s.name
  from public.staff s
  where s.active = true
    and s.id <> pmms.current_staff_id()
    and pmms.staff_access_level(s.id) is not null
  order by s.name
$function$;

commit;

notify pgrst, 'reload schema';
