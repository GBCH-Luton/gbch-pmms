-- pmms.staff (distinct from public.staff, which is the real, actively
-- used staff table) is a legacy leftover with a completely open policy
-- ("authenticated full access", qual: true, with_check: true) -- any
-- logged-in user, including a builder, could read/write/delete every
-- row via a direct API call. Confirmed via grep that no client code
-- anywhere calls .schema('pmms').from('staff') -- every real staff
-- read/write in the app goes through the default (public) schema.
--
-- Locked down rather than dropped -- same security effect, but
-- reversible. Drop it outright once fully confirmed dead over time.

drop policy if exists "authenticated full access" on pmms.staff;

create policy "admin_only" on pmms.staff
  for all to authenticated
  using (pmms.current_access_level() = 'admin')
  with check (pmms.current_access_level() = 'admin');
