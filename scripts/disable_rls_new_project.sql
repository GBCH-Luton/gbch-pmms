-- New Supabase projects appear to auto-enable RLS on newly created tables
-- even when the CREATE TABLE statement never asked for it. That's why anon/
-- authenticated queries were returning zero rows despite the data being
-- present (service_role bypasses RLS, which is why it looked fine there).
-- This makes the earlier "disable RLS for now" sandbox decision explicit.

alter table public.staff disable row level security;

alter table pmms.staff disable row level security;
alter table pmms.properties disable row level security;
alter table pmms.tickets disable row level security;
alter table pmms.comments disable row level security;
alter table pmms.work_sessions disable row level security;
alter table pmms.audit_events disable row level security;
