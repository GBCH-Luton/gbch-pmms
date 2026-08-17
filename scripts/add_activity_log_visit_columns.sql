-- Property-visit logging for staff who travel office/home -> property with
-- no ticket/job involved (e.g. the Landlord Liaison Manager's own visits)
-- -- reuses pmms.activity_log (see add_activity_log.sql) rather than a new
-- table, same as every other "away from base" reason already modelled
-- there (materials/office/job -- see add_pmms_activity_log_category.sql).
-- activity_category = 'visit' for these rows.
--
-- mileage_logged is captured on arrival, not departure -- same reasoning
-- as tickets.mileage_logged for a builder's "Going to Another Job" arrival
-- (BuilderDashboard.jsx): the real distance is only known once the trip is
-- actually driven, not guessed beforehand.

alter table pmms.activity_log add column if not exists destination_property_id uuid references pmms.properties(id);
alter table pmms.activity_log add column if not exists mileage_logged numeric;

notify pgrst, 'reload schema';
