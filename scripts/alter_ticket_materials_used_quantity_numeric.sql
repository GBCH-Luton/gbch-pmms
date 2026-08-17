-- quantity was free text (to allow "2 boxes"-style entries), but the
-- builder found they could type letters into what's meant to be a count
-- -- tightened to numeric, both at the DB level and the input itself
-- (BuilderDashboard.jsx now uses type="number"). No rows existed yet
-- (feature shipped same session), so a plain type change is safe.

alter table pmms.ticket_materials_used alter column quantity type numeric using quantity::numeric;

notify pgrst, 'reload schema';
