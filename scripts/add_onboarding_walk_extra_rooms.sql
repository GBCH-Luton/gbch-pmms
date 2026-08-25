-- Lets a Maintenance Assistant add extra rooms to one property's onboarding
-- walk, for a property with more bedrooms/kitchens/bathrooms than the fixed
-- 6-room default (ROOMS in client/src/lib/onboarding.js). See
-- client/src/pages/admin/PropertyOnboardingWalk.jsx's "+ Bedroom / Kitchen /
-- Bathroom" buttons.

alter table pmms.property_onboarding_walks
  add column if not exists extra_rooms text[] not null default '{}';

-- Was hardcoded to "6 rooms x 5 checklist items = 30" -- a walk with extra
-- rooms would never satisfy that count, so it would never auto-submit to
-- Landlord Liaison. Now derives the expected pair count from this walk's
-- own extra_rooms instead of the fixed default.
create or replace function pmms.maybe_auto_submit_onboarding_walk(p_property_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pmms'
as $function$
declare
  v_walk_id uuid;
  v_extra_rooms text[];
  v_expected_pairs int;
  v_rooms_done boolean;
  v_open_count int;
begin
  select id, extra_rooms into v_walk_id, v_extra_rooms from pmms.property_onboarding_walks
    where property_id = p_property_id and status in ('in_progress', 'sent_back')
    limit 1;
  if v_walk_id is null then return; end if;

  -- 6 fixed rooms x 5 checklist items, plus any extra rooms this walk has
  -- (extra_rooms) x the same 5 checklist items each.
  v_expected_pairs := (6 + coalesce(array_length(v_extra_rooms, 1), 0)) * 5;

  select count(distinct room || ':' || item_key) = v_expected_pairs into v_rooms_done
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
$function$;
