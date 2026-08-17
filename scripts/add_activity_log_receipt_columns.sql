-- Optional receipt capture for a "Buying Materials" trip -- builders had
-- no way to record what a materials run actually cost (only a free-text
-- store name/note), and the separate "Materials Used" picker on job
-- completion is a sandbox stub that doesn't write anywhere real (see
-- lib/simsMaterialsBridge.js). This is the purchase side: an optional
-- receipt photo + total when logging back in from a materials trip
-- (activity_category = 'materials'). Both null for every other activity
-- category -- never required, never shown outside that one case.

alter table pmms.activity_log add column if not exists receipt_photo_url text;
alter table pmms.activity_log add column if not exists receipt_amount numeric;

notify pgrst, 'reload schema';
