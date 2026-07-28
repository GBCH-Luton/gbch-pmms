-- Registers the daily job that calls check-void-aging. Void duration
-- doesn't move minute to minute (unlike ticket status), so this runs
-- once a day, staggered an hour after check-compliance-expiry.
--
-- Reuses the same CRON_SECRET Edge Function secret already set for
-- check-stuck-tickets/check-compliance-expiry -- no new secret needed.

create extension if not exists pg_net;

select cron.schedule(
  'check-void-aging',
  '0 7 * * *',
  $$
    select net.http_post(
      url := 'https://hfubtfohtieglrvdgblc.functions.supabase.co/check-void-aging',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', 'YOUR_CRON_SECRET_HERE'
      ),
      body := '{}'::jsonb
    )
  $$
);
