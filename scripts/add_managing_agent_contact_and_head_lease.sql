-- Revised Temporary Tasks spec (2026-09-02, 2nd pass): the Task Type list
-- is trimmed down to 6 real types -- Estate Agent/Property Viewing and
-- Lease/Renewal Follow-Up are dropped in favour of a single "Managing
-- Agent Contact" type (covers viewings/agent queries) plus a separate,
-- non-task automatic Head Lease Renewal reminder.

-- Managing Agent Contact reuses almost every column already on
-- temporary_tasks (organisation_name, contact_person, contact_datetime,
-- contact_method, reason_for_contact, details_notes, contact_outcome_text,
-- responsible_person_department, follow_up_date, evidence_url) -- only 3
-- genuinely new fields, which also retroactively fill a gap in Landlord
-- Contact (its own spec always had "Action Required? Yes/No -> If Yes:
-- Action Required" too; this was missed when that type was first built).
alter table pmms.temporary_tasks
  add column if not exists action_required boolean,
  add column if not exists action_required_detail text,
  add column if not exists follow_up_required boolean;

-- Head Lease Renewal -- "does not need to operate as a normal task type at
-- the moment", just an automatic reminder: renewal date = signed date + 6
-- years, LLO notified 3 months before. alert_sent_at re-arms itself
-- whenever head_lease_signed_date changes (see PropertyLeaseLegalTab.jsx),
-- same pattern as property_compliance's aging_alert_sent_at.
alter table pmms.properties
  add column if not exists head_lease_signed_date date,
  add column if not exists head_lease_renewal_alert_sent_at timestamptz;

notify pgrst, 'reload schema';
