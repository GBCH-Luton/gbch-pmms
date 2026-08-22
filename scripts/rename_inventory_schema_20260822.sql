-- Weekend test: rename inventory schema to see if anything breaks.
-- it_luton was renamed first (same day) with no issues -- see
-- scripts/rename_it_luton_schema_20260822.sql.
-- Confirmed beforehand: inventory is NOT currently checked in
-- Project Settings -> Data API -> Exposed schemas (unchecked since 2026-08-13),
-- which was the actual cause of the outage last time this was tried.
-- Fully reversible: rename back with the reverse ALTER SCHEMA if anything goes wrong.

alter schema inventory rename to inventory_deprecated_20260822;
