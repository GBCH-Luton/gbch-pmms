-- Which job a builder was on when they left/returned (Buying Materials or
-- Lunch Break), captured automatically from whichever ticket is "In
-- Progress" for them at the moment they start the activity -- not
-- builder-entered. Nullable: not every activity happens mid-job (e.g. a
-- lunch break with nothing in progress at all).
alter table pmms.activity_log add column if not exists ticket_id uuid references pmms.tickets(id);
