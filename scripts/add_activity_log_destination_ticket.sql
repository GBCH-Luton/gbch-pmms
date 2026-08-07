-- "Leaving Site" only distinguished shop errands from lunch breaks -- a
-- builder driving between two of his own jobs had nowhere to log that,
-- so the gap looked like unaccounted-for time. New third option
-- ("Going to Another Job") lets him pick which of his own assigned
-- tickets he's heading to; this column records it, separate from the
-- existing ticket_id (which already means "the job he was mid-way
-- through when he stepped away", auto-captured, not builder-chosen).

alter table pmms.activity_log add column if not exists destination_ticket_id uuid;
