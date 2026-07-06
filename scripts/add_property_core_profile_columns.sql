-- Adds the columns needed for the Property Profile "Core" tab.
--
-- Three fields from the original spec were intentionally NOT added as new
-- columns because pmms.properties already has an equivalent, load-bearing
-- column:
--   - "Layout Type" (Studio/1-Bed/2-Bed/.../HMO/Other) -> stored under the
--     NEW column unit_layout_type instead, because the existing layout_type
--     column already drives the Builder's ticket-raising floor/area picker
--     (values 2-Floors/3-Floors/Flat) -- reusing it would have broken that
--     feature for every property not tagged 'Flat' or '3-Floors'.
--   - "Electric Shutoff Location" -> reuses the existing electrical_shutoff
--     column (already shown on the Builder's Job Detail Access & Safety
--     card) instead of adding a near-duplicate electric_shutoff column.
--   - "Vulnerability Flag" / "Vulnerability Notes" -> reuse the existing
--     high_vulnerability / vulnerability_reason columns (already power the
--     Builder Job Detail alert banner and the +30 priority score bonus on
--     new tickets) instead of adding a second, disconnected pair of columns.
--
-- The Core tab's "Property Status" dropdown also writes into the existing
-- status column, just with an expanded value set (Occupied/Void/Under
-- Repair, alongside the existing Active/Inactive).

alter table pmms.properties add column if not exists property_name text;
alter table pmms.properties add column if not exists tenure_type text;
alter table pmms.properties add column if not exists unit_layout_type text;
alter table pmms.properties add column if not exists construction_type text;
alter table pmms.properties add column if not exists num_floors integer;
alter table pmms.properties add column if not exists num_rooms integer;
alter table pmms.properties add column if not exists num_bathrooms integer;
alter table pmms.properties add column if not exists num_kitchens integer;
alter table pmms.properties add column if not exists floor_area_sqft integer;
alter table pmms.properties add column if not exists year_constructed integer;
alter table pmms.properties add column if not exists access_instructions text;
alter table pmms.properties add column if not exists emergency_contact text;
alter table pmms.properties add column if not exists gas_supplier text;
alter table pmms.properties add column if not exists electric_supplier text;
alter table pmms.properties add column if not exists water_supplier text;
alter table pmms.properties add column if not exists maps_link text;
alter table pmms.properties add column if not exists coordinates text;
alter table pmms.properties add column if not exists cover_photo_url text;
