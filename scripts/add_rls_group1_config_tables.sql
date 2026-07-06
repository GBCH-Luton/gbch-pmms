-- RLS fix, group 1 of 3: pmms.settings, pmms.staff_roles, pmms.staff_availability.
--
-- Every pmms table currently has RLS disabled, which means the public anon
-- key alone -- no login, no session -- can read AND write everything (this
-- was verified live: a real ticket comment was created and deleted using
-- nothing but the anon key). The anon key ships inside the client bundle by
-- necessity, so it's not really secret -- anyone can copy it from the
-- browser's Network tab.
--
-- This fix requires a valid logged-in session (Supabase's built-in
-- "authenticated" role, assigned automatically whenever a request carries a
-- real user's JWT) for any access at all. It does NOT yet restrict what a
-- logged-in user can see based on their role (e.g. a builder only seeing
-- their own tickets) -- every authenticated user keeps exactly the access
-- they have today. That finer-grained "least privilege per role" work is a
-- separate, larger project. This closes the specific hole that was
-- demonstrated: fully anonymous access.

alter table pmms.settings enable row level security;
drop policy if exists "authenticated full access" on pmms.settings;
create policy "authenticated full access" on pmms.settings for all to authenticated using (true) with check (true);

alter table pmms.staff_roles enable row level security;
drop policy if exists "authenticated full access" on pmms.staff_roles;
create policy "authenticated full access" on pmms.staff_roles for all to authenticated using (true) with check (true);

alter table pmms.staff_availability enable row level security;
drop policy if exists "authenticated full access" on pmms.staff_availability;
create policy "authenticated full access" on pmms.staff_availability for all to authenticated using (true) with check (true);
