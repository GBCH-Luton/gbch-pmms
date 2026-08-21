-- Property Onboarding: an Assistant Manager walks a new (Procured) property
-- room by room; anything that fails becomes a real pmms.tickets row (no
-- schema change needed there -- an Assistant Manager is job_title-derived
-- role='manager' with no division, i.e. an unscoped manager, which already
-- has full ticket insert/select/update; raiser-only sign-off already
-- applies to managers too, see add_raiser_only_signoff.sql). What's
-- missing is somewhere to track the walk itself and which checklist
-- verdict produced which ticket (or a plain Pass, which has no ticket at
-- all) -- these two tables, following the property_status_history
-- precedent (single admin_manager_full_access-shaped policy).
--
-- current_job_title() is a new small helper, mirroring current_division()
-- (add_divisions_helper_functions.sql), because nothing existing exposes
-- job_title to RLS -- every other division-scoped feature gates on an
-- assigned PMMS Role's division, not on job_title directly, and
-- "Assistant Manager" is purely a job_title with no PMMS Role required.
create or replace function pmms.current_job_title()
returns text
language sql
stable
security definer
set search_path = public, pmms
as $$
  select job_title from public.staff where id = pmms.current_staff_id()
$$;

create table if not exists pmms.property_onboarding_walks (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references pmms.properties(id) on delete cascade,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'pending_liaison_review', 'sent_back', 'approved')),
  started_by uuid references public.staff(id),
  started_by_name text,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  reviewed_by uuid references public.staff(id),
  reviewed_by_name text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Only one walk in flight per property at a time -- an 'approved' walk
-- stays as history and doesn't block a future re-walk, but two Assistant
-- Managers can't both be mid-walk (or one submitted, one still walking)
-- on the same property simultaneously.
create unique index if not exists property_onboarding_walks_one_active
  on pmms.property_onboarding_walks(property_id)
  where status in ('in_progress', 'pending_liaison_review', 'sent_back');

-- One row per checklist verdict. room/item_key are null for entries not
-- tied to a specific checklist cell (landlord-agreed extra work, or a
-- Landlord Liaison flag/missed-item raised during review) -- source
-- distinguishes those. A Pass has no ticket_id at all; a Fail always does.
create table if not exists pmms.property_onboarding_checks (
  id uuid primary key default gen_random_uuid(),
  walk_id uuid not null references pmms.property_onboarding_walks(id) on delete cascade,
  room text,
  item_key text,
  verdict text not null check (verdict in ('pass', 'fail')),
  source text not null default 'walk' check (source in ('walk', 'custom', 'll_flag', 'll_missed')),
  ticket_id uuid references pmms.tickets(id) on delete set null,
  raised_by_name text,
  created_at timestamptz not null default now()
);

alter table pmms.property_onboarding_walks enable row level security;
alter table pmms.property_onboarding_checks enable row level security;

-- Deliberately not pmms.is_admin_or_manager() -- that would let every
-- manager (Housing Manager, Team Leader, any division) see and edit
-- onboarding walks, not just the two roles this feature is actually for.
create policy "onboarding_am_and_liaison" on pmms.property_onboarding_walks
  for all to authenticated
  using (
    pmms.current_access_level() = 'admin'
    or pmms.current_job_title() = 'Assistant Manager'
    or pmms.current_division() = 'Landlord Liaison'
  )
  with check (
    pmms.current_access_level() = 'admin'
    or pmms.current_job_title() = 'Assistant Manager'
    or pmms.current_division() = 'Landlord Liaison'
  );

create policy "onboarding_am_and_liaison" on pmms.property_onboarding_checks
  for all to authenticated
  using (
    pmms.current_access_level() = 'admin'
    or pmms.current_job_title() = 'Assistant Manager'
    or pmms.current_division() = 'Landlord Liaison'
  )
  with check (
    pmms.current_access_level() = 'admin'
    or pmms.current_job_title() = 'Assistant Manager'
    or pmms.current_division() = 'Landlord Liaison'
  );

notify pgrst, 'reload schema';
