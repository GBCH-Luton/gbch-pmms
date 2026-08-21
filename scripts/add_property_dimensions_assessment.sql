-- Dimensions Assessment: the Landlord Liaison records every room's
-- measurements (bedrooms, bathrooms, kitchens, gardens, shared/communal
-- spaces) for a property, replacing a Microsoft Forms form that fed
-- nowhere the rest of the team could see. Room-level data (one row per
-- measured room) gets its own table, mirroring property_status_history's
-- precedent; single-value-per-property fields (descriptions, the "Update"
-- note, who/when last assessed) go straight on pmms.properties, matching
-- how garden_state etc. already live there.
--
-- No new RLS carve-out needed for the Landlord Liaison specifically --
-- checked live: pmms.properties' only policy (admin_manager_full_access)
-- is already unscoped, so any admin/manager already has full read/write on
-- every column including these new ones. Her being read-only on the
-- EXISTING Gardens tab (has_garden/garden_state/photos) is purely a
-- client-side UI choice in PropertyGardensTab.jsx, not an RLS boundary --
-- this feature doesn't touch that tab or its columns at all.
create table if not exists pmms.property_room_dimensions (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references pmms.properties(id) on delete cascade,
  room_type text not null check (room_type in ('bedroom', 'bathroom', 'kitchen', 'garden', 'communal')),
  room_index int not null,
  length_m numeric,
  width_m numeric,
  -- Only meaningful for room_type='garden' -- lets "front only / back only /
  -- both" be read directly off these rows instead of a separate boolean
  -- pair on properties that could drift out of sync with what's actually
  -- recorded here. "Has a garden" itself is likewise derived (0 garden rows
  -- = no garden), not a stored flag -- deliberately NOT synced with the
  -- existing has_garden boolean, which a different process/person owns.
  orientation text check (orientation in ('front', 'back', 'other')),
  created_at timestamptz not null default now(),
  unique (property_id, room_type, room_index)
);

alter table pmms.property_room_dimensions enable row level security;

create policy "admin_manager_full_access" on pmms.property_room_dimensions
  for all to authenticated
  using (pmms.is_admin_or_manager())
  with check (pmms.is_admin_or_manager());

alter table pmms.properties
  add column if not exists bedroom_description text,
  add column if not exists bathroom_description text,
  add column if not exists kitchen_description text,
  add column if not exists garden_communal_description text,
  add column if not exists dimensions_update_note text,
  add column if not exists dimensions_assessed_by uuid references public.staff(id),
  add column if not exists dimensions_assessed_by_name text,
  add column if not exists dimensions_assessed_at timestamptz;

notify pgrst, 'reload schema';
