-- =============================================================================
-- GBCH PMMS — full schema-only snapshot of the sandbox `pmms` schema
-- Generated 2026-07-28 for initial production deployment.
-- Schema/structure only — no seed/test data included.
--
-- Source: sandbox Supabase project (ref hfubtfohtieglrvdgblc)
-- Target: production Supabase project (ref wvhelwxyzdkfjpyyxvbc) — run this in
-- the SQL Editor there. Assumes public.staff already exists with a matching
-- shape (phone/skills/gender columns already added).
--
-- Contents, in order: schema, extensions, tables (PK/UNIQUE/CHECK inline),
-- indexes, functions, foreign keys, sequence ownership, grants, RLS enable,
-- RLS policies. No triggers exist in the sandbox pmms schema (checked, none
-- found).
--
-- IMPORTANT: table/schema-level GRANTs are a separate layer from RLS.
-- PostgREST needs both the schema in the project's exposed-schemas list
-- (a dashboard/API setting, not SQL) AND actual GRANTs on the schema and
-- its tables to anon/authenticated/service_role -- RLS only narrows what's
-- visible AFTER that base grant already allows access. The first
-- production deploy of this file omitted the GRANTs section below, which
-- surfaced as "permission denied for schema pmms" until it was added.
-- =============================================================================

-- =============================================================================
-- 1. SCHEMA
-- =============================================================================
create schema if not exists pmms;

-- =============================================================================
-- 2. EXTENSIONS
-- pmms relies on gen_random_uuid() (pgcrypto). Supabase projects normally have
-- this enabled by default, but included defensively. pg_cron/pg_net/
-- pg_stat_statements/supabase_vault/uuid-ossp are present in the sandbox but
-- are Supabase-managed defaults not actually referenced by any pmms object.
-- =============================================================================
create extension if not exists pgcrypto;

-- =============================================================================
-- 3. SEQUENCES (needed ahead of the table that references them in a DEFAULT)
-- =============================================================================
create sequence if not exists pmms.tickets_ticket_number_seq as bigint;

-- =============================================================================
-- 4. TABLES
-- =============================================================================

-- properties: core property/unit register — address, lease/tenancy, utilities,
-- garden and compliance metadata
create table pmms.properties (
  address text NOT NULL,
  property_type text,
  electrical_shutoff text,
  gas_shutoff text,
  safeguards text,
  high_vulnerability boolean DEFAULT false,
  vulnerability_reason text,
  created_at timestamp with time zone DEFAULT now(),
  layout_type text NOT NULL DEFAULT '2-Floors'::text,
  postcode text,
  status text NOT NULL DEFAULT 'Procured'::text,
  property_name text,
  tenure_type text,
  unit_layout_type text,
  construction_type text,
  num_floors integer,
  num_rooms integer,
  num_bathrooms integer,
  num_kitchens integer,
  floor_area_sqft integer,
  year_constructed integer,
  access_instructions text,
  emergency_contact text,
  gas_supplier text,
  electric_supplier text,
  water_supplier text,
  maps_link text,
  coordinates text,
  cover_photo_url text,
  lease_start_date date,
  lease_end_date date,
  lease_type text,
  lease_status text,
  landlord_company text,
  landlord_name text,
  landlord_phone text,
  landlord_email text,
  rent_amount numeric,
  rent_payment_day integer,
  deposit_amount numeric,
  deposit_scheme text,
  deposit_scheme_id text,
  special_lease_terms text,
  insurance_expiry date,
  insurance_doc_url text,
  lease_doc_url text,
  staff_gender_restriction text,
  latitude double precision,
  longitude double precision,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  assigned_cleaner_id uuid,
  cleaner_assigned_since timestamp with time zone,
  has_garden boolean DEFAULT false,
  garden_state text,
  garden_last_attended_date date,
  garden_last_attended_by text,
  garden_front_photo_url text,
  garden_back_photo_url text,
  town text,
  wifi_provider text,
  wifi_account text,
  wifi_payment_method text,
  wifi_start_date date,
  CONSTRAINT properties_pkey PRIMARY KEY (id)
);

-- events: calendar events linked to properties (paused feature, behind
-- EVENTS_FEATURE_ENABLED flag)
create table pmms.events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  property_id uuid,
  event_date timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT events_pkey PRIMARY KEY (id)
);

-- tickets: maintenance/repair tickets — the core work-order table
create table pmms.tickets (
  assigned_builder_id uuid,
  status text NOT NULL DEFAULT 'Assigned'::text,
  category text,
  description text,
  room text,
  priority_score integer DEFAULT 0,
  suppressed boolean DEFAULT false,
  force_top boolean DEFAULT false,
  reported_by text,
  hold_reason text,
  hold_note text,
  no_access_flag boolean DEFAULT false,
  mileage_logged numeric DEFAULT 0,
  transit_start text,
  completion_note text,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  department text,
  priority text DEFAULT 'Normal'::text,
  raised_by uuid,
  issue_tag text,
  raised_by_name text,
  photo_url text,
  priority_override text,
  cancel_type text,
  cancel_reason text,
  cancel_duplicate_ref text,
  completion_photo_url text,
  no_access_note text,
  no_access_photo_url text,
  property_id uuid,
  ticket_number integer NOT NULL DEFAULT nextval('pmms.tickets_ticket_number_seq'::regclass),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  status_changed_at timestamp with time zone,
  stuck_alert_sent_at timestamp with time zone,
  first_assigned_at timestamp with time zone,
  checklist_responses jsonb,
  delay_reason text,
  delay_reason_note text,
  delay_reason_status text,
  delay_reason_submitted_at timestamp with time zone,
  delay_reason_reviewed_at timestamp with time zone,
  delay_reason_reviewed_by uuid,
  event_id uuid,
  CONSTRAINT tickets_pkey PRIMARY KEY (id),
  CONSTRAINT tickets_ticket_number_key UNIQUE (ticket_number)
);

alter sequence pmms.tickets_ticket_number_seq owned by pmms.tickets.ticket_number;

-- property_rooms: individual rooms/units within a property (voids tracking)
create table pmms.property_rooms (
  room_name text NOT NULL,
  room_type text DEFAULT 'Bedroom'::text,
  current_status text DEFAULT 'Occupied'::text,
  tenant_name text,
  void_since date,
  created_at timestamp with time zone DEFAULT now(),
  property_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  void_alert_sent_at timestamp with time zone,
  bed_type text,
  CONSTRAINT property_rooms_pkey PRIMARY KEY (id)
);

-- property_room_history: move-in/move-out history per room
create table pmms.property_room_history (
  property_id uuid,
  action text NOT NULL,
  action_date date NOT NULL,
  tenant_name text,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  room_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  CONSTRAINT property_room_history_pkey PRIMARY KEY (id)
);

-- property_assets: equipment/appliances tracked per property
create table pmms.property_assets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  asset_name text NOT NULL,
  asset_category text,
  make text,
  model text,
  serial_number text,
  installation_date date,
  warranty_start date,
  warranty_end date,
  lifespan_years integer,
  current_status text DEFAULT 'Operational'::text,
  maintenance_frequency text,
  last_service_date date,
  current_value numeric,
  supplier_details text,
  asset_photo_url text,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  property_id uuid,
  CONSTRAINT property_assets_pkey PRIMARY KEY (id)
);

-- property_compliance: compliance certificates (gas safety, EICR, etc.) per property
create table pmms.property_compliance (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  cert_type text NOT NULL,
  expiry_date date,
  cert_url text,
  notes text,
  not_applicable boolean NOT NULL DEFAULT false,
  updated_at timestamp with time zone DEFAULT now(),
  property_id uuid,
  aging_alert_sent_at timestamp with time zone,
  CONSTRAINT property_compliance_pkey PRIMARY KEY (id),
  CONSTRAINT property_compliance_property_id_cert_type_key UNIQUE (property_id, cert_type)
);

-- property_documents: general documents attached to a property
create table pmms.property_documents (
  document_name text NOT NULL,
  document_category text,
  document_date date,
  expiry_date date,
  file_url text,
  notes text,
  uploaded_by text,
  created_at timestamp with time zone DEFAULT now(),
  property_id uuid,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  CONSTRAINT property_documents_pkey PRIMARY KEY (id)
);

-- property_notes: free-text notes/observations logged against a property
create table pmms.property_notes (
  note_text text NOT NULL,
  note_category text DEFAULT 'Observation'::text,
  is_flagged boolean DEFAULT false,
  flag_status text DEFAULT 'Open'::text,
  author text,
  created_at timestamp with time zone DEFAULT now(),
  property_id uuid,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  CONSTRAINT property_notes_pkey PRIMARY KEY (id)
);

-- audit_events: audit trail of actions taken on tickets
create table pmms.audit_events (
  id integer GENERATED BY DEFAULT AS IDENTITY,
  actor_id uuid,
  actor_name text,
  action text NOT NULL,
  summary text,
  created_at timestamp with time zone DEFAULT now(),
  ticket_id uuid,
  CONSTRAINT audit_events_pkey PRIMARY KEY (id)
);

-- comments: comments/discussion thread on tickets
create table pmms.comments (
  id integer GENERATED BY DEFAULT AS IDENTITY,
  author_id uuid,
  author_name text NOT NULL,
  role text,
  body text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  ticket_id uuid,
  CONSTRAINT comments_pkey PRIMARY KEY (id)
);

-- login_events: sign-in/sign-out log for staff
create table pmms.login_events (
  id bigint GENERATED BY DEFAULT AS IDENTITY,
  staff_id uuid,
  staff_name text,
  email text NOT NULL,
  event_type text NOT NULL,
  user_agent text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT login_events_pkey PRIMARY KEY (id),
  CONSTRAINT login_events_event_type_check CHECK ((event_type = ANY (ARRAY['Signed In'::text, 'Signed Out'::text])))
);

-- notifications: in-app notifications per staff member
create table pmms.notifications (
  id bigint GENERATED BY DEFAULT AS IDENTITY,
  staff_id uuid NOT NULL,
  message text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  ticket_id uuid,
  CONSTRAINT notifications_pkey PRIMARY KEY (id)
);

-- push_subscriptions: web push subscription endpoints per staff member
create table pmms.push_subscriptions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id),
  CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint)
);

-- staff_availability: current availability status per staff member
create table pmms.staff_availability (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'Available'::text,
  note text,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT staff_availability_pkey PRIMARY KEY (id),
  CONSTRAINT staff_availability_staff_id_key UNIQUE (staff_id)
);

-- staff_roles: role assignment per staff member (Admin/Manager/Builder/Cleaner/etc.)
create table pmms.staff_roles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL,
  role text NOT NULL,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT staff_roles_pkey PRIMARY KEY (id),
  CONSTRAINT staff_roles_staff_id_key UNIQUE (staff_id)
);

-- work_sessions: clock-in/clock-out work sessions for builders against tickets
create table pmms.work_sessions (
  id integer GENERATED BY DEFAULT AS IDENTITY,
  builder_id uuid,
  started_at timestamp with time zone NOT NULL,
  ended_at timestamp with time zone,
  clock_in_lat double precision,
  clock_in_lng double precision,
  clock_out_lat double precision,
  clock_out_lng double precision,
  ticket_id uuid,
  CONSTRAINT work_sessions_pkey PRIMARY KEY (id)
);

-- settings: key/value app-wide settings (JSONB)
create table pmms.settings (
  setting_key text NOT NULL,
  setting_value jsonb NOT NULL,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT settings_pkey PRIMARY KEY (setting_key)
);

-- impersonation_events: audit trail for the "View As" admin-impersonation
-- feature (added 2026-07-28)
create table pmms.impersonation_events (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  admin_staff_id  uuid NOT NULL,
  admin_name      text,
  target_staff_id uuid NOT NULL,
  target_name     text,
  started_at      timestamp with time zone NOT NULL DEFAULT now(),
  ended_at        timestamp with time zone,
  user_agent      text,
  CONSTRAINT impersonation_events_pkey PRIMARY KEY (id)
);

-- chat_messages: Team Chat, one channel per division (added 2026-07-29)
create table pmms.chat_messages (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  division            text NOT NULL,
  sender_id           uuid NOT NULL,
  sender_name         text NOT NULL,
  body                text NOT NULL,
  mentioned_staff_ids uuid[] NOT NULL DEFAULT '{}',
  created_at          timestamp with time zone NOT NULL DEFAULT now(),
  photo_url           text,
  CONSTRAINT chat_messages_pkey PRIMARY KEY (id)
);

-- chat_channel_reads: Team Chat read receipts, one row per division+staff
-- member holding a read watermark (added 2026-07-30)
create table pmms.chat_channel_reads (
  division      text NOT NULL,
  staff_id      uuid NOT NULL,
  last_read_at  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT chat_channel_reads_pkey PRIMARY KEY (division, staff_id)
);

-- =============================================================================
-- 5. INDEXES (explicit, non-PK/non-unique-constraint indexes)
-- =============================================================================
CREATE INDEX notifications_staff_id_idx ON pmms.notifications USING btree (staff_id);

-- =============================================================================
-- 6. FUNCTIONS
-- Placed after the other tables (all of which these function bodies reference)
-- and before error_logs, whose staff_id column DEFAULT calls
-- pmms.current_staff_id() — that default is validated against the catalog at
-- CREATE TABLE time, so the function must already exist.
-- =============================================================================

CREATE OR REPLACE FUNCTION pmms.current_staff_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pmms'
AS $function$
  select id from public.staff
  where email = auth.jwt() ->> 'email'
  order by id
  limit 1
$function$;

CREATE OR REPLACE FUNCTION pmms.current_access_level()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pmms'
AS $function$
  with me as (
    select id, active from public.staff
    where email = auth.jwt() ->> 'email'
    order by id
    limit 1
  ),
  my_role as (
    select sr.role from pmms.staff_roles sr, me
    where sr.staff_id = me.id
    order by sr.role
    limit 1
  ),
  custom_roles as (
    select
      case jsonb_typeof(elem) when 'string' then elem #>> '{}' else elem ->> 'name' end as name,
      case jsonb_typeof(elem) when 'string' then 'none' else coalesce(elem ->> 'accessLevel', 'none') end as access_level
    from pmms.settings s,
      lateral jsonb_array_elements(coalesce(s.setting_value, '[]'::jsonb)) elem
    where s.setting_key = 'custom_roles'
  )
  select
    case
      when me.active = false then null
      when my_role.role = 'Admin' then 'admin'
      when my_role.role = 'Builder' then 'builder'
      when my_role.role in ('Cleaner', 'Support Worker') then null
      when cr.access_level = 'manager' then 'manager'
      when cr.access_level = 'builder' then 'builder'
      else null
    end
  from me
  left join my_role on true
  left join custom_roles cr on cr.name = my_role.role
$function$;

CREATE OR REPLACE FUNCTION pmms.current_division()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pmms'
AS $function$
  with me as (
    select id, active from public.staff
    where email = auth.jwt() ->> 'email'
    order by id
    limit 1
  ),
  my_role as (
    select sr.role from pmms.staff_roles sr, me
    where sr.staff_id = me.id
    order by sr.role
    limit 1
  ),
  custom_roles as (
    select
      case jsonb_typeof(elem) when 'string' then elem #>> '{}' else elem ->> 'name' end as name,
      case jsonb_typeof(elem) when 'string' then null else elem ->> 'division' end as division
    from pmms.settings s,
      lateral jsonb_array_elements(coalesce(s.setting_value, '[]'::jsonb)) elem
    where s.setting_key = 'custom_roles'
  )
  select
    case
      when me.active = false then null
      else cr.division
    end
  from me
  left join my_role on true
  left join custom_roles cr on cr.name = my_role.role
$function$;

CREATE OR REPLACE FUNCTION pmms.current_can_create_events()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pmms'
AS $function$
  with me as (
    select id, active from public.staff
    where email = auth.jwt() ->> 'email'
    order by id
    limit 1
  ),
  my_role as (
    select sr.role from pmms.staff_roles sr, me
    where sr.staff_id = me.id
    order by sr.role
    limit 1
  ),
  custom_roles as (
    select
      case jsonb_typeof(elem) when 'string' then elem #>> '{}' else elem ->> 'name' end as name,
      case jsonb_typeof(elem) when 'string' then false else coalesce((elem ->> 'canCreateEvents')::boolean, false) end as can_create_events
    from pmms.settings s,
      lateral jsonb_array_elements(coalesce(s.setting_value, '[]'::jsonb)) elem
    where s.setting_key = 'custom_roles'
  )
  select
    case
      when me.active = false then false
      else coalesce(cr.can_create_events, false)
    end
  from me
  left join my_role on true
  left join custom_roles cr on cr.name = my_role.role
$function$;

CREATE OR REPLACE FUNCTION pmms.is_admin_or_manager()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pmms'
AS $function$
  select pmms.current_access_level() in ('admin', 'manager')
$function$;

CREATE OR REPLACE FUNCTION pmms.category_division(cat text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pmms'
AS $function$
  select coalesce(
    (select s.setting_value -> cat ->> 'division' from pmms.settings s where s.setting_key = 'maintenance_categories'),
    'Maintenance'
  )
$function$;

CREATE OR REPLACE FUNCTION pmms.staff_division(target_staff_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pmms'
AS $function$
  with target as (
    select id, active from public.staff where id = target_staff_id
  ),
  target_role as (
    select sr.role from pmms.staff_roles sr, target
    where sr.staff_id = target.id
    order by sr.role
    limit 1
  ),
  custom_roles as (
    select
      case jsonb_typeof(elem) when 'string' then elem #>> '{}' else elem ->> 'name' end as name,
      case jsonb_typeof(elem) when 'string' then null else elem ->> 'division' end as division
    from pmms.settings s,
      lateral jsonb_array_elements(coalesce(s.setting_value, '[]'::jsonb)) elem
    where s.setting_key = 'custom_roles'
  )
  select
    case
      when target.active = false then null
      else cr.division
    end
  from target
  left join target_role on true
  left join custom_roles cr on cr.name = target_role.role
$function$;

CREATE OR REPLACE FUNCTION pmms.builder_properties(property_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(id uuid, address text, high_vulnerability boolean, layout_type text, safeguards text, electrical_shutoff text, gas_shutoff text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pmms'
AS $function$
  select p.id, p.address, p.high_vulnerability, p.layout_type, p.safeguards, p.electrical_shutoff, p.gas_shutoff
  from pmms.properties p
  where pmms.current_access_level() = 'builder'
    and (property_ids is null or p.id = any(property_ids))
$function$;

CREATE OR REPLACE FUNCTION pmms.complete_garden_ticket_property_update(p_ticket_id uuid, p_attended_by text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pmms'
AS $function$
declare
  v_property_id uuid;
  v_category text;
  v_issue_tag text;
  v_assigned_builder_id uuid;
begin
  select property_id, category, issue_tag, assigned_builder_id
    into v_property_id, v_category, v_issue_tag, v_assigned_builder_id
  from pmms.tickets
  where id = p_ticket_id;

  if v_property_id is null then
    raise exception 'Ticket not found';
  end if;

  if v_assigned_builder_id is distinct from pmms.current_staff_id() then
    raise exception 'Not authorized to update this ticket''s property';
  end if;

  if v_category is distinct from 'Grounds & External Works'
     or v_issue_tag not in ('Garden maintenance', 'Tree/hedge trimming', 'Grass cutting') then
    raise exception 'Not a garden ticket';
  end if;

  update pmms.properties
  set garden_last_attended_date = current_date, garden_last_attended_by = p_attended_by
  where id = v_property_id;
end;
$function$;

-- Mirrors pmms.current_access_level()'s exact branching, but for an
-- arbitrary target_staff_id -- the same relationship pmms.staff_division()
-- already has to pmms.current_division(). Added for Team Chat's @mention
-- picker (chat_channel_members below), which needs to know whether an
-- OTHER person is an Admin/unscoped-manager (sees every channel).
CREATE OR REPLACE FUNCTION pmms.staff_access_level(target_staff_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pmms'
AS $function$
  with target as (
    select id, active from public.staff where id = target_staff_id
  ),
  target_role as (
    select sr.role from pmms.staff_roles sr, target
    where sr.staff_id = target.id
    order by sr.role
    limit 1
  ),
  custom_roles as (
    select
      case jsonb_typeof(elem) when 'string' then elem #>> '{}' else elem ->> 'name' end as name,
      case jsonb_typeof(elem) when 'string' then 'none' else coalesce(elem ->> 'accessLevel', 'none') end as access_level
    from pmms.settings s,
      lateral jsonb_array_elements(coalesce(s.setting_value, '[]'::jsonb)) elem
    where s.setting_key = 'custom_roles'
  )
  select
    case
      when target.active = false then null
      when target_role.role = 'Admin' then 'admin'
      when target_role.role = 'Builder' then 'builder'
      when target_role.role in ('Cleaner', 'Support Worker') then null
      when cr.access_level = 'manager' then 'manager'
      when cr.access_level = 'builder' then 'builder'
      else null
    end
  from target
  left join target_role on true
  left join custom_roles cr on cr.name = target_role.role
$function$;

-- Builders can only SELECT their own row in public.staff, so Team Chat's
-- @mention picker needs a SECURITY DEFINER function to list who's
-- actually in a given channel (Admins/unscoped managers always included,
-- since they can see every channel; everyone else only if their own
-- resolved division matches THIS one, defaulting built-in Builder to
-- 'Maintenance' same as everywhere else in this app).
CREATE OR REPLACE FUNCTION pmms.chat_channel_members(target_division text)
 RETURNS TABLE(id uuid, name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pmms'
AS $function$
  select s.id, s.name
  from public.staff s
  join pmms.staff_roles sr on sr.staff_id = s.id
  where s.active = true
    and (
      pmms.staff_access_level(s.id) = 'admin'
      or (pmms.staff_access_level(s.id) = 'manager' and pmms.staff_division(s.id) is null)
      or coalesce(pmms.staff_division(s.id), 'Maintenance') = target_division
    )
$function$;

-- error_logs: client-side error log capture
-- (created here, after the functions, because its staff_id column DEFAULT
-- calls pmms.current_staff_id())
create table pmms.error_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  staff_id uuid DEFAULT pmms.current_staff_id(),
  email text DEFAULT (auth.jwt() ->> 'email'::text),
  error_type text NOT NULL,
  message text NOT NULL,
  stack text,
  context jsonb,
  CONSTRAINT error_logs_pkey PRIMARY KEY (id),
  CONSTRAINT error_logs_error_type_check CHECK ((error_type = ANY (ARRAY['js_error'::text, 'unhandled_rejection'::text, 'react_render'::text, 'supabase_query'::text])))
);

-- =============================================================================
-- 7. FOREIGN KEYS
-- Added last so table creation order above never has to satisfy FK ordering.
-- staff(id) below resolves to public.staff, which must already exist in the
-- target (production) database.
-- =============================================================================

ALTER TABLE pmms.audit_events ADD CONSTRAINT audit_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES staff(id);
ALTER TABLE pmms.audit_events ADD CONSTRAINT audit_events_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES pmms.tickets(id);

ALTER TABLE pmms.chat_messages ADD CONSTRAINT chat_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES staff(id);

ALTER TABLE pmms.chat_channel_reads ADD CONSTRAINT chat_channel_reads_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES staff(id);

ALTER TABLE pmms.comments ADD CONSTRAINT comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES staff(id);
ALTER TABLE pmms.comments ADD CONSTRAINT comments_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES pmms.tickets(id);

ALTER TABLE pmms.events ADD CONSTRAINT events_created_by_fkey FOREIGN KEY (created_by) REFERENCES staff(id);
ALTER TABLE pmms.events ADD CONSTRAINT events_property_id_fkey FOREIGN KEY (property_id) REFERENCES pmms.properties(id);

ALTER TABLE pmms.login_events ADD CONSTRAINT login_events_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES staff(id);

ALTER TABLE pmms.impersonation_events ADD CONSTRAINT impersonation_events_admin_staff_id_fkey FOREIGN KEY (admin_staff_id) REFERENCES staff(id);
ALTER TABLE pmms.impersonation_events ADD CONSTRAINT impersonation_events_target_staff_id_fkey FOREIGN KEY (target_staff_id) REFERENCES staff(id);

ALTER TABLE pmms.notifications ADD CONSTRAINT notifications_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE;
ALTER TABLE pmms.notifications ADD CONSTRAINT notifications_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES pmms.tickets(id) ON DELETE CASCADE;

ALTER TABLE pmms.properties ADD CONSTRAINT properties_assigned_cleaner_id_fkey FOREIGN KEY (assigned_cleaner_id) REFERENCES staff(id);

ALTER TABLE pmms.property_assets ADD CONSTRAINT property_assets_property_id_fkey FOREIGN KEY (property_id) REFERENCES pmms.properties(id) ON DELETE CASCADE;

ALTER TABLE pmms.property_compliance ADD CONSTRAINT property_compliance_property_id_fkey FOREIGN KEY (property_id) REFERENCES pmms.properties(id) ON DELETE CASCADE;

ALTER TABLE pmms.property_documents ADD CONSTRAINT property_documents_property_id_fkey FOREIGN KEY (property_id) REFERENCES pmms.properties(id) ON DELETE CASCADE;

ALTER TABLE pmms.property_notes ADD CONSTRAINT property_notes_property_id_fkey FOREIGN KEY (property_id) REFERENCES pmms.properties(id) ON DELETE CASCADE;

ALTER TABLE pmms.property_room_history ADD CONSTRAINT property_room_history_property_id_fkey FOREIGN KEY (property_id) REFERENCES pmms.properties(id);
ALTER TABLE pmms.property_room_history ADD CONSTRAINT property_room_history_room_id_fkey FOREIGN KEY (room_id) REFERENCES pmms.property_rooms(id) ON DELETE CASCADE;

ALTER TABLE pmms.property_rooms ADD CONSTRAINT property_rooms_property_id_fkey FOREIGN KEY (property_id) REFERENCES pmms.properties(id) ON DELETE CASCADE;

ALTER TABLE pmms.push_subscriptions ADD CONSTRAINT push_subscriptions_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE;

ALTER TABLE pmms.staff_availability ADD CONSTRAINT staff_availability_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE;

ALTER TABLE pmms.staff_roles ADD CONSTRAINT staff_roles_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE;

ALTER TABLE pmms.tickets ADD CONSTRAINT tickets_delay_reason_reviewed_by_fkey FOREIGN KEY (delay_reason_reviewed_by) REFERENCES staff(id);
ALTER TABLE pmms.tickets ADD CONSTRAINT tickets_event_id_fkey FOREIGN KEY (event_id) REFERENCES pmms.events(id);
ALTER TABLE pmms.tickets ADD CONSTRAINT tickets_property_id_fkey FOREIGN KEY (property_id) REFERENCES pmms.properties(id);
ALTER TABLE pmms.tickets ADD CONSTRAINT tickets_raised_by_fkey FOREIGN KEY (raised_by) REFERENCES staff(id);

ALTER TABLE pmms.work_sessions ADD CONSTRAINT work_sessions_builder_id_fkey FOREIGN KEY (builder_id) REFERENCES staff(id);
ALTER TABLE pmms.work_sessions ADD CONSTRAINT work_sessions_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES pmms.tickets(id);

-- =============================================================================
-- 8. GRANTS
-- Separate from RLS -- these are the base privileges PostgREST needs before
-- RLS gets a chance to narrow anything. Verified to match the sandbox's
-- actual grants exactly (all 19 tables, ALL privilege, same 3 roles).
-- Function EXECUTE needs no explicit grant: Postgres grants EXECUTE on new
-- functions to PUBLIC by default, and nothing here revokes it.
-- =============================================================================
grant usage on schema pmms to anon, authenticated, service_role;
grant all on all tables in schema pmms to anon, authenticated, service_role;
grant all on all sequences in schema pmms to anon, authenticated, service_role;
alter default privileges in schema pmms grant all on tables to anon, authenticated, service_role;
alter default privileges in schema pmms grant all on sequences to anon, authenticated, service_role;

-- Team Chat's first requirement: Supabase Realtime (this app's first use
-- of it anywhere -- everything else "live" is setInterval polling). RLS
-- applies to the underlying feed the same as any normal query.
alter publication supabase_realtime add table pmms.chat_messages;

-- Read receipts ("Seen by ..."): same Realtime treatment as chat_messages
-- so other members' read state updates live without polling.
alter publication supabase_realtime add table pmms.chat_channel_reads;

-- =============================================================================
-- 9. ENABLE ROW LEVEL SECURITY
-- =============================================================================
ALTER TABLE pmms.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE pmms.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE pmms.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE pmms.property_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE pmms.property_room_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE pmms.property_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE pmms.property_compliance ENABLE ROW LEVEL SECURITY;
ALTER TABLE pmms.property_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE pmms.property_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pmms.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE pmms.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE pmms.login_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE pmms.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE pmms.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pmms.staff_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE pmms.staff_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE pmms.work_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pmms.error_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pmms.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE pmms.impersonation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE pmms.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE pmms.chat_channel_reads ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 10. RLS POLICIES
-- Copied verbatim from pg_policies (qual / with_check expressions untouched).
-- =============================================================================

-- audit_events
CREATE POLICY "admin_full_access" ON pmms.audit_events AS PERMISSIVE FOR ALL TO authenticated
  USING (pmms.current_access_level() = 'admin'::text)
  WITH CHECK (pmms.current_access_level() = 'admin'::text);
CREATE POLICY "builder_insert_own_events" ON pmms.audit_events AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((pmms.current_access_level() = 'builder'::text) AND (actor_id = pmms.current_staff_id()));
CREATE POLICY "manager_division_scoped_access" ON pmms.audit_events AS PERMISSIVE FOR ALL TO authenticated
  USING ((pmms.current_access_level() = 'manager'::text) AND (pmms.current_division() IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM pmms.tickets t
  WHERE ((t.id = audit_events.ticket_id) AND (pmms.category_division(t.category) = pmms.current_division())))))
  WITH CHECK ((pmms.current_access_level() = 'manager'::text) AND (pmms.current_division() IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM pmms.tickets t
  WHERE ((t.id = audit_events.ticket_id) AND (pmms.category_division(t.category) = pmms.current_division())))));
CREATE POLICY "manager_unscoped_full_access" ON pmms.audit_events AS PERMISSIVE FOR ALL TO authenticated
  USING ((pmms.current_access_level() = 'manager'::text) AND (pmms.current_division() IS NULL))
  WITH CHECK ((pmms.current_access_level() = 'manager'::text) AND (pmms.current_division() IS NULL));

-- chat_messages
CREATE POLICY "admin_full_access" ON pmms.chat_messages AS PERMISSIVE FOR ALL TO authenticated
  USING (pmms.current_access_level() = 'admin'::text)
  WITH CHECK (pmms.current_access_level() = 'admin'::text);
CREATE POLICY "manager_unscoped_access" ON pmms.chat_messages AS PERMISSIVE FOR ALL TO authenticated
  USING ((pmms.current_access_level() = 'manager'::text) AND (pmms.current_division() IS NULL))
  WITH CHECK ((pmms.current_access_level() = 'manager'::text) AND (pmms.current_division() IS NULL) AND (sender_id = pmms.current_staff_id()));
CREATE POLICY "manager_division_scoped_access" ON pmms.chat_messages AS PERMISSIVE FOR ALL TO authenticated
  USING ((pmms.current_access_level() = 'manager'::text) AND (pmms.current_division() = division))
  WITH CHECK ((pmms.current_access_level() = 'manager'::text) AND (pmms.current_division() = division) AND (sender_id = pmms.current_staff_id()));
CREATE POLICY "builder_division_access" ON pmms.chat_messages AS PERMISSIVE FOR ALL TO authenticated
  USING ((pmms.current_access_level() = 'builder'::text) AND (coalesce(pmms.current_division(), 'Maintenance'::text) = division))
  WITH CHECK ((pmms.current_access_level() = 'builder'::text) AND (coalesce(pmms.current_division(), 'Maintenance'::text) = division) AND (sender_id = pmms.current_staff_id()));

-- chat_channel_reads
CREATE POLICY "admin_full_access" ON pmms.chat_channel_reads AS PERMISSIVE FOR ALL TO authenticated
  USING (pmms.current_access_level() = 'admin'::text)
  WITH CHECK (pmms.current_access_level() = 'admin'::text);
CREATE POLICY "manager_unscoped_access" ON pmms.chat_channel_reads AS PERMISSIVE FOR ALL TO authenticated
  USING ((pmms.current_access_level() = 'manager'::text) AND (pmms.current_division() IS NULL))
  WITH CHECK ((pmms.current_access_level() = 'manager'::text) AND (pmms.current_division() IS NULL) AND (staff_id = pmms.current_staff_id()));
CREATE POLICY "manager_division_scoped_access" ON pmms.chat_channel_reads AS PERMISSIVE FOR ALL TO authenticated
  USING ((pmms.current_access_level() = 'manager'::text) AND (pmms.current_division() = division))
  WITH CHECK ((pmms.current_access_level() = 'manager'::text) AND (pmms.current_division() = division) AND (staff_id = pmms.current_staff_id()));
CREATE POLICY "builder_division_access" ON pmms.chat_channel_reads AS PERMISSIVE FOR ALL TO authenticated
  USING ((pmms.current_access_level() = 'builder'::text) AND (coalesce(pmms.current_division(), 'Maintenance'::text) = division))
  WITH CHECK ((pmms.current_access_level() = 'builder'::text) AND (coalesce(pmms.current_division(), 'Maintenance'::text) = division) AND (staff_id = pmms.current_staff_id()));

-- comments
CREATE POLICY "admin_full_access" ON pmms.comments AS PERMISSIVE FOR ALL TO authenticated
  USING (pmms.current_access_level() = 'admin'::text)
  WITH CHECK (pmms.current_access_level() = 'admin'::text);
CREATE POLICY "builder_insert_own_ticket_comments" ON pmms.comments AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((pmms.current_access_level() = 'builder'::text) AND (author_id = pmms.current_staff_id()) AND (EXISTS ( SELECT 1
   FROM pmms.tickets t
  WHERE ((t.id = comments.ticket_id) AND ((t.assigned_builder_id = pmms.current_staff_id()) OR (t.raised_by = pmms.current_staff_id()))))));
CREATE POLICY "builder_select_own_ticket_comments" ON pmms.comments AS PERMISSIVE FOR SELECT TO authenticated
  USING ((pmms.current_access_level() = 'builder'::text) AND (EXISTS ( SELECT 1
   FROM pmms.tickets t
  WHERE ((t.id = comments.ticket_id) AND ((t.assigned_builder_id = pmms.current_staff_id()) OR (t.raised_by = pmms.current_staff_id()))))));
CREATE POLICY "manager_division_scoped_access" ON pmms.comments AS PERMISSIVE FOR ALL TO authenticated
  USING ((pmms.current_access_level() = 'manager'::text) AND (pmms.current_division() IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM pmms.tickets t
  WHERE ((t.id = comments.ticket_id) AND (pmms.category_division(t.category) = pmms.current_division())))))
  WITH CHECK ((pmms.current_access_level() = 'manager'::text) AND (pmms.current_division() IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM pmms.tickets t
  WHERE ((t.id = comments.ticket_id) AND (pmms.category_division(t.category) = pmms.current_division())))));
CREATE POLICY "manager_unscoped_full_access" ON pmms.comments AS PERMISSIVE FOR ALL TO authenticated
  USING ((pmms.current_access_level() = 'manager'::text) AND (pmms.current_division() IS NULL))
  WITH CHECK ((pmms.current_access_level() = 'manager'::text) AND (pmms.current_division() IS NULL));

-- error_logs
CREATE POLICY "admin_read" ON pmms.error_logs AS PERMISSIVE FOR SELECT TO authenticated
  USING (pmms.current_access_level() = 'admin'::text);
CREATE POLICY "manager_division_scoped_read" ON pmms.error_logs AS PERMISSIVE FOR SELECT TO authenticated
  USING ((pmms.current_access_level() = 'manager'::text) AND ((pmms.current_division() IS NULL) OR (pmms.staff_division(staff_id) = pmms.current_division())));
CREATE POLICY "self_insert" ON pmms.error_logs AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (true);

-- events
CREATE POLICY "admin_full_access" ON pmms.events AS PERMISSIVE FOR ALL TO authenticated
  USING (pmms.current_access_level() = 'admin'::text)
  WITH CHECK (pmms.current_access_level() = 'admin'::text);
CREATE POLICY "manager_create_gated" ON pmms.events AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((pmms.current_access_level() = 'admin'::text) OR ((pmms.current_access_level() = 'manager'::text) AND pmms.current_can_create_events()));
CREATE POLICY "manager_read_and_link" ON pmms.events AS PERMISSIVE FOR SELECT TO authenticated
  USING (pmms.is_admin_or_manager());
CREATE POLICY "manager_update_any" ON pmms.events AS PERMISSIVE FOR UPDATE TO authenticated
  USING (pmms.is_admin_or_manager())
  WITH CHECK (pmms.is_admin_or_manager());

-- impersonation_events
CREATE POLICY "admin_full_access" ON pmms.impersonation_events AS PERMISSIVE FOR ALL TO authenticated
  USING (pmms.current_access_level() = 'admin'::text)
  WITH CHECK (pmms.current_access_level() = 'admin'::text);

-- login_events
CREATE POLICY "admin_read" ON pmms.login_events AS PERMISSIVE FOR SELECT TO authenticated
  USING (pmms.current_access_level() = 'admin'::text);
CREATE POLICY "manager_division_scoped_read" ON pmms.login_events AS PERMISSIVE FOR SELECT TO authenticated
  USING ((pmms.current_access_level() = 'manager'::text) AND ((pmms.current_division() IS NULL) OR (pmms.staff_division(staff_id) = pmms.current_division())));
CREATE POLICY "self_insert" ON pmms.login_events AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (email = (auth.jwt() ->> 'email'::text));

-- notifications
CREATE POLICY "admin_full_access" ON pmms.notifications AS PERMISSIVE FOR ALL TO authenticated
  USING (pmms.current_access_level() = 'admin'::text)
  WITH CHECK (pmms.current_access_level() = 'admin'::text);
CREATE POLICY "builder_read_own" ON pmms.notifications AS PERMISSIVE FOR SELECT TO authenticated
  USING ((pmms.current_access_level() = 'builder'::text) AND (staff_id = pmms.current_staff_id()));
CREATE POLICY "builder_update_own" ON pmms.notifications AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((pmms.current_access_level() = 'builder'::text) AND (staff_id = pmms.current_staff_id()))
  WITH CHECK ((pmms.current_access_level() = 'builder'::text) AND (staff_id = pmms.current_staff_id()));
CREATE POLICY "manager_division_scoped_access" ON pmms.notifications AS PERMISSIVE FOR ALL TO authenticated
  USING ((pmms.current_access_level() = 'manager'::text) AND ((pmms.current_division() IS NULL) OR (pmms.staff_division(staff_id) = pmms.current_division())))
  WITH CHECK ((pmms.current_access_level() = 'manager'::text) AND ((pmms.current_division() IS NULL) OR (pmms.staff_division(staff_id) = pmms.current_division())));

-- properties
CREATE POLICY "admin_manager_full_access" ON pmms.properties AS PERMISSIVE FOR ALL TO authenticated
  USING (pmms.is_admin_or_manager())
  WITH CHECK (pmms.is_admin_or_manager());

-- property_assets
CREATE POLICY "admin_manager_full_access" ON pmms.property_assets AS PERMISSIVE FOR ALL TO authenticated
  USING (pmms.is_admin_or_manager())
  WITH CHECK (pmms.is_admin_or_manager());

-- property_compliance
CREATE POLICY "admin_manager_full_access" ON pmms.property_compliance AS PERMISSIVE FOR ALL TO authenticated
  USING (pmms.is_admin_or_manager())
  WITH CHECK (pmms.is_admin_or_manager());

-- property_documents
CREATE POLICY "admin_manager_full_access" ON pmms.property_documents AS PERMISSIVE FOR ALL TO authenticated
  USING (pmms.is_admin_or_manager())
  WITH CHECK (pmms.is_admin_or_manager());

-- property_notes
CREATE POLICY "admin_manager_full_access" ON pmms.property_notes AS PERMISSIVE FOR ALL TO authenticated
  USING (pmms.is_admin_or_manager())
  WITH CHECK (pmms.is_admin_or_manager());

-- property_room_history
CREATE POLICY "admin_manager_full_access" ON pmms.property_room_history AS PERMISSIVE FOR ALL TO authenticated
  USING (pmms.is_admin_or_manager())
  WITH CHECK (pmms.is_admin_or_manager());

-- property_rooms
CREATE POLICY "admin_manager_full_access" ON pmms.property_rooms AS PERMISSIVE FOR ALL TO authenticated
  USING (pmms.is_admin_or_manager())
  WITH CHECK (pmms.is_admin_or_manager());

-- push_subscriptions
CREATE POLICY "admin_read" ON pmms.push_subscriptions AS PERMISSIVE FOR SELECT TO authenticated
  USING (pmms.current_access_level() = 'admin'::text);
CREATE POLICY "manager_division_scoped_read" ON pmms.push_subscriptions AS PERMISSIVE FOR SELECT TO authenticated
  USING ((pmms.current_access_level() = 'manager'::text) AND ((pmms.current_division() IS NULL) OR (pmms.staff_division(staff_id) = pmms.current_division())));
CREATE POLICY "self_manage" ON pmms.push_subscriptions AS PERMISSIVE FOR ALL TO authenticated
  USING (staff_id = pmms.current_staff_id())
  WITH CHECK (staff_id = pmms.current_staff_id());

-- settings
CREATE POLICY "admin_manager_full_access" ON pmms.settings AS PERMISSIVE FOR ALL TO authenticated
  USING (pmms.is_admin_or_manager())
  WITH CHECK (pmms.is_admin_or_manager());
CREATE POLICY "any_authenticated_read" ON pmms.settings AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

-- staff_availability
CREATE POLICY "admin_full_access" ON pmms.staff_availability AS PERMISSIVE FOR ALL TO authenticated
  USING (pmms.current_access_level() = 'admin'::text)
  WITH CHECK (pmms.current_access_level() = 'admin'::text);
CREATE POLICY "manager_division_scoped_access" ON pmms.staff_availability AS PERMISSIVE FOR ALL TO authenticated
  USING ((pmms.current_access_level() = 'manager'::text) AND ((pmms.current_division() IS NULL) OR (pmms.staff_division(staff_id) = pmms.current_division())))
  WITH CHECK ((pmms.current_access_level() = 'manager'::text) AND ((pmms.current_division() IS NULL) OR (pmms.staff_division(staff_id) = pmms.current_division())));

-- staff_roles
-- (recent fix: admin-only write, split out from a separate self-read-any-level
-- policy — captured here verbatim as currently defined in the sandbox)
CREATE POLICY "admin_full_access" ON pmms.staff_roles AS PERMISSIVE FOR ALL TO authenticated
  USING (pmms.current_access_level() = 'admin'::text)
  WITH CHECK (pmms.current_access_level() = 'admin'::text);
CREATE POLICY "admin_manager_read" ON pmms.staff_roles AS PERMISSIVE FOR SELECT TO authenticated
  USING (pmms.is_admin_or_manager());
CREATE POLICY "builder_read_own_role" ON pmms.staff_roles AS PERMISSIVE FOR SELECT TO authenticated
  USING ((pmms.current_access_level() = 'builder'::text) AND (staff_id = pmms.current_staff_id()));

-- tickets
-- (3-way split: admin full access / manager unscoped full access / manager
-- division-scoped access, plus separate builder-specific policies)
CREATE POLICY "admin_full_access" ON pmms.tickets AS PERMISSIVE FOR ALL TO authenticated
  USING (pmms.current_access_level() = 'admin'::text)
  WITH CHECK (pmms.current_access_level() = 'admin'::text);
CREATE POLICY "builder_claim_unassigned" ON pmms.tickets AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((pmms.current_access_level() = 'builder'::text) AND (assigned_builder_id IS NULL) AND ((pmms.current_division() IS NULL) OR (pmms.category_division(category) = pmms.current_division())))
  WITH CHECK ((pmms.current_access_level() = 'builder'::text) AND (assigned_builder_id = pmms.current_staff_id()));
CREATE POLICY "builder_insert_own" ON pmms.tickets AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((pmms.current_access_level() = 'builder'::text) AND (raised_by = pmms.current_staff_id()));
CREATE POLICY "builder_select_open_or_own" ON pmms.tickets AS PERMISSIVE FOR SELECT TO authenticated
  USING ((pmms.current_access_level() = 'builder'::text) AND ((status <> ALL (ARRAY['Completed'::text, 'Archived'::text, 'Cancelled'::text])) OR (assigned_builder_id = pmms.current_staff_id()) OR (raised_by = pmms.current_staff_id())));
CREATE POLICY "builder_update_own" ON pmms.tickets AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((pmms.current_access_level() = 'builder'::text) AND ((assigned_builder_id = pmms.current_staff_id()) OR (raised_by = pmms.current_staff_id())))
  WITH CHECK ((pmms.current_access_level() = 'builder'::text) AND ((assigned_builder_id = pmms.current_staff_id()) OR (raised_by = pmms.current_staff_id())));
CREATE POLICY "manager_division_scoped_access" ON pmms.tickets AS PERMISSIVE FOR ALL TO authenticated
  USING ((pmms.current_access_level() = 'manager'::text) AND (pmms.current_division() IS NOT NULL) AND (pmms.category_division(category) = pmms.current_division()))
  WITH CHECK ((pmms.current_access_level() = 'manager'::text) AND (pmms.current_division() IS NOT NULL) AND (pmms.category_division(category) = pmms.current_division()));
CREATE POLICY "manager_unscoped_full_access" ON pmms.tickets AS PERMISSIVE FOR ALL TO authenticated
  USING ((pmms.current_access_level() = 'manager'::text) AND (pmms.current_division() IS NULL))
  WITH CHECK ((pmms.current_access_level() = 'manager'::text) AND (pmms.current_division() IS NULL));

-- work_sessions
CREATE POLICY "admin_full_access" ON pmms.work_sessions AS PERMISSIVE FOR ALL TO authenticated
  USING (pmms.current_access_level() = 'admin'::text)
  WITH CHECK (pmms.current_access_level() = 'admin'::text);
CREATE POLICY "builder_own_sessions_insert" ON pmms.work_sessions AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((pmms.current_access_level() = 'builder'::text) AND (builder_id = pmms.current_staff_id()));
CREATE POLICY "builder_own_sessions_select" ON pmms.work_sessions AS PERMISSIVE FOR SELECT TO authenticated
  USING ((pmms.current_access_level() = 'builder'::text) AND (builder_id = pmms.current_staff_id()));
CREATE POLICY "builder_own_sessions_update" ON pmms.work_sessions AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((pmms.current_access_level() = 'builder'::text) AND (builder_id = pmms.current_staff_id()))
  WITH CHECK ((pmms.current_access_level() = 'builder'::text) AND (builder_id = pmms.current_staff_id()));
CREATE POLICY "manager_division_scoped_access" ON pmms.work_sessions AS PERMISSIVE FOR ALL TO authenticated
  USING ((pmms.current_access_level() = 'manager'::text) AND ((pmms.current_division() IS NULL) OR (pmms.staff_division(builder_id) = pmms.current_division())))
  WITH CHECK ((pmms.current_access_level() = 'manager'::text) AND ((pmms.current_division() IS NULL) OR (pmms.staff_division(builder_id) = pmms.current_division())));

-- =============================================================================
-- End of file
-- =============================================================================
