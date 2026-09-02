-- 4th fully-built Temporary Task type: External Agency / Third-Party Task
-- (directors' spec section 4). Reuses reference_case_number,
-- escalation_required (already added for Neighbour Complaint -- same
-- concept) and the standard follow_up_date field for "Next Chase Date".
-- contact_method also reuses the column Landlord Contact already added --
-- same concept (how contact happened), just a shorter option list here.
alter table pmms.temporary_tasks
  add column if not exists external_agency_type text, -- Managing Agent / Freeholder / Block Management / Local Authority / Estate Agent / Landlord / Neighbouring Property / Contractor / Insurer / Police / Fire Service / Utility Company / Other
  add column if not exists organisation_name text,
  add column if not exists contact_person text,
  add column if not exists initial_contact_date date,
  add column if not exists action_required_from_them text,
  add column if not exists evidence_sent boolean,
  add column if not exists response_received boolean,
  add column if not exists response_details text,
  add column if not exists external_source_outside_property boolean, -- gates the External Property Issues fields below
  add column if not exists external_issue_type text, -- Leak / Structural Damage / Water Damage / Access Issue / Drainage / Roof / Boundary or Fence / Tree or Vegetation / Criminal Damage / Other
  add column if not exists responsible_party text,
  add column if not exists source_confirmed boolean,
  add column if not exists photos_videos_uploaded boolean,
  add column if not exists external_contractor_attended boolean,
  add column if not exists source_resolved boolean,
  add column if not exists gbch_damage_repaired boolean,
  add column if not exists cost_recovery_status text, -- Not Required / To Be Claimed / Submitted / Agreed / Disputed / Part Paid / Paid
  add column if not exists external_task_outcome_text text;

notify pgrst, 'reload schema';
