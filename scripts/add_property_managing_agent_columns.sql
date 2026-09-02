-- Managing Agent is a real, separate concept from Landlord that properties
-- had no field for at all -- e.g. AF Residential manages dozens of
-- different landlords' properties. Flat columns on pmms.properties, same
-- convention as the existing gas_supplier/electric_supplier/wifi_provider
-- etc. (one repeating supplier, still just columns, not a lookup table),
-- rather than a new managing_agents table -- kept consistent with how
-- every other "one external party serving many properties" concept in
-- this schema is already modelled.
--
-- Run before scripts/import_managing_agents.sql.
alter table pmms.properties
  add column if not exists managing_agent text,
  add column if not exists managing_agent_contact_name text,
  add column if not exists managing_agent_contact_phone text,
  add column if not exists managing_agent_email text,
  add column if not exists managing_agent_address text;

notify pgrst, 'reload schema';
