-- Tracks time-to-first-assignment for tickets, separate from total
-- turnaround (created_at -> completed_at). Deliberately not backfilled:
-- status_changed_at's own backfill (= created_at for untouched rows)
-- makes it an unreliable proxy for "first assignment" on historical
-- tickets, so a null here just means "predates this feature" rather
-- than fabricating a universal ~0-minute response time.

alter table pmms.tickets
  add column if not exists first_assigned_at timestamptz;
