-- Web push notification subscriptions -- one row per browser/device a
-- staff member has granted notification permission on (someone using both
-- a phone and a laptop has two rows). Used by the send-push-notifications
-- Edge Function (service role, bypasses RLS) to know where to actually
-- deliver a push; the RLS policies here only govern the client's own
-- subscribe/unsubscribe flow.

create table pmms.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references public.staff(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

alter table pmms.push_subscriptions enable row level security;

create policy "admin_manager_read" on pmms.push_subscriptions
  for select to authenticated using (pmms.is_admin_or_manager());

create policy "self_manage" on pmms.push_subscriptions
  for all to authenticated
  using (staff_id = pmms.current_staff_id())
  with check (staff_id = pmms.current_staff_id());

notify pgrst, 'reload schema';
