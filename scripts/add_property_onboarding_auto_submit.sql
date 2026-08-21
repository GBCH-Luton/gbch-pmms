-- The Maintenance Assistant's job is to walk the property and raise
-- tickets -- not to come back later, manually check every ticket's status,
-- and click "Submit for Landlord Liaison review". That manual re-check step
-- is removed client-side (PropertyOnboardingWalk.jsx); this is what
-- replaces it: the moment the LAST open ticket on a property with a
-- finished walk gets signed off (by anyone -- a pre-existing legacy ticket
-- could belong to a totally different manager or submitter), the walk
-- auto-advances to 'pending_liaison_review' on its own.
--
-- security definer, callable by any authenticated user: whoever signs off
-- the last ticket almost certainly isn't the Maintenance Assistant or
-- Landlord Liaison (raiser-only sign-off means it could be anyone who
-- raised a legacy ticket on this property), so this can't rely on the
-- caller's own RLS access to pmms.property_onboarding_walks the way the
-- rest of this feature does -- same reasoning as submit_garden_survey.
-- Every condition is computed server-side from real ticket/check state, not
-- taken from the caller, so widening who can call it is safe.
create or replace function pmms.maybe_auto_submit_onboarding_walk(p_property_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pmms
as $$
declare
  v_walk_id uuid;
  v_rooms_done boolean;
  v_open_count int;
begin
  select id into v_walk_id from pmms.property_onboarding_walks
    where property_id = p_property_id and status in ('in_progress', 'sent_back')
    limit 1;
  if v_walk_id is null then return; end if;

  -- 6 rooms x 5 checklist items -- matches ROOMS/CHECK_ITEMS in
  -- client/src/lib/onboarding.js; update both together if that shape ever
  -- changes (still fixed for every walk, per the "for now is ok" decision).
  select count(distinct room || ':' || item_key) = 30 into v_rooms_done
    from pmms.property_onboarding_checks
    where walk_id = v_walk_id and room is not null and item_key is not null;
  if not v_rooms_done then return; end if;

  select count(*) into v_open_count from pmms.tickets
    where property_id = p_property_id and status not in ('Archived', 'Cancelled');
  if v_open_count > 0 then return; end if;

  update pmms.property_onboarding_walks
    set status = 'pending_liaison_review', submitted_at = now()
    where id = v_walk_id;
end;
$$;

grant execute on function pmms.maybe_auto_submit_onboarding_walk(uuid) to authenticated;

notify pgrst, 'reload schema';
