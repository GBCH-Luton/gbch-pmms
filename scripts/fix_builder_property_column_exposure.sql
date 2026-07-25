-- pmms.properties' builder_read_only policy was row-level only (any
-- builder, any row) with no column restriction -- a builder could call
-- the REST API directly (select=*) and get every property's
-- rent_amount, deposit_amount, landlord contact details, wifi
-- credentials, etc., even though the UI only ever asks for a narrow,
-- safe set (confirmed via grep of every properties read in
-- BuilderDashboard.jsx: id, address, high_vulnerability, layout_type,
-- safeguards, electrical_shutoff, gas_shutoff).
--
-- Postgres RLS is row-level, not column-level, and this app shares one
-- `authenticated` DB role across every access level (admin/manager/
-- builder are all distinguished by JWT/session content, not separate
-- Postgres roles), so column-level GRANT/REVOKE or a plain view can't
-- differentiate what a builder sees vs. what a manager sees on the same
-- table. The correct mechanism is a SECURITY DEFINER function that
-- checks the caller's own access level and returns only the safe
-- columns -- then removing the builder's direct row-level SELECT
-- access to the base table entirely, so there's no way to bypass the
-- function via a raw API call.

drop policy if exists "builder_read_only" on pmms.properties;

create or replace function pmms.builder_properties(property_ids uuid[] default null)
returns table (
  id uuid,
  address text,
  high_vulnerability boolean,
  layout_type text,
  safeguards text,
  electrical_shutoff text,
  gas_shutoff text
)
language sql
security definer
stable
set search_path = public, pmms
as $$
  select p.id, p.address, p.high_vulnerability, p.layout_type, p.safeguards, p.electrical_shutoff, p.gas_shutoff
  from pmms.properties p
  where pmms.current_access_level() = 'builder'
    and (property_ids is null or p.id = any(property_ids))
$$;

grant execute on function pmms.builder_properties(uuid[]) to authenticated;
