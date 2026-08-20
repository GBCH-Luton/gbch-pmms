-- Temporary garden survey campaign (2026-08-20): Ticket Submitters (support
-- workers) visit properties daily and can record garden state/photos while
-- they're there, so management wants a stripped-down, temporary version of
-- the existing Gardens tab (PropertyGardensTab.jsx) added to their
-- dashboard instead of waiting on an admin to enter it. Gated client-side
-- behind GARDEN_SURVEY_CAMPAIGN_ENABLED (admin/shared.jsx) so the nav item
-- can be pulled once every property's been covered, with no rebuild.
--
-- New column: marks a property as covered by THIS campaign, independent of
-- has_garden/garden_last_attended_date -- those pre-date the campaign
-- (already populated for some properties by earlier admin/contractor
-- entries) and would be semantically wrong to stamp for a "no garden here"
-- property (there's nothing to "attend"). Once set, the property drops out
-- of every submitter's picker, so a second support worker visiting the same
-- property later can't see it, let alone overwrite the first submission.
alter table pmms.properties add column if not exists garden_survey_completed_at timestamptz;

-- Read-only list for the picker. Submitters have zero direct row-level
-- access to pmms.properties (see fix_builder_property_column_exposure.sql --
-- same reasoning applies here), so this is a SECURITY DEFINER function
-- returning only a narrow, safe column set, same shape as
-- pmms.builder_properties(). Every active property not yet covered by the
-- campaign -- not scoped to has_garden, since part of the point is letting
-- a submitter report "no garden here" for properties nobody's assessed yet.
create or replace function pmms.garden_survey_properties()
returns table (
  id uuid,
  address text,
  town text,
  postcode text
)
language sql
security definer
stable
set search_path = public, pmms
as $$
  select p.id, p.address, p.town, p.postcode
  from pmms.properties p
  where pmms.current_access_level() = 'submitter'
    and p.garden_survey_completed_at is null
    and p.status not in ('Inactive', 'Internal')
  order by p.address
$$;

grant execute on function pmms.garden_survey_properties() to authenticated;

-- Write path. Same narrow SECURITY DEFINER pattern as
-- complete_garden_ticket_property_update / set_ticket_report_photo, rather
-- than granting submitters broad UPDATE on properties.
--
-- The `where ... and garden_survey_completed_at is null` guard is what
-- actually prevents the overwrite the user flagged (two support workers
-- visiting the same property): whoever loses the race matches zero rows,
-- so the function raises instead of silently clobbering the first
-- submission -- a real guarantee, not just the dropdown-list hiding trick.
create or replace function pmms.submit_garden_survey(
  p_property_id uuid,
  p_has_garden boolean,
  p_state text,
  p_front_photo_url text,
  p_back_photo_url text
)
returns void
language plpgsql
security definer
set search_path = public, pmms
as $$
declare
  v_staff_name text;
  v_rows int;
begin
  select name into v_staff_name from public.staff where id = pmms.current_staff_id();

  update pmms.properties
  set
    has_garden = p_has_garden,
    garden_state = case when p_has_garden then p_state else garden_state end,
    garden_last_attended_date = case when p_has_garden then current_date else garden_last_attended_date end,
    garden_last_attended_by = case when p_has_garden then v_staff_name else garden_last_attended_by end,
    garden_front_photo_url = case when p_has_garden then coalesce(p_front_photo_url, garden_front_photo_url) else garden_front_photo_url end,
    garden_back_photo_url = case when p_has_garden then coalesce(p_back_photo_url, garden_back_photo_url) else garden_back_photo_url end,
    garden_survey_completed_at = now()
  where id = p_property_id
    and garden_survey_completed_at is null
    and pmms.current_access_level() = 'submitter';

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'This property has already been surveyed, or you do not have permission.';
  end if;
end;
$$;

grant execute on function pmms.submit_garden_survey(uuid, boolean, text, text, text) to authenticated;
