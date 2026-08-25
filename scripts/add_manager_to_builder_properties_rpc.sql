-- Widen pmms.builder_properties() to also serve 'manager' callers.
--
-- The Housekeeping Manager's temporary "Raise a Ticket (Any Category)"
-- page (see project_housekeeping_manager_temp_raise_access.md) reuses
-- SubmitterDashboard.jsx's NewReportForm as-is, which fetches its
-- property dropdown via this RPC. The function's access-level check only
-- ever allowed 'builder'/'submitter', so a manager calling it got zero
-- rows back -- "no matching properties" with an empty list.
--
-- Adding 'manager' here grants nothing new: managers already have full
-- direct SELECT on pmms.properties via the admin_manager_full_access RLS
-- policy (`pmms.is_admin_or_manager()`, unscoped by division). This just
-- makes the RPC path return the same data a manager can already see
-- through the properties table directly.

create or replace function pmms.builder_properties(property_ids uuid[] default null::uuid[])
returns table(id uuid, address text, high_vulnerability boolean, layout_type text, safeguards text, electrical_shutoff text, gas_shutoff text, latitude double precision, longitude double precision)
language sql
stable security definer
set search_path to 'public', 'pmms'
as $function$
  select p.id, p.address, p.high_vulnerability, p.layout_type, p.safeguards, p.electrical_shutoff, p.gas_shutoff,
         p.latitude, p.longitude
  from pmms.properties p
  where pmms.current_access_level() in ('builder', 'submitter', 'manager')
    and (property_ids is null or p.id = any(property_ids))
$function$;
