-- Removes the draft pmms schema from the OLD (company) project now that it's
-- been fully copied to the sandbox project. Does not touch public.staff or
-- anything else in public -- those are shared with the rest of the company
-- system and are untouched by this.
--
-- Uses RESTRICT (not CASCADE): if anything outside pmms unexpectedly depends
-- on one of these tables, this will fail loudly and name the object, instead
-- of silently dropping it too. If it fails, stop and investigate before
-- retrying with CASCADE.

drop schema pmms restrict;
