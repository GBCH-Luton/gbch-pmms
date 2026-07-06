-- Adds postcode + status to pmms.properties, needed by the new admin
-- "Properties" page (search-by-postcode and the Active/Inactive status pill).
-- pmms.properties itself already exists (see new_project_schema.sql) with an
-- integer identity id, address, property_type, electrical_shutoff,
-- gas_shutoff, safeguards, high_vulnerability, vulnerability_reason,
-- created_at -- this migration only adds the two missing columns.

alter table pmms.properties add column if not exists postcode text;
alter table pmms.properties add column if not exists status text not null default 'Active';
