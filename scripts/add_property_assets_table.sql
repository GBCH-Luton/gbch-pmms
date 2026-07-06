-- Adds the pmms.property_assets table backing the Property Profile
-- "Assets" tab. Reuses the same 'property-docs' storage bucket the
-- Compliance tab already created (see add_property_compliance_table.sql)
-- for asset photos -- no new bucket/policy needed here.
--
-- One deviation from the originally requested schema: property_id is
-- `integer references pmms.properties(id)`, not uuid -- pmms.properties.id
-- is an integer identity column (see new_project_schema.sql), so a uuid FK
-- would never match and the migration would fail outright. Same fix as
-- add_property_compliance_table.sql.

create table if not exists pmms.property_assets (
  id uuid primary key default gen_random_uuid(),
  property_id integer references pmms.properties(id) on delete cascade,
  asset_name text not null,
  asset_category text,
  make text,
  model text,
  serial_number text,
  installation_date date,
  warranty_start date,
  warranty_end date,
  lifespan_years integer,
  current_status text default 'Operational',
  maintenance_frequency text,
  last_service_date date,
  current_value numeric,
  supplier_details text,
  asset_photo_url text,
  notes text,
  created_at timestamptz default now()
);

-- Every other pmms table has RLS explicitly disabled (see
-- disable_rls_new_project.sql) -- this project runs with RLS off everywhere
-- as a sandbox decision. New tables in this project default to RLS ON,
-- which silently blocks anon/authenticated reads and hard-fails writes with
-- "new row violates row-level security policy" until this is run.
alter table pmms.property_assets disable row level security;
