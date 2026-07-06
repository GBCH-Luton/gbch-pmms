-- RLS fix, group 2 of 3: pmms.tickets, pmms.comments, pmms.audit_events,
-- pmms.work_sessions. Same fix as group 1 (see
-- add_rls_group1_config_tables.sql for the full explanation) -- requires a
-- logged-in session for any access, doesn't yet restrict access by role.

alter table pmms.tickets enable row level security;
drop policy if exists "authenticated full access" on pmms.tickets;
create policy "authenticated full access" on pmms.tickets for all to authenticated using (true) with check (true);

alter table pmms.comments enable row level security;
drop policy if exists "authenticated full access" on pmms.comments;
create policy "authenticated full access" on pmms.comments for all to authenticated using (true) with check (true);

alter table pmms.audit_events enable row level security;
drop policy if exists "authenticated full access" on pmms.audit_events;
create policy "authenticated full access" on pmms.audit_events for all to authenticated using (true) with check (true);

alter table pmms.work_sessions enable row level security;
drop policy if exists "authenticated full access" on pmms.work_sessions;
create policy "authenticated full access" on pmms.work_sessions for all to authenticated using (true) with check (true);
