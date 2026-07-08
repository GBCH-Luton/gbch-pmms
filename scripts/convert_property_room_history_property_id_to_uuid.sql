-- Converts pmms.property_room_history.property_id from integer to uuid.
--
-- This column exists on the live table but was never documented in the
-- original scripts/add_pmms_property_rooms_tables.sql, and is never read
-- or written by the client (client/src/pages/admin/PropertyRoomsTab.jsx's
-- insertHistory() only ever sets room_id -- property_id has always been
-- null on every row). It clearly conceptually references
-- public.properties(id), so it's converted to uuid to match, and given a
-- proper FK constraint (which it apparently never had), for consistency
-- with every other property_id column in the system.
--
-- Safe as a direct type change (not add-populate-drop-rename) because the
-- column is confirmed always null -- there is no non-null data to migrate
-- or risk losing.

begin;

alter table pmms.property_room_history
  alter column property_id type uuid using property_id::text::uuid;

alter table pmms.property_room_history
  add constraint property_room_history_property_id_fkey
  foreign key (property_id) references public.properties (id);

commit;

notify pgrst, 'reload schema';
