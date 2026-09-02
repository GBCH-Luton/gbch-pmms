-- 5th fully-built Temporary Task type: Rent Review Update (directors' spec
-- section 5) -- "should connect directly to the main Rent Reviews section
-- rather than creating a separate duplicate record." No standalone Rent
-- Reviews system exists in PMMS, so -- same resolution as Managing Agent
-- (add_property_managing_agent_columns.sql) -- the "main record" is a set
-- of summary columns directly on pmms.properties, auto-pulled when a
-- property is selected and auto-updated whenever a Rent Review Update task
-- is logged. Current Rent already exists (rent_amount, from
-- add_property_lease_legal_columns.sql) -- only the new fields below.
alter table pmms.properties
  add column if not exists rent_review_due_date date,
  add column if not exists rent_review_status text, -- set to the most recent Update Type logged
  add column if not exists rent_review_landlord_request numeric,
  add column if not exists rent_review_gbch_offer numeric,
  add column if not exists rent_review_last_contact_date date;

-- The task itself is still the full audit-trail log entry -- every update
-- ever logged, not just the current summary above.
alter table pmms.temporary_tasks
  add column if not exists update_type text, -- Initial Landlord Contact / Landlord Requested Increase / GBCH Offer Made / Negotiation Update / Management Approval Required / Rent Agreed / Memorandum Sent / Awaiting Signature / Signed / Review Completed / Other
  add column if not exists rent_review_current_rent_snapshot numeric, -- property.rent_amount at the moment this was logged
  add column if not exists landlord_requested_rent numeric,
  add column if not exists gbch_proposed_rent numeric,
  add column if not exists agreed_rent numeric,
  add column if not exists rent_effective_date date,
  add column if not exists landlord_response text,
  add column if not exists management_decision_notes text,
  add column if not exists document_sent_date date,
  add column if not exists signature_received_date date;

notify pgrst, 'reload schema';
