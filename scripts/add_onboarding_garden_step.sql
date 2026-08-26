-- Adds a Garden step to Property Onboarding's walk (2026-08-26), reusing
-- the exact fields/behaviour of the Ticket Submitter's Garden Check
-- campaign (GardenSurvey.jsx / scripts/add_garden_survey_campaign.sql) so
-- the Maintenance Assistant can record the same thing during her walk
-- instead of waiting on a submitter to visit separately.
--
-- Deliberately NOT reusing pmms.submit_garden_survey -- that RPC
-- hard-checks current_access_level() = 'submitter' in its own WHERE
-- clause and would silently reject a Maintenance Assistant (accessLevel
-- 'manager'). She already has full RLS access to pmms.properties via
-- admin_manager_full_access, so the walk writes straight to the same
-- has_garden/garden_state/garden_*_photo_url/garden_last_attended_*
-- columns PropertyGardensTab.jsx uses (see lib/onboarding.js's
-- saveGardenStep) -- no RPC needed at all.
--
-- garden_step_completed_at is walk-scoped, separate from the campaign's
-- own garden_survey_completed_at (that one drives the submitter picker's
-- dedupe logic and shouldn't be conflated with "this walk covered it").
alter table pmms.property_onboarding_walks add column if not exists garden_step_completed_at timestamptz;

-- Auto-submit-to-Landlord-Liaison now also requires the garden step to be
-- done, on top of the existing room-checklist-complete + zero-open-tickets
-- checks -- otherwise a walk could silently advance to review with the
-- Garden step never actually done, if every raised ticket just happened
-- to get signed off before she got to it.
create or replace function pmms.maybe_auto_submit_onboarding_walk(p_property_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pmms
as $$
declare
  v_walk_id uuid;
  v_extra_rooms text[];
  v_garden_done boolean;
  v_expected_pairs int;
  v_rooms_done boolean;
  v_open_count int;
begin
  select id, extra_rooms, garden_step_completed_at is not null
    into v_walk_id, v_extra_rooms, v_garden_done
    from pmms.property_onboarding_walks
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

  if not v_garden_done then return; end if;

  select count(*) into v_open_count from pmms.tickets
    where property_id = p_property_id and status not in ('Archived', 'Cancelled');
  if v_open_count > 0 then return; end if;

  update pmms.property_onboarding_walks
    set status = 'pending_liaison_review', submitted_at = now()
    where id = v_walk_id;
end;
$$;

notify pgrst, 'reload schema';
