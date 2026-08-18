-- Ticket Submitter tickets never auto-assigned, in any category, even
-- when eligible builders existed: suggestAutoAssignBuilder's first step
-- (fetchAssignableStaffForRole) reads pmms.staff_roles to find who holds
-- a given role (e.g. 'Builder'), but the only SELECT policy that applied
-- to a submitter's own session was "read your own row" -- so that query
-- always came back empty under her session, regardless of who actually
-- held the role. Role names ('Builder', 'Compliance Manager', etc.) are
-- not sensitive -- same low-sensitivity bar as public.staff's existing
-- "public read staff" (qual: true) policy -- so this grants submitters
-- the same broad read access, purely additive to the existing policies.
create policy submitter_read_staff_roles
on pmms.staff_roles
for select
using (pmms.current_access_level() = 'submitter');
