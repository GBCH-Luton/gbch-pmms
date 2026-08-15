-- Adds the "Landlord Liaison" division, same recipe as Compliance
-- (see memory: project_compliance_division.md): a division name, a
-- ticket category tagged to it, and a manager role. All three settings
-- are plain jsonb, so this is additive concatenation, not a rewrite.

update pmms.settings
set setting_value = setting_value || '["Landlord Liaison"]'::jsonb,
    updated_at = now()
where setting_key = 'divisions'
  and not (setting_value @> '["Landlord Liaison"]'::jsonb);

update pmms.settings
set setting_value = setting_value || '{
  "Landlord Liaison": {
    "division": "Landlord Liaison",
    "enabled": true,
    "order": 20,
    "weight": 30,
    "subCategories": [
      { "label": "Landlord requested work", "score": 40 },
      { "label": "Landlord complaint / dispute", "score": 60 },
      { "label": "Access arrangement with landlord", "score": 30 },
      { "label": "Lease / tenancy query", "score": 25 },
      { "label": "Landlord communication follow-up", "score": 20 }
    ]
  }
}'::jsonb,
    updated_at = now()
where setting_key = 'maintenance_categories'
  and not (setting_value ? 'Landlord Liaison');

update pmms.settings
set setting_value = setting_value || '[{
  "accessLevel": "manager",
  "canCreateEvents": true,
  "division": "Landlord Liaison",
  "hideSettings": true,
  "name": "Landlord Liaison Manager"
}]'::jsonb,
    updated_at = now()
where setting_key = 'custom_roles'
  and not (setting_value @> '[{"name": "Landlord Liaison Manager"}]'::jsonb);

notify pgrst, 'reload schema';
