-- Manager-only field: how long a job is expected to take, set when the
-- ticket is assigned/reassigned (AdminRaiseTicket.jsx / AdminPipeline.jsx's
-- Reassign modal). Never selected by BuilderDashboard.jsx's ticket queries,
-- so it stays invisible to builders by omission -- there's no column-level
-- RLS in Postgres, this is the same "trusted client just doesn't ask for
-- it" pattern already used elsewhere in this app.
alter table pmms.tickets add column if not exists estimated_minutes integer;
