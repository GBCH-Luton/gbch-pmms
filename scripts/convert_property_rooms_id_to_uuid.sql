-- Converts pmms.property_rooms.id from integer identity to uuid, and
-- updates pmms.property_room_history.room_id (its FK to property_rooms)
-- to match. The table STAYS in the pmms schema -- this is purely an id
-- type change, not a schema move (pmms is already an exposed API schema
-- with grants in place, so other systems can reach it once RLS allows).
--
-- Reason: the Support Worker system will need to mark rooms void, and the
-- future Service Users system will need to reference specific rooms --
-- both genuine, named consumers, unlike tickets/comments/property_notes
-- which have no named cross-system need yet and are intentionally left
-- as integers.
--
-- Same add-populate-swap-drop pattern as
-- convert_properties_id_to_uuid.sql, already proven live this session.
-- Run this whole script once in the SQL Editor. Take a fresh backup
-- immediately afterward, per usual practice.

begin;

-- 1. Add new uuid columns.
alter table pmms.property_rooms add column new_id uuid not null default gen_random_uuid();
alter table pmms.property_room_history add column new_room_id uuid;

-- 2. Populate property_room_history's new_room_id from the SAME room's
--    freshly generated uuid, matched via the still-intact old integer id.
update pmms.property_room_history h
  set new_room_id = r.new_id
  from pmms.property_rooms r
  where r.id = h.room_id;

-- 3. Guard: abort (rollback everything) if any history row with an old
--    room_id doesn't now have a new_room_id.
do $$
declare bad_count integer;
begin
  select count(*) into bad_count
  from pmms.property_room_history
  where room_id is not null and new_room_id is null;

  if bad_count > 0 then
    raise exception 'uuid backfill mismatch: % property_room_history rows unmatched -- aborting', bad_count;
  end if;
end $$;

-- 4. Drop old integer columns. CASCADE removes the auto-named FK
--    constraint and property_rooms' old PK + owned identity sequence.
alter table pmms.property_room_history drop column room_id cascade;
alter table pmms.property_rooms drop column id cascade;

-- 5. Rename new columns into the old names.
alter table pmms.property_rooms rename column new_id to id;
alter table pmms.property_room_history rename column new_room_id to room_id;

-- 6. Re-establish constraints: PK, NOT NULL (room_id was NOT NULL
--    originally), then the FK (matching the original ON DELETE CASCADE).
alter table pmms.property_rooms add constraint property_rooms_pkey primary key (id);

alter table pmms.property_room_history alter column room_id set not null;

alter table pmms.property_room_history
  add constraint property_room_history_room_id_fkey
  foreign key (room_id) references pmms.property_rooms (id) on delete cascade;

commit;

notify pgrst, 'reload schema';
