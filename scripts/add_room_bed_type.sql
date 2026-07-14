-- Adds a Bed Type field to pmms.property_rooms (Single / Double / Twin /
-- Bunk), following the same client-side-only-enforced-options convention
-- already used for room_type -- no CHECK constraint here, options live in
-- PropertyRoomsTab.jsx's BED_TYPES constant.
--
-- Nullable/no backfill by design: existing rooms keep bed_type = null
-- ("Not set" in the UI) until the next time someone edits them. Required
-- going forward is enforced only in RoomFormModal's client-side
-- validation (create + edit), not at the DB layer, and not by the Mark
-- as Void / Mark as Occupied quick-action flows, which never touch this
-- column.

alter table pmms.property_rooms
  add column if not exists bed_type text;
