-- Mileage per day/month needs to know WHEN each trip happened, not just how
-- many miles -- there was no such timestamp before this. mileage_logged and
-- transit_start are both set at the moment a builder clocks in to start a
-- job (BuilderDashboard.jsx's clock-in handler), so that's the real "trip
-- date". status_changed_at can't stand in for it: it gets overwritten by
-- every later status change (Completed, Archived, reopened...), so by the
-- time anyone looks it no longer reflects the original clock-in moment.
--
-- Backfill for existing rows approximates with created_at (when the ticket
-- was raised) since no better historical value exists -- imprecise for any
-- job that sat in the queue a while before being started, but it's the same
-- approximation BuilderDashboard.jsx's "This Month" mileage total already
-- silently relied on. Every new trip going forward gets the real moment.

alter table pmms.tickets add column if not exists mileage_logged_at timestamptz;

update pmms.tickets
set mileage_logged_at = created_at
where mileage_logged is not null
  and mileage_logged > 0
  and mileage_logged_at is null;
