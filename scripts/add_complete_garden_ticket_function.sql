-- Builders only have SELECT on pmms.properties (builder_read_only policy,
-- add_rls_per_role_batch2_properties.sql) -- there's no UPDATE policy for
-- them at all, and there shouldn't be one added broadly just for this: a
-- builder should not be able to edit arbitrary property fields (address,
-- high_vulnerability, etc). Instead, this function lets a builder stamp
-- ONLY the two garden "last attended" fields on ONE property, and only
-- when completing a ticket that's genuinely (a) their own assigned job
-- and (b) a garden-related "Grounds & External Works" subcategory --
-- verified server-side, not just trusted from the client.
create or replace function pmms.complete_garden_ticket_property_update(p_ticket_id uuid, p_attended_by text)
returns void
language plpgsql
security definer
set search_path = public, pmms
as $$
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
$$;

grant execute on function pmms.complete_garden_ticket_property_update(uuid, text) to authenticated;
