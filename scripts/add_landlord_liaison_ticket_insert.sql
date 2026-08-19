-- Kathryn (Landlord Liaison Manager) got "new row violates row-level
-- security policy for table tickets" raising a ticket for an issue she
-- spotted on a property walk (e.g. "Window lock fault", a Maintenance-
-- division category). Her role is accessLevel 'manager' with
-- division = 'Landlord Liaison' (see add_landlord_liaison_division.sql),
-- so pmms.current_division() = 'Landlord Liaison'. The existing
-- manager_division_scoped_access policy only allows a manager to write
-- tickets whose category belongs to their OWN division -- correct for a
-- normal division manager, but wrong here: her whole job is flagging
-- issues she finds across every division so they get routed to whoever
-- actually owns that category, same as a Ticket Submitter's unrestricted
-- insert. This adds an INSERT-only policy scoped to her own division tag
-- but not the ticket's category, mirroring submitter_insert_own.
create policy "landlord_liaison_insert_any_division" on pmms.tickets
  for insert to authenticated
  with check (
    pmms.current_access_level() = 'manager'
    and pmms.current_division() = 'Landlord Liaison'
    and raised_by = pmms.current_staff_id()
  );

notify pgrst, 'reload schema';
