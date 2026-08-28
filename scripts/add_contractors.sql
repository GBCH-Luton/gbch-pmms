-- External Contractors: directory, assignment, and per-job cost tracking.
-- Deliberately a separate entity from staff/public.staff -- a company like
-- "ABC Fencing Ltd" isn't a person, and this is meant to be a real, growable
-- directory (see docs/Company_Systems_Architecture_Brief.md discussion),
-- not another row in the "no-login staff" pattern.
--
-- Flat-list matching for v1 -- no specialty/division tagging, any active
-- contractor can be picked for any job (list is expected to stay small).

create table if not exists pmms.contractors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company_name text,
  contact_phone text,
  contact_email text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table pmms.tickets
  add column if not exists assigned_contractor_id uuid references pmms.contractors(id);

-- First mutual-exclusivity CHECK constraint in this schema -- a ticket is
-- either assigned to an internal builder or an external contractor, never
-- both. Every write path that sets one of these two columns must explicitly
-- null the other (see AdminPipeline.jsx Reassign, AdminRaiseTicket.jsx).
alter table pmms.tickets
  drop constraint if exists tickets_one_assignee_check;
alter table pmms.tickets
  add constraint tickets_one_assignee_check
    check (assigned_builder_id is null or assigned_contractor_id is null);

create index if not exists idx_tickets_assigned_contractor on pmms.tickets(assigned_contractor_id);

-- Per-job cost = amount + receipt photo, reusing the exact upload pattern
-- activity_receipts already uses (compressImage() -> ticket-photos bucket ->
-- signed URL). Logged alongside the Mark Complete update, not mid-job (out
-- of scope for v1 -- see plan).
create table if not exists pmms.contractor_job_costs (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references pmms.tickets(id),
  contractor_id uuid not null references pmms.contractors(id),
  amount numeric not null,
  note text,
  receipt_photo_url text,
  logged_by uuid references public.staff(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_contractor_job_costs_ticket on pmms.contractor_job_costs(ticket_id);
create index if not exists idx_contractor_job_costs_contractor on pmms.contractor_job_costs(contractor_id);

alter table pmms.contractors enable row level security;
alter table pmms.contractor_job_costs enable row level security;

-- contractors -- admin manages the directory (same trust boundary as staff
-- records today, see Manage Access); everyone authenticated can read the
-- flat list to populate pickers (Reassign, raise-ticket, Pipeline filter) --
-- contact info isn't sensitive the way staff PII is, same reasoning as
-- pmms.settings' any_authenticated_read.
create policy admin_full_access on pmms.contractors for all to authenticated
  using (pmms.current_access_level() = 'admin')
  with check (pmms.current_access_level() = 'admin');

create policy any_authenticated_read on pmms.contractors for select to authenticated
  using (true);

-- contractor_job_costs -- mirrors activity_receipts' shape exactly: admin
-- full access, manager division-scoped via the ticket's category_division,
-- no builder access at all (builders don't touch contractor jobs).
create policy admin_full_access on pmms.contractor_job_costs for all to authenticated
  using (pmms.current_access_level() = 'admin')
  with check (pmms.current_access_level() = 'admin');

create policy manager_division_scoped_access on pmms.contractor_job_costs for all to authenticated
  using (
    pmms.current_access_level() = 'manager'
    and pmms.current_division() is not null
    and exists (
      select 1 from pmms.tickets t
      where t.id = contractor_job_costs.ticket_id
        and pmms.category_division(t.category) = pmms.current_division()
    )
  )
  with check (
    pmms.current_access_level() = 'manager'
    and pmms.current_division() is not null
    and exists (
      select 1 from pmms.tickets t
      where t.id = contractor_job_costs.ticket_id
        and pmms.category_division(t.category) = pmms.current_division()
    )
  );

create policy manager_unscoped_full_access on pmms.contractor_job_costs for all to authenticated
  using (pmms.current_access_level() = 'manager' and pmms.current_division() is null)
  with check (pmms.current_access_level() = 'manager' and pmms.current_division() is null);

notify pgrst, 'reload schema';
