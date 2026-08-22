-- Weekend test: rename it_luton schema to see if anything breaks.
-- Confirmed beforehand: it_luton is NOT currently checked in
-- Project Settings -> Data API -> Exposed schemas (unchecked since 2026-08-13),
-- which was the actual cause of the outage last time this was tried.
-- Fully reversible: rename back with the reverse ALTER SCHEMA if anything goes wrong.

alter schema it_luton rename to it_luton_deprecated_20260822;
