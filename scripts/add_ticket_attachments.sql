-- Lets a ticket carry more than one photo/video at creation time. Every
-- "log a ticket" form (AdminRaiseTicket.jsx, SubmitterDashboard.jsx,
-- BuilderDashboard.jsx's self-raise flow) previously took a single file
-- into tickets.photo_url. That column is left untouched (still set to the
-- FIRST uploaded file, so every existing single-photo display site keeps
-- working with no changes), and every uploaded file -- including the
-- first -- is now also inserted here, giving display sites that want a
-- full gallery something to query.
--
-- RLS mirrors pmms.comments (add_rls_per_role_batch1_tickets.sql) and its
-- submitter extension (add_submitter_role.sql): visible/insertable by
-- whoever could see/raise the parent ticket, admin/manager unrestricted.
-- Builders additionally need insert on tickets assigned to them (not just
-- raised by them), since AdminRaiseTicket.jsx lets a manager attach media
-- while assigning straight to a builder -- no, that insert happens as the
-- manager, who's already covered by admin_manager_full_access. Builders
-- only ever attach media to tickets they themselves raised.

create table if not exists pmms.ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references pmms.tickets(id) on delete cascade,
  url text not null,
  created_at timestamptz not null default now()
);

create index if not exists ticket_attachments_ticket_id_idx on pmms.ticket_attachments(ticket_id);

alter table pmms.ticket_attachments enable row level security;

drop policy if exists "admin_manager_full_access" on pmms.ticket_attachments;
create policy "admin_manager_full_access" on pmms.ticket_attachments
  for all to authenticated
  using (pmms.is_admin_or_manager())
  with check (pmms.is_admin_or_manager());

drop policy if exists "builder_select_own_ticket_attachments" on pmms.ticket_attachments;
create policy "builder_select_own_ticket_attachments" on pmms.ticket_attachments
  for select to authenticated
  using (
    pmms.current_access_level() = 'builder' and exists (
      select 1 from pmms.tickets t
      where t.id = ticket_attachments.ticket_id
        and (t.assigned_builder_id = pmms.current_staff_id() or t.raised_by = pmms.current_staff_id())
    )
  );

drop policy if exists "builder_insert_own_ticket_attachments" on pmms.ticket_attachments;
create policy "builder_insert_own_ticket_attachments" on pmms.ticket_attachments
  for insert to authenticated
  with check (
    pmms.current_access_level() = 'builder' and exists (
      select 1 from pmms.tickets t
      where t.id = ticket_attachments.ticket_id and t.raised_by = pmms.current_staff_id()
    )
  );

drop policy if exists "submitter_select_own_ticket_attachments" on pmms.ticket_attachments;
create policy "submitter_select_own_ticket_attachments" on pmms.ticket_attachments
  for select to authenticated
  using (
    pmms.current_access_level() = 'submitter' and exists (
      select 1 from pmms.tickets t
      where t.id = ticket_attachments.ticket_id and t.raised_by = pmms.current_staff_id()
    )
  );

drop policy if exists "submitter_insert_own_ticket_attachments" on pmms.ticket_attachments;
create policy "submitter_insert_own_ticket_attachments" on pmms.ticket_attachments
  for insert to authenticated
  with check (
    pmms.current_access_level() = 'submitter' and exists (
      select 1 from pmms.tickets t
      where t.id = ticket_attachments.ticket_id and t.raised_by = pmms.current_staff_id()
    )
  );
