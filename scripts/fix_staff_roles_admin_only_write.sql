-- pmms.staff_roles previously had one ALL policy keyed on
-- is_admin_or_manager(), meaning any manager (not just admin) could
-- write to it -- including setting their own row's role to 'Admin',
-- fully bypassing the "admin only" UI gate on AdminAccess.jsx. Confirmed
-- live via a real non-service-role sign-in on 2026-07-22.
--
-- The read side is genuinely needed by managers (AdminBuilders.jsx's
-- Staff list, BuilderProfilePage.jsx, shared.jsx's
-- fetchAssignableStaffForRole all read every staff member's role, not
-- just the caller's own) -- so only the write side is narrowed here.

drop policy if exists "admin_manager_full_access" on pmms.staff_roles;

create policy "admin_full_access" on pmms.staff_roles
  for all to authenticated
  using (pmms.current_access_level() = 'admin')
  with check (pmms.current_access_level() = 'admin');

create policy "admin_manager_read" on pmms.staff_roles
  for select to authenticated
  using (pmms.is_admin_or_manager());

-- builder_read_own_role is untouched (SELECT, own row only).
