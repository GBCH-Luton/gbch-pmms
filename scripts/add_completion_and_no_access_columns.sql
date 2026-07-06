-- Adds the columns needed for the builder's "Mark complete" and "Couldn't get
-- access" confirmation steps to persist a note + photo, alongside the
-- pre-existing completion_note column.

alter table pmms.tickets add column if not exists completion_photo_url text;
alter table pmms.tickets add column if not exists no_access_note text;
alter table pmms.tickets add column if not exists no_access_photo_url text;
