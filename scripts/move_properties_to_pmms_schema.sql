-- Moves public.properties back into the pmms schema. Reverses
-- move_properties_to_public_schema.sql: that move anticipated other planned
-- standalone systems (Support Worker, HR, QA, etc.) needing properties as
-- shared reference data the same way public.staff already is, but none of
-- those systems exist yet, and public picking up more tables per new system
-- is exactly the mess the user wants to avoid. Properties goes back to being
-- owned by pmms (the only system that currently touches it); other schemas
-- can reference into pmms.properties via ordinary cross-schema FK whenever
-- a second system actually needs it, the same mechanism already used the
-- other direction. staff stays in public -- not part of this change.
--
-- ALTER TABLE ... SET SCHEMA relocates the table in place: data, indexes,
-- the uuid primary key default, and every RLS policy on the table all move
-- with it automatically (all tracked by the table's OID, not its
-- schema-qualified name). The 6 child tables (property_assets,
-- property_compliance, property_documents, property_notes, property_rooms,
-- property_room_history) and pmms.tickets all stay in pmms and already
-- reference properties(id) via ordinary (currently cross-schema) foreign
-- keys -- FK constraints are tracked by OID too, so they need no changes,
-- and simply become same-schema references after this move.
alter table public.properties set schema pmms;

-- Defensive/self-documenting -- grants on the table (relacl) already
-- survive the move automatically, and pmms already has a schema-wide
-- "alter default privileges" rule covering new/moved tables
-- (new_project_schema.sql), so this isn't strictly required, but it
-- matches the same explicit style the original move used.
grant all on pmms.properties to anon, authenticated, service_role;

-- Forces Supabase's PostgREST layer to pick up the schema change
-- immediately, rather than relying on its own DDL-triggered auto-reload --
-- without this, testing right after running this script could see stale
-- "table not found in schema cache" errors that have nothing to do with
-- whether the actual move worked.
notify pgrst, 'reload schema';
