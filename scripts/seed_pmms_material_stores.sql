-- Seeds the "material_stores" setting with the 8 stores that were
-- previously hardcoded into BuilderDashboard.jsx's Buying Materials
-- type-ahead, now that the list lives in Settings and is admin-managed.

insert into pmms.settings (setting_key, setting_value, updated_at)
values (
  'material_stores',
  '[
    {"name":"Screwfix Luton","active":true},
    {"name":"Screwfix Bedford","active":true},
    {"name":"B&Q Luton","active":true},
    {"name":"B&Q Bedford","active":true},
    {"name":"Wickes Luton","active":true},
    {"name":"Toolstation Luton","active":true},
    {"name":"Jewson Bedford","active":true},
    {"name":"Travis Perkins Luton","active":true}
  ]'::jsonb,
  now()
)
on conflict (setting_key) do nothing;
