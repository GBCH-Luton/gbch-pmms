-- New "Assign Type" column shown in Pipeline (Auto vs Manual), so a
-- manager can tell at a glance whether a ticket's current builder was
-- chosen by a system automation (the Cleaners Rota cron job, or the
-- "builder deactivated" auto-reassign fallback -- see
-- check-routine-visits-due/index.ts and shared.jsx) or by a person
-- (Log a Ticket / Reassign / Bulk Reassign, all of which explicitly set
-- this back to 'Manual' -- so a human taking over an auto-routed job
-- flips it correctly).
alter table pmms.tickets add column if not exists assign_type text not null default 'Manual';
