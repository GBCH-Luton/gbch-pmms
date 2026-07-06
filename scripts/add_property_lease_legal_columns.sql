-- Adds the columns needed for the Property Profile "Lease & Legal" tab.
-- All go directly on pmms.properties (an existing table with RLS already
-- disabled -- unlike property_compliance/property_assets, no RLS fix is
-- needed here). Lease/insurance documents reuse the 'property-docs' bucket
-- already created by add_property_compliance_table.sql.

alter table pmms.properties add column if not exists lease_start_date date;
alter table pmms.properties add column if not exists lease_end_date date;
alter table pmms.properties add column if not exists lease_type text;
alter table pmms.properties add column if not exists lease_status text;
alter table pmms.properties add column if not exists landlord_company text;
alter table pmms.properties add column if not exists landlord_name text;
alter table pmms.properties add column if not exists landlord_phone text;
alter table pmms.properties add column if not exists landlord_email text;
alter table pmms.properties add column if not exists rent_amount numeric;
alter table pmms.properties add column if not exists rent_payment_day integer;
alter table pmms.properties add column if not exists deposit_amount numeric;
alter table pmms.properties add column if not exists deposit_scheme text;
alter table pmms.properties add column if not exists deposit_scheme_id text;
alter table pmms.properties add column if not exists special_lease_terms text;
alter table pmms.properties add column if not exists insurance_expiry date;
alter table pmms.properties add column if not exists insurance_doc_url text;
alter table pmms.properties add column if not exists lease_doc_url text;
