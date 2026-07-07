-- Moves pmms.properties into the public schema, so it can become shared
-- reference data across the company's other planned standalone systems
-- (Support Worker, HR, QA, etc.) the same way public.staff already is --
-- each future system gets its own schema, with only cross-cutting entities
-- like staff and properties living in public.
--
-- ALTER TABLE ... SET SCHEMA relocates the table in place: data, indexes,
-- the identity sequence backing properties.id, and every RLS policy on the
-- table all move with it automatically (all tracked by the table's OID,
-- not its schema-qualified name). The 6 child tables (property_assets,
-- property_compliance, property_documents, property_notes, property_rooms,
-- property_room_history) and pmms.tickets all stay in pmms, still pointing
-- at properties(id) via ordinary (now cross-schema) foreign keys -- FK
-- constraints are tracked by OID too, so they need no changes at all.
alter table pmms.properties set schema public;

-- Defensive/self-documenting -- grants on the table (relacl) already
-- survive the move automatically, but unlike pmms, public has no
-- schema-wide "alter default privileges" rule backing new/moved tables,
-- so this makes the requirement explicit rather than relying on implicit
-- carry-over.
grant all on public.properties to anon, authenticated, service_role;

-- Forces Supabase's PostgREST layer to pick up the schema change
-- immediately, rather than relying on its own DDL-triggered auto-reload --
-- without this, testing right after running this script could see stale
-- "table not found in schema cache" errors that have nothing to do with
-- whether the actual move worked.
notify pgrst, 'reload schema';
