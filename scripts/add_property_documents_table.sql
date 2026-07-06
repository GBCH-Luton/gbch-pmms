-- Adds the pmms.property_documents table backing the Property Profile
-- "Documents" tab. Not specified in the request's SQL (there wasn't one
-- this time), so it follows the same conventions as the other new
-- property-profile tables added this session:
--   - property_id is `integer references pmms.properties(id)`, not uuid --
--     pmms.properties.id is an integer identity column (see
--     new_project_schema.sql).
--   - RLS is explicitly disabled, matching every other pmms table (see
--     disable_rls_new_project.sql) -- new tables in this project default to
--     RLS ON, which silently blocks anon/authenticated reads and hard-fails
--     writes with "new row violates row-level security policy" until this
--     is run (bit us on property_assets/property_compliance already).
-- Documents reuse the 'property-docs' storage bucket already created by
-- add_property_compliance_table.sql.

create table if not exists pmms.property_documents (
  id uuid primary key default gen_random_uuid(),
  property_id integer references pmms.properties(id) on delete cascade,
  document_name text not null,
  category text,
  document_date date,
  expiry_date date,
  notes text,
  file_url text,
  uploaded_by text,
  created_at timestamptz default now()
);

alter table pmms.property_documents disable row level security;
