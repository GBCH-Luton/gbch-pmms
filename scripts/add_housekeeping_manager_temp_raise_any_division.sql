-- Temporary (2026-08-25): lets the Housekeeping Manager raise a ticket in
-- ANY category, not just Housekeeping's own -- mirrors the existing
-- Landlord Liaison exception (landlord_liaison_insert_any_division /
-- landlord_liaison_select_own_raised) exactly, just scoped to the
-- Housekeeping division instead. Without the SELECT policy too, the
-- INSERT would succeed but the client's chained .select() would silently
-- return no row (same gotcha noted when the Landlord Liaison pair was
-- built).
--
-- To remove once the temporary need ends:
--   drop policy housekeeping_manager_insert_any_division on pmms.tickets;
--   drop policy housekeeping_manager_select_own_raised on pmms.tickets;
-- (and remove the matching nav item / AdminRaiseMaintenanceTicket.jsx in
-- the client -- see project_housekeeping_manager_temp_raise_access.md)

create policy housekeeping_manager_insert_any_division
on pmms.tickets
for insert
to authenticated
with check (
  pmms.current_access_level() = 'manager'
  and pmms.current_division() = 'Housekeeping'
  and raised_by = pmms.current_staff_id()
);

create policy housekeeping_manager_select_own_raised
on pmms.tickets
for select
to authenticated
using (
  pmms.current_access_level() = 'manager'
  and pmms.current_division() = 'Housekeeping'
  and raised_by = pmms.current_staff_id()
);
