-- RLS fix, group 3 of 3: pmms.properties + all property_* tables, plus
-- pmms.staff (a separate legacy table discovered while doing this pass --
-- not referenced anywhere in client code, distinct from the real,
-- company-wide public.staff table -- but still wide open like everything
-- else, so it gets the same fix here rather than being left as a loose end).
--
-- Same fix as groups 1 and 2 (see add_rls_group1_config_tables.sql for the
-- full explanation) -- requires a logged-in session for any access, doesn't
-- yet restrict access by role.

alter table pmms.properties enable row level security;
drop policy if exists "authenticated full access" on pmms.properties;
create policy "authenticated full access" on pmms.properties for all to authenticated using (true) with check (true);

alter table pmms.property_rooms enable row level security;
drop policy if exists "authenticated full access" on pmms.property_rooms;
create policy "authenticated full access" on pmms.property_rooms for all to authenticated using (true) with check (true);

alter table pmms.property_room_history enable row level security;
drop policy if exists "authenticated full access" on pmms.property_room_history;
create policy "authenticated full access" on pmms.property_room_history for all to authenticated using (true) with check (true);

alter table pmms.property_assets enable row level security;
drop policy if exists "authenticated full access" on pmms.property_assets;
create policy "authenticated full access" on pmms.property_assets for all to authenticated using (true) with check (true);

alter table pmms.property_compliance enable row level security;
drop policy if exists "authenticated full access" on pmms.property_compliance;
create policy "authenticated full access" on pmms.property_compliance for all to authenticated using (true) with check (true);

alter table pmms.property_documents enable row level security;
drop policy if exists "authenticated full access" on pmms.property_documents;
create policy "authenticated full access" on pmms.property_documents for all to authenticated using (true) with check (true);

alter table pmms.property_notes enable row level security;
drop policy if exists "authenticated full access" on pmms.property_notes;
create policy "authenticated full access" on pmms.property_notes for all to authenticated using (true) with check (true);

alter table pmms.staff enable row level security;
drop policy if exists "authenticated full access" on pmms.staff;
create policy "authenticated full access" on pmms.staff for all to authenticated using (true) with check (true);
