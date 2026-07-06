-- Adds pmms.staff_roles, a PMMS-only mapping of staff -> role, replacing
-- the earlier design where "Role" was written directly onto public.staff.role.
--
-- Why: public.staff is a company-wide directory, potentially shared by
-- other systems in this same Supabase project. Writing "Admin"/"Builder"/
-- "Cleaner"/"Support Worker"/custom straight onto public.staff.role meant a
-- role in THIS system (PMMS) could collide with, or be mistaken for, a role
-- some other system assigns via that same column -- being Admin in one
-- system doesn't make someone Admin in the other, and vice versa. This
-- table scopes "Role" to PMMS specifically: one row per staff member, only
-- ever read/written by this app.
--
-- staff_id has ON DELETE CASCADE, so deleting a public.staff row (if that
-- ever happens from elsewhere) cleans up its PMMS role assignment too.
--
-- RLS is explicitly disabled, matching every other pmms table (see
-- disable_rls_new_project.sql) -- new tables in this project default to
-- RLS ON, which silently blocks reads and hard-fails writes until this is
-- run (the same issue hit property_assets/property_compliance/
-- property_documents/property_notes earlier).

create table if not exists pmms.staff_roles (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  role text not null,
  updated_at timestamptz default now(),
  unique (staff_id)
);

alter table pmms.staff_roles disable row level security;
