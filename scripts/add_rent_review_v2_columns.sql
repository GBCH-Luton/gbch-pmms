-- Directors' 2nd-pass Rent Review update (2026-09-03): the "Follow-Up
-- Needed?" finalise step (upload the signed agreement) on the Rent Review
-- Update task type, plus the fuller "current rent, previous rent, last
-- review date, next review due, agreed new rent, signed agreement" picture
-- the spec wants visible on the Property Profile. Payment history (Farha
-- logging rent payments received) is explicitly deferred -- she'll get her
-- own Finance system later, not a PMMS access grant.
--
-- See AdminTemporaryTasks.jsx's Rent Review Update block and handleSave,
-- and PropertyLeaseLegalTab.jsx's Rent Review Status block + Financials
-- saveFields.

-- The uploaded signed PDF for one Rent Review Update log entry -- separate
-- from the generic evidence_url (Standard Fields' "Evidence /
-- Attachments"), since this one also propagates to the property's own
-- rent_review_signed_document_url below.
alter table pmms.temporary_tasks add column if not exists signed_document_url text;

-- "Next Follow-Up: selected follow-up date" from the spec's own worked
-- example -- mirrors temporary_tasks.follow_up_date, kept in sync by
-- AdminTemporaryTasks.jsx same as the other rent_review_* columns.
alter table pmms.properties add column if not exists rent_review_next_follow_up_date date;
-- What was actually agreed once both parties sign -- deliberately separate
-- from rent_amount below, since Adnan updates that manually once the
-- standing order itself changes (real-world process), not automatically
-- the moment the review is logged as finalised.
alter table pmms.properties add column if not exists rent_review_agreed_rent_amount numeric;
alter table pmms.properties add column if not exists rent_review_signed_document_url text;
-- Snapshotted automatically whenever Financials' Weekly Rent Amount
-- (rent_amount) actually changes -- see PropertyLeaseLegalTab.jsx's
-- saveFields, same "capture the old value before it's overwritten"
-- pattern used nowhere else on this table yet.
alter table pmms.properties add column if not exists previous_rent_amount numeric;
alter table pmms.properties add column if not exists last_rent_review_date date;
