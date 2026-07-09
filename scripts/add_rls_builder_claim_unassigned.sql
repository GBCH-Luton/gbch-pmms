-- Lets a builder "claim" any unassigned ticket -- today's
-- builder_update_own policy (add_rls_per_role_batch1_tickets.sql) only
-- allows a builder to update a ticket that's already theirs (assigned_
-- builder_id = them) or that they personally raised, so claiming a
-- ticket nobody's been assigned yet fails outright under that policy
-- alone.
--
-- Additive, not a replacement -- Postgres OR's multiple permissive
-- policies together for the same command, so this sits alongside
-- builder_update_own without touching it.
--
-- Deliberately does NOT check the ticket's category against the
-- builder's own skills column -- eligibility narrowing is already a
-- client-side concern everywhere else in this app (e.g.
-- fetchAssignableStaffForCategory), not a DB-level constraint. The
-- Available Jobs UI simply never offers a non-matching ticket to claim;
-- this policy only needs to guarantee the claim itself is atomic (the
-- `assigned_builder_id is null` check in the USING clause is what makes
-- two simultaneous claims on the same ticket resolve safely -- only the
-- first UPDATE actually matches a row).
create policy "builder_claim_unassigned" on pmms.tickets
  for update to authenticated
  using (pmms.current_access_level() = 'builder' and assigned_builder_id is null)
  with check (pmms.current_access_level() = 'builder' and assigned_builder_id = pmms.current_staff_id());
