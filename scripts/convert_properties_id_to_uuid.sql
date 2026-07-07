-- Converts public.properties.id from integer identity to uuid, and updates
-- the 6 pmms child-table FK columns (tickets.property_id,
-- property_assets/property_compliance/property_documents/property_notes/
-- property_rooms.property_id) to uuid, preserving every existing row's
-- identity and every existing FK relationship (same properties, same links --
-- not arbitrary new uuids).
--
-- Reason: public.properties is shared reference data across future
-- standalone systems (Support Worker, HR, QA) in this Supabase project.
-- Sequential integer ids invite collisions/enumeration once independent
-- systems insert into the same table; uuid avoids that.
--
-- gen_random_uuid() is used -- already proven available in this project
-- (public.staff/pmms.staff both default their id to it today).
--
-- Table is tiny (6 properties, ~34 tickets, small child tables), so this is
-- a straightforward add-populate-swap-drop rewrite, not an incremental/
-- zero-downtime strategy.
--
-- Run this whole script once in the SQL Editor. Take a fresh backup
-- immediately afterward, per usual practice.

begin;

-- 1. Add new uuid columns. properties.new_id gets a real, distinct value per
--    existing row immediately -- the default is volatile (gen_random_uuid()),
--    so even though the column is NOT NULL from the start, Postgres computes
--    it per-row rather than failing or requiring a separate UPDATE. Child
--    new_property_id columns start null; populated in step 2.
alter table public.properties add column new_id uuid not null default gen_random_uuid();

alter table pmms.tickets add column new_property_id uuid;
alter table pmms.property_assets add column new_property_id uuid;
alter table pmms.property_compliance add column new_property_id uuid;
alter table pmms.property_documents add column new_property_id uuid;
alter table pmms.property_notes add column new_property_id uuid;
alter table pmms.property_rooms add column new_property_id uuid;

-- 2. Populate every child's new_property_id from the SAME property row's
--    freshly generated uuid, matched via the still-intact old integer id.
--    Rows whose old property_id is null (e.g. an unassigned ticket) stay null.
update pmms.tickets t
  set new_property_id = p.new_id
  from public.properties p
  where p.id = t.property_id;

update pmms.property_assets a
  set new_property_id = p.new_id
  from public.properties p
  where p.id = a.property_id;

update pmms.property_compliance c
  set new_property_id = p.new_id
  from public.properties p
  where p.id = c.property_id;

update pmms.property_documents d
  set new_property_id = p.new_id
  from public.properties p
  where p.id = d.property_id;

update pmms.property_notes n
  set new_property_id = p.new_id
  from public.properties p
  where p.id = n.property_id;

update pmms.property_rooms r
  set new_property_id = p.new_id
  from public.properties p
  where p.id = r.property_id;

-- 3. Guard: every row that HAD an old property_id must now have a
--    new_property_id. Aborts the whole transaction (nothing commits) if not.
do $$
declare
  bad_count integer;
begin
  select
    (select count(*) from pmms.tickets where property_id is not null and new_property_id is null) +
    (select count(*) from pmms.property_assets where property_id is not null and new_property_id is null) +
    (select count(*) from pmms.property_compliance where property_id is not null and new_property_id is null) +
    (select count(*) from pmms.property_documents where property_id is not null and new_property_id is null) +
    (select count(*) from pmms.property_notes where property_id is not null and new_property_id is null) +
    (select count(*) from pmms.property_rooms where property_id is not null and new_property_id is null)
  into bad_count;

  if bad_count > 0 then
    raise exception 'uuid backfill mismatch: % child rows have an old property_id with no matching new_property_id -- aborting', bad_count;
  end if;
end $$;

-- 4. Drop the old integer columns. CASCADE takes each old FK constraint
--    with it (auto-named, e.g. tickets_property_id_fkey), plus
--    property_compliance's old (property_id, cert_type) unique constraint,
--    plus properties' old PK and its owned identity sequence -- confirmed
--    nothing else (no view, no other FK, no RLS policy) depends on these
--    columns.
alter table pmms.tickets drop column property_id cascade;
alter table pmms.property_assets drop column property_id cascade;
alter table pmms.property_compliance drop column property_id cascade;
alter table pmms.property_documents drop column property_id cascade;
alter table pmms.property_notes drop column property_id cascade;
alter table pmms.property_rooms drop column property_id cascade;

alter table public.properties drop column id cascade;

-- 5. Rename the new columns into the old names.
alter table public.properties rename column new_id to id;

alter table pmms.tickets rename column new_property_id to property_id;
alter table pmms.property_assets rename column new_property_id to property_id;
alter table pmms.property_compliance rename column new_property_id to property_id;
alter table pmms.property_documents rename column new_property_id to property_id;
alter table pmms.property_notes rename column new_property_id to property_id;
alter table pmms.property_rooms rename column new_property_id to property_id;

-- 6. Re-establish constraints: PK first, then NOT NULL where the original
--    schema had it (property_rooms only), then FKs (matching each table's
--    original ON DELETE behaviour exactly), then the compliance unique
--    constraint.
alter table public.properties add constraint properties_pkey primary key (id);

alter table pmms.property_rooms alter column property_id set not null;

alter table pmms.tickets
  add constraint tickets_property_id_fkey
  foreign key (property_id) references public.properties (id);

alter table pmms.property_assets
  add constraint property_assets_property_id_fkey
  foreign key (property_id) references public.properties (id) on delete cascade;

alter table pmms.property_compliance
  add constraint property_compliance_property_id_fkey
  foreign key (property_id) references public.properties (id) on delete cascade;

alter table pmms.property_documents
  add constraint property_documents_property_id_fkey
  foreign key (property_id) references public.properties (id) on delete cascade;

alter table pmms.property_notes
  add constraint property_notes_property_id_fkey
  foreign key (property_id) references public.properties (id) on delete cascade;

alter table pmms.property_rooms
  add constraint property_rooms_property_id_fkey
  foreign key (property_id) references public.properties (id) on delete cascade;

alter table pmms.property_compliance
  add constraint property_compliance_property_id_cert_type_key
  unique (property_id, cert_type);

commit;

notify pgrst, 'reload schema';
