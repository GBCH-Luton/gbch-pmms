-- ticket-photos / property-photos / property-docs / chat-photos are moving
-- from public to private (staff-photos stays public -- it's owned by
-- another company system sharing this database, not ours to change).
-- Each already has an "authenticated can insert" policy from its own
-- creation script; none had a SELECT policy since public buckets don't
-- need one (reads went through the public endpoint, bypassing RLS
-- entirely). Signing a URL (createSignedUrl) requires the caller to
-- actually have SELECT on the object, so without this every signed-URL
-- request would fail once the bucket goes private. Same simple shape as
-- the existing insert policies -- bucket_id match only, no per-owner
-- scoping, consistent with how this app doesn't do granular per-owner
-- storage RLS anywhere else either.

begin;

create policy "Allow authenticated reads from ticket-photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'ticket-photos');

create policy "Allow authenticated reads from property-photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'property-photos');

create policy "Allow authenticated reads from property-docs" on storage.objects
  for select to authenticated
  using (bucket_id = 'property-docs');

create policy "Allow authenticated reads from chat-photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-photos');

commit;
