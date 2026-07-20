-- Adds a Town/City field to properties, so the portfolio (spread across
-- several towns -- Luton, Milton Keynes, Bedford, etc.) can be filtered by
-- area. The list of valid towns is admin-editable (pmms.settings key
-- 'towns', same pattern as 'divisions') rather than hardcoded, so adding a
-- new town later needs no code/schema change -- see client/src/lib/towns.js.
alter table pmms.properties add column if not exists town text;
