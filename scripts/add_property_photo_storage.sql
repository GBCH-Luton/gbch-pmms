-- Adds cover photo storage for the Property Profile "Core" tab, mirroring
-- add_ticket_photo_storage.sql.
--
-- 1. Creates the 'property-photos' bucket (public read, so cover photos can
--    be displayed without signed URLs).
-- 2. A storage policy allowing signed-in users to upload into it -- the
--    bucket's public flag only controls read access, uploads still need an
--    explicit RLS policy regardless.
--
-- (cover_photo_url itself is added in add_property_core_profile_columns.sql)

insert into storage.buckets (id, name, public)
values ('property-photos', 'property-photos', true)
on conflict (id) do nothing;

drop policy if exists "Allow authenticated uploads to property-photos" on storage.objects;

create policy "Allow authenticated uploads to property-photos"
on storage.objects for insert
to authenticated
with check (bucket_id = 'property-photos');
