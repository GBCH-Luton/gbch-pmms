-- Seeds 3 additional properties and 5 additional tickets for testing.
-- Assumes pmms.tickets has a property_id FK referencing pmms.properties(id) —
-- adjust the column name below if your schema differs.

with new_properties as (
  insert into pmms.properties (address, electrical_shutoff, gas_shutoff, safeguards)
  values
    ('14 Mallow Court, Bristol, BS8 4RT', 'Fuse box under the stairs, left of the front door', 'Gas meter in the side alley cupboard', 'Elderly resident, hard of hearing — knock loudly and wait'),
    ('27 Chestnut Grove, Manchester, M20 3PL', 'Consumer unit in the hallway cupboard', 'External meter box, right of the garage', 'Dog on premises — keep back gate closed at all times'),
    ('9 Willowbank Road, Edinburgh, EH10 5JG', 'Fuse box in the kitchen, above the counter', 'Gas meter under the stairs', 'No safeguarding concerns on file')
  returning id, address
),
ordered_properties as (
  select id, address, row_number() over (order by address) as rn
  from new_properties
)

insert into pmms.tickets (
  property_id, assigned_builder_id, status, category, description, room,
  priority_score, completed_at
)
select op.id as property_id, t.builder_id, t.status, t.category, t.description, t.room, t.priority_score, t.completed_at
from (
  values
    (1, '59767397-3b26-474e-a6d2-31ee9d3ec055'::uuid, 'Assigned',    'Plumbing',   'Leaking radiator valve needs replacing', 'Living room', 45, null::timestamptz),
    (1, '59767397-3b26-474e-a6d2-31ee9d3ec055'::uuid, 'In Progress', 'Electrical', 'Kitchen socket not working',             'Kitchen',     72, null),
    (2, '59767397-3b26-474e-a6d2-31ee9d3ec055'::uuid, 'On Hold',     'Carpentry',  'Bedroom door sticking, needs planing',   'Bedroom 2',   28, null),
    (2, '59767397-3b26-474e-a6d2-31ee9d3ec055'::uuid, 'Completed',   'General',    'Replace broken smoke alarm battery',     'Hallway',     20, now()),
    (3, '59767397-3b26-474e-a6d2-31ee9d3ec055'::uuid, 'Completed',   'Plumbing',   'Fix dripping tap in bathroom',           'Bathroom',    90, now())
) as t(prop_rn, builder_id, status, category, description, room, priority_score, completed_at)
join ordered_properties op on op.rn = t.prop_rn;
