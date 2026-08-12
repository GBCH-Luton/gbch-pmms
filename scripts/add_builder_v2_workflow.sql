-- Builder v2 ("Locked Job Focus Mode") -- see client/public/builder-v2-guide.html
-- for the approved design this implements. Three independent pieces:

-- 1. Nearby-jobs "Closest to you" needs property coordinates, which
--    builder_properties() (see fix_builder_property_column_exposure.sql)
--    deliberately doesn't return today -- that restriction was about
--    accidentally-exposed sensitive fields (rent, deposit, landlord
--    contact, wifi credentials), not coordinates. A builder already knows
--    the address of every property they're assigned to; lat/lng is just a
--    geocoded form of the same information, so adding it here is a
--    targeted, low-risk extension, not a re-opening of that fix.
--
--    NOTE (2026-08-12 fix): this drop+recreate was copied from an older
--    base version of the function and silently reverted the access check
--    to 'builder' only, dropping 'submitter' -- which add_submitter_role.sql
--    had already added so a Ticket Submitter's raise-ticket property
--    dropdown (same RPC, see SubmitterDashboard.jsx) could see anything.
--    That regression broke every submitter's property list in production
--    until caught and fixed live. Both access levels must stay listed here.
drop function if exists pmms.builder_properties(uuid[]);

create function pmms.builder_properties(property_ids uuid[] default null)
returns table (
  id uuid,
  address text,
  high_vulnerability boolean,
  layout_type text,
  safeguards text,
  electrical_shutoff text,
  gas_shutoff text,
  latitude double precision,
  longitude double precision
)
language sql
security definer
stable
set search_path = public, pmms
as $$
  select p.id, p.address, p.high_vulnerability, p.layout_type, p.safeguards, p.electrical_shutoff, p.gas_shutoff,
         p.latitude, p.longitude
  from pmms.properties p
  where pmms.current_access_level() in ('builder', 'submitter')
    and (property_ids is null or p.id = any(property_ids))
$$;

grant execute on function pmms.builder_properties(uuid[]) to authenticated;

-- 2. End-of-day auto-clock-out grace period (minutes past the
--    daily_clock_out_reminder_time deadline before the system closes an
--    unclosed shift itself) -- a new Settings field, same pattern as
--    every other pmms.settings row.
insert into pmms.settings (setting_key, setting_value)
values ('auto_clock_out_grace_minutes', '120')
on conflict (setting_key) do nothing;

-- 3. Two new daily_attendance columns for the end-of-day escalation:
--    manager_clock_out_alert_sent_at is a one-shot guard for the
--    manager's own ping, mirroring clock_out_reminder_sent_at's existing
--    role for the builder's. auto_clocked_out marks a shift the system
--    closed itself, kept deliberately separate from clock_out_override
--    (that column means "a manager did this" -- AdminClocking.jsx already
--    labels it "Manager override", which would be actively misleading if
--    reused here for something a manager never touched).
alter table pmms.daily_attendance
  add column if not exists manager_clock_out_alert_sent_at timestamptz,
  add column if not exists auto_clocked_out boolean not null default false;
