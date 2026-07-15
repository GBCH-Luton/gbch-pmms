-- Registers the daily job that calls check-routine-visits-due. Staggered
-- an hour after check-void-aging (which is an hour after
-- check-compliance-expiry).
--
-- Reuses the same CRON_SECRET Edge Function secret already set for
-- check-stuck-tickets/check-compliance-expiry/check-void-aging -- no new
-- secret needed.

select cron.schedule(
  'check-routine-visits-due',
  '0 8 * * *',
  $$
    select net.http_post(
      url := 'https://hfubtfohtieglrvdgblc.functions.supabase.co/check-routine-visits-due',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', '184285e4445895e8e690796857314ea8e3b90b290daaac6d2137b4832fa2efdd'
      ),
      body := '{}'::jsonb
    )
  $$
);
