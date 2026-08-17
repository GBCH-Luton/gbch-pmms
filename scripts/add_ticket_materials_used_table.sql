-- Real replacement for the sandbox "Materials Used" picker on job
-- completion (lib/simsMaterialsBridge.js's fetchAvailableMaterials/
-- logMaterialUsage) -- that one looked real (a genuine SIMS item picker)
-- but silently saved nothing anywhere. This is job-level material usage,
-- deliberately separate from pmms.activity_receipts (a shopping trip's
-- receipt isn't the same thing as what a specific job actually consumed
-- -- a bulk buy can supply several future jobs, so tying a receipt to
-- "whichever job was in progress when the trip started" doesn't hold up).
-- Free text, not a catalog pick -- there's no real SIMS item catalog to
-- pick from yet (the stub's list was a static snapshot), so name/kind and
-- quantity are both whatever the builder types.

create table if not exists pmms.ticket_materials_used (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references pmms.tickets(id) on delete cascade,
  staff_id uuid not null references public.staff(id),
  name text not null,
  quantity text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_ticket_materials_used_ticket on pmms.ticket_materials_used(ticket_id);

alter table pmms.ticket_materials_used enable row level security;

-- Same shape as pmms.ticket_attachments' own RLS (add_ticket_attachments.sql):
-- admin/manager unrestricted, builder select/insert scoped to tickets
-- assigned to them (materials are logged on completion, always by the
-- assigned builder, never the raiser).
create policy admin_manager_full_access on pmms.ticket_materials_used
  for all to authenticated
  using (pmms.is_admin_or_manager())
  with check (pmms.is_admin_or_manager());

create policy builder_select_own_ticket_materials on pmms.ticket_materials_used
  for select to authenticated
  using (
    pmms.current_access_level() = 'builder' and exists (
      select 1 from pmms.tickets t
      where t.id = ticket_materials_used.ticket_id and t.assigned_builder_id = pmms.current_staff_id()
    )
  );

create policy builder_insert_own_ticket_materials on pmms.ticket_materials_used
  for insert to authenticated
  with check (
    pmms.current_access_level() = 'builder' and exists (
      select 1 from pmms.tickets t
      where t.id = ticket_materials_used.ticket_id and t.assigned_builder_id = pmms.current_staff_id()
    )
  );

notify pgrst, 'reload schema';
