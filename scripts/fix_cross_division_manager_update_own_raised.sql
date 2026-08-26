-- Found live 2026-08-26: Kathryn Williamson (Landlord Liaison) raised
-- tickets #538/#539 in "Security & Access Systems" / "Compliance & Safety
-- Systems" -- Maintenance-division categories -- using her cross-division
-- raise right. She tried to Cancel #539 four times (10:27, 10:27, 11:33,
-- 11:57) -- each attempt's audit-trail entry was posted successfully
-- (manager_insert_own_events, generic to any manager, already covers
-- that), but the actual `pmms.tickets` status update silently affected 0
-- rows: no RLS policy allows her to write ANY status transition on a
-- cross-division ticket she raised, only the earlier fix's narrow
-- Completed -> Archived/Assigned sign-off transition
-- (landlord_liaison_signoff_own_raised, added by
-- fix_cross_division_manager_signoff_and_comments.sql this morning).
-- Cancelling from Assigned/Pending/In Progress/On Hold is a different
-- transition that policy never covered -- the plain `.update()` in
-- AdminPipeline.jsx's submitCancel() has no `.select()` chained, so a
-- 0-row RLS-filtered update returns no error, making the failure
-- invisible to both her and the app.
--
-- Same underlying gap, generalized this time instead of patched
-- transition-by-transition: replace the narrow signoff-only policy with
-- one general "raised_by = self" UPDATE policy per cross-division-raise
-- role, matching the shape manager_division_scoped_access already gives
-- a same-division manager over their own division's tickets (full write
-- access, gated only by raised_by for the Archived transition -- which
-- here is automatically satisfied since raised_by = self is required for
-- every transition, not just Archived).

begin;

drop policy if exists "landlord_liaison_signoff_own_raised" on pmms.tickets;
create policy "landlord_liaison_update_own_raised" on pmms.tickets
  for update to authenticated
  using (
    pmms.current_access_level() = 'manager'
    and pmms.current_division() = 'Landlord Liaison'
    and raised_by = pmms.current_staff_id()
  )
  with check (
    pmms.current_access_level() = 'manager'
    and pmms.current_division() = 'Landlord Liaison'
    and raised_by = pmms.current_staff_id()
  );

drop policy if exists "housekeeping_manager_signoff_own_raised" on pmms.tickets;
create policy "housekeeping_manager_update_own_raised" on pmms.tickets
  for update to authenticated
  using (
    pmms.current_access_level() = 'manager'
    and pmms.current_division() = 'Housekeeping'
    and raised_by = pmms.current_staff_id()
  )
  with check (
    pmms.current_access_level() = 'manager'
    and pmms.current_division() = 'Housekeeping'
    and raised_by = pmms.current_staff_id()
  );

commit;

notify pgrst, 'reload schema';
