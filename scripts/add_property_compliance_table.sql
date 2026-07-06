-- Adds the pmms.property_compliance table backing the Property Profile
-- "Compliance" tab, plus the 'property-docs' storage bucket certificates
-- are uploaded to.
--
-- Two deviations from the originally requested schema:
--   1. property_id is `integer references pmms.properties(id)`, not uuid --
--      pmms.properties.id is an integer identity column (see
--      new_project_schema.sql), so a uuid FK would never match and the
--      migration would fail outright.
--   2. Added `not_applicable boolean default false`. The Compliance tab's
--      RAG rules distinguish "Red: expired or no record" from
--      "Grey: not applicable" -- without an explicit flag there's no way
--      to tell "this property has no lift, so Lift Safety doesn't apply"
--      (should be grey) apart from "Gas Safety was never filled in"
--      (should be red/urgent). This column is what "skip if not
--      applicable" (the Lift Safety note) actually toggles.

create table if not exists pmms.property_compliance (
  id uuid primary key default gen_random_uuid(),
  property_id integer references pmms.properties(id) on delete cascade,
  cert_type text not null,
  expiry_date date,
  cert_url text,
  notes text,
  not_applicable boolean not null default false,
  updated_at timestamptz default now(),
  unique (property_id, cert_type)
);

-- Every other pmms table has RLS explicitly disabled (see
-- disable_rls_new_project.sql) -- this project runs with RLS off everywhere
-- as a sandbox decision. New tables in this project default to RLS ON,
-- which silently blocks anon/authenticated reads and hard-fails writes with
-- "new row violates row-level security policy" until this is run.
alter table pmms.property_compliance disable row level security;

insert into storage.buckets (id, name, public)
values ('property-docs', 'property-docs', true)
on conflict (id) do nothing;

drop policy if exists "Allow authenticated uploads to property-docs" on storage.objects;

create policy "Allow authenticated uploads to property-docs"
on storage.objects for insert
to authenticated
with check (bucket_id = 'property-docs');
