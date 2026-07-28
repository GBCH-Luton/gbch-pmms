-- Audit trail for the "View As" admin-impersonation feature -- a
-- separate table from pmms.audit_events (ticket-scoped) and
-- pmms.login_events (has a CHECK constraint limited to 'Signed In'/
-- 'Signed Out', and conflating a real credentialed login with an
-- admin borrowing someone else's session would be misleading there).
--
-- The INSERT on starting a "view as" happens via the impersonate-staff
-- Edge Function's service-role client, which bypasses RLS entirely --
-- the policy below's real job is gating the ended_at UPDATE (made by
-- the admin's own restored session on "Return to my account") and any
-- future admin-facing read UI.

begin;

create table pmms.impersonation_events (
  id              uuid primary key default gen_random_uuid(),
  admin_staff_id  uuid not null references public.staff (id),
  admin_name      text,
  target_staff_id uuid not null references public.staff (id),
  target_name     text,
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  user_agent      text
);

alter table pmms.impersonation_events enable row level security;

create policy "admin_full_access" on pmms.impersonation_events
  for all to authenticated
  using (pmms.current_access_level() = 'admin')
  with check (pmms.current_access_level() = 'admin');

commit;

notify pgrst, 'reload schema';
