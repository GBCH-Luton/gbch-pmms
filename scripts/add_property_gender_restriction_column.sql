-- Adds the column backing the new Property Profile "Restrictions" tab --
-- marks a property as Male Only / Female Only / Both, for matching support
-- worker gender to resident preference. pmms.properties already exists
-- with RLS disabled (see new_project_schema.sql / disable_rls_new_project.sql),
-- so no RLS fix is needed for this one, unlike most other additions this
-- session.

alter table pmms.properties add column if not exists staff_gender_restriction text;
