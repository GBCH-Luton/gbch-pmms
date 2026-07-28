-- Registers the daily job that calls check-compliance-expiry. Expiry
-- dates don't move minute to minute (unlike ticket status), so this runs
-- once a day rather than every 15 minutes like check-stuck-tickets.
--
-- Reuses the same CRON_SECRET Edge Function secret already set for
-- check-stuck-tickets -- no new secret needed.

create extension if not exists pg_net;

select cron.schedule(
  'check-compliance-expiry',
  '0 6 * * *',
  $$
    select net.http_post(
      url := 'https://hfubtfohtieglrvdgblc.functions.supabase.co/check-compliance-expiry',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', 'YOUR_CRON_SECRET_HERE'
      ),
      body := '{}'::jsonb
    )
  $$
);
