-- Converts pmms.property_documents.id and pmms.property_room_history.id
-- from integer to uuid. Both are independent leaf tables (no other table
-- has a FK to either), so this is two simple column swaps -- no populate/
-- guard step needed for either.
--
-- property_documents.id was previously believed to already be uuid (per
-- a stale comment in scripts/add_property_documents_table.sql that never
-- matched the live database) -- a live test insert confirmed it was
-- actually still integer. property_room_history.id was a known,
-- deliberate gap left over from the property_rooms migration (only its
-- room_id FK was converted at the time).
--
-- Run this whole script once in the SQL Editor. Take a fresh backup
-- immediately afterward, per usual practice.

begin;

-- property_documents: 0 rows, RLS disabled -- straight swap.
alter table pmms.property_documents add column new_id uuid not null default gen_random_uuid();
alter table pmms.property_documents drop column id cascade;
alter table pmms.property_documents rename column new_id to id;
alter table pmms.property_documents add constraint property_documents_pkey primary key (id);

-- property_room_history: 1 row, RLS enabled but policy is blanket
-- using(true) with no column dependency -- survives automatically,
-- tied to the table not the column.
alter table pmms.property_room_history add column new_id uuid not null default gen_random_uuid();
alter table pmms.property_room_history drop column id cascade;
alter table pmms.property_room_history rename column new_id to id;
alter table pmms.property_room_history add constraint property_room_history_pkey primary key (id);

commit;

notify pgrst, 'reload schema';
