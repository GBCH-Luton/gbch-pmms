-- Lets an admin mark a past AI question as a favourite for quick access,
-- separate from paging through the full history. Shared across admins
-- (not per-user) -- matches how the rest of this table already works as
-- one shared admin-visible log, not a personal one.

alter table pmms.ai_usage_log add column if not exists is_favorite boolean not null default false;

-- Only a SELECT policy existed before (admins can view); the star toggle
-- needs a matching UPDATE policy to actually flip it from the client.
create policy "Admins can update AI usage log" on pmms.ai_usage_log
  for update
  using (pmms.current_access_level() = 'admin')
  with check (pmms.current_access_level() = 'admin');
