-- Converts pmms.property_notes.id from integer identity to uuid. This is
-- the last property child table still using an integer for its own PK
-- (property_assets, property_compliance, property_documents were already
-- uuid from the start; property_rooms was converted earlier this session).
--
-- No named cross-system consumer needs this yet -- it's done now because
-- the table currently has 0 rows, making this a free, zero-risk DDL
-- change: no backfill, no populate step, no possibility of a mismatch.
--
-- No child table references property_notes(id), and RLS is disabled on
-- this table, so unlike the previous migrations there's no populate/guard
-- step and no RLS policy to preserve -- just a straight column swap.
--
-- Run this whole script once in the SQL Editor. Take a fresh backup
-- immediately afterward, per usual practice.

begin;

-- 1. Add the new uuid column.
alter table pmms.property_notes add column new_id uuid not null default gen_random_uuid();

-- 2. Drop the old integer column. CASCADE removes the old PK and its
--    owned identity sequence -- confirmed nothing else depends on it.
alter table pmms.property_notes drop column id cascade;

-- 3. Rename the new column into the old name.
alter table pmms.property_notes rename column new_id to id;

-- 4. Re-establish the primary key.
alter table pmms.property_notes add constraint property_notes_pkey primary key (id);

commit;

notify pgrst, 'reload schema';
