-- Adds layout_type to pmms.properties, needed by the ported support-worker
-- "Room / Area" step: it decides whether the floor/context picker shows
-- Ground/First (2-Floors), Ground/First/Second (3-Floors), or Main Flat
-- Space/En-Suite (Flat), matching the original vanilla-JS screen exactly.
--
-- Existing rows default to '2-Floors' -- update specific properties to
-- 'Flat' or '3-Floors' as appropriate for your portfolio.

alter table pmms.properties
  add column if not exists layout_type text not null default '2-Floors';
