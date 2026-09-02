-- Temporary Tasks -- Landlord Liaison's structured place to log work that
-- doesn't need a full inspection/maintenance/compliance workflow but still
-- needs tracking, chasing, and reporting (directors' spec, 2026-09-02;
-- mocked up as the "Follow-Ups" artifact). Picking a Task Type changes
-- which extra fields apply -- 3 types are built for real here (Landlord
-- Complaint, Neighbour Complaint, Landlord Contact / Follow-Up), matching
-- what was mocked up and approved; the other 11 types from the spec are
-- selectable but have no dedicated columns yet, same "not designed yet"
-- scope as the mockup -- extend this table when each of those gets built.
--
-- Flat columns, not a JSONB details blob -- same convention already used
-- everywhere else in this schema (pmms.properties itself has ~60 columns
-- for exactly this reason). Field ownership across the 3 built types:
--   - acknowledged/acknowledgement_date/department_assigned_to/
--     action_taken/recurring_issue/next_update_due/resolved_date are
--     genuinely the same concept on both complaint types, so they're
--     shared columns.
--   - Each type's own "Outcome" field means something different (a fixed
--     enum on Neighbour Complaint, free text on the other two) -- kept as
--     3 separate columns rather than forced into one to avoid silently
--     conflating them.
create table pmms.temporary_tasks (
  id uuid primary key default gen_random_uuid(),

  -- Standard fields (every task type)
  task_type text not null,
  property_id uuid references pmms.properties(id),
  task_title text,
  details_notes text,
  priority text not null default 'Medium', -- Low / Medium / High / Urgent
  assigned_to uuid references public.staff(id),
  department_involved text, -- Maintenance / Support / Housing / Compliance / Management / Other
  due_date date,
  follow_up_date date,
  status text not null default 'New', -- New / In Progress / Awaiting Response / Awaiting Internal Team / Resolved / Closed
  evidence_url text,
  date_completed timestamptz,

  -- Shared across Landlord Complaint + Neighbour Complaint
  complaint_category text,
  acknowledged boolean,
  acknowledgement_date date,
  department_assigned_to text,
  action_taken text,
  recurring_issue boolean,
  next_update_due date,
  resolved_date date,

  -- Landlord Complaint only
  complaint_received_via text,
  complaint_received_date date,
  complaint_details text,
  landlord_updated boolean,
  complaint_outcome_text text,
  root_cause text,

  -- Neighbour Complaint only
  complainant_name text,
  complainant_address text,
  complainant_contact_details text,
  complaint_received_datetime timestamptz,
  incident_datetime timestamptz,
  service_user_room text,
  previous_complaints_same_neighbour boolean,
  investigation_required boolean,
  property_visit_required boolean,
  service_user_identified boolean,
  support_worker_contacted boolean,
  external_agency_involved boolean,
  external_agency text,
  warning_action_issued text,
  reference_case_number text,
  further_action_required boolean,
  next_follow_up_date date,
  neighbour_updated boolean,
  date_last_updated date,
  update_response_provided text,
  further_update_required boolean,
  neighbour_outcome text, -- Upheld / Partially Upheld / Not Upheld / Unsubstantiated / Unable to Determine
  escalation_required boolean,
  closed_date date,
  resolution_final_action text,

  -- Landlord Contact / Follow-Up only
  contact_datetime timestamptz,
  contact_method text,
  reason_for_contact text,
  contact_outcome_text text,
  responsible_person_department text,

  -- A "Create Follow-Up Task" button (Landlord Complaint / Neighbour
  -- Complaint) pre-fills a new task from an existing one -- this links the
  -- new row back to what spawned it, so a chain of chases is traceable.
  follow_up_of_task_id uuid references pmms.temporary_tasks(id),

  created_by uuid references public.staff(id),
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table pmms.temporary_tasks enable row level security;

-- Same admin/manager shape as most of PMMS's property-adjacent tables --
-- not scoped to Landlord Liaison specifically at the RLS level (the UI
-- already only offers the nav item to LL + admin, same "UI narrows, RLS
-- stays open to any manager" precedent as Utility Bills/Compliance).
create policy "admin_manager_full_access" on pmms.temporary_tasks
  for all to authenticated
  using (pmms.is_admin_or_manager())
  with check (pmms.is_admin_or_manager());

create index temporary_tasks_property_id_idx on pmms.temporary_tasks(property_id);
create index temporary_tasks_status_idx on pmms.temporary_tasks(status);

notify pgrst, 'reload schema';
