-- Replaces the single receipt_photo_url/receipt_amount columns just added
-- to pmms.activity_log (add_activity_log_receipt_columns.sql) -- a
-- materials run can involve more than one receipt (two different shops,
-- two separate purchases), so this needs to be a proper one-to-many
-- table, same reasoning that made pmms.ticket_attachments a separate
-- table from a single tickets.photo_url column. Those two columns are
-- dropped below; nothing had been written to them yet.
--
-- ticket_id is denormalized from activity_log.ticket_id at insert time
-- (not looked up via a join every read) so AdminPipeline's ticket-expand
-- view can query "receipts for this job" directly, same convention
-- ticket_attachments already uses. A materials run started with no job
-- in progress has ticket_id null here too -- those receipts are visible
-- via activity_log itself (staff/day view), just not attached to any one
-- ticket's expanded row.
--
-- RLS mirrors pmms.activity_log itself exactly (admin full, manager
-- division-scoped via the receipt's own staff_id, builder own row
-- select/insert only -- no update/delete once submitted, same as
-- ticket_attachments has no builder update/delete either).

alter table pmms.activity_log drop column if exists receipt_photo_url;
alter table pmms.activity_log drop column if exists receipt_amount;

create table if not exists pmms.activity_receipts (
  id uuid primary key default gen_random_uuid(),
  activity_log_id uuid not null references pmms.activity_log(id) on delete cascade,
  ticket_id uuid references pmms.tickets(id) on delete set null,
  staff_id uuid not null references public.staff(id),
  photo_url text,
  amount numeric,
  created_at timestamptz not null default now()
);

create index if not exists idx_activity_receipts_activity_log on pmms.activity_receipts(activity_log_id);
create index if not exists idx_activity_receipts_ticket on pmms.activity_receipts(ticket_id);

alter table pmms.activity_receipts enable row level security;

create policy admin_full_access on pmms.activity_receipts for all to authenticated
  using (pmms.current_access_level() = 'admin')
  with check (pmms.current_access_level() = 'admin');

create policy manager_division_scoped_access on pmms.activity_receipts for all to authenticated
  using (
    pmms.current_access_level() = 'manager'
    and pmms.current_division() is not null
    and pmms.staff_division(staff_id) = pmms.current_division()
  )
  with check (
    pmms.current_access_level() = 'manager'
    and pmms.current_division() is not null
    and pmms.staff_division(staff_id) = pmms.current_division()
  );

create policy manager_unscoped_full_access on pmms.activity_receipts for all to authenticated
  using (pmms.current_access_level() = 'manager' and pmms.current_division() is null)
  with check (pmms.current_access_level() = 'manager' and pmms.current_division() is null);

create policy builder_own_receipts_select on pmms.activity_receipts for select to authenticated
  using (pmms.current_access_level() = 'builder' and staff_id = pmms.current_staff_id());

create policy builder_own_receipts_insert on pmms.activity_receipts for insert to authenticated
  with check (pmms.current_access_level() = 'builder' and staff_id = pmms.current_staff_id());

notify pgrst, 'reload schema';
