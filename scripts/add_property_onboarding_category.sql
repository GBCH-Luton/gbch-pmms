-- Seeds a "Property Onboarding" ticket category so tickets raised from a
-- Property Onboarding walk (add_property_onboarding_tables.sql) show up in
-- Pipeline/Reports/priority-scoring like any other ticket, instead of
-- needing a special case. Routed to the Maintenance division (general
-- property-condition issues, same pool of builders as everything else) --
-- same additive jsonb-concatenation recipe as add_landlord_liaison_division.sql.
-- Sub-category scores are deliberately modest: a pre-occupancy condition
-- check, not an active emergency, except Safety which scores higher in
-- line with how Electricity/Plumbing's genuinely urgent sub-categories score.
update pmms.settings
set setting_value = setting_value || '{
  "Property Onboarding": {
    "division": "Maintenance",
    "enabled": true,
    "order": 30,
    "weight": 20,
    "subCategories": [
      { "label": "Walls, ceiling & decoration", "score": 15 },
      { "label": "Flooring", "score": 20 },
      { "label": "Windows, doors & locks", "score": 30 },
      { "label": "Fixtures & fittings", "score": 20 },
      { "label": "Safety (smoke alarm / sockets / trip hazards)", "score": 45 },
      { "label": "Landlord-agreed extra work", "score": 15 },
      { "label": "Flagged by Landlord Liaison", "score": 25 },
      { "label": "Missed item found during review", "score": 25 }
    ]
  }
}'::jsonb,
    updated_at = now()
where setting_key = 'maintenance_categories'
  and not (setting_value ? 'Property Onboarding');

notify pgrst, 'reload schema';
