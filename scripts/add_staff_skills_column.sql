-- Adds a per-builder trade-skill tag list, for routing raised tickets to
-- only the builders who can actually do that category of work (Electrical,
-- Plumbing, etc.) instead of treating every "Builder"-role staff member as
-- equally eligible for everything in the Maintenance division.
--
-- Deliberately just a flat array of category names -- no separate "skill"
-- taxonomy or scoring, reusing the same category names already managed in
-- Settings > Issue Scores (pmms.settings 'maintenance_categories'). An
-- empty/null array means "no restriction, eligible for everything," not
-- "eligible for nothing" -- every existing builder keeps working exactly
-- as today until an admin actively tags someone with specific skills.

alter table public.staff add column if not exists skills text[];
