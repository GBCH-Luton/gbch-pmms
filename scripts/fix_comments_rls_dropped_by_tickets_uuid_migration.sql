-- Fixes a real regression caused by convert_tickets_id_to_uuid.sql.
--
-- That migration ran `alter table pmms.comments drop column ticket_id
-- cascade` to swap the column to uuid. Its own comment claimed "confirmed
-- nothing else (no view, no other FK, no RLS policy) depends on these
-- columns" -- that check missed that three RLS policies' USING/WITH CHECK
-- clauses reference comments.ticket_id in a subquery (`where t.id =
-- comments.ticket_id`), which Postgres tracks as a real dependency. The
-- CASCADE silently dropped all three:
--   - builder_select_own_ticket_comments
--   - builder_insert_own_ticket_comments
--   - manager_division_scoped_access (on pmms.comments)
--
-- Confirmed live: builder2@gbch.test, correctly assigned to ticket #13,
-- got "new row violates row-level security policy for table comments"
-- on both SELECT and INSERT against their own assigned ticket's
-- comments -- i.e. every builder has been unable to read or post
-- comments on their own jobs since the tickets uuid migration ran.
--
-- This just recreates the three policies verbatim (logic unchanged --
-- ticket_id is now uuid instead of int4, but the equality join doesn't
-- care about the underlying type).

drop policy if exists "builder_select_own_ticket_comments" on pmms.comments;
create policy "builder_select_own_ticket_comments" on pmms.comments
  for select to authenticated
  using (
    pmms.current_access_level() = 'builder' and exists (
      select 1 from pmms.tickets t
      where t.id = comments.ticket_id
        and (t.assigned_builder_id = pmms.current_staff_id() or t.raised_by = pmms.current_staff_id())
    )
  );

drop policy if exists "builder_insert_own_ticket_comments" on pmms.comments;
create policy "builder_insert_own_ticket_comments" on pmms.comments
  for insert to authenticated
  with check (
    pmms.current_access_level() = 'builder'
    and author_id = pmms.current_staff_id()
    and exists (
      select 1 from pmms.tickets t
      where t.id = comments.ticket_id
        and (t.assigned_builder_id = pmms.current_staff_id() or t.raised_by = pmms.current_staff_id())
    )
  );

drop policy if exists "manager_division_scoped_access" on pmms.comments;
create policy "manager_division_scoped_access" on pmms.comments
  for all to authenticated
  using (
    pmms.current_access_level() = 'manager'
    and pmms.current_division() is not null
    and exists (
      select 1 from pmms.tickets t
      where t.id = comments.ticket_id
        and pmms.category_division(t.category) = pmms.current_division()
    )
  )
  with check (
    pmms.current_access_level() = 'manager'
    and pmms.current_division() is not null
    and exists (
      select 1 from pmms.tickets t
      where t.id = comments.ticket_id
        and pmms.category_division(t.category) = pmms.current_division()
    )
  );

notify pgrst, 'reload schema';
