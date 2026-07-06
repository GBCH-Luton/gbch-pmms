-- Fixes a schema mismatch on pmms.settings discovered while testing the
-- Roles panel's "Add Role" feature (error: "Could not find the 'setting_key'
-- column of 'settings' in the schema cache").
--
-- The live table already exists (created by something other than
-- scripts/add_pmms_settings_table.sql -- origin unknown, same situation as
-- property_notes earlier) with columns `key`/`value`, but every piece of
-- app code that reads/writes pmms.settings (AdminSettings.jsx -- priority
-- thresholds, issue score weights, compliance check types, clocking rules,
-- on-call roster -- and AdminBuilders.jsx's custom_roles) was written
-- against `setting_key`/`setting_value`, matching the original migration
-- script. The table is currently empty, so renaming the columns to match
-- the app is a safe, zero-data-loss fix -- much lower risk than rewriting
-- every one of those call sites.

alter table pmms.settings rename column key to setting_key;
alter table pmms.settings rename column value to setting_value;

-- Also disable RLS, matching every other pmms table (see
-- disable_rls_new_project.sql) -- new/pre-existing tables in this project
-- keep turning up with RLS ON by default, which blocks writes with
-- "new row violates row-level security policy" until this runs (hit
-- property_assets/property_compliance/property_documents/property_notes/
-- staff_roles already).
alter table pmms.settings disable row level security;
