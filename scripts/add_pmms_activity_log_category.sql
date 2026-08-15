-- Distinct category per activity_log row, so admin-side displays (Where's
-- the Team, Clocking history) and duration reporting can tell "Buying
-- Materials" apart from "Going to Another Job" / "Going to the Office" /
-- "Lunch Break" instead of all four collapsing into a single generic
-- "Travelling" label (only activity_type + free-text note existed before).
-- One of: 'materials' | 'job' | 'office' | 'lunch'.

alter table pmms.activity_log add column if not exists activity_category text;

notify pgrst, 'reload schema';
