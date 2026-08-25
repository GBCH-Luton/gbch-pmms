-- Per-room description field for the Onboarding walk (one text box per
-- individual room, e.g. "Bedroom 3" separately from "Bedroom 1") -- see
-- PropertyOnboardingWalk.jsx's redesigned type-grouped step wizard.

create table if not exists pmms.property_onboarding_room_notes (
  id uuid primary key default gen_random_uuid(),
  walk_id uuid not null references pmms.property_onboarding_walks(id) on delete cascade,
  room text not null,
  description text not null default '',
  updated_at timestamptz not null default now(),
  unique (walk_id, room)
);

alter table pmms.property_onboarding_room_notes enable row level security;

-- Same access as property_onboarding_walks itself (onboarding_am_and_liaison) --
-- whoever can see/edit the walk can see/edit its room notes.
create policy onboarding_room_notes_am_and_liaison on pmms.property_onboarding_room_notes
  for all
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
