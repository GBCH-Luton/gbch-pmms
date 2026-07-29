-- Team Chat photo attachments -- same convention as the other 3 buckets
-- (property-docs, property-photos, ticket-photos): public, one
-- authenticated-uploads-only policy, no delete/update (uploads are
-- add-only, matching how every other bucket in this app behaves).

insert into storage.buckets (id, name, public) values
  ('chat-photos', 'chat-photos', true)
on conflict (id) do nothing;

create policy "Allow authenticated uploads to chat-photos" on storage.objects
  for insert to authenticated with check (bucket_id = 'chat-photos');
