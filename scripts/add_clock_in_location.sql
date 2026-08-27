-- Adds the mandatory clock-in location fields to pmms.daily_attendance.
-- Previewed in the Builder v0.3 guide simulator and approved before
-- building. Every future clock-in now records WHERE the builder says
-- they're clocking in from (Office / a specific Job / a specific
-- Property / Other, free text) -- not retroactive, existing rows keep
-- all four columns null.

alter table pmms.daily_attendance
  add column if not exists clock_in_location_type text
    check (clock_in_location_type in ('office', 'job', 'property', 'other')),
  add column if not exists clock_in_location_ticket_id uuid references pmms.tickets(id),
  add column if not exists clock_in_location_property_id uuid references pmms.properties(id),
  add column if not exists clock_in_location_note text;
