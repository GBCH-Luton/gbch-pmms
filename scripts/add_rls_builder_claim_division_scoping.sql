-- Closes a real gap found 2026-07-17: a division-scoped builder (e.g. the
-- Housekeeper role) could see and claim ANY unassigned Pending ticket
-- portfolio-wide via the Available Jobs queue, including Maintenance jobs,
-- because builder_claim_unassigned (add_rls_builder_claim_unassigned.sql)
-- deliberately left eligibility as a client-side-only concern. That's fine
-- for skill-tag narrowing (a preference), but division separation is a real
-- boundary -- the same one already enforced for managers in
-- add_rls_division_scoping.sql. This applies the same pattern to builders:
-- an unscoped builder (current_division() is null -- today's default
-- "Builder" role) keeps claiming exactly as before; a division-scoped
-- builder can now only claim a ticket whose category belongs to their own
-- division.
--
-- The client-side fix (BuilderDashboard.jsx's fetchAvailableJobs()) already
-- stops a division-scoped builder from being *offered* a non-matching job;
-- this is the DB-level backstop so the claim itself can't succeed even if
-- the client-side filter is ever bypassed or has a bug.
drop policy if exists "builder_claim_unassigned" on pmms.tickets;

create policy "builder_claim_unassigned" on pmms.tickets
  for update to authenticated
  using (
    pmms.current_access_level() = 'builder'
    and assigned_builder_id is null
    and (pmms.current_division() is null or pmms.category_division(category) = pmms.current_division())
  )
  with check (pmms.current_access_level() = 'builder' and assigned_builder_id = pmms.current_staff_id());
