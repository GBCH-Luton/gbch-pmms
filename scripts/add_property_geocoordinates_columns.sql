-- Adds cached lat/lng coordinates to pmms.properties, geocoded (client-side,
-- lazily, on first need) from the property's postcode via postcodes.io.
-- pmms.properties.postcode already exists but has never been populated --
-- it's backfilled by extracting the postcode from the free-text address
-- the first time a property's coordinates are needed, then cached here so
-- it's never re-geocoded unless the address changes.

alter table pmms.properties add column if not exists latitude double precision;
alter table pmms.properties add column if not exists longitude double precision;
