-- Key-value settings store backing the Admin "Settings" (Calibration) page.
-- setting_value is jsonb so it can hold numbers, booleans, or arrays/objects
-- (e.g. the on-call roster) under a single simple key-value shape.

create table if not exists pmms.settings (
  setting_key text primary key,
  setting_value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Seed sensible defaults so the page has real values on first load.
insert into pmms.settings (setting_key, setting_value) values
  ('priority_threshold_p1', '70'),
  ('priority_threshold_p2', '40'),
  ('issue_score_weights', '{
    "Exposed Live Wires / Sparking": 65,
    "Complete Property Power Outage": 55,
    "Flickering Display Lights": 10,
    "Faulty Power Socket": 20,
    "Storage Heater Failure": 25,
    "Burst Pipe / Active Flooding": 65,
    "Total Loss of Cold Drinking Water": 55,
    "No Hot Water Supply": 35,
    "Clogged Primary Toilet Block": 40,
    "Slow Dripping Tap": 10,
    "Main Entrance Gate Jammed Open": 55,
    "Main Entrance Lockout / Jammed Shut": 60,
    "Fire Door Failing to Close Safely": 50,
    "Broken Outer Glazing / Window Shattered": 45,
    "Internal Bedroom Door Stuck": 35,
    "Pest Vector / Active Rodent Infestation": 35,
    "Severe Floor Fabric / Carpet Water Damage": 30,
    "Broken Safety Wall Grab Rail Loose": 40,
    "Structural Plaster Ceiling Cracking Risk": 45,
    "General Unlisted Handyman Issue Entry": 15
  }'),
  ('compliance_check_types', '{
    "Fire Door Inspection": true,
    "Fire Alarm & Detection": true,
    "Fire Extinguishers": true,
    "Emergency Lighting & Routes": true
  }'),
  ('clock_overrun_hours', '8'),
  ('done_window_hours', '24'),
  ('on_call_roster', '[]')
on conflict (setting_key) do nothing;
