-- Adds real photo persistence for tickets raised via the "Log a Ticket" form.
-- The photo was previously only held as a browser-memory preview and never
-- actually uploaded anywhere, so it vanished the moment the form reset.
--
-- 1. photo_url column to store the uploaded file's public URL.
-- 2. A storage policy allowing signed-in users to upload into the
--    'ticket-photos' bucket (the bucket itself was created via the Storage
--    API and marked public for easy read access; uploads still need an
--    explicit RLS policy regardless of the bucket's public flag).

alter table pmms.tickets
  add column if not exists photo_url text;

drop policy if exists "Allow authenticated uploads to ticket-photos" on storage.objects;

create policy "Allow authenticated uploads to ticket-photos"
on storage.objects for insert
to authenticated
with check (bucket_id = 'ticket-photos');
