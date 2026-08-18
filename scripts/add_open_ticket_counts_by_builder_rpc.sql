-- Second half of the submitter auto-assign gap: suggestAutoAssignBuilder
-- also reads every open ticket's assigned_builder_id to pick the LEAST
-- busy eligible builder, but a submitter's session can only see tickets
-- she raised herself (submitter_select_own), so that read came back
-- empty under her session too -- not a hard failure like staff_roles was
-- (it still assigned someone, just always the alphabetically-first
-- eligible candidate rather than the genuinely least-loaded one).
--
-- Rather than widening submitters' direct SELECT access to pmms.tickets
-- (which would expose full ticket rows -- addresses, descriptions, notes
-- -- well beyond what this needs), this is a narrow SECURITY DEFINER RPC
-- returning only an aggregate count per builder. Matches the existing
-- pmms.builder_properties() precedent (STABLE SECURITY DEFINER, pinned
-- search_path).
create or replace function pmms.open_ticket_counts_by_builder()
returns table(builder_id uuid, open_count bigint)
language sql
stable security definer
set search_path to 'public', 'pmms'
as $function$
  select assigned_builder_id as builder_id, count(*) as open_count
  from pmms.tickets
  where assigned_builder_id is not null
    and status not in ('Completed', 'Archived', 'Cancelled')
    and pmms.current_access_level() is not null
  group by assigned_builder_id
$function$;
