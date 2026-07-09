-- In-house error/crash logging -- no third-party service (Sentry etc.)
-- because sending error data off-machine to a third party isn't something
-- the company will accept. Same pattern as pmms.login_events/audit_events:
-- our own table, our own schema, viewable by admins in-app.
--
-- staff_id/email are DATABASE DEFAULTS (pmms.current_staff_id() /
-- auth.jwt() email), not client-supplied values like login_events uses --
-- error logging fires from arbitrary low-level code (a global
-- window.onerror handler, a generic Supabase query wrapper) that has no
-- React profile/session in scope, unlike login_events' two deliberate
-- call sites. Since the client never supplies these fields at all, there's
-- nothing for a malicious client to spoof, so "with check (true)" is safe.

begin;

create table pmms.error_logs (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  staff_id   uuid default pmms.current_staff_id(),
  email      text default (auth.jwt() ->> 'email'),
  error_type text not null check (error_type in ('js_error', 'unhandled_rejection', 'react_render', 'supabase_query')),
  message    text not null,
  stack      text,
  context    jsonb
);

alter table pmms.error_logs enable row level security;

-- Only Admin/Manager can read the log.
create policy "admin_manager_read" on pmms.error_logs
  for select to authenticated using (pmms.is_admin_or_manager());

-- Anyone logged in can log their own error -- identity is always
-- server-resolved (see comment above), so there's no spoofing risk in
-- allowing every authenticated user to insert.
create policy "self_insert" on pmms.error_logs
  for insert to authenticated with check (true);

commit;

notify pgrst, 'reload schema';

-- Retention: auto-delete anything older than 30 days, daily at 3am.
-- Requires the pg_cron extension -- this attempts to enable it directly;
-- if that fails on this project's plan, enable it once via the Supabase
-- Dashboard under Database -> Extensions, then re-run just the two
-- statements below.
create extension if not exists pg_cron;

select cron.schedule(
  'delete-old-error-logs',
  '0 3 * * *',
  $$ delete from pmms.error_logs where created_at < now() - interval '30 days' $$
);
