-- New Property Profile "Inventory" tab -- tracks furniture/appliances in a
-- property, split Company-owned vs Landlord-owned (the split the directors'
-- own mockup called out: what GBCH supplied vs what was already there at
-- handover). Previewed first as a Claude Artifact simulation before being
-- built for real -- see that artifact for the exact card/modal design this
-- mirrors.
--
-- Same single-policy RLS shape as pmms.property_status_history/
-- property_room_history: admin/manager full access at the DB level, with
-- Landlord Liaison's read-only treatment enforced client-side only (same
-- established tradeoff every other Property Profile tab already accepts --
-- see PropertyGardensTab.jsx's own readOnly prop -- a real DB-level
-- per-division restriction is separate, parked work, not reopened here).
create table if not exists pmms.property_inventory_items (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references pmms.properties(id) on delete cascade,
  owner text not null check (owner in ('company', 'landlord')),
  name text not null,
  category text,
  room text,
  condition text check (condition in ('good', 'fair', 'poor')),
  notes text,
  photo_url text,
  added_by uuid references public.staff(id),
  created_at timestamptz not null default now()
);

alter table pmms.property_inventory_items enable row level security;

create policy "admin_manager_full_access" on pmms.property_inventory_items
  for all to authenticated
  using (pmms.is_admin_or_manager())
  with check (pmms.is_admin_or_manager());

create index if not exists property_inventory_items_property_id_idx
  on pmms.property_inventory_items(property_id);

notify pgrst, 'reload schema';
