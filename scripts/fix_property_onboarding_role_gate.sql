-- add_property_onboarding_tables.sql gated Property Onboarding access on
-- job_title = 'Assistant Manager' -- turned out that's not a real job_title
-- in this company's data at all (checked live: no staff row has it). The
-- actual role is "Maintenance Assistant", an existing PMMS custom Role
-- (pmms.settings['custom_roles'], accessLevel 'manager', division null),
-- assigned via pmms.staff_roles like any other PMMS Role -- not a job_title.
--
-- pmms.current_job_title() is now dead (nothing else uses it) -- dropped.
-- New helper mirrors pmms.current_division() (add_divisions_helper_functions.sql)
-- but returns the assigned Role's raw name itself, not something derived
-- from it, since nothing existing exposes that to RLS.
create or replace function pmms.current_role_name()
returns text
language sql
security definer
stable
set search_path = public, pmms
as $$
  with me as (
    select id, active from public.staff
    where email = auth.jwt() ->> 'email'
    order by id
    limit 1
  ),
  my_role as (
    select sr.role from pmms.staff_roles sr, me
    where sr.staff_id = me.id
    order by sr.role
    limit 1
  )
  select case when me.active = false then null else my_role.role end
  from me left join my_role on true
$$;

drop policy if exists "onboarding_am_and_liaison" on pmms.property_onboarding_walks;
create policy "onboarding_am_and_liaison" on pmms.property_onboarding_walks
  for all to authenticated
  using (
    pmms.current_access_level() = 'admin'
    or pmms.current_role_name() = 'Maintenance Assistant'
    or pmms.current_division() = 'Landlord Liaison'
  )
  with check (
    pmms.current_access_level() = 'admin'
    or pmms.current_role_name() = 'Maintenance Assistant'
    or pmms.current_division() = 'Landlord Liaison'
  );

drop policy if exists "onboarding_am_and_liaison" on pmms.property_onboarding_checks;
create policy "onboarding_am_and_liaison" on pmms.property_onboarding_checks
  for all to authenticated
  using (
    pmms.current_access_level() = 'admin'
    or pmms.current_role_name() = 'Maintenance Assistant'
    or pmms.current_division() = 'Landlord Liaison'
  )
  with check (
    pmms.current_access_level() = 'admin'
    or pmms.current_role_name() = 'Maintenance Assistant'
    or pmms.current_division() = 'Landlord Liaison'
  );

drop function if exists pmms.current_job_title();

notify pgrst, 'reload schema';
