-- Converts pmms.tickets.id from integer identity to uuid, and updates the
-- 4 dependent tables' ticket_id FK columns (comments, audit_events,
-- work_sessions, notifications) to match.
--
-- Also adds a NEW pmms.tickets.ticket_number integer column, backfilled from
-- the CURRENT id values so existing "Job #13" labels stay "Job #13" (no
-- renumbering), with its own sequence for all future inserts. This is purely
-- a human-facing display value -- tickets.id (uuid) remains the real PK/FK
-- identity going forward, same reasoning already applied to
-- public.properties.id and pmms.property_rooms.id this session.
--
-- Reason: the Support Worker system will raise/track/archive its own
-- tickets and needs a stable uuid identity for cross-system referencing.
--
-- Same add-populate-swap-drop pattern as convert_properties_id_to_uuid.sql /
-- convert_property_rooms_id_to_uuid.sql, already proven live this session.
-- Run this whole script once in the SQL Editor. Take a fresh backup
-- immediately afterward, per usual practice.

begin;

-- 1. Add the new display column, backfilled directly from the current id
--    (still integer at this point) -- so ticket_number == id for every
--    existing row, preserving continuity exactly.
alter table pmms.tickets add column ticket_number integer;
update pmms.tickets set ticket_number = id;

-- 2. Give ticket_number its own sequence, seeded to continue exactly where
--    the old identity column would have -- i.e. next value = max(id) + 1.
--    Owned by the column so it's dropped automatically if the column is
--    ever dropped, matching how identity sequences behave.
create sequence pmms.tickets_ticket_number_seq owned by pmms.tickets.ticket_number;
select setval('pmms.tickets_ticket_number_seq', coalesce((select max(ticket_number) from pmms.tickets), 0) + 1, false);
alter table pmms.tickets alter column ticket_number set default nextval('pmms.tickets_ticket_number_seq');
alter table pmms.tickets alter column ticket_number set not null;
alter table pmms.tickets add constraint tickets_ticket_number_key unique (ticket_number);

-- 3. Add new uuid columns. tickets.new_id gets a real, distinct value per
--    existing row immediately via the volatile default. Children's
--    new_ticket_id columns start null; populated in step 4.
alter table pmms.tickets add column new_id uuid not null default gen_random_uuid();
alter table pmms.comments add column new_ticket_id uuid;
alter table pmms.audit_events add column new_ticket_id uuid;
alter table pmms.work_sessions add column new_ticket_id uuid;
alter table pmms.notifications add column new_ticket_id uuid;

-- 4. Populate every child's new_ticket_id from the SAME ticket's freshly
--    generated uuid, matched via the still-intact old integer id. Rows
--    whose old ticket_id is null stay null.
update pmms.comments c
  set new_ticket_id = t.new_id
  from pmms.tickets t
  where t.id = c.ticket_id;

update pmms.audit_events a
  set new_ticket_id = t.new_id
  from pmms.tickets t
  where t.id = a.ticket_id;

update pmms.work_sessions w
  set new_ticket_id = t.new_id
  from pmms.tickets t
  where t.id = w.ticket_id;

update pmms.notifications n
  set new_ticket_id = t.new_id
  from pmms.tickets t
  where t.id = n.ticket_id;

-- 5. Guard: every row that HAD an old ticket_id must now have a
--    new_ticket_id. Aborts the whole transaction (nothing commits) if not.
do $$
declare
  bad_count integer;
begin
  select
    (select count(*) from pmms.comments where ticket_id is not null and new_ticket_id is null) +
    (select count(*) from pmms.audit_events where ticket_id is not null and new_ticket_id is null) +
    (select count(*) from pmms.work_sessions where ticket_id is not null and new_ticket_id is null) +
    (select count(*) from pmms.notifications where ticket_id is not null and new_ticket_id is null)
  into bad_count;

  if bad_count > 0 then
    raise exception 'uuid backfill mismatch: % child rows have an old ticket_id with no matching new_ticket_id -- aborting', bad_count;
  end if;
end $$;

-- 6. Drop the old integer columns. CASCADE takes each old FK constraint
--    with it (auto-named, e.g. comments_ticket_id_fkey), plus tickets' old
--    PK and its owned identity sequence -- confirmed nothing else (no view,
--    no other FK, no RLS policy) depends on these columns.
alter table pmms.comments drop column ticket_id cascade;
alter table pmms.audit_events drop column ticket_id cascade;
alter table pmms.work_sessions drop column ticket_id cascade;
alter table pmms.notifications drop column ticket_id cascade;

alter table pmms.tickets drop column id cascade;

-- 7. Rename the new columns into the old names.
alter table pmms.tickets rename column new_id to id;
alter table pmms.comments rename column new_ticket_id to ticket_id;
alter table pmms.audit_events rename column new_ticket_id to ticket_id;
alter table pmms.work_sessions rename column new_ticket_id to ticket_id;
alter table pmms.notifications rename column new_ticket_id to ticket_id;

-- 8. Re-establish constraints: PK first, then each FK matching the
--    original ON DELETE behaviour exactly -- cascade ONLY for
--    notifications, none for the other 3.
alter table pmms.tickets add constraint tickets_pkey primary key (id);

alter table pmms.comments
  add constraint comments_ticket_id_fkey
  foreign key (ticket_id) references pmms.tickets (id);

alter table pmms.audit_events
  add constraint audit_events_ticket_id_fkey
  foreign key (ticket_id) references pmms.tickets (id);

alter table pmms.work_sessions
  add constraint work_sessions_ticket_id_fkey
  foreign key (ticket_id) references pmms.tickets (id);

alter table pmms.notifications
  add constraint notifications_ticket_id_fkey
  foreign key (ticket_id) references pmms.tickets (id) on delete cascade;

commit;

notify pgrst, 'reload schema';
